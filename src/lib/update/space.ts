// The synthetic Space that carries an available update. Nothing here reads the
// store or the API: the Space and its two notes are derived from the updater's
// state and rendered through the ordinary sidebar and note rows, so the
// notification never becomes user data and cannot reach the vault. Pure, so it
// stays unit-testable without runes.

import type { Note } from "$lib/api/types";
import { formatBytes } from "$lib/format";

/** Sentinel ids no real workspace or note can hold (ids are UUIDs). */
export const UPDATE_SPACE_ID = "update-space";
export const UPDATE_NOTE_ID = "update-note";
export const RELEASE_NOTES_NOTE_ID = "update-release-notes";

export const UPDATE_SPACE_NAME = "Update";

// The Space has no real birth; when the manifest carries no release date, fall
// back to the epoch so the date helpers render something stable rather than
// "now" (which would make the notification look newly changed on every read).
const EPOCH = "1970-01-01T00:00:00.000Z";

export function isUpdateSpaceId(id: string | null | undefined): boolean {
  return id === UPDATE_SPACE_ID;
}

export function isUpdateNoteId(id: string | null | undefined): boolean {
  return id === UPDATE_NOTE_ID;
}

export function isReleaseNotesNoteId(id: string | null | undefined): boolean {
  return id === RELEASE_NOTES_NOTE_ID;
}

/** Any note that only exists while an update is offered. */
export function isVirtualNoteId(id: string | null | undefined): boolean {
  return isUpdateNoteId(id) || isReleaseNotesNoteId(id);
}

/** "update 0.9.0 → 0.10.0" - the version jump, the note's whole subject. */
export function updateNoteTitle(
  currentVersion: string,
  version: string,
): string {
  return `update ${currentVersion} → ${version}`;
}

/** "What's new in 0.10.0" - the release notes, which are just a note. */
export function releaseNotesTitle(version: string): string {
  return `What's new in ${version}`;
}

export interface UpdateView {
  version: string;
  currentVersion: string;
  date?: string | null;
  notes?: string | null;
}

export function buildUpdateNotes(view: UpdateView): Note[] {
  const at = view.date ?? EPOCH;
  const base = {
    createdAt: at,
    updatedAt: at,
    isPinned: false,
    isArchived: false,
    isDeleted: false,
    contentKind: "document" as const,
  };
  const notes = view.notes?.trim() ?? "";
  return [
    {
      ...base,
      id: UPDATE_NOTE_ID,
      title: updateNoteTitle(view.currentVersion, view.version),
      // Only the list row ever shows this; opening the note renders the update
      // page, not the body.
      body: `Update InstantNotes from ${view.currentVersion} to ${view.version}.`,
    },
    {
      ...base,
      id: RELEASE_NOTES_NOTE_ID,
      title: releaseNotesTitle(view.version),
      body: notes,
    },
  ];
}

/** "1.2 MB larger than v0.9.0", or null when the size is unknown. */
export function sizeDeltaLine(
  bytes: number | null,
  fromVersion: string,
): string | null {
  if (bytes == null || !Number.isFinite(bytes)) return null;
  if (bytes === 0) return `the same size as v${fromVersion}`;
  return `${formatBytes(Math.abs(bytes))} ${
    bytes > 0 ? "larger" : "smaller"
  } than v${fromVersion}`;
}
