// Splits a search excerpt/title into plain-text segments around the sentinel
// characters Store::search_notes wraps matched terms with (see store.rs).
// U+0001/U+0002 are control characters a user can never type, so their
// presence is unambiguous. This never touches HTML: callers render segments
// as text, never {@html}, and use `hit` to style the matched ones.

export const HIGHLIGHT_START = "\u0001";
export const HIGHLIGHT_END = "\u0002";

export interface HighlightSegment {
  text: string;
  hit: boolean;
}

/** Parse a string that may contain sentinel-wrapped hits into segments.
 *  Malformed input (an unclosed start, a stray end, or nested markers)
 *  degrades to a single unhighlighted segment with sentinels stripped,
 *  rather than throwing or mis-rendering. */
export function parseHighlightSegments(text: string): HighlightSegment[] {
  if (!text) return [];
  if (!text.includes(HIGHLIGHT_START) && !text.includes(HIGHLIGHT_END)) {
    return [{ text, hit: false }];
  }
  if (!isWellFormed(text)) {
    return [{ text: stripSentinels(text), hit: false }];
  }

  const segments: HighlightSegment[] = [];
  let buffer = "";
  let hit = false;
  for (const ch of text) {
    if (ch === HIGHLIGHT_START) {
      if (buffer) segments.push({ text: buffer, hit });
      buffer = "";
      hit = true;
    } else if (ch === HIGHLIGHT_END) {
      if (buffer) segments.push({ text: buffer, hit });
      buffer = "";
      hit = false;
    } else {
      buffer += ch;
    }
  }
  if (buffer) segments.push({ text: buffer, hit });
  return segments;
}

/** True for properly paired, non-nested sentinels: every start is closed by
 *  an end before the next start, and nothing closes twice. */
function isWellFormed(text: string): boolean {
  let open = false;
  for (const ch of text) {
    if (ch === HIGHLIGHT_START) {
      if (open) return false;
      open = true;
    } else if (ch === HIGHLIGHT_END) {
      if (!open) return false;
      open = false;
    }
  }
  return !open;
}

/** Remove the sentinels without any highlighting, for surfaces that render
 *  matched text plainly (the command palette). */
export function stripSentinels(text: string): string {
  return text.split(HIGHLIGHT_START).join("").split(HIGHLIGHT_END).join("");
}
