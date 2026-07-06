use std::path::PathBuf;
use std::process::Command;

use serde_json::Value;
use thiserror::Error;

use crate::models::AnalysisResult;

#[derive(Debug, Error)]
pub enum AnalyzeError {
    #[error("python executable not found at {0}")]
    PythonNotFound(String),
    #[error("analysis script not found at {0}")]
    ScriptNotFound(String),
    #[error("analysis failed: {0}")]
    Failed(String),
    #[error("invalid json from analyzer: {0}")]
    InvalidJson(String),
}

pub fn project_root() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("..")
}

pub fn python_executable() -> PathBuf {
    let venv_python = project_root().join("python/venv/bin/python");
    if venv_python.exists() {
        return venv_python;
    }

    PathBuf::from("python3")
}

pub fn analysis_script() -> PathBuf {
    project_root().join("python/analyze_track.py")
}

pub fn analyze_track(path: &str) -> Result<AnalysisResult, AnalyzeError> {
    let python = python_executable();
    let script = analysis_script();

    if !script.exists() {
        return Err(AnalyzeError::ScriptNotFound(
            script.to_string_lossy().into_owned(),
        ));
    }

    let output = Command::new(&python)
        .arg(&script)
        .arg(path)
        .output()
        .map_err(|err| {
            AnalyzeError::PythonNotFound(format!("{} ({err})", python.to_string_lossy()))
        })?;

    let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();
    if stdout.is_empty() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(AnalyzeError::Failed(format!(
            "empty analyzer output: {stderr}"
        )));
    }

    let value: Value = serde_json::from_str(&stdout)
        .map_err(|err| AnalyzeError::InvalidJson(format!("{err}: {stdout}")))?;

    if let Some(error) = value.get("error").and_then(Value::as_str) {
        return Err(AnalyzeError::Failed(error.to_string()));
    }

    serde_json::from_value(value).map_err(|err| AnalyzeError::InvalidJson(err.to_string()))
}
