import { describe, expect, it } from "vitest";
import {
  canRevert,
  claudeCodeCommand,
  clientLabel,
  clockTime,
  codexCommand,
  describeActivity,
  errorCode,
  formatDuration,
  groupSessions,
  mcpServersJson,
  parseAccess,
  parseActivityLog,
  parseNotify,
  timeAgo,
  type AgentActivity,
} from "./agent-activity";

const entry = (over: Partial<AgentActivity>): AgentActivity => ({
  seq: 1,
  at: 0,
  session: "s1",
  client: "claude-code",
  tool: "get_note",
  kind: "read",
  status: "ok",
  error: null,
  durationMs: 3,
  noteIds: ["n1"],
  noteCount: 1,
  titles: ["Groceries"],
  space: null,
  tag: null,
  query: null,
  afterUpdatedAt: null,
  revertable: false,
  revertedAt: null,
  reverts: null,
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
    expect(describeActivity(entry({ tool: "revert", client: "instantnotes" }))).toBe(
      "Reverted a change to “Groceries”",
    );
    expect(clientLabel("instantnotes")).toBe("You");
    // A failed call says what was tried, never a made-up outcome.
    expect(
      describeActivity(entry({ tool: "update_note", status: "error", error: "NOT_FOUND: gone" })),
    ).toBe("Tried to edit a note, but it failed");
    expect(errorCode(entry({ status: "error", error: "NOT_FOUND: gone" }))).toBe("NOT_FOUND");
    expect(errorCode(entry({ status: "error", error: "invalid arguments" }))).toBeNull();
  });

  it("knows which rows can still be reverted", () => {
    const write = entry({ kind: "write", tool: "update_note", revertable: true });
    expect(canRevert(write)).toBe(true);
    expect(canRevert({ ...write, revertedAt: 5 })).toBe(false);
    expect(canRevert({ ...write, status: "error" })).toBe(false);
    expect(canRevert({ ...write, revertable: false })).toBe(false);
    expect(canRevert(entry({}))).toBe(false);
  });

  it("groups rows into sessions, newest first, with counts", () => {
    const rows = [
      entry({ seq: 5, at: 50, session: "b", client: "cursor", kind: "write", tool: "append_to_note" }),
      entry({ seq: 4, at: 40, session: "b", client: "cursor", status: "error", error: "x" }),
      entry({ seq: 3, at: 30, session: "a" }),
      entry({ seq: 2, at: 20, session: "a", kind: "search", tool: "search_notes" }),
    ];
    const groups = groupSessions(rows);
    expect(groups.map((g) => g.session)).toEqual(["b", "a"]);
    expect(groups[0]).toMatchObject({ client: "cursor", writes: 1, errors: 1, reads: 0, startedAt: 40, endedAt: 50 });
    expect(groups[1]).toMatchObject({ reads: 2, writes: 0, errors: 0 });
    expect(groups[1].entries.map((e) => e.seq)).toEqual([3, 2]);
  });

  it("formats durations and clock times", () => {
    expect(formatDuration(12)).toBe("12 ms");
    expect(formatDuration(1400)).toBe("1.4 s");
    expect(clockTime(new Date(2026, 0, 1, 14, 3, 7).getTime())).toBe("14:03:07");
  });

  it("reads access defensively, defaulting to off", () => {
    expect(parseAccess("write")).toBe("write");
    expect(parseAccess("read")).toBe("read");
    expect(parseAccess("everything")).toBe("off");
    expect(parseAccess(null)).toBe("off");
    expect(parseNotify("all")).toBe("all");
    expect(parseNotify(undefined)).toBe("writes");
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
    expect(codexCommand(c)).toMatch(/^codex mcp add instantnotes -- /);
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
