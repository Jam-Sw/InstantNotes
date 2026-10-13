import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { render, fireEvent, cleanup, waitFor } from "@testing-library/svelte";
import SettingsSync from "./SettingsSync.svelte";
import { exportVaultToFolder } from "$lib/vault-export";
import {
  disconnectSyncServer,
  getSyncServerStatus,
  getVaultStatus,
  listSyncDevices,
  setVaultFolder,
} from "$lib/api/client";
import { confirmDialog } from "$lib/stores/confirm.svelte";
import { toasts } from "$lib/stores/toasts.svelte";
import type { SyncServerStatus, VaultStatus } from "$lib/api/types";

vi.mock("$lib/vault-export", () => ({
  exportVaultToFolder: vi.fn(),
}));
vi.mock("$lib/api/client", () => ({
  acceptPlainServer: vi.fn(),
  cancelSyncSignIn: vi.fn(),
  confirmRecoverySaved: vi.fn(),
  confirmSyncJoin: vi.fn(),
  confirmSyncRemovals: vi.fn(),
  confirmVaultRemovals: vi.fn(),
  connectSyncServer: vi.fn(),
  disconnectSyncServer: vi.fn(),
  enterRecoveryKey: vi.fn(),
  getSyncServerStatus: vi.fn(),
  getVaultStatus: vi.fn(),
  listSyncDevices: vi.fn(),
  revokeSyncDevice: vi.fn(),
  setSyncEncryption: vi.fn(),
  setVaultFolder: vi.fn(),
  showRecoveryKey: vi.fn(),
  startSyncJoin: vi.fn(),
  verifyVault: vi.fn(),
}));
vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn(() => Promise.resolve(() => {})),
}));
vi.mock("$lib/stores/confirm.svelte", () => ({
  confirmDialog: { ask: vi.fn() },
}));

