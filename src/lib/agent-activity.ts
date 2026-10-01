// Agent access, the parts with no runes: the activity record the MCP server
// writes (src-tauri/agents/src/tools.rs), how it reads in plain words, and
// the commands that connect an agent. Shared by the agents store, the
// sidebar's live line, and Settings > Agents.

/** Settings keys, owned by the MCP server's side (tools.rs). */
export const AGENT_ACCESS_KEY = "agents.access";
export const AGENT_ACTIVITY_KEY = "agents.activity";

export type AgentAccess = "off" | "read" | "write";

/** One agent call, as the server records it. */
export interface AgentActivity {
  /** Epoch milliseconds. */
  at: number;
  /** The client's own name from the MCP handshake, e.g. "claude-code". */
  client: string;
  tool: string;
  kind: "read" | "write";
  noteIds: string[];
  noteCount: number;
  /** The first few touched notes' titles. */
  titles: string[];
  space: string | null;
  tag: string | null;
  query: string | null;
}

export function parseAccess(value: unknown): AgentAccess {
  return value === "read" || value === "write" ? value : "off";
}

/** Keep only well-formed entries: the log is data another process wrote. */
export function parseActivityLog(value: unknown): AgentActivity[] {
  if (!Array.isArray(value)) return [];
  return value.filter(
    (e): e is AgentActivity =>
      !!e &&
      typeof e === "object" &&
      typeof e.at === "number" &&
      typeof e.tool === "string" &&
      (e.kind === "read" || e.kind === "write") &&
      Array.isArray(e.noteIds),
  );
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
  vscode: "VS Code",
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

/** What the call did, in words: "Reading “Groceries”". */
export function describeActivity(e: AgentActivity): string {
  const title = quote(e.titles[0] ?? "");
  const more = e.noteCount > 1 ? ` and ${e.noteCount - 1} more` : "";
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
    default:
      return e.kind === "write" ? "Changing your notes" : "Reading your notes";
  }
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

/** The `mcpServers` entry most other clients take (Claude Desktop, Cursor). */
export function mcpServersJson(c: AgentConnection): string {
  return JSON.stringify(
    { mcpServers: { instantnotes: { command: c.exe, args: serverArgs(c) } } },
    null,
    2,
  );
}
