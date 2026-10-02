// Agents (Svelte 5 runes): the access level, the trace of agent calls, and
// live presence, meaning which notes, Spaces, and tags an agent is reading,
// searching, or changing right now. Presence is what lets the library show
// it on the things themselves (a glow on the row, the open note, the Space)
// instead of in a window of its own; the trace is the Agents Space, for when the
// user wants the full story and the power to undo a change.
//
// Fed by `library:external-change`, which the shell emits when another
// process writes to the library (src-tauri/src/shell/agents.rs) and when the
// app itself reverts an agent's write.

import { listen } from "@tauri-apps/api/event";
import {
  ApiError,
  clearAgentActivity,
  getAgentConnection,
  getSetting,
  listAgentActivity,
  revertAgentActivity,
  setSetting,
} from "$lib/api/client";
import { EVENTS } from "$lib/api/events";
import { friendlyMessage, GENERIC_MESSAGE } from "$lib/errors";
import { toasts } from "$lib/stores/toasts.svelte";
import {
  AGENT_ACCESS_KEY,
  AGENT_NOTIFY_KEY,
  canRevert,
  clientLabel,
  describeActivity,
  parseAccess,
  parseActivityLog,
  parseNotify,
  type AgentAccess,
  type AgentActivity,
  type AgentConnection,
  type AgentKind,
  type AgentNotify,
} from "$lib/agent-activity";

/** How long a touched note, Space, or tag stays lit after the last call. */
export const PRESENCE_MS = 4000;
/** How much of the trace is held in memory. */
const RECENT_KEEP = 500;
/** How many rows one load fetches. */
const PAGE = 200;
/** More calls than this in one batch are announced as one toast. */
const BURST = 3;

export type AgentMark = AgentKind;

