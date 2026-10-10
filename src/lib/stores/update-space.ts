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
  get visible(): boolean {
    return updater.pendingUpdate;
  },
  get notes(): Note[] {
    return updater.pendingUpdate ? buildUpdateNotes(view()) : [];
  },
  get leadNote(): Note | null {
    return updater.pendingUpdate ? (buildUpdateNotes(view())[0] ?? null) : null;
  },
};
