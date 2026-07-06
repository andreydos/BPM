export interface Track {
  id: number;
  path: string;
  filename: string;
  duration: number | null;
  bpm: number | null;
  rms: number | null;
  onsetRate: number | null;
  spectralCentroid: number | null;
  energyRaw: number | null;
  energyNormalized: number | null;
  analyzedAt: string | null;
  analysisError: string | null;
  isIcloud: boolean;
  missing: boolean;
}

export interface ScanResult {
  root: string;
  added: number;
  updated: number;
  total: number;
  icloudPending: number;
}

export interface AnalysisProgress {
  current: number;
  total: number;
  path: string;
  status: string;
}

export interface BatchAnalysisResult {
  analyzed: number;
  failed: number;
  icloudFailures: number;
  sampleError: string | null;
}

export function formatDuration(seconds: number | null): string {
  if (seconds == null) return "—";
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins}:${secs.toString().padStart(2, "0")}`;
}

export function formatNumber(value: number | null, digits = 1): string {
  if (value == null) return "—";
  return value.toFixed(digits);
}

export function formatAnalysisStatus(track: Track): string {
  if (track.bpm != null) return "OK";
  if (track.analysisError) return track.analysisError;
  if (track.isIcloud) return "iCloud — download in Finder first";
  return "—";
}