class AgentsStore {
  access = $state<AgentAccess>("off");
  notify = $state<AgentNotify>("writes");
  /** The trace, newest first. */
  recent = $state<AgentActivity[]>([]);
  /** Whether a load returned a full page, so there may be more. */
  hasMore = $state(false);
  /** The latest call while it is fresh; drives the sidebar's live line. */
  current = $state<AgentActivity | null>(null);
  /** The latest search while it is fresh; the note list shows the query. */
  currentSearch = $state<AgentActivity | null>(null);
  connection = $state<AgentConnection | null>(null);
  /** Whether the Agents Space is on screen: changes are then seen as they land. */
  watching = $state(false);
  /** Writes that arrived while the Agents Space was not on screen: the badge. */
  unseen = $state(0);
  /** Takes the user to the Agents Space. The library page sets it, since this
   *  store cannot reach the library (the library imports it). */
  show: () => void = () => {};

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
      const [access, notify] = await Promise.all([
        getSetting<unknown>(AGENT_ACCESS_KEY),
        getSetting<unknown>(AGENT_NOTIFY_KEY),
      ]);
      this.access = parseAccess(access);
      this.notify = parseNotify(notify);
    } catch {
      // Best-effort, like every settings store: presence still works.
    }
    await this.loadRecent();
  }

  /** (Re)load the newest page of the trace. */
  async loadRecent(): Promise<void> {
    try {
      const rows = parseActivityLog(await listAgentActivity(PAGE, 0));
      this.recent = rows;
      this.hasMore = rows.length === PAGE;
    } catch {
      // The Space shows what it has; the store is best-effort.
    }
  }

  /** Fetch the page after what is loaded. */
  async loadMore(): Promise<void> {
    if (!this.hasMore) return;
    try {
      const rows = parseActivityLog(await listAgentActivity(PAGE, this.recent.length));
      const seen = new Set(this.recent.map((e) => e.seq));
      this.recent = this.recent.concat(rows.filter((e) => !seen.has(e.seq))).slice(0, RECENT_KEEP);
      this.hasMore = rows.length === PAGE && this.recent.length < RECENT_KEEP;
    } catch {
      this.hasMore = false;
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

  setNotify(notify: AgentNotify): void {
    this.notify = notify;
    void setSetting(AGENT_NOTIFY_KEY, notify);
  }

  setWatching(on: boolean): void {
    this.watching = on;
    if (on) this.unseen = 0;
  }

  /** Show new calls, oldest first, as they arrive. */
  play(entries: AgentActivity[], now = Date.now()): void {
    if (entries.length === 0) return;
    const until = now + PRESENCE_MS;
    const notes = new Map(this.#notes);
    const spaces = new Set(this.#spaces);
    const tags = new Set(this.#tags);
    for (const e of entries) {
      // A write holds over a read on the same note within the window.
      for (const id of e.noteIds) {
        if (e.kind === "write" || notes.get(id) !== "write") notes.set(id, e.kind);
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
      if (e.kind === "search" && e.status === "ok") {
        this.currentSearch = e;
        this.#until.set("search", until);
      }
    }
    this.#notes = notes;
    this.#spaces = spaces;
    this.#tags = tags;
    const latest = entries[entries.length - 1];
    this.current = latest;
    this.#until.set("current", until);
    this.#merge(entries);
    this.#announce(entries);
    setTimeout(() => this.expire(), PRESENCE_MS + 50);
  }

  /** Fold new rows into the trace: a revert row also marks the row it undid. */
  #merge(entries: AgentActivity[]): void {
    const seen = new Set(this.recent.map((e) => e.seq));
    const fresh = entries.filter((e) => !seen.has(e.seq));
    let recent = this.recent;
    for (const e of fresh) {
      if (e.tool === "revert" && e.reverts !== null) {
        const target = e.reverts;
        recent = recent.map((r) => (r.seq === target ? { ...r, revertedAt: e.at } : r));
      }
    }
    this.recent = [...fresh].reverse().concat(recent).slice(0, RECENT_KEEP);
  }

  /** Toasts for what just happened, as the notify setting asks. A write
   *  offers Revert right there; the Agents Space has the rest. A burst of changes
   *  is one toast that opens the Space, not a stack that evicts itself. */
  #announce(entries: AgentActivity[]): void {
    // The app's own revert is already confirmed where it was asked for.
    const theirs = entries.filter((e) => e.client !== "instantnotes");
    const writes = theirs.filter((e) => e.kind === "write" && e.status === "ok");
    if (!this.watching) this.unseen += writes.length;
    if (this.notify === "off") return;
    const shown = this.notify === "writes" ? writes : theirs;
    if (shown.length > BURST) {
      const who = clientLabel(shown[0].client);
      const n = writes.length;
      toasts.show(
        n > 0 ? `${who} made ${n} change${n === 1 ? "" : "s"}.` : `${who} made ${shown.length} calls.`,
        { label: "Show", run: () => this.show() },
      );
      return;
    }
    for (const e of shown) {
      const text = `${clientLabel(e.client)}: ${describeActivity(e)}`;
      if (canRevert(e)) {
        toasts.show(text, { label: "Revert", run: () => void this.revert(e.seq) });
      } else {
        toasts.show(text);
      }
    }
  }

  /** Undo one agent write. The shell answers with the revert row and emits it
   *  as an external change, which `play` folds in; the toast confirms. */
  async revert(seq: number): Promise<boolean> {
    const original = this.recent.find((r) => r.seq === seq);
    try {
      const row = await revertAgentActivity(seq);
      this.recent = this.recent.map((r) => (r.seq === seq ? { ...r, revertedAt: row.at } : r));
      const title = `“${row.titles[0] || "Untitled"}”`;
      const what =
        original && original.client !== "instantnotes"
          ? `Reverted ${clientLabel(original.client)}'s change to ${title}.`
          : `Put ${title} back.`;
      toasts.show(what, {
        label: "Undo",
        run: () => void this.revert(row.seq),
      });
      return true;
    } catch (e) {
      const message =
        e instanceof ApiError ? friendlyMessage(e.code, e.message) : GENERIC_MESSAGE;
      toasts.show(`Couldn't revert. ${message}`);
      return false;
    }
  }

  async clear(): Promise<void> {
    try {
      await clearAgentActivity();
      this.recent = [];
      this.hasMore = false;
      this.unseen = 0;
    } catch {
      toasts.show("Couldn't clear the agent history.");
    }
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
    if (this.currentSearch && lapsed("search")) this.currentSearch = null;
    for (const [key, at] of this.#until) if (at <= now) this.#until.delete(key);
  }

  /** "read", "search", or "write" while an agent is on this note, else null. */
  noteMark(id: string): AgentMark | null {
    return this.#notes.get(id) ?? null;
  }

  spaceActive(name: string): boolean {
    return this.#spaces.has(name.toLowerCase());
  }

  tagActive(name: string): boolean {
    return this.#tags.has(name.toLowerCase());
  }

  /** The client that last wrote to a note, from the trace, if any did. */
  lastWriter(noteId: string): string | null {
    const hit = this.recent.find(
      (e) => e.kind === "write" && e.status === "ok" && e.noteIds.includes(noteId),
    );
    return hit?.client ?? null;
  }

  /** Every write to a note that can still be reverted, newest first. */
  revertableFor(noteId: string): AgentActivity[] {
    return this.recent.filter((e) => canRevert(e) && e.noteIds.includes(noteId));
  }
}

export const agents = new AgentsStore();

/** The user's typing replaced an agent's edit to a note. Say so, by name, and
 *  offer it back; the restore is itself an edit, so Cmd-Z undoes it. Shown by
 *  whichever window was editing the note: the library or its sticky. */
export function announceOverwrite(noteId: string, restore: () => void): void {
  const who = clientLabel(agents.lastWriter(noteId) ?? "");
  toasts.show(`${who}'s change to this note was replaced by your typing.`, {
    label: "Restore theirs",
    run: restore,
  });
}