const VAULT_OFF: VaultStatus = {
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

const FOLDER: VaultStatus = {
  ...VAULT_OFF,
  path: "/Users/me/Vault",
  transport: "folder",
  reachable: true,
  lastSyncedAt: "2026-10-07T12:00:00.000000Z",
};

const SERVER_OFF: SyncServerStatus = {
  stage: "off",
  message: null,
  address: null,
  person: null,
  encrypted: false,
  joinWords: null,
  joinKey: null,
  recoveryKey: null,
  lastSyncedAt: null,
  conflicts: 0,
  heldRemovals: 0,
  tooLarge: [],
  localNotes: 0,
  serverItems: 0,
};

const CONNECTED: SyncServerStatus = {
  ...SERVER_OFF,
  stage: "upToDate",
  address: "https://notes.example.org",
  person: "sam@example.org",
  encrypted: true,
};

const ask = vi.mocked(confirmDialog.ask);

function showing(vault: VaultStatus, server: SyncServerStatus) {
  vi.mocked(getVaultStatus).mockResolvedValue(vault);
  vi.mocked(getSyncServerStatus).mockResolvedValue(server);
  return render(SettingsSync);
}

function selected(getByRole: (role: string, options: { name: string }) => HTMLElement, name: string) {
  return getByRole("radio", { name }).getAttribute("aria-checked") === "true";
}

afterEach(cleanup);

beforeEach(() => {
  vi.mocked(exportVaultToFolder).mockReset();
  vi.mocked(getVaultStatus).mockReset();
  vi.mocked(getSyncServerStatus).mockReset();
  vi.mocked(setVaultFolder).mockReset();
  vi.mocked(disconnectSyncServer).mockReset().mockResolvedValue(undefined);
  vi.mocked(listSyncDevices).mockReset().mockResolvedValue([]);
  ask.mockReset();
  toasts.items = [];
});

describe("SettingsSync provider choice", () => {
  it("shows Off when nothing syncs", async () => {
    const { findByText, getByRole } = showing(VAULT_OFF, SERVER_OFF);
    expect(await findByText("Your notes are on this device only.")).toBeTruthy();
    expect(selected(getByRole, "Off")).toBe(true);
  });

  it("shows the folder card when a folder syncs", async () => {
    const { findByText, getByRole } = showing(FOLDER, SERVER_OFF);
    expect(await findByText("/Users/me/Vault")).toBeTruthy();
    expect(selected(getByRole, "Folder")).toBe(true);
  });

  it("shows the server card when a server syncs", async () => {
    const { findByText, getByRole } = showing(VAULT_OFF, CONNECTED);
    expect(await findByText("sam@example.org")).toBeTruthy();
    expect(selected(getByRole, "Sync server")).toBe(true);
  });

  it("moves from Off to a provider without asking", async () => {
    const { findByRole, getByRole } = showing(VAULT_OFF, SERVER_OFF);

    const server = getByRole("radio", { name: "Sync server" }) as HTMLButtonElement;
    await waitFor(() => expect(server.disabled).toBe(false));
    await fireEvent.click(server);

    expect(ask).not.toHaveBeenCalled();
    expect(await findByRole("textbox", { name: "Server address" })).toBeTruthy();
  });

  it("asks before leaving the folder and stays when declined", async () => {
    ask.mockResolvedValue(false);
    const { findByText, getByRole } = showing(FOLDER, SERVER_OFF);

    await findByText("/Users/me/Vault");
    await fireEvent.click(getByRole("radio", { name: "Sync server" }));

    await waitFor(() =>
      expect(ask).toHaveBeenCalledWith(
        expect.objectContaining({
          title: "Stop syncing with your folder?",
          body: "Your notes stay on this device.",
        }),
      ),
    );
    expect(setVaultFolder).not.toHaveBeenCalled();
    expect(selected(getByRole, "Folder")).toBe(true);
  });

  it("stops the folder and opens the server card when confirmed", async () => {
    ask.mockResolvedValue(true);
    vi.mocked(setVaultFolder).mockImplementation(async () => {
      vi.mocked(getVaultStatus).mockResolvedValue(VAULT_OFF);
      return VAULT_OFF;
    });
    const { findByText, findByRole, getByRole } = showing(FOLDER, SERVER_OFF);

    await findByText("/Users/me/Vault");
    await fireEvent.click(getByRole("radio", { name: "Sync server" }));

    await waitFor(() => expect(setVaultFolder).toHaveBeenCalledWith(null));
    expect(await findByRole("textbox", { name: "Server address" })).toBeTruthy();
    expect(selected(getByRole, "Sync server")).toBe(true);
  });

  it("names the server when leaving it and disconnects when confirmed", async () => {
    ask.mockResolvedValue(true);
    vi.mocked(disconnectSyncServer).mockImplementation(async () => {
      vi.mocked(getSyncServerStatus).mockResolvedValue(SERVER_OFF);
    });
    const { findByText, getByRole } = showing(VAULT_OFF, CONNECTED);

    await findByText("sam@example.org");
    await fireEvent.click(getByRole("radio", { name: "Off" }));

    await waitFor(() => expect(disconnectSyncServer).toHaveBeenCalled());
    expect(ask.mock.calls[0][0]).toMatchObject({ title: "Stop syncing with notes.example.org?" });
    expect(await findByText("Your notes are on this device only.")).toBeTruthy();
  });

  it("keeps the folder card after the folder stops on its own", async () => {
    vi.mocked(setVaultFolder).mockImplementation(async () => {
      vi.mocked(getVaultStatus).mockResolvedValue(VAULT_OFF);
      return VAULT_OFF;
    });
    const { findByRole, getByRole } = showing(FOLDER, SERVER_OFF);

    await fireEvent.click(await findByRole("button", { name: /Stop syncing/ }));

    expect(await findByRole("button", { name: /Choose folder/ })).toBeTruthy();
    expect(selected(getByRole, "Folder")).toBe(true);
  });
});

describe("SettingsSync export", () => {
  it("shows a success toast after a completed export", async () => {
    vi.mocked(exportVaultToFolder).mockResolvedValue({ ok: true });
    const { getByRole } = showing(VAULT_OFF, SERVER_OFF);

    await fireEvent.click(getByRole("button", { name: /Export a copy/ }));

    await waitFor(() =>
      expect(toasts.items.map((t) => t.message)).toEqual([expect.stringContaining("Exported.")]),
    );
  });

  it("shows no toast when the user cancels the folder picker", async () => {
    vi.mocked(exportVaultToFolder).mockResolvedValue({ cancelled: true });
    const { getByRole } = showing(VAULT_OFF, SERVER_OFF);

    await fireEvent.click(getByRole("button", { name: /Export a copy/ }));
    await waitFor(() => expect(vi.mocked(exportVaultToFolder)).toHaveBeenCalled());

    expect(toasts.items).toEqual([]);
  });

  it("shows the error on failure", async () => {
    vi.mocked(exportVaultToFolder).mockResolvedValue({ ok: false, error: "disk full" });
    const { getByRole } = showing(VAULT_OFF, SERVER_OFF);

    await fireEvent.click(getByRole("button", { name: /Export a copy/ }));

    await waitFor(() =>
      expect(toasts.items.map((t) => t.message)).toEqual([expect.stringContaining("disk full")]),
    );
  });

  it("disables the button while exporting", async () => {
    let resolve!: (v: { ok: true }) => void;
    vi.mocked(exportVaultToFolder).mockReturnValue(
      new Promise((r) => {
        resolve = r;
      }),
    );
    const { getByRole } = showing(VAULT_OFF, SERVER_OFF);
    const button = getByRole("button", { name: /Export a copy/ }) as HTMLButtonElement;

    await fireEvent.click(button);
    expect(button.disabled).toBe(true);

    resolve({ ok: true });
    await waitFor(() => expect(button.disabled).toBe(false));
  });
});
