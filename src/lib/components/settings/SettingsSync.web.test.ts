import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { render, cleanup } from "@testing-library/svelte";
import SettingsSync from "./SettingsSync.svelte";
import { getSyncServerStatus, getVaultStatus, listSyncDevices } from "$lib/api/client";
import type { SyncServerStatus } from "$lib/api/types";

vi.mock("$lib/api/runtime", () => ({ clientId: "tab-1", isWeb: true }));
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
vi.mock("$lib/api/events", () => ({
  EVENTS: { VAULT_STATUS: "vault:status" },
  listen: vi.fn(() => Promise.resolve(() => {})),
}));
vi.mock("$lib/stores/confirm.svelte", () => ({
  confirmDialog: { ask: vi.fn() },
}));

const OFF: SyncServerStatus = {
  stage: "off",
  message: null,
  address: "notes.example.org",
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
  pairingCode: null,
  pairingUrl: null,
};

const CONNECTED: SyncServerStatus = {
  ...OFF,
  stage: "upToDate",
  person: "sam@example.org",
  encrypted: true,
};

function showing(server: SyncServerStatus) {
  vi.mocked(getSyncServerStatus).mockResolvedValue(server);
  return render(SettingsSync);
}

afterEach(cleanup);

beforeEach(() => {
  vi.mocked(getSyncServerStatus).mockReset();
  vi.mocked(getVaultStatus).mockReset();
  vi.mocked(listSyncDevices).mockReset().mockResolvedValue([]);
});

describe("SettingsSync on the web", () => {
  it("shows the server card with no provider choice or folder", async () => {
    const { findByText, queryByRole, queryByText } = showing(CONNECTED);

    expect(await findByText("sam@example.org")).toBeTruthy();
    expect(queryByText("Sync with")).toBeNull();
    expect(queryByRole("radio", { name: "Folder" })).toBeNull();
    expect(queryByRole("radio", { name: "Sync server" })).toBeNull();
    expect(queryByRole("button", { name: /Choose folder/ })).toBeNull();
    expect(getVaultStatus).not.toHaveBeenCalled();
  });

  it("offers to set up a server with no library", async () => {
    const { findByRole, queryByRole } = showing(OFF);

    expect(await findByRole("button", { name: "Set up" })).toBeTruthy();
    expect(queryByRole("radio", { name: "Off" })).toBeNull();
  });
});
