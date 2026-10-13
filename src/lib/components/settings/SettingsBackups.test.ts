import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { render, fireEvent, cleanup, waitFor } from "@testing-library/svelte";
import SettingsBackups from "./SettingsBackups.svelte";
import { open } from "@tauri-apps/plugin-dialog";
import {
  backupNow,
  inspectBackup,
  listBackups,
  openBackupsFolder,
  restoreBackup,
  setBackupsAutomatic,
} from "$lib/api/client";
import { exportVaultToFolder } from "$lib/vault-export";
import { confirmDialog } from "$lib/stores/confirm.svelte";
import { toasts } from "$lib/stores/toasts.svelte";
import type { BackupList } from "$lib/api/types";

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
vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn(() => Promise.resolve(() => {})),
}));
vi.mock("$lib/stores/confirm.svelte", () => ({
  confirmDialog: { ask: vi.fn() },
}));

const EMPTY: BackupList = { backups: [], automatic: true, lastAt: null, folder: "/data/backups" };
const TWO: BackupList = {
  backups: [
    { path: "/data/backups/instantnotes-20261013-090000.db", madeAt: "2026-10-13T09:00:00Z", bytes: 2048 },
    { path: "/data/backups/instantnotes-20261012-090000.db", madeAt: "2026-10-12T09:00:00Z", bytes: 1024 },
  ],
  automatic: false,
  lastAt: "2026-10-13T09:00:00Z",
  folder: "/data/backups",
};

afterEach(cleanup);

beforeEach(() => {
  toasts.items.splice(0);
  vi.mocked(open).mockReset();
  vi.mocked(listBackups).mockReset();
  vi.mocked(backupNow).mockReset();
  vi.mocked(inspectBackup).mockReset();
  vi.mocked(restoreBackup).mockReset().mockResolvedValue(undefined);
  vi.mocked(setBackupsAutomatic).mockReset().mockResolvedValue(undefined);
  vi.mocked(openBackupsFolder).mockReset().mockResolvedValue(undefined);
  vi.mocked(exportVaultToFolder).mockReset();
  vi.mocked(confirmDialog.ask).mockReset();
});

