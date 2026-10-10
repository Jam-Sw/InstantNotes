export const AGENT_ACCESS_KEY = "agents.access";
export const AGENT_NOTIFY_KEY = "agents.notify";
export const AGENT_TAGS_KEY = "agents.tags";
export const AGENT_BLOCKED_KEY = "agents.blocked";

export const AGENT_KINDS = ["claude-code", "codex", "hermes"];

export function agentKind(client: string): string {
  const name = client.trim().toLowerCase();
  return AGENT_KINDS.find((kind) => name.startsWith(kind)) ?? name;
}

export type AgentTags = Record<string, string[]>;

export type AgentAccess = "off" | "read" | "write";

export type AgentNotify = "writes" | "all" | "off";

export type AgentKind = "read" | "search" | "write";

export interface AgentActivity {
  seq: number;
  at: number;
  session: string;
  client: string;
  tool: string;
  kind: AgentKind;
  status: "ok" | "error";
  error: string | null;
  durationMs: number;
  noteIds: string[];
  noteCount: number;
  titles: string[];
  space: string | null;
  tag: string | null;
  query: string | null;
  afterUpdatedAt: string | null;
  revertable: boolean;
  revertedAt: number | null;
  reverts: number | null;
}

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

export function parseBlocked(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((k): k is string => typeof k === "string") : [];
}

export function parseTags(value: unknown): AgentTags {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const out: AgentTags = {};
  for (const [client, tags] of Object.entries(value)) {
    const names = Array.isArray(tags) ? tags.filter((t): t is string => typeof t === "string") : [];
    if (names.length > 0) out[client] = names;
  }
  return out;
}

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

export interface AgentPresence {
  session: string;
  client: string;
  connectedAt: number;
  disconnectedAt: number | null;
  connected: boolean;
  label?: string | null;
  clientSession?: string | null;
  cwd?: string | null;
  matched?: string | null;
}

export function agentName(client: string, label?: string | null): string {
  const who = clientLabel(client);
  return label ? `${who}: ${label}` : who;
}

export function parsePresence(value: unknown): AgentPresence[] {
  if (!Array.isArray(value)) return [];
  return value.filter(
    (s): s is AgentPresence =>
      !!s &&
      typeof s === "object" &&
      typeof s.session === "string" &&
      typeof s.client === "string" &&
      typeof s.connectedAt === "number" &&
      typeof s.connected === "boolean",
  );
}

export function mayHaveWritten(entries: AgentActivity[], noteId: string): boolean {
  return (
    entries.length === 0 ||
    entries.some((e) => e.kind === "write" && e.status === "ok" && e.noteIds.includes(noteId))
  );
}

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
  "hermes-agent": "Hermes",
  instantnotes: "You",
  vscode: "VS Code",
  windsurf: "Windsurf",
  zed: "Zed",
};

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
    case "get_notes":
    case "resources/read":
      return `Reading ${title}${more}`;
    case "resources/list":
      return "Looking through your notes";
    case "suggest_space":
      return "Looking for where notes belong";
    case "list_tags":
      return "Looking at your tags";
    case "list_spaces":
      return "Looking at your Spaces";
    case "create_note":
      return `Writing a new note, ${title}`;
    case "update_note":
    case "edit_note":
      return `Editing ${title}`;
    case "append_to_note":
      return `Adding to ${title}`;
    case "append_sheet_rows":
      return `Adding rows to ${title}`;
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
    get_notes: "read notes",
    "resources/read": "read a note",
    "resources/list": "list notes",
    suggest_space: "suggest a Space",
    list_tags: "list tags",
    list_spaces: "list Spaces",
    create_note: "create a note",
    update_note: "edit a note",
    edit_note: "edit a note",
    append_to_note: "add to a note",
    append_sheet_rows: "add rows to a sheet",
    tag_note: "tag a note",
    untag_note: "untag a note",
    add_to_space: "file a note",
    remove_from_space: "take a note out of a Space",
    trash_note: "trash a note",
    restore_note: "restore a note",
  };
  return `Tried to ${verb[e.tool] ?? "act"}, but it failed`;
}

export function kindLabel(e: AgentActivity): string {
  if (e.tool === "revert") return "revert";
  return e.kind;
}

export function timeAgo(at: number, now: number): string {
  const s = Math.max(0, Math.round((now - at) / 1000));
  if (s < 45) return "just now";
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 48) return `${h} h ago`;
  return `${Math.round(h / 24)} d ago`;
}

export function formatDuration(ms: number): string {
  if (ms < 1000) return `${Math.max(0, Math.round(ms))} ms`;
  return `${(ms / 1000).toFixed(1)} s`;
}

export function clockTime(at: number): string {
  const d = new Date(at);
  const two = (n: number) => String(n).padStart(2, "0");
  return `${two(d.getHours())}:${two(d.getMinutes())}:${two(d.getSeconds())}`;
}

export interface AgentWire {
  request: string | null;
  response: string | null;
}

export function prettyWire(raw: string): string {
  try {
    return JSON.stringify(JSON.parse(raw), null, 2);
  } catch {
    return raw;
  }
}

export interface AgentSession {
  session: string;
  client: string;
  startedAt: number;
  endedAt: number;
  entries: AgentActivity[];
  reads: number;
  writes: number;
  errors: number;
}

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

export function claudeCodeCommand(c: AgentConnection): string {
  return ["claude", "mcp", "add", "instantnotes", "--", c.exe, ...serverArgs(c)]
    .map(shellQuote)
    .join(" ");
}

export function codexCommand(c: AgentConnection): string {
  return ["codex", "mcp", "add", "instantnotes", "--", c.exe, ...serverArgs(c)]
    .map(shellQuote)
    .join(" ");
}

export function hermesConfig(c: AgentConnection): string {
  return [
    "mcp_servers:",
    "  instantnotes:",
    `    command: ${JSON.stringify(c.exe)}`,
    `    args: ${JSON.stringify(serverArgs(c))}`,
  ].join("\n");
}

export function mcpServersJson(c: AgentConnection): string {
  return JSON.stringify(
    { mcpServers: { instantnotes: { command: c.exe, args: serverArgs(c) } } },
    null,
    2,
  );
}
