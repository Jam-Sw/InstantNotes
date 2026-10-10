export const HIGHLIGHT_START = "\u0001";
export const HIGHLIGHT_END = "\u0002";

export interface HighlightSegment {
  text: string;
  hit: boolean;
}

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

export function stripSentinels(text: string): string {
  return text.split(HIGHLIGHT_START).join("").split(HIGHLIGHT_END).join("");
}
