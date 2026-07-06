import { useRef } from "react";
import { Track } from "../types";
import { crossfaderGains, syncPlaybackRate } from "../utils/deckAudio";
import { Deck, DeckHandle } from "./Deck";

interface DeckSectionProps {
  deckA: Track | null;
  deckB: Track | null;
  crossfader: number;
  onCrossfaderChange: (value: number) => void;
  syncEnabled: boolean;
  onSyncEnabledChange: (enabled: boolean) => void;
  masterDeck: "A" | "B";
  onMasterDeckChange: (deck: "A" | "B") => void;
}

export function DeckSection({
  deckA,
  deckB,
  crossfader,
  onCrossfaderChange,
  syncEnabled,
  onSyncEnabledChange,
  masterDeck,
  onMasterDeckChange,
}: DeckSectionProps) {
  const deckARef = useRef<DeckHandle>(null);
  const deckBRef = useRef<DeckHandle>(null);

  const { gainA, gainB } = crossfaderGains(crossfader);
  const rateA = syncPlaybackRate(syncEnabled, "A", masterDeck, deckA?.bpm ?? null, deckB?.bpm ?? null);
  const rateB = syncPlaybackRate(syncEnabled, "B", masterDeck, deckB?.bpm ?? null, deckA?.bpm ?? null);
  const syncReady = deckA?.bpm != null && deckB?.bpm != null;
  const bothLoaded = deckA != null && deckB != null;

  async function playBoth() {
    const jobs: Promise<void>[] = [];
    if (deckARef.current?.isReady()) jobs.push(deckARef.current.play());
    if (deckBRef.current?.isReady()) jobs.push(deckBRef.current.play());
    await Promise.all(jobs);
  }

  function pauseBoth() {
    deckARef.current?.pause();
    deckBRef.current?.pause();
  }

  function stopBoth() {
    deckARef.current?.stop();
    deckBRef.current?.stop();
  }

  return (
    <section className="deck-section">
      <div className="deck-grid">
        <Deck ref={deckARef} label="A" track={deckA} volume={gainA} playbackRate={rateA} />
        <Deck ref={deckBRef} label="B" track={deckB} volume={gainB} playbackRate={rateB} />
      </div>

      <div className="mixer-panel">
        <div className="transport-row">
          <button type="button" onClick={() => void playBoth()} disabled={!bothLoaded}>
            Play both
          </button>
          <button type="button" onClick={pauseBoth} disabled={!bothLoaded}>
            Pause both
          </button>
          <button type="button" onClick={stopBoth} disabled={!bothLoaded}>
            Stop both
          </button>
        </div>

        <div className="mixer-row">
          <span className="mixer-side">A</span>
          <input
            type="range"
            min={0}
            max={1}
            step={0.01}
            value={crossfader}
            onChange={(event) => onCrossfaderChange(Number(event.currentTarget.value))}
            aria-label="Crossfader"
            className="crossfader"
          />
          <span className="mixer-side">B</span>
        </div>

        <div className="mixer-options">
          <label className="sync-toggle">
            <input
              type="checkbox"
              checked={syncEnabled}
              onChange={(event) => onSyncEnabledChange(event.currentTarget.checked)}
              disabled={!syncReady}
            />
            BPM sync
          </label>

          <div className="master-select">
            <span>Master</span>
            <button
              type="button"
              className={masterDeck === "A" ? "active" : undefined}
              onClick={() => onMasterDeckChange("A")}
              disabled={!syncEnabled || !syncReady}
            >
              A
            </button>
            <button
              type="button"
              className={masterDeck === "B" ? "active" : undefined}
              onClick={() => onMasterDeckChange("B")}
              disabled={!syncEnabled || !syncReady}
            >
              B
            </button>
          </div>

          <span className="muted mixer-hint">
            {syncEnabled && syncReady
              ? `Slave follows master via playbackRate (${masterDeck} = ${masterDeck === "A" ? deckA?.bpm?.toFixed(1) : deckB?.bpm?.toFixed(1)} BPM)`
              : "Analyze both tracks to enable BPM sync"}
          </span>
        </div>
      </div>
    </section>
  );
}
