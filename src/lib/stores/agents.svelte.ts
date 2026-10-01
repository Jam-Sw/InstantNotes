// Agents (Svelte 5 runes): the access level, the recent activity log, and
// live presence, meaning which notes, Spaces, and tags an agent is reading
// or changing right now. Presence is what lets the library show it on the
// things themselves (a glow on the row, the open note, the Space) instead
// of in a panel of its own. Each mark fades a few seconds after the last
// call that touched it.
//
// Fed by `library:external-change`, which the shell emits when another
// process writes to the library (src-tauri/src/shell/agents.rs).

import { listen } from "@tauri-apps/api/event";
import { getAgentConnection, getSetting, setSetting } from "$lib/api/client";
import { EVENTS } from "$lib/api/events";
import {
  AGENT_ACCESS_KEY,
  AGENT_ACTIVITY_KEY,
  parseAccess,
  parseActivityLog,
  type AgentAccess,
  type AgentActivity,
  type AgentConnection,
} from "$lib/agent-activity";

/** How long a touched note, Space, or tag stays lit after the last call. */
export const PRESENCE_MS = 4000;
const RECENT_KEEP = 30;

export type AgentMark = AgentActivity["kind"];

class AgentsStore {
  access = $state<AgentAccess>("off");
  /** Newest first. */
  recent = $state<AgentActivity[]>([]);
  /** The latest call while it is fresh; drives the sidebar's live line. */
  current = $state<AgentActivity | null>(null);
  connection = $state<AgentConnection | null>(null);

  #notes = $state(new Map<string, AgentMark>());
  #spaces = $state(new Set<string>());
  #tags = $state(new Set<string>());
  // When each mark lapses, so a later call extends it and an earlier timer
  // does not clear it early.
  #until = new Map<string, number>();
  #loaded = false;

  async init(): Promise<void> {
    if (this.#loaded) return;
    this.#loaded = true;
    await listen<unknown>(EVENTS.LIBRARY_EXTERNAL_CHANGE, (e) => {
      this.play(parseActivityLog(e.payload));
    });
    try {
      const [access, log] = await Promise.all([
        getSetting<unknown>(AGENT_ACCESS_KEY),
        getSetting<unknown>(AGENT_ACTIVITY_KEY),
      ]);
      this.access = parseAccess(access);
      this.recent = parseActivityLog(log);
    } catch {
      // Best-effort, like every settings store: presence still works.
    }
  }

  /** The executable and library path, for the connect commands. */
  async loadConnection(): Promise<void> {
    try {
      this.connection = await getAgentConnection();
    } catch {
      this.connection = null;
    }
  }

  setAccess(access: AgentAccess): void {
    this.access = access;
    void setSetting(AGENT_ACCESS_KEY, access);
  }

  /** Show new calls, oldest first, as they arrive. */
  play(entries: AgentActivity[], now = Date.now()): void {
    if (entries.length === 0) return;
    const until = now + PRESENCE_MS;
    const notes = new Map(this.#notes);
    const spaces = new Set(this.#spaces);
    const tags = new Set(this.#tags);
    for (const e of entries) {
      for (const id of e.noteIds) {
        notes.set(id, e.kind);
        this.#until.set(`n:${id}`, until);
      }
      if (e.space) {
        spaces.add(e.space.toLowerCase());
        this.#until.set(`s:${e.space.toLowerCase()}`, until);
      }
      if (e.tag) {
        const tag = e.tag.replace(/^#/, "").toLowerCase();
        tags.add(tag);
        this.#until.set(`t:${tag}`, until);
      }
    }
    this.#notes = notes;
    this.#spaces = spaces;
    this.#tags = tags;
    const latest = entries[entries.length - 1];
    this.current = latest;
    this.#until.set("current", until);
    this.recent = [...entries].reverse().concat(this.recent).slice(0, RECENT_KEEP);
    setTimeout(() => this.expire(), PRESENCE_MS + 50);
  }

  /** Drop marks whose time is up. Public so tests can drive the clock. */
  expire(now = Date.now()): void {
    const lapsed = (key: string) => (this.#until.get(key) ?? 0) <= now;
    const notes = [...this.#notes].filter(([id]) => !lapsed(`n:${id}`));
    if (notes.length !== this.#notes.size) this.#notes = new Map(notes);
    const spaces = [...this.#spaces].filter((s) => !lapsed(`s:${s}`));
    if (spaces.length !== this.#spaces.size) this.#spaces = new Set(spaces);
    const tags = [...this.#tags].filter((t) => !lapsed(`t:${t}`));
    if (tags.length !== this.#tags.size) this.#tags = new Set(tags);
    if (this.current && lapsed("current")) this.current = null;
    for (const [key, at] of this.#until) if (at <= now) this.#until.delete(key);
  }

  /** "read" or "write" while an agent is on this note, else null. */
  noteMark(id: string): AgentMark | null {
    return this.#notes.get(id) ?? null;
  }

  spaceActive(name: string): boolean {
    return this.#spaces.has(name.toLowerCase());
  }

  tagActive(name: string): boolean {
    return this.#tags.has(name.toLowerCase());
  }

  /** The client that last wrote to a note, from the log, if any did. */
  lastWriter(noteId: string): string | null {
    const hit = this.recent.find((e) => e.kind === "write" && e.noteIds.includes(noteId));
    return hit?.client ?? null;
  }
}

export const agents = new AgentsStore();
