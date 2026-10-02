// Agent access, the parts with no runes: the activity row the MCP server
// writes (core store/activity.rs), how it reads in plain words, and the
// commands that connect an agent. Shared by the agents store, the sidebar's
// live line, the Agents Space, and Settings > Agents.

/** Settings keys owned by this surface. */
export const AGENT_ACCESS_KEY = "agents.access";
export const AGENT_NOTIFY_KEY = "agents.notify";

export type AgentAccess = "off" | "read" | "write";

/** Which agent calls raise a toast: every write (default), everything, or
 *  nothing (the trace and the live marks still show). */
export type AgentNotify = "writes" | "all" | "off";

export type AgentKind = "read" | "search" | "write";

/** One agent call, as the server traces it. */
export interface AgentActivity {
  /** Monotonic row id; newer rows have larger seqs. */
  seq: number;
  /** Epoch milliseconds. */
  at: number;
  /** The MCP process that made the call: one conversation's calls share it. */
  session: string;
  /** The client's own name from the MCP handshake, e.g. "claude-code"; or
   *  "instantnotes" for a revert made in the app. */
  client: string;
  tool: string;
  kind: AgentKind;
  status: "ok" | "error";
  /** What the tool refused with, when status is "error". */
  error: string | null;
  durationMs: number;
  noteIds: string[];
  noteCount: number;
  /** The first few touched notes' titles. */
  titles: string[];
  space: string | null;
  tag: string | null;
  query: string | null;
  /** The note's updatedAt once this write landed. */
  afterUpdatedAt: string | null;
  /** A snapshot exists to go back to (or the note was created and can be
   *  trashed). */
  revertable: boolean;
  /** Epoch ms when this row was reverted; it cannot be reverted again. */
  revertedAt: number | null;
  /** For a revert row: the seq of the row it undid. */
  reverts: number | null;
}

/** The note as it was before a write, from `agent_activity_before`. */
export interface NoteSnapshot {
  id: string;
  title: string;
  titleIsAuto: boolean;
  body: string;
  isPinned: boolean;
  isArchived: boolean;
  isDeleted: boolean;
  deletedAt: string | null;
  updatedAt: string;
  tags: [string, string][];
  spaces: string[];
}

export function parseAccess(value: unknown): AgentAccess {
  return value === "read" || value === "write" ? value : "off";
}

export function parseNotify(value: unknown): AgentNotify {
  return value === "all" || value === "off" ? value : "writes";
}

/** Keep only well-formed rows: the trace is data another process wrote. */
export function parseActivityLog(value: unknown): AgentActivity[] {
  if (!Array.isArray(value)) return [];
  return value.filter(
    (e): e is AgentActivity =>
      !!e &&
      typeof e === "object" &&
      typeof e.seq === "number" &&
      typeof e.at === "number" &&
      typeof e.tool === "string" &&
      (e.kind === "read" || e.kind === "search" || e.kind === "write") &&
      Array.isArray(e.noteIds),
  );
}

/** Whether a batch of outside writes may have changed this note. No rows
 *  means a write the trace does not describe (a second copy of the app),
 *  which may have touched anything. */
export function mayHaveWritten(entries: AgentActivity[], noteId: string): boolean {
  return (
    entries.length === 0 ||
    entries.some((e) => e.kind === "write" && e.status === "ok" && e.noteIds.includes(noteId))
  );
}

/** A write that changed a note and can still be put back. */
export function canRevert(e: AgentActivity): boolean {
  return e.kind === "write" && e.status === "ok" && e.revertable && e.revertedAt === null;
}

const KNOWN_CLIENTS: Record<string, string> = {
  "claude-code": "Claude Code",
  "claude-ai": "Claude",
  "claude-desktop": "Claude",
  codex: "Codex",
  "codex-mcp-client": "Codex",
  cursor: "Cursor",
  "cursor-vscode": "Cursor",
  "gemini-cli": "Gemini CLI",
  hermes: "Hermes",
  instantnotes: "You",
  vscode: "VS Code",
  windsurf: "Windsurf",
  zed: "Zed",
};

/** A client's handshake name as a person would say it. */
export function clientLabel(raw: string): string {
  const name = raw.trim();
  const known = KNOWN_CLIENTS[name.toLowerCase()];
  if (known) return known;
  if (!name || name === "agent") return "An agent";
  return name
    .split(/[-_\s]+/)
    .filter(Boolean)
    .map((w) => w[0].toUpperCase() + w.slice(1))
    .join(" ");
}

const quote = (s: string) => `“${s || "Untitled"}”`;

/** What the call did, in words: "Reading “Groceries”". A failed call says
 *  what it tried: "Tried to read a note". */
