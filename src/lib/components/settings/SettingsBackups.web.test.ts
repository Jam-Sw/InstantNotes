import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { render, fireEvent, cleanup, waitFor } from "@testing-library/svelte";
import SettingsBackups from "./SettingsBackups.svelte";
import { listBackups } from "$lib/api/client";
import { exportArchiveDownload } from "$lib/vault-export";
import { toasts } from "$lib/stores/toasts.svelte";

vi.mock("$lib/api/runtime", () => ({ clientId: "tab-1", isWeb: true }));
vi.mock("@tauri-apps/plugin-dialog", () => ({ open: vi.fn() }));
vi.mock("$lib/vault-export", () => ({
  exportVaultToFolder: vi.fn(),
  exportArchiveDownload: vi.fn(),
}));
vi.mock("$lib/api/client", () => ({
  backupNow: vi.fn(),
  inspectBackup: vi.fn(),
  listBackups: vi.fn(),
  openBackupsFolder: vi.fn(),
  restoreBackup: vi.fn(),
  setBackupsAutomatic: vi.fn(),
}));
vi.mock("$lib/stores/confirm.svelte", () => ({
  confirmDialog: { ask: vi.fn() },
}));

afterEach(cleanup);

beforeEach(() => {
  toasts.items.splice(0);
  vi.mocked(listBackups).mockReset();
  vi.mocked(exportArchiveDownload).mockReset();
});

describe("SettingsBackups in the browser", () => {
  it("is the Export page: no backups, no restore, one download", async () => {
    vi.mocked(exportArchiveDownload).mockResolvedValue({ ok: true });
    const { getByRole, getByText, queryByRole, queryByText } = render(SettingsBackups);

    expect(getByRole("heading", { name: "Export" })).toBeTruthy();
    expect(getByText(/kept on the server and on every signed-in device/)).toBeTruthy();
    expect(queryByRole("switch")).toBeNull();
    expect(queryByText("Back up now")).toBeNull();
    expect(listBackups).not.toHaveBeenCalled();

    await fireEvent.click(getByRole("button", { name: "Download…" }));

    await waitFor(() => expect(exportArchiveDownload).toHaveBeenCalledTimes(1));
    await waitFor(() =>
      expect(toasts.items.map((t) => t.message)).toEqual([expect.stringContaining("Exported.")]),
    );
  });

  it("shows the error when the download fails", async () => {
    vi.mocked(exportArchiveDownload).mockResolvedValue({ ok: false, error: "storage closed" });
    const { getByRole } = render(SettingsBackups);

    await fireEvent.click(getByRole("button", { name: "Download…" }));

    await waitFor(() =>
      expect(toasts.items.map((t) => t.message)).toEqual([expect.stringContaining("storage closed")]),
    );
  });
});
