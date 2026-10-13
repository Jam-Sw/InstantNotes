import { beforeEach, describe, expect, it, vi } from "vitest";

const run = vi.fn();
const emit = vi.fn();
const syncSoon = vi.fn();
const status = vi.fn();

vi.mock("./core", () => ({
  run: (...args: unknown[]) => run(...args),
  emit: (...args: unknown[]) => emit(...args),
}));
vi.mock("./sync", () => ({
  startSync: () => Promise.resolve(),
  syncSoon: () => syncSoon(),
  syncCommands: { get_sync_server_status: (args: unknown) => status(args) },
}));
vi.mock("$lib/api/runtime", () => ({ clientId: "tab-1", isWeb: true }));

import { callLibrary, libraryAttachment, saveLibraryAttachment } from "./library";

beforeEach(() => {
  run.mockReset();
  emit.mockReset();
  syncSoon.mockReset();
  status.mockReset();
});

describe("the web library", () => {
  it("runs a command in the worker and announces what it changed", async () => {
    run.mockResolvedValue(
      JSON.stringify({
        value: { id: "n1" },
        changes: [{ event: "notes:changed", payload: { noteId: "n1", origin: "tab-1" } }],
      }),
    );
    await expect(callLibrary("create_note", { input: { title: "A" } })).resolves.toEqual({
      id: "n1",
    });
    expect(run).toHaveBeenCalledWith(
      "call",
      "create_note",
      JSON.stringify({ input: { title: "A" } }),
      "tab-1",
    );
    expect(emit).toHaveBeenCalledWith("notes:changed", { noteId: "n1", origin: "tab-1" });
    expect(syncSoon).toHaveBeenCalledOnce();
  });

  it("starts no sync when nothing changed", async () => {
    run.mockResolvedValue(JSON.stringify({ value: [], changes: [] }));
    await callLibrary("list_notes", { filter: {} });
    expect(syncSoon).not.toHaveBeenCalled();
  });

  it("answers sync commands in the page, not the worker", async () => {
    status.mockResolvedValue({ stage: "upToDate" });
    await expect(callLibrary("get_sync_server_status")).resolves.toEqual({ stage: "upToDate" });
    expect(run).not.toHaveBeenCalled();
  });

  it("keeps a pasted image in the browser and syncs it", async () => {
    run.mockResolvedValue("a1.png");
    const bytes = new Uint8Array([1, 2, 3]);
    await expect(saveLibraryAttachment(bytes, "png")).resolves.toBe("a1.png");
    expect(run).toHaveBeenCalledWith("save_attachment", bytes, "png");
    expect(syncSoon).toHaveBeenCalledOnce();
  });

  it("reads an image back, or nothing when it is missing", async () => {
    run.mockResolvedValueOnce(new Uint8Array([9])).mockResolvedValueOnce(undefined);
    await expect(libraryAttachment("a1.png")).resolves.toEqual(new Uint8Array([9]));
    await expect(libraryAttachment("gone.png")).resolves.toBeNull();
  });
});
