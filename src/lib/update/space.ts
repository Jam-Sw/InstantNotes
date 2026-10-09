import type { Note } from "$lib/api/types";
import { formatBytes } from "$lib/format";

export const UPDATE_SPACE_ID = "update-space";
/** @internal */
export const UPDATE_NOTE_ID = "update-note";
/** @internal */
export const RELEASE_NOTES_NOTE_ID = "update-release-notes";

export const UPDATE_SPACE_NAME = "Update";

const EPOCH = "1970-01-01T00:00:00.000Z";

export function isUpdateSpaceId(id: string | null | undefined): boolean {
  return id === UPDATE_SPACE_ID;
}

export function isUpdateNoteId(id: string | null | undefined): boolean {
  return id === UPDATE_NOTE_ID;
}

/** @internal */
export function isReleaseNotesNoteId(id: string | null | undefined): boolean {
  return id === RELEASE_NOTES_NOTE_ID;
}

export function isVirtualNoteId(id: string | null | undefined): boolean {
  return isUpdateNoteId(id) || isReleaseNotesNoteId(id);
}

export function updateNoteTitle(
  currentVersion: string,
  version: string,
): string {
  return `update ${currentVersion} → ${version}`;
}

/** @internal */
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