export function describeActivity(e: AgentActivity): string {
  const title = quote(e.titles[0] ?? "");
  const more = e.noteCount > 1 ? ` and ${e.noteCount - 1} more` : "";
  if (e.status === "error") return describeAttempt(e);
  switch (e.tool) {
    case "search_notes":
      return `Searching for ${quote(e.query ?? "")}`;
    case "list_notes":
      if (e.space) return `Looking through ${e.space}`;
      if (e.tag) return `Looking through #${e.tag}`;
      return "Looking through your notes";
    case "get_note":
      return `Reading ${title}${more}`;
    case "list_tags":
      return "Looking at your tags";
    case "list_spaces":
      return "Looking at your Spaces";
    case "create_note":
      return `Writing a new note, ${title}`;
    case "update_note":
      return `Editing ${title}`;
    case "append_to_note":
      return `Adding to ${title}`;
    case "tag_note":
      return `Tagging ${title} #${e.tag ?? ""}`;
    case "untag_note":
      return `Removing #${e.tag ?? ""} from ${title}`;
    case "add_to_space":
      return `Filing ${title} in ${e.space ?? "a Space"}`;
    case "remove_from_space":
      return `Taking ${title} out of ${e.space ?? "a Space"}`;
    case "trash_note":
      return `Moving ${title} to Trash`;
    case "restore_note":
      return `Restoring ${title}`;
    case "revert":
      return `Reverted a change to ${title}`;
    default:
      return e.kind === "write" ? "Changing your notes" : "Reading your notes";
  }
}

function describeAttempt(e: AgentActivity): string {
  const verb: Record<string, string> = {
    search_notes: "search",
    list_notes: "list notes",
    get_note: "read a note",
    list_tags: "list tags",
    list_spaces: "list Spaces",
    create_note: "create a note",
    update_note: "edit a note",
    append_to_note: "add to a note",
    tag_note: "tag a note",
    untag_note: "untag a note",
    add_to_space: "file a note",
    remove_from_space: "take a note out of a Space",
    trash_note: "trash a note",
    restore_note: "restore a note",
  };
  return `Tried to ${verb[e.tool] ?? "act"}, but it failed`;
}

/** The tool as a short badge: "read", "search", "write", "revert". */
export function kindLabel(e: AgentActivity): string {
  if (e.tool === "revert") return "revert";
  return e.kind;
}

/** The error's stable code, if the message starts with one ("NOT_FOUND:"). */
export function errorCode(e: AgentActivity): string | null {
  const m = /^([A-Z_]+):/.exec(e.error ?? "");
  return m ? m[1] : null;
}

/** "just now", "4 min ago", "2 h ago", "3 d ago". */
export function timeAgo(at: number, now: number): string {
  const s = Math.max(0, Math.round((now - at) / 1000));
  if (s < 45) return "just now";
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 48) return `${h} h ago`;
  return `${Math.round(h / 24)} d ago`;
}

/** "12 ms", "1.4 s". */
export function formatDuration(ms: number): string {
  if (ms < 1000) return `${Math.max(0, Math.round(ms))} ms`;
  return `${(ms / 1000).toFixed(1)} s`;
}

/** The clock time of a row, for the trace: "14:03:27". */
export function clockTime(at: number): string {
  const d = new Date(at);
  const two = (n: number) => String(n).padStart(2, "0");
  return `${two(d.getHours())}:${two(d.getMinutes())}:${two(d.getSeconds())}`;
}

/** One conversation's calls, for the trace to group under a header. */
export interface AgentSession {
  session: string;
  client: string;
  /** Oldest and newest `at` in the group. */
  startedAt: number;
  endedAt: number;
  entries: AgentActivity[];
  reads: number;
  writes: number;
  errors: number;
}

/** Group rows (newest first) into sessions, newest session first. Rows keep
 *  their order within a session. */
export function groupSessions(entries: AgentActivity[]): AgentSession[] {
  const out: AgentSession[] = [];
  const index = new Map<string, AgentSession>();
  for (const e of entries) {
    let group = index.get(e.session);
    if (!group) {
      group = {
        session: e.session,
        client: e.client,
        startedAt: e.at,
        endedAt: e.at,
        entries: [],
        reads: 0,
        writes: 0,
        errors: 0,
      };
      index.set(e.session, group);
      out.push(group);
    }
    group.entries.push(e);
    group.startedAt = Math.min(group.startedAt, e.at);
    group.endedAt = Math.max(group.endedAt, e.at);
    if (e.status === "error") group.errors++;
    else if (e.kind === "write") group.writes++;
    else group.reads++;
  }
  return out;
}

/** Where the app and its library live, from `agent_connection`. */
export interface AgentConnection {
  exe: string;
  db: string;
  attachments: string | null;
}

function serverArgs(c: AgentConnection): string[] {
  const args = ["mcp", "--db", c.db];
  if (c.attachments) args.push("--attachments", c.attachments);
  return args;
}

const shellQuote = (s: string) => (/^[\w./:@-]+$/.test(s) ? s : `'${s.replace(/'/g, `'\\''`)}'`);

/** One line for Claude Code. */
export function claudeCodeCommand(c: AgentConnection): string {
  return ["claude", "mcp", "add", "instantnotes", "--", c.exe, ...serverArgs(c)]
    .map(shellQuote)
    .join(" ");
}

/** One line for Codex. */
export function codexCommand(c: AgentConnection): string {
  return ["codex", "mcp", "add", "instantnotes", "--", c.exe, ...serverArgs(c)]
    .map(shellQuote)
    .join(" ");
}

/** The `mcpServers` entry most other clients take (Claude Desktop, Cursor). */
export function mcpServersJson(c: AgentConnection): string {
  return JSON.stringify(
    { mcpServers: { instantnotes: { command: c.exe, args: serverArgs(c) } } },
    null,
    2,
  );
}