describe("SettingsBackups on the desktop", () => {
  it("says there is no backup yet and lists none", async () => {
    vi.mocked(listBackups).mockResolvedValue(EMPTY);
    const { findByText, queryByRole } = render(SettingsBackups);

    expect(await findByText("No backup yet.")).toBeTruthy();
    expect(await findByText(/No backups yet/)).toBeTruthy();
    expect(queryByRole("list", { name: "Backups" })).toBeNull();
  });

  it("lists the backups newest first with their size and the last time", async () => {
    vi.mocked(listBackups).mockResolvedValue(TWO);
    const { findByRole, getAllByRole, getByText } = render(SettingsBackups);

    const list = await findByRole("list", { name: "Backups" });
    expect(list).toBeTruthy();
    expect(getAllByRole("button", { name: "Restore…" })).toHaveLength(2);
    expect(getByText("2 KB")).toBeTruthy();
    expect(getByText("1 KB")).toBeTruthy();
    expect(getByText(/^Last backup /)).toBeTruthy();
    expect(getAllByRole("switch")[0].getAttribute("aria-checked")).toBe("false");
  });

  it("flips the automatic setting", async () => {
    vi.mocked(listBackups).mockResolvedValue(EMPTY);
    const { findByText, getByRole } = render(SettingsBackups);
    await findByText(/No backups yet/);

    await fireEvent.click(getByRole("switch", { name: /Automatic backups/ }));

    expect(setBackupsAutomatic).toHaveBeenCalledWith(false);
  });

  it("backs up now and shows the new list", async () => {
    vi.mocked(listBackups).mockResolvedValue(EMPTY);
    vi.mocked(backupNow).mockResolvedValue(TWO);
    const { findByRole, findAllByRole } = render(SettingsBackups);

    await fireEvent.click(await findByRole("button", { name: "Back up now" }));

    expect(await findAllByRole("button", { name: "Restore…" })).toHaveLength(2);
    expect(toasts.items.map((t) => t.message)).toEqual([expect.stringContaining("Backed up.")]);
  });

  it("asks before restoring, naming the date, the count and the sync consequence", async () => {
    vi.mocked(listBackups).mockResolvedValue(TWO);
    vi.mocked(inspectBackup).mockResolvedValue({ madeAt: "2026-10-12T09:00:00Z", notes: 12, schemaVersion: 14 });
    vi.mocked(confirmDialog.ask).mockResolvedValue(true);
    const { findAllByRole } = render(SettingsBackups);

    await fireEvent.click((await findAllByRole("button", { name: "Restore…" }))[1]);

    await waitFor(() => expect(restoreBackup).toHaveBeenCalledWith(TWO.backups[1].path));
    expect(inspectBackup).toHaveBeenCalledWith(TWO.backups[1].path);
    const asked = vi.mocked(confirmDialog.ask).mock.calls[0][0];
    expect(asked.title).toMatch(/^Restore the library from /);
    expect(asked.body).toContain("12 notes");
    expect(asked.body).toContain("turns sync off");
    expect(asked.tone).toBe("danger");
  });

  it("does nothing when the restore is declined", async () => {
    vi.mocked(listBackups).mockResolvedValue(TWO);
    vi.mocked(inspectBackup).mockResolvedValue({ madeAt: null, notes: 1, schemaVersion: 14 });
    vi.mocked(confirmDialog.ask).mockResolvedValue(false);
    const { findAllByRole } = render(SettingsBackups);

    await fireEvent.click((await findAllByRole("button", { name: "Restore…" }))[0]);

    await waitFor(() => expect(confirmDialog.ask).toHaveBeenCalled());
    expect(restoreBackup).not.toHaveBeenCalled();
  });

  it("shows why a file cannot be restored", async () => {
    vi.mocked(listBackups).mockResolvedValue(EMPTY);
    vi.mocked(open).mockResolvedValue("/tmp/notes.db");
    vi.mocked(inspectBackup).mockRejectedValue(new Error("not an InstantNotes library: it holds no notes table"));
    const { findByRole } = render(SettingsBackups);

    await fireEvent.click(await findByRole("button", { name: "Restore from a file…" }));

    await waitFor(() =>
      expect(toasts.items.map((t) => t.message)).toEqual([expect.stringContaining("no notes table")]),
    );
    expect(confirmDialog.ask).not.toHaveBeenCalled();
  });

  it("opens the folder and exports to a chosen folder", async () => {
    vi.mocked(listBackups).mockResolvedValue(EMPTY);
    vi.mocked(exportVaultToFolder).mockResolvedValue({ ok: true });
    const { findByRole, getByRole } = render(SettingsBackups);

    await fireEvent.click(await findByRole("button", { name: "Open backups folder" }));
    expect(openBackupsFolder).toHaveBeenCalled();

    await fireEvent.click(getByRole("button", { name: /Export a copy/ }));
    await waitFor(() =>
      expect(toasts.items.map((t) => t.message)).toEqual([expect.stringContaining("Exported.")]),
    );
  });

  it("stays quiet when the export is cancelled and shows the error otherwise", async () => {
    vi.mocked(listBackups).mockResolvedValue(EMPTY);
    vi.mocked(exportVaultToFolder).mockResolvedValueOnce({ cancelled: true });
    const { findByRole } = render(SettingsBackups);
    const button = await findByRole("button", { name: /Export a copy/ });

    await fireEvent.click(button);
    await waitFor(() => expect(exportVaultToFolder).toHaveBeenCalledTimes(1));
    expect(toasts.items).toEqual([]);

    vi.mocked(exportVaultToFolder).mockResolvedValueOnce({ ok: false, error: "disk full" });
    await fireEvent.click(button);
    await waitFor(() =>
      expect(toasts.items.map((t) => t.message)).toEqual([expect.stringContaining("disk full")]),
    );
  });
});
