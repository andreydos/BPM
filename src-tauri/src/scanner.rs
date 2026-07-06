use std::path::{Path, PathBuf};

use walkdir::WalkDir;

const AUDIO_EXTENSIONS: &[&str] = &["mp3", "wav", "flac", "m4a", "aac", "ogg", "aiff", "aif"];

pub fn scan_folder(root: &Path) -> Result<Vec<(PathBuf, i64)>, std::io::Error> {
    let mut files = Vec::new();

    for entry in WalkDir::new(root).follow_links(false).into_iter().filter_map(|e| e.ok()) {
        if !entry.file_type().is_file() {
            continue;
        }

        let path = entry.path();
        let ext = path
            .extension()
            .and_then(|value| value.to_str())
            .map(|value| value.to_ascii_lowercase());

        if ext.as_deref().is_some_and(|value| AUDIO_EXTENSIONS.contains(&value)) {
            let metadata = entry.metadata()?;
            let mtime = metadata
                .modified()
                .ok()
                .and_then(|time| time.duration_since(std::time::UNIX_EPOCH).ok())
                .map(|duration| duration.as_secs() as i64)
                .unwrap_or(0);
            files.push((path.to_path_buf(), mtime));
        }
    }

    files.sort_by(|a, b| a.0.cmp(&b.0));
    Ok(files)
}
