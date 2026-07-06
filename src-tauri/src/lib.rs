mod analyzer;
mod db;
mod file_access;
mod models;
mod scanner;

use std::path::PathBuf;
use std::sync::Mutex;

use tauri::{AppHandle, Emitter, Manager, State};
use tauri_plugin_dialog::DialogExt;

use crate::analyzer::analyze_track as run_analysis;
use crate::db::Database;
use crate::file_access::ensure_file_readable;
use crate::models::{
    AnalysisProgress, BatchAnalysisResult, ScanResult, Track,
};
use crate::scanner::scan_folder;

struct AppState {
    db: Mutex<Database>,
}

fn db_path(app: &AppHandle) -> PathBuf {
    app.path()
        .app_data_dir()
        .expect("failed to resolve app data dir")
        .join("bpm.db")
}

#[tauri::command]
fn list_tracks(state: State<'_, AppState>) -> Result<Vec<Track>, String> {
    let db = state.db.lock().map_err(|_| "database lock poisoned".to_string())?;
    db.list_tracks().map_err(|err| err.to_string())
}

#[tauri::command]
fn get_music_root(state: State<'_, AppState>) -> Result<Option<String>, String> {
    let db = state.db.lock().map_err(|_| "database lock poisoned".to_string())?;
    db.get_setting("music_root")
        .map_err(|err| err.to_string())
}

#[tauri::command]
async fn select_music_folder(app: AppHandle, state: State<'_, AppState>) -> Result<Option<ScanResult>, String> {
    let folder = app
        .dialog()
        .file()
        .set_title("Choose music folder")
        .blocking_pick_folder();

    let Some(folder) = folder else {
        return Ok(None);
    };

    let root = folder
        .into_path()
        .map_err(|err| err.to_string())?
        .to_string_lossy()
        .into_owned();

    scan_and_persist(&app, &state, &root)
}

#[tauri::command]
fn rescan_music_folder(app: AppHandle, state: State<'_, AppState>) -> Result<ScanResult, String> {
    let db = state.db.lock().map_err(|_| "database lock poisoned".to_string())?;
    let root = db
        .get_setting("music_root")
        .map_err(|err| err.to_string())?
        .ok_or_else(|| "No music folder selected yet".to_string())?;
    drop(db);

    scan_and_persist(&app, &state, &root).map(|result| result.ok_or_else(|| "Scan cancelled".to_string()))?
}

fn scan_and_persist(
    _app: &AppHandle,
    state: &State<'_, AppState>,
    root: &str,
) -> Result<Option<ScanResult>, String> {
    let files = scan_folder(root.as_ref()).map_err(|err| err.to_string())?;

    let db = state.db.lock().map_err(|_| "database lock poisoned".to_string())?;
    db.set_setting("music_root", root)
        .map_err(|err| err.to_string())?;
    let mut result = db
        .upsert_scanned_files(&files)
        .map_err(|err| err.to_string())?;
    result.root = root.to_string();
    Ok(Some(result))
}

#[tauri::command]
async fn analyze_track_by_id(
    state: State<'_, AppState>,
    track_id: i64,
) -> Result<Track, String> {
    let path = {
        let db = state.db.lock().map_err(|_| "database lock poisoned".to_string())?;
        db.track_paths_by_ids(&[track_id])
            .map_err(|err| err.to_string())?
            .into_iter()
            .next()
            .ok_or_else(|| "Track not found".to_string())?
    };

    analyze_path_and_refresh(&state, &path).await
}

#[tauri::command]
async fn analyze_tracks_by_ids(
    app: AppHandle,
    state: State<'_, AppState>,
    track_ids: Vec<i64>,
) -> Result<BatchAnalysisResult, String> {
    let paths = {
        let db = state.db.lock().map_err(|_| "database lock poisoned".to_string())?;
        db.track_paths_by_ids(&track_ids)
            .map_err(|err| err.to_string())?
    };

    run_batch_analysis(&app, &state, paths).await
}

#[tauri::command]
async fn analyze_all_tracks(
    app: AppHandle,
    state: State<'_, AppState>,
) -> Result<BatchAnalysisResult, String> {
    let paths = {
        let db = state.db.lock().map_err(|_| "database lock poisoned".to_string())?;
        db.all_track_paths().map_err(|err| err.to_string())?
    };

    run_batch_analysis(&app, &state, paths).await
}

async fn run_batch_analysis(
    app: &AppHandle,
    state: &State<'_, AppState>,
    paths: Vec<String>,
) -> Result<BatchAnalysisResult, String> {
    let total = paths.len();
    let mut analyzed = 0usize;
    let mut failed = 0usize;
    let mut icloud_failures = 0usize;
    let mut sample_error: Option<String> = None;

    for (index, path) in paths.into_iter().enumerate() {
        let current = index + 1;
        let _ = app.emit(
            "analysis-progress",
            AnalysisProgress {
                current,
                total,
                path: path.clone(),
                status: "running".to_string(),
            },
        );

        let analysis_result = ensure_file_readable(&path)
            .map_err(|err| err.to_string())
            .and_then(|_| run_analysis(&path).map_err(|err| err.to_string()));

        match analysis_result {
            Ok(result) => {
                let db = state.db.lock().map_err(|_| "database lock poisoned".to_string())?;
                db.update_analysis(&path, &result)
                    .map_err(|err| err.to_string())?;
                db.normalize_energy().map_err(|err| err.to_string())?;
                drop(db);
                analyzed += 1;
                let _ = app.emit(
                    "analysis-progress",
                    AnalysisProgress {
                        current,
                        total,
                        path: path.clone(),
                        status: "ok".to_string(),
                    },
                );
            }
            Err(err) => {
                failed += 1;
                if err.to_lowercase().contains("icloud") {
                    icloud_failures += 1;
                }
                if sample_error.is_none() {
                    sample_error = Some(err.clone());
                }

                let db = state.db.lock().map_err(|_| "database lock poisoned".to_string())?;
                let _ = db.set_analysis_error(&path, &err);
                drop(db);

                let _ = app.emit(
                    "analysis-progress",
                    AnalysisProgress {
                        current,
                        total,
                        path: path.clone(),
                        status: format!("error: {err}"),
                    },
                );
            }
        }
    }

    let _ = app.emit(
        "analysis-progress",
        AnalysisProgress {
            current: total,
            total,
            path: String::new(),
            status: "done".to_string(),
        },
    );

    Ok(BatchAnalysisResult {
        analyzed,
        failed,
        icloud_failures,
        sample_error,
    })
}

async fn analyze_path_and_refresh(
    state: &State<'_, AppState>,
    path: &str,
) -> Result<Track, String> {
    ensure_file_readable(path).map_err(|err| err.to_string())?;
    let result = run_analysis(path).map_err(|err| err.to_string())?;

    let db = state.db.lock().map_err(|_| "database lock poisoned".to_string())?;
    db.update_analysis(path, &result)
        .map_err(|err| err.to_string())?;
    db.normalize_energy().map_err(|err| err.to_string())?;

    db.list_tracks()
        .map_err(|err| err.to_string())?
        .into_iter()
        .find(|track| track.path == path)
        .ok_or_else(|| "Track not found after analysis".to_string())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .setup(|app| {
            let db = Database::open(&db_path(app.handle()))
                .expect("failed to open database");
            app.manage(AppState {
                db: Mutex::new(db),
            });
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            list_tracks,
            get_music_root,
            select_music_folder,
            rescan_music_folder,
            analyze_track_by_id,
            analyze_tracks_by_ids,
            analyze_all_tracks,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
