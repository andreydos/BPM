use std::io::Read;
use std::path::Path;
use std::process::Command;

use crate::analyzer::AnalyzeError;

/// Returns true when macOS reports the file is an iCloud item not yet downloaded locally.
#[cfg(target_os = "macos")]
pub fn is_icloud_pending(path: &Path) -> bool {
    let path_str = path.to_string_lossy();
    let output = Command::new("mdls")
        .args([
            "-raw",
            "-name",
            "kMDItemIsUbiquitous",
            "-name",
            "kMDItemDownloadingStatus",
            path_str.as_ref(),
        ])
        .output();

    let Ok(output) = output else {
        return path_str.contains("CloudStorage") || path_str.contains("Mobile Documents");
    };

    let text = String::from_utf8_lossy(&output.stdout);
    let is_ubiquitous = text.lines().any(|line| line.trim() == "1");
    let not_downloaded = text
        .lines()
        .any(|line| line.contains("Not Downloaded") || line.contains("not downloaded"));

    is_ubiquitous && not_downloaded
}

#[cfg(not(target_os = "macos"))]
pub fn is_icloud_pending(path: &Path) -> bool {
    let path_str = path.to_string_lossy();
    path_str.contains("CloudStorage") || path_str.contains("Mobile Documents")
}

pub fn ensure_file_readable(path: &str) -> Result<(), AnalyzeError> {
    let path = Path::new(path);

    if !path.exists() {
        return Err(AnalyzeError::Failed(
            "File not found on disk.".to_string(),
        ));
    }

    if is_icloud_pending(path) {
        return Err(AnalyzeError::Failed(
            "File is not downloaded from iCloud yet. Open it in Finder and wait until the cloud icon becomes a checkmark.".to_string(),
        ));
    }

    let metadata = std::fs::metadata(path).map_err(|err| {
        AnalyzeError::Failed(format!("Cannot read file metadata: {err}"))
    })?;

    if metadata.len() == 0 {
        return Err(AnalyzeError::Failed(
            "File is empty — it may be an iCloud placeholder. Download it in Finder first.".to_string(),
        ));
    }

    let mut file = std::fs::File::open(path).map_err(|err| {
        AnalyzeError::Failed(format!(
            "Cannot open file for reading (iCloud download may be required): {err}"
        ))
    })?;

    let mut buffer = [0u8; 4096];
    let bytes_read = file.read(&mut buffer).map_err(|err| {
        AnalyzeError::Failed(format!(
            "Cannot read file data (iCloud download may be required): {err}"
        ))
    })?;

    if bytes_read == 0 {
        return Err(AnalyzeError::Failed(
            "File returned no readable data — likely not downloaded from iCloud.".to_string(),
        ));
    }

    Ok(())
}
