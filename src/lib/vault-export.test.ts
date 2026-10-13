import { describe, it, expect, vi, beforeEach } from "vitest";
import { open } from "@tauri-apps/plugin-dialog";
import { exportArchive, exportVault } from "$lib/api/client";
import { exportArchiveDownload, exportVaultToFolder } from "./vault-export";

vi.mock("@tauri-apps/plugin-dialog", () => ({
  open: vi.fn(),
}));
vi.mock("$lib/api/client", () => ({
  exportArchive: vi.fn(),
  exportVault: vi.fn(),
}));

beforeEach(() => {
  vi.mocked(open).mockReset();
  vi.mocked(exportVault).mockReset();
  vi.mocked(exportArchive).mockReset();
});

describe("exportVaultToFolder", () => {
  it("writes to the folder the user picked", async () => {
    vi.mocked(open).mockResolvedValue("/Users/me/notes-vault");
    vi.mocked(exportVault).mockResolvedValue(undefined);

    const result = await exportVaultToFolder();

    expect(exportVault).toHaveBeenCalledWith("/Users/me/notes-vault");
    expect(result).toEqual({ ok: true });
  });

  it("reports cancellation without calling the backend when no folder is picked", async () => {
    vi.mocked(open).mockResolvedValue(null);

    const result = await exportVaultToFolder();

    expect(exportVault).not.toHaveBeenCalled();
    expect(result).toEqual({ cancelled: true });
  });

  it("surfaces the backend error message on failure", async () => {
    vi.mocked(open).mockResolvedValue("/dest");
    vi.mocked(exportVault).mockRejectedValue(new Error("disk full"));

    const result = await exportVaultToFolder();

    expect(result).toEqual({ ok: false, error: "disk full" });
  });

  it("surfaces a dialog failure without calling the backend", async () => {
    vi.mocked(open).mockRejectedValue(new Error("dialog unavailable"));

    const result = await exportVaultToFolder();

    expect(exportVault).not.toHaveBeenCalled();
    expect(result).toEqual({ ok: false, error: "dialog unavailable" });
  });
});

describe("exportArchiveDownload", () => {
  it("downloads one archive with the dated name", async () => {
    vi.mocked(exportArchive).mockResolvedValue(new Uint8Array([80, 75, 5, 6]));
    const createObjectURL = vi.fn(() => "blob:archive");
    const revokeObjectURL = vi.fn();
    vi.stubGlobal("URL", { createObjectURL, revokeObjectURL });
    const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});

    const result = await exportArchiveDownload();

    expect(result).toEqual({ ok: true });
    expect(createObjectURL).toHaveBeenCalledTimes(1);
    expect(click).toHaveBeenCalledTimes(1);
    const link = click.mock.instances[0] as HTMLAnchorElement;
    expect(link.download).toMatch(/^InstantNotes-\d{4}-\d{2}-\d{2}\.zip$/);
    expect(link.download).toBe(`InstantNotes-${new Date().toISOString().slice(0, 10)}.zip`);
    expect(revokeObjectURL).toHaveBeenCalledWith("blob:archive");
    vi.unstubAllGlobals();
    click.mockRestore();
  });

  it("reports the engine's error", async () => {
    vi.mocked(exportArchive).mockRejectedValue(new Error("storage closed"));

    expect(await exportArchiveDownload()).toEqual({ ok: false, error: "storage closed" });
  });
});
