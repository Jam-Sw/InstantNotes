import { describe, it, expect, vi, beforeEach } from "vitest";
import { open } from "@tauri-apps/plugin-dialog";
import {
  chooseVaultFolder,
  describeVaultReport,
  describeVaultStatus,
  parseVaultSynced,
} from "./vault-mirror";
import type { VaultStatus } from "$lib/api/types";
import type { VaultReport } from "$lib/api/types";

vi.mock("@tauri-apps/plugin-dialog", () => ({
  open: vi.fn(),
}));

beforeEach(() => {
  vi.mocked(open).mockReset();
});

function report(overrides: Partial<VaultReport> = {}): VaultReport {
  return {
    checked: 0,
    missing: [],
    diverged: [],
    orphans: [],
    pending: 0,
    manifestOk: true,
    ...overrides,
  };
}

describe("chooseVaultFolder", () => {
  it("returns the folder the user picked", async () => {
    vi.mocked(open).mockResolvedValue("/Users/me/Vault");
    expect(await chooseVaultFolder()).toEqual({ path: "/Users/me/Vault" });
    expect(open).toHaveBeenCalledWith(
      expect.objectContaining({ directory: true, multiple: false }),
    );
  });

  it("reports cancellation when no folder is picked", async () => {
    vi.mocked(open).mockResolvedValue(null);
    expect(await chooseVaultFolder()).toEqual({ cancelled: true });
  });

  it("surfaces a dialog failure", async () => {
    vi.mocked(open).mockRejectedValue(new Error("no dialog"));
    expect(await chooseVaultFolder()).toEqual({ error: "no dialog" });
  });
});

describe("describeVaultReport", () => {
  it("says everything matches for a clean vault", () => {
    expect(describeVaultReport(report({ checked: 412 }))).toEqual([
      "All 412 notes match their files.",
    ]);
  });

  it("uses the singular for one note", () => {
    expect(describeVaultReport(report({ checked: 1 }))).toEqual([
      "The 1 note matches its file.",
    ]);
  });

  it("mentions notes still being written", () => {
    expect(describeVaultReport(report({ checked: 10, pending: 2 }))).toEqual([
      "All 10 notes match their files.",
      "2 more are still being written.",
    ]);
  });

  it("lists each kind of difference, naming a few files", () => {
    const lines = describeVaultReport(
      report({
        checked: 20,
        diverged: ["A.md"],
        missing: ["B.md", "C.md"],
        orphans: ["1.md", "2.md", "3.md", "4.md", "5.md"],
        manifestOk: false,
      }),
    );
    expect(lines).toEqual([
      "1 file was edited outside InstantNotes: A.md",
      "2 note files are missing: B.md, C.md",
      "5 files are not notes InstantNotes wrote: 1.md, 2.md, 3.md and 2 more",
      "instantnotes.yaml does not match your tags and Spaces.",
    ]);
  });
});

describe("parseVaultSynced", () => {
  it("reads the note ids and drops anything else", () => {
    expect(parseVaultSynced({ noteIds: ["a", 2, "b"] })).toEqual(["a", "b"]);
    expect(parseVaultSynced(null)).toEqual([]);
    expect(parseVaultSynced({ noteIds: "a" })).toEqual([]);
  });
});

describe("describeVaultStatus", () => {
  const status = (over: Partial<VaultStatus>): VaultStatus => ({
    path: "/mnt/kel/notes",
    transport: "folder",
    reachable: true,
    unreachable: null,
    pending: 0,
    lastError: null,
    lastFlushedAt: null,
    lastSyncedAt: null,
    heldRemovals: 0,
    conflicts: 0,
    ...over,
  });

  it("puts being offline before anything else", () => {
    expect(
      describeVaultStatus(
        status({ reachable: false, unreachable: "cannot list", lastError: "x", pending: 1 }),
      ),
    ).toEqual({ line: "Offline: cannot list. 1 note will sync when it's back.", tone: "warn" });
  });

  it("then held removals, then errors, then work in flight", () => {
    expect(describeVaultStatus(status({ heldRemovals: 1, lastError: "x" })).line).toBe(
      "Waiting: 1 note went missing from the folder at once.",
    );
    expect(describeVaultStatus(status({ lastError: "x", pending: 2 }))).toEqual({
      line: "Problem: x",
      tone: "warn",
    });
    expect(describeVaultStatus(status({ pending: 2 }))).toEqual({
      line: "Syncing 2 notes…",
      tone: "busy",
    });
    expect(describeVaultStatus(status({})).line).toBe("Up to date");
    expect(describeVaultStatus(status({ path: null })).line).toBe("");
  });
});
