import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { render, fireEvent, cleanup, waitFor } from "@testing-library/svelte";
import SettingsVault from "./SettingsVault.svelte";
import { exportVaultToFolder } from "$lib/vault-export";
import { chooseVaultFolder } from "$lib/vault-mirror";
import {
  confirmVaultRemovals,
  getVaultStatus,
  setVaultFolder,
  verifyVault,
} from "$lib/api/client";
import { toasts } from "$lib/stores/toasts.svelte";
import type { VaultStatus } from "$lib/api/types";

vi.mock("$lib/vault-export", () => ({
  exportVaultToFolder: vi.fn(),
}));
vi.mock("$lib/vault-mirror", async (importOriginal) => ({
  ...(await importOriginal<typeof import("$lib/vault-mirror")>()),
  chooseVaultFolder: vi.fn(),
}));
vi.mock("$lib/api/client", () => ({
  getVaultStatus: vi.fn(),
  setVaultFolder: vi.fn(),
  verifyVault: vi.fn(),
  confirmVaultRemovals: vi.fn(),
}));
vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn(() => Promise.resolve(() => {})),
}));

const OFF: VaultStatus = {
  path: null,
  transport: null,
  reachable: false,
  unreachable: null,
  pending: 0,
  lastError: null,
  lastFlushedAt: null,
  lastSyncedAt: null,
  heldRemovals: 0,
  conflicts: 0,
};

function on(overrides: Partial<VaultStatus> = {}): VaultStatus {
  return {
    ...OFF,
    path: "/Users/me/Vault",
    transport: "folder",
    reachable: true,
    lastFlushedAt: "t",
    lastSyncedAt: "2026-10-07T12:00:00.000000Z",
    ...overrides,
  };
}

afterEach(cleanup);

beforeEach(() => {
  vi.mocked(exportVaultToFolder).mockReset();
  vi.mocked(chooseVaultFolder).mockReset();
  vi.mocked(getVaultStatus).mockReset().mockResolvedValue(OFF);
  vi.mocked(setVaultFolder).mockReset();
  vi.mocked(verifyVault).mockReset();
  vi.mocked(confirmVaultRemovals).mockReset();
  toasts.items = [];
});

