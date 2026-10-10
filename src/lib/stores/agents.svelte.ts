import { listen } from "@tauri-apps/api/event";
import {
  clearAgentActivity,
  getAgentConnection,
  getSetting,
  listAgentActivity,
  listAgentSessions,
  revertAgentActivity,
  setSetting,
} from "$lib/api/client";
import { EVENTS } from "$lib/api/events";
import { friendlyError } from "$lib/errors";
import { toasts } from "$lib/stores/toasts.svelte";
import {
  AGENT_ACCESS_KEY,
  AGENT_BLOCKED_KEY,
  AGENT_NOTIFY_KEY,
  AGENT_TAGS_KEY,
  agentKind,
  canRevert,
  clientLabel,
  describeActivity,
  parseAccess,
  parseActivityLog,
  parseBlocked,
  parseNotify,
  parsePresence,
  parseTags,
  type AgentAccess,
  type AgentActivity,
  type AgentConnection,
  type AgentKind,
  type AgentNotify,
  type AgentPresence,
  type AgentTags,
} from "$lib/agent-activity";

export const PRESENCE_MS = 4000;
const RECENT_KEEP = 500;
const PAGE = 200;
const BURST = 3;

type AgentMark = AgentKind;

class AgentsStore {
  access = $state<AgentAccess>("off");
  notify = $state<AgentNotify>("writes");
  tags = $state<AgentTags>({});
  blocked = $state<string[]>([]);
  recent = $state<AgentActivity[]>([]);
  hasMore = $state(false);
  current = $state<AgentActivity | null>(null);
  currentSearch = $state<AgentActivity | null>(null);
  connection = $state<AgentConnection | null>(null);
  sessions = $state<AgentPresence[]>([]);
  watching = $state(false);
  unseen = $state(0);
  show: () => void = () => {};

  #notes = $state(new Map<string, AgentMark>());
  #spaces = $state(new Set<string>());
  #tags = $state(new Set<string>());
  #doing = $state(new Map<string, AgentActivity>());
  #until = new Map<string, number>();
  #loaded = false;

  async init(): Promise<void> {
    if (this.#loaded) return;
    this.#loaded = true;
    await listen<unknown>(EVENTS.LIBRARY_EXTERNAL_CHANGE, (e) => {
      this.play(parseActivityLog(e.payload));
    });
    await listen<unknown>(EVENTS.AGENT_SESSIONS, (e) => {
      this.sessions = parsePresence(e.payload);
    });
    void this.loadSessions();
    try {
      const [access, notify, tags, blocked] = await Promise.all([
        getSetting<unknown>(AGENT_ACCESS_KEY),
        getSetting<unknown>(AGENT_NOTIFY_KEY),
        getSetting<unknown>(AGENT_TAGS_KEY),
        getSetting<unknown>(AGENT_BLOCKED_KEY),
      ]);
      this.access = parseAccess(access);
      this.notify = parseNotify(notify);
      this.tags = parseTags(tags);
      this.blocked = parseBlocked(blocked);
    } catch {
    }
    await this.loadRecent();
  }

  async loadRecent(): Promise<void> {
    try {
      const rows = parseActivityLog(await listAgentActivity(PAGE, 0));
      this.recent = rows;
      this.hasMore = rows.length === PAGE;
    } catch {
    }
  }

  async loadSessions(): Promise<void> {
    try {
      this.sessions = parsePresence(await listAgentSessions());
    } catch {
    }
  }

  get connectedCount(): number {
    return this.sessions.filter((s) => s.connected).length;
  }

  get working(): boolean {
    return this.#doing.size > 0;
  }

  doing(session: string): AgentActivity | null {
    return this.#doing.get(session) ?? null;
  }

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

  setTags(client: string, names: string[]): void {
    const next = { ...this.tags };
    if (names.length > 0) next[client] = names;
    else delete next[client];
    this.tags = next;
    void setSetting(AGENT_TAGS_KEY, next);
  }

  isBlocked(client: string): boolean {
    return this.blocked.includes(agentKind(client));
  }

  setBlocked(client: string, on: boolean): void {
    const kind = agentKind(client);
    this.blocked = on
      ? [...new Set([...this.blocked, kind])]
      : this.blocked.filter((k) => k !== kind);
    void setSetting(AGENT_BLOCKED_KEY, this.blocked);
  }

  setWatching(on: boolean): void {
    this.watching = on;
    if (on) this.unseen = 0;
  }

  play(entries: AgentActivity[], now = Date.now()): void {
    if (entries.length === 0) return;
    const until = now + PRESENCE_MS;
    const notes = new Map(this.#notes);
    const spaces = new Set(this.#spaces);
    const tags = new Set(this.#tags);
    const doing = new Map(this.#doing);
    for (const e of entries) {
      if (e.client !== "instantnotes") {
        doing.set(e.session, e);
        this.#until.set(`d:${e.session}`, until);
      }
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
    this.#doing = doing;
    const latest = entries[entries.length - 1];
    this.current = latest;
    this.#until.set("current", until);
    this.#merge(entries);
    this.#announce(entries);
    setTimeout(() => this.expire(), PRESENCE_MS + 50);
  }

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

  #announce(entries: AgentActivity[]): void {
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
      toasts.show(`Couldn't revert. ${friendlyError(e, "That change was already reverted.")}`);
      return false;
    }
  }

  async clear(): Promise<void> {
    try {
      await clearAgentActivity();
      this.recent = [];
      this.hasMore = false;
      this.unseen = 0;
      void this.loadSessions();
    } catch {
      toasts.show("Couldn't clear the agent history.");
    }
  }

  expire(now = Date.now()): void {
    const lapsed = (key: string) => (this.#until.get(key) ?? 0) <= now;
    const notes = [...this.#notes].filter(([id]) => !lapsed(`n:${id}`));
    if (notes.length !== this.#notes.size) this.#notes = new Map(notes);
    const spaces = [...this.#spaces].filter((s) => !lapsed(`s:${s}`));
    if (spaces.length !== this.#spaces.size) this.#spaces = new Set(spaces);
    const tags = [...this.#tags].filter((t) => !lapsed(`t:${t}`));
    if (tags.length !== this.#tags.size) this.#tags = new Set(tags);
    const doing = [...this.#doing].filter(([s]) => !lapsed(`d:${s}`));
    if (doing.length !== this.#doing.size) this.#doing = new Map(doing);
    if (this.current && lapsed("current")) this.current = null;
    if (this.currentSearch && lapsed("search")) this.currentSearch = null;
    for (const [key, at] of this.#until) if (at <= now) this.#until.delete(key);
  }

  noteMark(id: string): AgentMark | null {
    return this.#notes.get(id) ?? null;
  }

  spaceActive(name: string): boolean {
    return this.#spaces.has(name.toLowerCase());
  }

  tagActive(name: string): boolean {
    return this.#tags.has(name.toLowerCase());
  }

  lastWriter(noteId: string): string | null {
    const hit = this.recent.find(
      (e) => e.kind === "write" && e.status === "ok" && e.noteIds.includes(noteId),
    );
    return hit?.client ?? null;
  }

  revertableFor(noteId: string): AgentActivity[] {
    return this.recent.filter((e) => canRevert(e) && e.noteIds.includes(noteId));
  }
}

export const agents = new AgentsStore();

export function announceOverwrite(noteId: string, restore: () => void): void {
  const who = clientLabel(agents.lastWriter(noteId) ?? "");
  toasts.show(`${who}'s change to this note was replaced by your typing.`, {
    label: "Restore theirs",
    run: restore,
  });
}
