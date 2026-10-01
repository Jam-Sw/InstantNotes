// The update notification as a place in the sidebar: a synthetic Space whose
// two notes are the version jump and the release notes. It is derived from the
// updater and never stored, so it cannot be searched, tagged, exported, or
// synced, and it vanishes the moment there is nothing to install.

import { updater } from "$lib/stores/updater.svelte";
import { buildUpdateNotes } from "$lib/update/space";
import type { Note } from "$lib/api/types";

function view() {
  return {
    version: updater.version as string,
    currentVersion: updater.currentVersion as string,
    date: updater.date,
    notes: updater.notes,
  };
}

export const updateSpace = {
  /** True while the notification belongs in the sidebar. */
  get visible(): boolean {
    return updater.pendingUpdate;
  },
  get notes(): Note[] {
    return updater.pendingUpdate ? buildUpdateNotes(view()) : [];
  },
  /** The update note itself: the one the welcome pill opens. */
  get leadNote(): Note | null {
    return updater.pendingUpdate ? (buildUpdateNotes(view())[0] ?? null) : null;
  },
};
