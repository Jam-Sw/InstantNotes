// Time-bucketed sections for the note list (the macOS-native grouping:
// Pinned, Today, Yesterday, Previous 7 Days, Previous 30 Days, month names
// for this year, then plain years). Pure and clock-injected so tests pin
// every boundary.

import type { Note } from "$lib/api/types";

export interface NoteGroup {
  label: string;
  notes: Note[];
}

const DAY_MS = 24 * 60 * 60 * 1000;

function bucketLabel(note: Note, now: Date): string {
  // Pinned floats as its own section, except in the trash, where the list
  // is plain recency order and a leftover pin flag must not reorder it.
  if (note.isPinned && !note.isDeleted) return "Pinned";

  const t = new Date(note.updatedAt);
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  if (t.getTime() >= startOfToday.getTime()) return "Today";
  if (t.getTime() >= startOfToday.getTime() - DAY_MS) return "Yesterday";
  if (t.getTime() >= startOfToday.getTime() - 7 * DAY_MS) return "Previous 7 Days";
  if (t.getTime() >= startOfToday.getTime() - 30 * DAY_MS) return "Previous 30 Days";
  if (t.getFullYear() === now.getFullYear()) {
    return t.toLocaleString(undefined, { month: "long" });
  }
  return String(t.getFullYear());
}

/**
 * Group a note list into labeled sections, preserving the incoming order.
 * Adjacent notes with the same label share a section; the caller's sort
 * (pinned first, then updatedAt desc) makes the labels monotonic, so each
 * label appears exactly once.
 */
export function groupNotes(notes: Note[], now: Date): NoteGroup[] {
  const groups: NoteGroup[] = [];
  for (const note of notes) {
    const label = bucketLabel(note, now);
    const last = groups[groups.length - 1];
    if (last && last.label === label) {
      last.notes.push(note);
    } else {
      groups.push({ label, notes: [note] });
    }
  }
  return groups;
}
