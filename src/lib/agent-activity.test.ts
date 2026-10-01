import { describe, expect, it } from "vitest";
import {
  claudeCodeCommand,
  clientLabel,
  describeActivity,
  mcpServersJson,
  parseAccess,
  parseActivityLog,
  timeAgo,
  type AgentActivity,
} from "./agent-activity";

const entry = (over: Partial<AgentActivity>): AgentActivity => ({
  at: 0,
  client: "claude-code",
  tool: "get_note",
  kind: "read",
  noteIds: ["n1"],
  noteCount: 1,
  titles: ["Groceries"],
  space: null,
  tag: null,
  query: null,
  ...over,
});

describe("agent activity", () => {
  it("names known clients and tidies unknown ones", () => {
    expect(clientLabel("claude-code")).toBe("Claude Code");
    expect(clientLabel("Cursor")).toBe("Cursor");
    expect(clientLabel("my-local_bot")).toBe("My Local Bot");
    expect(clientLabel("")).toBe("An agent");
    expect(clientLabel("agent")).toBe("An agent");
  });

  it("describes calls in plain words", () => {
    expect(describeActivity(entry({}))).toBe("Reading “Groceries”");
    expect(describeActivity(entry({ tool: "list_notes", space: "Ideas" }))).toBe(
      "Looking through Ideas",
    );
    expect(describeActivity(entry({ tool: "search_notes", query: "sync" }))).toBe(
      "Searching for “sync”",
    );
    expect(describeActivity(entry({ tool: "append_to_note", kind: "write" }))).toBe(
      "Adding to “Groceries”",
    );
    expect(describeActivity(entry({ tool: "create_note", titles: [""] }))).toBe(
      "Writing a new note, “Untitled”",
    );
  });

  it("reads access defensively, defaulting to off", () => {
    expect(parseAccess("write")).toBe("write");
    expect(parseAccess("read")).toBe("read");
    expect(parseAccess("everything")).toBe("off");
    expect(parseAccess(null)).toBe("off");
  });

  it("drops malformed log entries", () => {
    const good = entry({});
    expect(parseActivityLog([good, { at: "x" }, null, 3])).toEqual([good]);
    expect(parseActivityLog("nope")).toEqual([]);
  });

  it("says how long ago", () => {
    expect(timeAgo(0, 10_000)).toBe("just now");
    expect(timeAgo(0, 4 * 60_000)).toBe("4 min ago");
    expect(timeAgo(0, 3 * 3_600_000)).toBe("3 h ago");
    expect(timeAgo(0, 3 * 86_400_000)).toBe("3 d ago");
  });

  it("builds connect commands, quoting paths with spaces", () => {
    const c = {
      exe: "/Applications/InstantNotes.app/Contents/MacOS/instantnotes",
      db: "/Users/me/Library/Application Support/com.instantnotes.app/instantnotes.db",
      attachments: null,
    };
    expect(claudeCodeCommand(c)).toBe(
      "claude mcp add instantnotes -- /Applications/InstantNotes.app/Contents/MacOS/instantnotes mcp --db '/Users/me/Library/Application Support/com.instantnotes.app/instantnotes.db'",
    );
    const json = JSON.parse(mcpServersJson({ ...c, attachments: "/a b" }));
    expect(json.mcpServers.instantnotes.args).toEqual([
      "mcp",
      "--db",
      c.db,
      "--attachments",
      "/a b",
    ]);
  });
});
