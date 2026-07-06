import { useCallback, useEffect, useMemo, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { DeckSection } from "./components/DeckSection";
import {
  AnalysisProgress,
  BatchAnalysisResult,
  ScanResult,
  Track,
  formatAnalysisStatus,
  formatDuration,
  formatNumber,
} from "./types";
import "./App.css";

function formatBatchResult(result: BatchAnalysisResult): string {
  let message = `Analysis finished. OK: ${result.analyzed}, failed: ${result.failed}.`;
  if (result.icloudFailures > 0) {
    message += ` ${result.icloudFailures} file(s) are not downloaded from iCloud — open them in Finder and retry.`;
  } else if (result.failed > 0 && result.sampleError) {
    message += ` Example error: ${result.sampleError}`;
  }
  return message;
}

function App() {
  const [tracks, setTracks] = useState<Track[]>([]);
  const [musicRoot, setMusicRoot] = useState<string | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const [status, setStatus] = useState("Choose a music folder to begin.");
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<AnalysisProgress | null>(null);
  const [deckA, setDeckA] = useState<Track | null>(null);
  const [deckB, setDeckB] = useState<Track | null>(null);
  const [crossfader, setCrossfader] = useState(0.5);
  const [syncBpm, setSyncBpm] = useState(false);
  const [masterDeck, setMasterDeck] = useState<"A" | "B">("A");

  const refreshTracks = useCallback(async () => {
    const [nextTracks, root] = await Promise.all([
      invoke<Track[]>("list_tracks"),
      invoke<string | null>("get_music_root"),
    ]);
    setTracks(nextTracks);
    setMusicRoot(root);

    setDeckA((current) => {
      if (!current) return current;
      return nextTracks.find((track) => track.id === current.id) ?? current;
    });
    setDeckB((current) => {
      if (!current) return current;
      return nextTracks.find((track) => track.id === current.id) ?? current;
    });
  }, []);

  useEffect(() => {
    void refreshTracks();
  }, [refreshTracks]);

  useEffect(() => {
    const unlistenPromise = listen<AnalysisProgress>("analysis-progress", (event) => {
      const payload = event.payload;
      setProgress(payload);

      if (payload.status === "ok" || payload.status.startsWith("error:")) {
        void refreshTracks();
      }

      if (payload.status === "done") {
        setBusy(false);
        void refreshTracks();
      }
    });

    return () => {
      void unlistenPromise.then((unlisten) => unlisten());
    };
  }, [refreshTracks]);

  const selectedCount = selectedIds.size;
  const analyzedCount = useMemo(
    () => tracks.filter((track) => track.bpm != null).length,
    [tracks],
  );
  const icloudPendingCount = useMemo(
    () => tracks.filter((track) => track.isIcloud && track.bpm == null).length,
    [tracks],
  );

  async function handleChooseFolder() {
    setBusy(true);
    setStatus("Scanning folder...");
    try {
      const result = await invoke<ScanResult | null>("select_music_folder");
      if (!result) {
        setStatus("Folder selection cancelled.");
        return;
      }
      setMusicRoot(result.root);
      await refreshTracks();
      let message = `Scanned ${result.root}. Added ${result.added}, updated ${result.updated}. Total: ${result.total}.`;
      if (result.icloudPending > 0) {
        message += ` ${result.icloudPending} track(s) are still in iCloud — download them in Finder before analyzing.`;
      }
      setStatus(message);
    } catch (error) {
      setStatus(String(error));
    } finally {
      setBusy(false);
    }
  }

  async function handleRescan() {
    if (!musicRoot) return;
    setBusy(true);
    setStatus("Rescanning library...");
    try {
      const result = await invoke<ScanResult>("rescan_music_folder");
      await refreshTracks();
      let message = `Rescan complete. Added ${result.added}, updated ${result.updated}. Total: ${result.total}.`;
      if (result.icloudPending > 0) {
        message += ` ${result.icloudPending} track(s) are still in iCloud.`;
      }
      setStatus(message);
    } catch (error) {
      setStatus(String(error));
    } finally {
      setBusy(false);
    }
  }

  function toggleSelection(trackId: number) {
    setSelectedIds((current) => {
      const next = new Set(current);
      if (next.has(trackId)) next.delete(trackId);
      else next.add(trackId);
      return next;
    });
  }

  function toggleSelectAll() {
    if (selectedIds.size === tracks.length) {
      setSelectedIds(new Set());
      return;
    }
    setSelectedIds(new Set(tracks.map((track) => track.id)));
  }

  async function handleAnalyzeSelected() {
    if (selectedIds.size === 0) {
      setStatus("Select at least one track to analyze.");
      return;
    }

    setBusy(true);
    setProgress(null);
    setStatus(`Analyzing ${selectedIds.size} selected track(s)...`);
    try {
      const result = await invoke<BatchAnalysisResult>("analyze_tracks_by_ids", {
        trackIds: Array.from(selectedIds),
      });
      await refreshTracks();
      setStatus(formatBatchResult(result));
    } catch (error) {
      setStatus(String(error));
    } finally {
      setBusy(false);
      setProgress(null);
    }
  }

  async function handleAnalyzeAll() {
    if (tracks.length === 0) {
      setStatus("No tracks to analyze.");
      return;
    }

    setBusy(true);
    setProgress(null);
    setStatus(`Analyzing ${tracks.length} track(s)...`);
    try {
      const result = await invoke<BatchAnalysisResult>("analyze_all_tracks");
      await refreshTracks();
      setStatus(formatBatchResult(result));
    } catch (error) {
      setStatus(String(error));
    } finally {
      setBusy(false);
      setProgress(null);
    }
  }

  function loadTrackToDeck(track: Track, deck: "A" | "B") {
    if (deck === "A") setDeckA(track);
    else setDeckB(track);
    setStatus(`Loaded "${track.filename}" to Deck ${deck}.`);
  }

  return (
    <div className="app">
      <header className="toolbar">
        <div>
          <h1>BPM</h1>
          <p className="subtitle">Local offline track browser and analyzer</p>
        </div>
        <div className="toolbar-actions">
          <button type="button" onClick={() => void handleChooseFolder()} disabled={busy}>
            Choose folder
          </button>
          <button type="button" onClick={() => void handleRescan()} disabled={busy || !musicRoot}>
            Rescan
          </button>
          <button
            type="button"
            onClick={() => void handleAnalyzeSelected()}
            disabled={busy || selectedCount === 0}
          >
            Analyze selected
          </button>
          <button type="button" onClick={() => void handleAnalyzeAll()} disabled={busy || tracks.length === 0}>
            Analyze all
          </button>
        </div>
      </header>

      <section className="status-bar">
        <span>{status}</span>
        {musicRoot ? <span className="muted">Root: {musicRoot}</span> : null}
        <span className="muted">
          Tracks: {tracks.length} · Analyzed: {analyzedCount}
          {icloudPendingCount > 0 ? ` · iCloud pending: ${icloudPendingCount}` : ""}
        </span>
      </section>

      {progress && progress.total > 0 ? (
        <section className="progress-panel">
          <div className="progress-meta">
            <span>
              Analyzing {progress.current}/{progress.total}
            </span>
            <span className="muted">
              {progress.status === "running" || progress.status === "ok"
                ? progress.path
                : progress.status}
            </span>
          </div>
          <div className="progress-track">
            <div
              className="progress-fill"
              style={{ width: `${(progress.current / progress.total) * 100}%` }}
            />
          </div>
        </section>
      ) : null}

      <DeckSection
        deckA={deckA}
        deckB={deckB}
        crossfader={crossfader}
        onCrossfaderChange={setCrossfader}
        syncEnabled={syncBpm}
        onSyncEnabledChange={setSyncBpm}
        masterDeck={masterDeck}
        onMasterDeckChange={setMasterDeck}
      />

      <section className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>
                <input
                  type="checkbox"
                  checked={tracks.length > 0 && selectedIds.size === tracks.length}
                  onChange={toggleSelectAll}
                  aria-label="Select all tracks"
                />
              </th>
              <th>Filename</th>
              <th>Duration</th>
              <th>BPM</th>
              <th>Energy</th>
              <th>Status</th>
              <th>Load</th>
              <th>RMS</th>
              <th>Onset</th>
              <th>Path</th>
            </tr>
          </thead>
          <tbody>
            {tracks.length === 0 ? (
              <tr>
                <td colSpan={10} className="empty-row">
                  No tracks yet. Choose a music folder to scan subfolders recursively.
                </td>
              </tr>
            ) : (
              tracks.map((track) => {
                const statusText = formatAnalysisStatus(track);
                const hasError = track.analysisError != null || (track.isIcloud && track.bpm == null);

                return (
                  <tr
                    key={track.id}
                    className={[
                      selectedIds.has(track.id) ? "selected" : "",
                      hasError ? "row-error" : "",
                      track.isIcloud ? "row-icloud" : "",
                    ]
                      .filter(Boolean)
                      .join(" ") || undefined}
                  >
                    <td>
                      <input
                        type="checkbox"
                        checked={selectedIds.has(track.id)}
                        onChange={() => toggleSelection(track.id)}
                        aria-label={`Select ${track.filename}`}
                      />
                    </td>
                    <td>{track.filename}</td>
                    <td>{formatDuration(track.duration)}</td>
                    <td>{formatNumber(track.bpm, 1)}</td>
                    <td>{track.energyNormalized ?? "—"}</td>
                    <td className="status-cell" title={statusText}>
                      {statusText}
                    </td>
                    <td className="load-cell">
                      <button type="button" className="load-btn" onClick={() => loadTrackToDeck(track, "A")}>
                        A
                      </button>
                      <button type="button" className="load-btn" onClick={() => loadTrackToDeck(track, "B")}>
                        B
                      </button>
                    </td>
                    <td>{formatNumber(track.rms, 3)}</td>
                    <td>{formatNumber(track.onsetRate, 2)}</td>
                    <td className="path-cell" title={track.path}>
                      {track.path}
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </section>
    </div>
  );
}

export default App;
