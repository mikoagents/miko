/** How long something took, to the precision a reader compares runs by. */
export function formatDuration(milliseconds: number): string {
  if (!Number.isFinite(milliseconds) || milliseconds < 0) return "";
  const seconds = Math.round(milliseconds / 1000);
  if (seconds < 1) return "under 1s";
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return pair(minutes, "m", seconds % 60, "s");
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return pair(hours, "h", minutes % 60, "m");
  return pair(Math.floor(hours / 24), "d", hours % 24, "h");
}

function pair(major: number, majorUnit: string, minor: number, minorUnit: string): string {
  return minor === 0 ? `${major}${majorUnit}` : `${major}${majorUnit} ${minor}${minorUnit}`;
}
