/** "1:05:09" for timers */
export function clock(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

/** "1:30 h" for booked durations */
export function hours(seconds: number): string {
  const minutes = Math.round(seconds / 60);
  return `${Math.floor(minutes / 60)}:${String(minutes % 60).padStart(2, "0")} h`;
}

/** Input for the duration field: "1h 30m" */
export function durationText(seconds: number): string {
  const minutes = Math.round(seconds / 60);
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (!h) return `${m}m`;
  return m ? `${h}h ${m}m` : `${h}h`;
}

/**
 * Accepts "1:30", "1h 30m", "1h30", "1.5h", "1,5 h", "90m", "90" (minutes), "2h".
 * Returns seconds or undefined if the text can't be read.
 */
export function parseDuration(input: string): number | undefined {
  const text = input.trim().toLowerCase().replace(",", ".");
  if (!text) return undefined;
  let m = /^(\d+):(\d{1,2})$/.exec(text);
  if (m) return (Number(m[1]) * 60 + Number(m[2])) * 60;
  // Whole number = minutes, decimal = hours ("1.5" is 1 h 30 m)
  if (/^\d+$/.test(text)) return Number(text) * 60;
  if (/^\d*\.\d+$/.test(text)) return Math.round(Number(text) * 3600);
  m = /^(?:(\d+(?:\.\d+)?)\s*(?:h|std|stunden?|hours?))?\s*(?:(\d+)\s*(?:m|min|minuten?|minutes?)?)?$/.exec(text);
  if (m && (m[1] || m[2])) return Math.round((Number(m[1] ?? 0) * 60 + Number(m[2] ?? 0)) * 60);
  return undefined;
}

/** Rounds to the nearest minute, then up to the step in minutes; at least one step. */
export function roundUp(seconds: number, stepMinutes: number): number {
  const step = Math.max(1, stepMinutes);
  const minutes = Math.round(Math.max(0, seconds) / 60);
  return Math.max(1, Math.ceil(minutes / step)) * step * 60;
}

/** Local date as YYYY-MM-DD */
export function isoDate(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

export function dayLabel(iso: string): string {
  const today = isoDate(new Date());
  const yesterday = isoDate(new Date(Date.now() - 86400000));
  if (iso === today) return "Today";
  if (iso === yesterday) return "Yesterday";
  const [y, mo, d] = iso.split("-").map(Number);
  return new Date(y, mo - 1, d).toLocaleDateString(undefined, { weekday: "long", day: "numeric", month: "long" });
}
