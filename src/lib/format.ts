// Small presentation helpers shared by the library views.

/** Today shows a time (e.g. "3:04 PM"); any other day shows a short date
 *  (e.g. "Jun 5"). */
export function formatDate(iso: string): string {
  const d = new Date(iso);
  const today = new Date();
  const sameDay = d.toDateString() === today.toDateString();
  return sameDay
    ? d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })
    : d.toLocaleDateString([], { month: "short", day: "numeric" });
}

/** Full local date and time to the minute (e.g. "Jul 11, 2026, 2:55 PM").
 *  The always-available exact stamp: shown inline when the user opts in, and
 *  offered on hover everywhere the short `formatDate` is displayed. */
export function formatExact(iso: string): string {
  return new Date(iso).toLocaleString([], {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

/** Human byte size (e.g. "0 B", "340 KB", "1.2 MB"). Base-1024, one decimal
 *  once past kilobytes. */
export function formatBytes(n: number): string {
  if (!Number.isFinite(n) || n <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.min(units.length - 1, Math.floor(Math.log(n) / Math.log(1024)));
  const val = n / 1024 ** i;
  const shown = i === 0 ? String(val) : val.toFixed(val >= 10 || val % 1 === 0 ? 0 : 1);
  return `${shown} ${units[i]}`;
}

/** One-line note preview: collapse all whitespace, trim, cap at 90 chars. */
export function preview(body: string): string {
  return body.replace(/\s+/g, " ").trim().slice(0, 90);
}

/** Whitespace-delimited word count; 0 for a blank body. */
export function wordCount(body: string): number {
  const trimmed = body.trim();
  return trimmed ? trimmed.split(/\s+/).length : 0;
}
