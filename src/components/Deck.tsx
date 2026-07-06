import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from "react";
import WaveSurfer from "wavesurfer.js";
import { convertFileSrc } from "@tauri-apps/api/core";
import { RgbWaveform } from "./RgbWaveform";
import { Track } from "../types";
import { formatDeckTime } from "../utils/deckAudio";
import { computeRekordboxRgbWaveform, RgbWaveformBar } from "../utils/waveformRgb";

export interface DeckHandle {
  play: () => Promise<void>;
  pause: () => void;
  stop: () => void;
  isReady: () => boolean;
}

interface DeckProps {
  label: "A" | "B";
  track: Track | null;
  volume: number;
  playbackRate: number;
}

export const Deck = forwardRef<DeckHandle, DeckProps>(function Deck(
  { label, track, volume, playbackRate },
  ref,
) {
  const audioHostRef = useRef<HTMLDivElement>(null);
  const wavesurferRef = useRef<WaveSurfer | null>(null);
  const audioUrlRef = useRef("");
  const [playing, setPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [loading, setLoading] = useState(false);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [waveformBars, setWaveformBars] = useState<RgbWaveformBar[]>([]);

  useImperativeHandle(ref, () => ({
    play: async () => {
      const wavesurfer = wavesurferRef.current;
      if (!wavesurfer || !track || loading) return;
      await wavesurfer.play();
    },
    pause: () => {
      wavesurferRef.current?.pause();
    },
    stop: () => {
      const wavesurfer = wavesurferRef.current;
      if (!wavesurfer) return;
      wavesurfer.stop();
      setPlaying(false);
      setCurrentTime(0);
    },
    isReady: () => Boolean(track && ready && !loading && wavesurferRef.current),
  }));

  useEffect(() => {
    if (!audioHostRef.current) return;

    const wavesurfer = WaveSurfer.create({
      container: audioHostRef.current,
      height: 1,
      waveColor: "transparent",
      progressColor: "transparent",
      cursorColor: "transparent",
      interact: false,
      normalize: false,
    });

    wavesurfer.on("play", () => setPlaying(true));
    wavesurfer.on("pause", () => setPlaying(false));
    wavesurfer.on("finish", () => setPlaying(false));
    wavesurfer.on("timeupdate", (time) => setCurrentTime(time));
    wavesurfer.on("ready", (readyDuration) => {
      setDuration(readyDuration);
      setLoading(false);
      setReady(true);
      setError(null);
    });
    wavesurfer.on("decode", () => {
      const decoded = wavesurfer.getDecodedData();
      if (!decoded) return;
      setWaveformBars(computeRekordboxRgbWaveform(decoded));
    });
    wavesurfer.on("error", (err) => {
      setLoading(false);
      setReady(false);
      setError(String(err));
    });

    wavesurferRef.current = wavesurfer;

    return () => {
      wavesurfer.destroy();
      wavesurferRef.current = null;
    };
  }, [label]);

  useEffect(() => {
    const wavesurfer = wavesurferRef.current;
    if (!wavesurfer) return;

    if (!track) {
      wavesurfer.empty();
      audioUrlRef.current = "";
      setWaveformBars([]);
      setPlaying(false);
      setCurrentTime(0);
      setDuration(0);
      setLoading(false);
      setReady(false);
      setError(null);
      return;
    }

    audioUrlRef.current = convertFileSrc(track.path);
    setWaveformBars([]);
    setLoading(true);
    setReady(false);
    setError(null);
    setPlaying(false);
    setCurrentTime(0);
    setDuration(0);

    void wavesurfer.load(audioUrlRef.current).catch((err: unknown) => {
      setLoading(false);
      setReady(false);
      setError(String(err));
    });
  }, [track]);

  useEffect(() => {
    wavesurferRef.current?.setVolume(volume);
  }, [volume]);

  useEffect(() => {
    wavesurferRef.current?.setPlaybackRate(playbackRate, true);
  }, [playbackRate]);

  function togglePlay() {
    const wavesurfer = wavesurferRef.current;
    if (!wavesurfer || !track) return;
    void wavesurfer.playPause();
  }

  function stopPlayback() {
    const wavesurfer = wavesurferRef.current;
    if (!wavesurfer) return;
    wavesurfer.stop();
    setPlaying(false);
    setCurrentTime(0);
  }

  function handleSeek(progress: number) {
    wavesurferRef.current?.seekTo(progress);
  }

  return (
    <div className={`deck deck-${label.toLowerCase()}`}>
      <div className="deck-header">
        <div>
          <span className="deck-label">Deck {label}</span>
          <p className="deck-track-name">{track?.filename ?? "No track loaded"}</p>
        </div>
        <div className="deck-meta">
          <span>BPM {track?.bpm?.toFixed(1) ?? "—"}</span>
          <span>Rate {playbackRate.toFixed(2)}x</span>
        </div>
      </div>

      <div className="deck-waveform-wrap">
        <div ref={audioHostRef} className="deck-audio-host" aria-hidden="true" />
        {track && waveformBars.length > 0 ? (
          <RgbWaveform
            bars={waveformBars}
            currentTime={currentTime}
            duration={duration}
            onSeek={handleSeek}
          />
        ) : null}
        {!track ? <div className="deck-empty">Load a track from the table</div> : null}
        {track && loading ? <div className="deck-overlay">Analyzing waveform...</div> : null}
        {error ? <div className="deck-overlay deck-overlay-error">{error}</div> : null}
      </div>

      <div className="deck-waveform-legend muted">
        <span className="legend-low">Low</span>
        <span className="legend-mid">Mid</span>
        <span className="legend-high">High</span>
      </div>

      <div className="deck-controls">
        <button type="button" onClick={togglePlay} disabled={!track || loading}>
          {playing ? "Pause" : "Play"}
        </button>
        <button type="button" onClick={stopPlayback} disabled={!track || loading}>
          Stop
        </button>
        <span className="deck-time">
          {formatDeckTime(currentTime)} / {formatDeckTime(duration)}
        </span>
      </div>
    </div>
  );
});
