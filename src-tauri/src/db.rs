use std::path::{Path, PathBuf};

use rusqlite::{params, Connection};
use thiserror::Error;

use crate::file_access::is_icloud_pending;
use crate::models::{AnalysisResult, ScanResult, Track};

#[derive(Debug, Error)]
pub enum DbError {
    #[error("database error: {0}")]
    Sqlite(#[from] rusqlite::Error),
    #[error("io error: {0}")]
    Io(#[from] std::io::Error),
}

pub struct Database {
    conn: Connection,
}

impl Database {
    pub fn open(path: &Path) -> Result<Self, DbError> {
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent)?;
        }

        let conn = Connection::open(path)?;
        let db = Self { conn };
        db.init_schema()?;
        Ok(db)
    }

    fn init_schema(&self) -> Result<(), DbError> {
        self.conn.execute_batch(
            "
            CREATE TABLE IF NOT EXISTS settings (
                key TEXT PRIMARY KEY,
                value TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS tracks (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                path TEXT NOT NULL UNIQUE,
                filename TEXT NOT NULL,
                duration REAL,
                bpm REAL,
                rms REAL,
                onset_rate REAL,
                spectral_centroid REAL,
                energy_raw REAL,
                energy_normalized INTEGER,
                analyzed_at TEXT,
                file_mtime INTEGER NOT NULL DEFAULT 0,
                missing INTEGER NOT NULL DEFAULT 0,
                created_at TEXT NOT NULL DEFAULT (datetime('now'))
            );

            CREATE INDEX IF NOT EXISTS idx_tracks_path ON tracks(path);
            ",
        )?;
        let _ = self
            .conn
            .execute("ALTER TABLE tracks ADD COLUMN analysis_error TEXT", []);
        let _ = self.conn.execute(
            "ALTER TABLE tracks ADD COLUMN is_icloud INTEGER NOT NULL DEFAULT 0",
            [],
        );
        Ok(())
    }

    pub fn get_setting(&self, key: &str) -> Result<Option<String>, DbError> {
        let mut stmt = self
            .conn
            .prepare("SELECT value FROM settings WHERE key = ?1")?;
        let mut rows = stmt.query(params![key])?;
        if let Some(row) = rows.next()? {
            Ok(Some(row.get(0)?))
        } else {
            Ok(None)
        }
    }

    pub fn set_setting(&self, key: &str, value: &str) -> Result<(), DbError> {
        self.conn.execute(
            "INSERT INTO settings (key, value) VALUES (?1, ?2)
             ON CONFLICT(key) DO UPDATE SET value = excluded.value",
            params![key, value],
        )?;
        Ok(())
    }

    pub fn list_tracks(&self) -> Result<Vec<Track>, DbError> {
        let mut stmt = self.conn.prepare(
            "SELECT id, path, filename, duration, bpm, rms, onset_rate,
                    spectral_centroid, energy_raw, energy_normalized, analyzed_at,
                    analysis_error, is_icloud, missing
             FROM tracks
             WHERE missing = 0
             ORDER BY filename COLLATE NOCASE ASC",
        )?;

        let tracks = stmt
            .query_map([], |row| {
                Ok(Track {
                    id: row.get(0)?,
                    path: row.get(1)?,
                    filename: row.get(2)?,
                    duration: row.get(3)?,
                    bpm: row.get(4)?,
                    rms: row.get(5)?,
                    onset_rate: row.get(6)?,
                    spectral_centroid: row.get(7)?,
                    energy_raw: row.get(8)?,
                    energy_normalized: row.get(9)?,
                    analyzed_at: row.get(10)?,
                    analysis_error: row.get(11)?,
                    is_icloud: row.get::<_, i64>(12)? != 0,
                    missing: row.get::<_, i64>(13)? != 0,
                })
            })?
            .collect::<Result<Vec<_>, _>>()?;

        Ok(tracks)
    }

    pub fn upsert_scanned_files(&self, files: &[(PathBuf, i64)]) -> Result<ScanResult, DbError> {
        let root = self
            .get_setting("music_root")?
            .unwrap_or_default();

        let mut added = 0usize;
        let mut updated = 0usize;
        let mut icloud_pending = 0usize;
        let seen_paths: Vec<String> = files
            .iter()
            .map(|(path, _)| path.to_string_lossy().into_owned())
            .collect();

        for (path, mtime) in files {
            let path_str = path.to_string_lossy();
            let filename = path
                .file_name()
                .map(|name| name.to_string_lossy().into_owned())
                .unwrap_or_else(|| path_str.to_string());
            let icloud = is_icloud_pending(path);
            if icloud {
                icloud_pending += 1;
            }

            let existing: Option<(i64, i64)> = self.conn.query_row(
                "SELECT id, file_mtime FROM tracks WHERE path = ?1",
                params![path_str.as_ref()],
                |row| Ok((row.get(0)?, row.get(1)?)),
            ).ok();

            if let Some((_, old_mtime)) = existing {
                if old_mtime != *mtime {
                    self.conn.execute(
                        "UPDATE tracks SET filename = ?1, file_mtime = ?2, missing = 0, is_icloud = ?3 WHERE path = ?4",
                        params![filename, mtime, icloud as i64, path_str.as_ref()],
                    )?;
                    updated += 1;
                } else {
                    self.conn.execute(
                        "UPDATE tracks SET missing = 0, is_icloud = ?1 WHERE path = ?2",
                        params![icloud as i64, path_str.as_ref()],
                    )?;
                }
            } else {
                self.conn.execute(
                    "INSERT INTO tracks (path, filename, file_mtime, missing, is_icloud)
                     VALUES (?1, ?2, ?3, 0, ?4)",
                    params![path_str.as_ref(), filename, mtime, icloud as i64],
                )?;
                added += 1;
            }
        }

        if !seen_paths.is_empty() {
            let placeholders = seen_paths
                .iter()
                .map(|_| "?")
                .collect::<Vec<_>>()
                .join(", ");
            let sql = format!(
                "UPDATE tracks SET missing = 1 WHERE missing = 0 AND path NOT IN ({placeholders})"
            );
            let args: Vec<&dyn rusqlite::ToSql> =
                seen_paths.iter().map(|p| p as &dyn rusqlite::ToSql).collect();
            self.conn.execute(&sql, args.as_slice())?;
        }

        let total = self.conn.query_row(
            "SELECT COUNT(*) FROM tracks WHERE missing = 0",
            [],
            |row| row.get(0),
        )?;

        Ok(ScanResult {
            root,
            added,
            updated,
            total,
            icloud_pending,
        })
    }

    pub fn update_analysis(&self, path: &str, result: &AnalysisResult) -> Result<(), DbError> {
        self.conn.execute(
            "UPDATE tracks SET
                duration = ?1,
                bpm = ?2,
                rms = ?3,
                onset_rate = ?4,
                spectral_centroid = ?5,
                energy_raw = ?6,
                analyzed_at = datetime('now'),
                analysis_error = NULL
             WHERE path = ?7",
            params![
                result.duration,
                result.bpm,
                result.rms,
                result.onset_rate,
                result.spectral_centroid,
                result.energy_raw,
                path,
            ],
        )?;
        Ok(())
    }

    pub fn set_analysis_error(&self, path: &str, error: &str) -> Result<(), DbError> {
        self.conn.execute(
            "UPDATE tracks SET analysis_error = ?1 WHERE path = ?2",
            params![error, path],
        )?;
        Ok(())
    }

    pub fn normalize_energy(&self) -> Result<(), DbError> {
        let mut stmt = self
            .conn
            .prepare("SELECT id, energy_raw FROM tracks WHERE missing = 0 AND energy_raw IS NOT NULL")?;
        let rows = stmt
            .query_map([], |row| Ok((row.get::<_, i64>(0)?, row.get::<_, f64>(1)?)))?
            .collect::<Result<Vec<_>, _>>()?;

        if rows.is_empty() {
            return Ok(());
        }

        let min = rows.iter().map(|(_, v)| *v).fold(f64::INFINITY, f64::min);
        let max = rows.iter().map(|(_, v)| *v).fold(f64::NEG_INFINITY, f64::max);

        for (id, value) in rows {
            let normalized = if (max - min).abs() < f64::EPSILON {
                5
            } else {
                let scaled = 1.0 + 9.0 * (value - min) / (max - min);
                scaled.round().clamp(1.0, 10.0) as i64
            };

            self.conn.execute(
                "UPDATE tracks SET energy_normalized = ?1 WHERE id = ?2",
                params![normalized, id],
            )?;
        }

        Ok(())
    }

    pub fn track_paths_by_ids(&self, ids: &[i64]) -> Result<Vec<String>, DbError> {
        if ids.is_empty() {
            return Ok(Vec::new());
        }

        let placeholders = ids.iter().map(|_| "?").collect::<Vec<_>>().join(", ");
        let sql = format!(
            "SELECT path FROM tracks WHERE missing = 0 AND id IN ({placeholders}) ORDER BY filename COLLATE NOCASE ASC"
        );
        let mut stmt = self.conn.prepare(&sql)?;
        let args: Vec<&dyn rusqlite::ToSql> =
            ids.iter().map(|id| id as &dyn rusqlite::ToSql).collect();
        let paths = stmt
            .query_map(args.as_slice(), |row| row.get(0))?
            .collect::<Result<Vec<String>, _>>()?;
        Ok(paths)
    }

    pub fn all_track_paths(&self) -> Result<Vec<String>, DbError> {
        let mut stmt = self
            .conn
            .prepare("SELECT path FROM tracks WHERE missing = 0 ORDER BY filename COLLATE NOCASE ASC")?;
        let paths = stmt
            .query_map([], |row| row.get(0))?
            .collect::<Result<Vec<String>, _>>()?;
        Ok(paths)
    }
}
