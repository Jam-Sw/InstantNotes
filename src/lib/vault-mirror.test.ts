import { describe, it, expect, vi, beforeEach } from "vitest";
import { open } from "@tauri-apps/plugin-dialog";
import { chooseVaultFolder, describeVaultReport } from "./vault-mirror";
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