describe("SettingsVault live mirror", () => {
  it("offers to choose a folder while mirroring is off", async () => {
    const { findByRole, queryByRole } = render(SettingsVault);
    expect(await findByRole("button", { name: /Choose folder/ })).toBeTruthy();
    expect(queryByRole("button", { name: /Stop syncing/ })).toBeNull();
  });

  it("starts mirroring into the picked folder", async () => {
    vi.mocked(chooseVaultFolder).mockResolvedValue({ path: "/Users/me/Vault" });
    vi.mocked(setVaultFolder).mockResolvedValue(on({ pending: 12 }));
    const { findByRole, findByText } = render(SettingsVault);

    await fireEvent.click(await findByRole("button", { name: /Choose folder/ }));

    expect(setVaultFolder).toHaveBeenCalledWith("/Users/me/Vault");
    expect(await findByText("/Users/me/Vault")).toBeTruthy();
    expect(await findByText(/Syncing 12 notes/)).toBeTruthy();
  });

  it("does nothing when the folder picker is cancelled", async () => {
    vi.mocked(chooseVaultFolder).mockResolvedValue({ cancelled: true });
    const { findByRole } = render(SettingsVault);
    await fireEvent.click(await findByRole("button", { name: /Choose folder/ }));
    await waitFor(() => expect(chooseVaultFolder).toHaveBeenCalled());
    expect(setVaultFolder).not.toHaveBeenCalled();
  });

  it("shows the backend's reason when a folder is refused", async () => {
    vi.mocked(chooseVaultFolder).mockResolvedValue({ path: "/Library/InstantNotes" });
    vi.mocked(setVaultFolder).mockRejectedValue(
      new Error("choose a folder outside the app's own data folder"),
    );
    const { findByRole } = render(SettingsVault);
    await fireEvent.click(await findByRole("button", { name: /Choose folder/ }));
    await waitFor(() =>
      expect(toasts.items.map((t) => t.message)).toEqual([
        expect.stringContaining("outside the app's own data folder"),
      ]),
    );
  });

  it("reports an up-to-date mirror", async () => {
    vi.mocked(getVaultStatus).mockResolvedValue(on());
    const { findByText } = render(SettingsVault);
    expect(await findByText(/Up to date/)).toBeTruthy();
  });

  it("explains a missing folder as offline, with the changes waiting for it", async () => {
    vi.mocked(getVaultStatus).mockResolvedValue(
      on({ reachable: false, pending: 3, unreachable: "vault folder not found: /Volumes/USB/Vault" }),
    );
    const { findByText } = render(SettingsVault);
    expect(await findByText(/Offline: the folder can't be found. 3 notes will sync/)).toBeTruthy();
  });

  it("explains an empty mount point as an unmounted drive", async () => {
    vi.mocked(getVaultStatus).mockResolvedValue(
      on({ reachable: false, unreachable: "vault folder has no instantnotes.yaml: /mnt/share" }),
    );
    const { findByText } = render(SettingsVault);
    expect(await findByText(/check that it's mounted/)).toBeTruthy();
  });

  it("shows any other error as a problem with its message", async () => {
    vi.mocked(getVaultStatus).mockResolvedValue(on({ lastError: "note x: disk full" }));
    const { findByText } = render(SettingsVault);
    expect(await findByText(/Problem: note x: disk full/)).toBeTruthy();
  });

  it("holds a mass removal until the user moves the notes to the Trash", async () => {
    vi.mocked(getVaultStatus).mockResolvedValue(on({ heldRemovals: 40 }));
    vi.mocked(confirmVaultRemovals).mockResolvedValue(on());
    const { findByRole, findByText } = render(SettingsVault);
    expect(await findByText(/40 notes went missing/)).toBeTruthy();
    await fireEvent.click(await findByRole("button", { name: /Move 40 notes to Trash/ }));
    expect(confirmVaultRemovals).toHaveBeenCalled();
    expect(await findByText(/Up to date/)).toBeTruthy();
  });

  it("counts conflicts kept as copies", async () => {
    vi.mocked(getVaultStatus).mockResolvedValue(on({ conflicts: 2 }));
    const { findByText } = render(SettingsVault);
    expect(await findByText(/2 notes changed in two places/)).toBeTruthy();
  });

  it("stops mirroring and returns to the off state", async () => {
    vi.mocked(getVaultStatus).mockResolvedValue(on());
    vi.mocked(setVaultFolder).mockResolvedValue(OFF);
    const { findByRole } = render(SettingsVault);

    await fireEvent.click(await findByRole("button", { name: /Stop syncing/ }));

    expect(setVaultFolder).toHaveBeenCalledWith(null);
    expect(await findByRole("button", { name: /Choose folder/ })).toBeTruthy();
  });

  it("checks the vault and shows what it found", async () => {
    vi.mocked(getVaultStatus).mockResolvedValue(on());
    vi.mocked(verifyVault).mockResolvedValue({
      checked: 3,
      missing: [],
      diverged: ["Plan.md"],
      orphans: [],
      pending: 0,
      manifestOk: true,
    });
    const { findByRole, findByText } = render(SettingsVault);

    await fireEvent.click(await findByRole("button", { name: /Check vault/ }));

    expect(await findByText(/1 file was edited outside InstantNotes: Plan.md/)).toBeTruthy();
  });
});

describe("SettingsVault", () => {
  it("shows a success toast after a completed export", async () => {
    vi.mocked(exportVaultToFolder).mockResolvedValue({ ok: true });
    const { getByRole } = render(SettingsVault);

    await fireEvent.click(getByRole("button", { name: /Export a copy/ }));

    await waitFor(() =>
      expect(toasts.items.map((t) => t.message)).toEqual([
        expect.stringContaining("Exported."),
      ]),
    );
  });

  it("shows no toast when the user cancels the folder picker", async () => {
    vi.mocked(exportVaultToFolder).mockResolvedValue({ cancelled: true });
    const { getByRole } = render(SettingsVault);

    await fireEvent.click(getByRole("button", { name: /Export a copy/ }));
    await waitFor(() => expect(vi.mocked(exportVaultToFolder)).toHaveBeenCalled());

    expect(toasts.items).toEqual([]);
  });

  it("shows the error on failure", async () => {
    vi.mocked(exportVaultToFolder).mockResolvedValue({ ok: false, error: "disk full" });
    const { getByRole } = render(SettingsVault);

    await fireEvent.click(getByRole("button", { name: /Export a copy/ }));

    await waitFor(() =>
      expect(toasts.items.map((t) => t.message)).toEqual([
        expect.stringContaining("disk full"),
      ]),
    );
  });

  it("disables the button while exporting", async () => {
    let resolve!: (v: { ok: true }) => void;
    vi.mocked(exportVaultToFolder).mockReturnValue(
      new Promise((r) => {
        resolve = r;
      }),
    );
    const { getByRole } = render(SettingsVault);
    const button = getByRole("button", { name: /Export a copy/ }) as HTMLButtonElement;

    await fireEvent.click(button);
    expect(button.disabled).toBe(true);

    resolve({ ok: true });
    await waitFor(() => expect(button.disabled).toBe(false));
  });
});
