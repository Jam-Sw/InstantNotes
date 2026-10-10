import type { Note } from "$lib/api/types";

export interface NoteGroup {
  label: string;
  notes: Note[];
}

const DAY_MS = 24 * 60 * 60 * 1000;

const monthName = new Intl.DateTimeFormat(undefined, { month: "long" });

function bucketLabel(note: Note, now: Date, startOfToday: Date): string {
  if (note.isPinned && !note.isDeleted) return "Pinned";

  const t = new Date(note.updatedAt);
  if (t.getTime() >= startOfToday.getTime()) return "Today";
  if (t.getTime() >= startOfToday.getTime() - DAY_MS) return "Yesterday";
  if (t.getTime() >= startOfToday.getTime() - 7 * DAY_MS) return "Previous 7 Days";
  if (t.getTime() >= startOfToday.getTime() - 30 * DAY_MS) return "Previous 30 Days";
  if (t.getFullYear() === now.getFullYear()) {
    return monthName.format(t);
  }
  return String(t.getFullYear());
}

export function groupNotes(notes: Note[], now: Date): NoteGroup[] {
  const groups: NoteGroup[] = [];
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  for (const note of notes) {
    const label = bucketLabel(note, now, startOfToday);
    const last = groups[groups.length - 1];
    if (last && last.label === label) {
      last.notes.push(note);
    } else {
      groups.push({ label, notes: [note] });
    }
  }
  return groups;
}
