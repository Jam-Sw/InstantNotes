// Spaces and notes the app draws but does not store: the update notification
// and the agent trace. They go through the ordinary sidebar and note rows, and
// everything that persists, files, or exports a note asks here first.

import { isUpdateSpaceId, isVirtualNoteId } from "$lib/update/space";
import { isAgentNoteId, isAgentsSpaceId } from "$lib/agents/space";

export function isSyntheticSpaceId(id: string | null | undefined): boolean {
  return isUpdateSpaceId(id) || isAgentsSpaceId(id);
}

export function isSyntheticNoteId(id: string | null | undefined): boolean {
  return isVirtualNoteId(id) || isAgentNoteId(id);
}
