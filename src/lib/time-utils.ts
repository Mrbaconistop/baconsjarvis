export function formatRelative(date: Date | string): string {
  const d = typeof date === "string" ? new Date(date) : date;
  const diffMs = d.getTime() - Date.now();
  const past = diffMs < 0;
  const abs = Math.abs(diffMs);
  const min = Math.round(abs / 60000);
  const hr = Math.round(abs / 3600000);
  const day = Math.round(abs / 86400000);
  if (min < 1) return past ? "just now" : "in moments";
  if (min < 60) return past ? `${min}m ago` : `in ${min}m`;
  if (hr < 24) return past ? `${hr}h ago` : `in ${hr}h`;
  if (day < 7) return past ? `${day}d ago` : `in ${day}d`;
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

export function formatClock(date: Date | string): string {
  const d = typeof date === "string" ? new Date(date) : date;
  return d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
}

export function formatDateLong(date: Date | string): string {
  const d = typeof date === "string" ? new Date(date) : date;
  return d.toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" });
}

export function minutesUntil(date: Date | string): number {
  const d = typeof date === "string" ? new Date(date) : date;
  return Math.round((d.getTime() - Date.now()) / 60000);
}
