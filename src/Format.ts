/** Formats a measured percentage with one decimal place. */
export function formatPercent(value: number | undefined): string {
  return value === undefined ? "--" : `${value.toFixed(1)}%`;
}

/** Formats token counts as whole thousands or millions with one decimal place. */
export function formatTokens(value: number): string {
  return value >= 1_000_000 ? `${(value / 1_000_000).toFixed(1)}M` : value >= 1_000 ? `${Math.round(value / 1_000)}K` : String(value);
}

/** Formats accumulated milliseconds and marks estimated totals. */
export function formatDuration(milliseconds: number | undefined, approximate = false): string {
  if (milliseconds === undefined) return "--";
  const seconds = Math.floor(milliseconds / 1000);
  const prefix = approximate ? "~" : "";
  if (seconds < 60) return `${prefix}${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const remainder = `${String(seconds % 60).padStart(2, "0")}s`;
  return minutes < 60 ? `${prefix}${minutes}m${remainder}` : `${prefix}${Math.floor(minutes / 60)}h${String(minutes % 60).padStart(2, "0")}m${remainder}`;
}

/** Builds a block bar with a rounded, clamped fill. */
export function progressBar(percent: number, width: number): string {
  const clamped = Math.max(0, Math.min(100, percent));
  const filled = Math.round((clamped / 100) * width);
  return "\u2588".repeat(filled) + "\u2591".repeat(Math.max(0, width - filled));
}
