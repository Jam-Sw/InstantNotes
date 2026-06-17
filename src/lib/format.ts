// Small presentation helpers shared by the library views.

/** Today shows a time (e.g. "3:04 PM"); any other day shows a short date
 *  (e.g. "Jun 5"). Mirrors the previous inline helper in the library page. */
export function formatDate(iso: string): string {
  const d = new Date(iso);
  const today = new Date();
  const sameDay = d.toDateString() === today.toDateString();
  return sameDay
    ? d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })
    : d.toLocaleDateString([], { month: "short", day: "numeric" });
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
