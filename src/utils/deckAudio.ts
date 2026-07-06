export function crossfaderGains(position: number): { gainA: number; gainB: number } {
  const clamped = Math.min(1, Math.max(0, position));
  return {
    gainA: Math.cos(clamped * (Math.PI / 2)),
    gainB: Math.sin(clamped * (Math.PI / 2)),
  };
}

export function syncPlaybackRate(
  syncEnabled: boolean,
  side: "A" | "B",
  masterSide: "A" | "B",
  ownBpm: number | null,
  otherBpm: number | null,
): number {
  if (!syncEnabled || ownBpm == null || otherBpm == null || ownBpm <= 0 || otherBpm <= 0) {
    return 1;
  }

  if (side === masterSide) {
    return 1;
  }

  return otherBpm / ownBpm;
}

export function formatDeckTime(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return "0:00";
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins}:${secs.toString().padStart(2, "0")}`;
}