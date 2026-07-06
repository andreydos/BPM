use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Track {
    pub id: i64,
    pub path: String,
    pub filename: String,
    pub duration: Option<f64>,
    pub bpm: Option<f64>,
    pub rms: Option<f64>,
    pub onset_rate: Option<f64>,
    pub spectral_centroid: Option<f64>,
    pub energy_raw: Option<f64>,
    pub energy_normalized: Option<i64>,
    pub analyzed_at: Option<String>,
    pub analysis_error: Option<String>,
    pub is_icloud: bool,
    pub missing: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub struct AnalysisResult {
    pub duration: f64,
    pub bpm: f64,
    pub rms: f64,
    pub onset_rate: f64,
    pub spectral_centroid: f64,
    pub energy_raw: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ScanResult {
    pub root: String,
    pub added: usize,
    pub updated: usize,
    pub total: usize,
    pub icloud_pending: usize,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AnalysisProgress {
    pub current: usize,
    pub total: usize,
    pub path: String,
    pub status: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BatchAnalysisResult {
    pub analyzed: usize,
    pub failed: usize,
    pub icloud_failures: usize,
    pub sample_error: Option<String>,
}
