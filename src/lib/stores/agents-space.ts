// The agent trace as a place in the sidebar: a synthetic Space with one note
// per agent conversation. It is derived from the agents store and never
// stored, so it cannot be searched, tagged, exported, or synced.

import { agents } from "$lib/stores/agents.svelte";
import { library } from "$lib/stores/library.svelte";
import { groupSessions } from "$lib/agent-activity";
import {
  AGENTS_SPACE_ID,
  buildAgentNotes,
  joinConversations,
  sessionOfNote,
  type AgentConversation,
} from "$lib/agents/space";
import type { Note } from "$lib/api/types";

export const agentsSpace = {
  /** Present whenever agents may connect or ever have, so there is always one
   *  place to see and undo what they did. */
  get visible(): boolean {
    return agents.access !== "off" || agents.recent.length > 0 || agents.connectedCount > 0;
  },
  /** Connected agents first, then the rest, most recent first. */
  get sessions(): AgentConversation[] {
    return joinConversations(groupSessions(agents.recent), agents.sessions);
  },
  get notes(): Note[] {
    return buildAgentNotes(this.sessions, (s) => agents.doing(s));
  },
  /** How a conversation's row should be marked: in the middle of a call,
   *  connected and quiet, or not connected. */
  stateOf(noteId: string | null | undefined): "working" | "connected" | null {
    const s = this.sessionFor(noteId);
    if (!s?.connected) return null;
    return agents.doing(s.session) ? "working" : "connected";
  },
  /** The conversation a synthetic note stands for, while the trace has it. */
  sessionFor(noteId: string | null | undefined): AgentConversation | null {
    const session = sessionOfNote(noteId);
    return session ? (this.sessions.find((s) => s.clocks.some((c) => c.session === session)) ?? null) : null;
  },
  /** Go to the Space, with the latest conversation open. */
  open(): void {
    library.selectWorkspace(AGENTS_SPACE_ID);
    const lead = this.notes[0];
    if (lead) library.selectVirtual(lead);
  },
};
