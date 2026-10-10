import { isUpdateSpaceId, isVirtualNoteId } from "$lib/update/space";
import { isAgentNoteId, isAgentsSpaceId } from "$lib/agents/space";

export function isSyntheticSpaceId(id: string | null | undefined): boolean {
  return isUpdateSpaceId(id) || isAgentsSpaceId(id);
}

export function isSyntheticNoteId(id: string | null | undefined): boolean {
  return isVirtualNoteId(id) || isAgentNoteId(id);
}
