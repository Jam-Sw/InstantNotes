import { describe, it, expect, vi, beforeEach } from "vitest";
import { open } from "@tauri-apps/plugin-dialog";
import { exportVault } from "$lib/api/client";
import { exportVaultToFolder } from "./vault-export";

vi.mock("@tauri-apps/plugin-dialog", () => ({
  open: vi.fn(),
}));
vi.mock("$lib/api/client", () => ({
  exportVault: vi.fn(),
}));

beforeEach(() => {
  vi.mocked(open).mockReset();
  vi.mocked(exportVault).mockReset();
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
