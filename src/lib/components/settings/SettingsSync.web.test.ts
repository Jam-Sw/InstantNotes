import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { render, cleanup, fireEvent, waitFor, within } from "@testing-library/svelte";
import SettingsSync from "./SettingsSync.svelte";
import { getSetting, getSyncServerStatus, getVaultStatus, listSyncDevices, setSetting } from "$lib/api/client";
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
  getSetting: vi.fn(),
  getSyncServerStatus: vi.fn(),
  getVaultStatus: vi.fn(),
  listSyncDevices: vi.fn(),
  revokeSyncDevice: vi.fn(),
  setSetting: vi.fn(),
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
  vi.mocked(getSetting).mockReset().mockResolvedValue(null);
  vi.mocked(setSetting).mockReset().mockResolvedValue(undefined);
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

  it("shows the default sync and retry delays", async () => {
    const { findByRole } = showing(CONNECTED);

    expect((await findByRole("radio", { name: "300 ms" })).getAttribute("aria-checked")).toBe("true");
    const retry = within(await findByRole("radiogroup", { name: "Retry delay" }));
    expect(retry.getByRole("radio", { name: "30 s" }).getAttribute("aria-checked")).toBe("true");
  });

  it("restores the saved delays", async () => {
    vi.mocked(getSetting).mockImplementation(async (key: string) =>
      (key === "sync.delayMs" ? 10000 : 300) as never,
    );
    const { findByRole } = showing(CONNECTED);

    const delay = within(await findByRole("radiogroup", { name: "Sync delay" })).getByRole("radio", { name: "10 s" });
    const retry = within(await findByRole("radiogroup", { name: "Retry delay" })).getByRole("radio", { name: "5 min" });
    await waitFor(() => expect(delay.getAttribute("aria-checked")).toBe("true"));
    expect(retry.getAttribute("aria-checked")).toBe("true");
  });

  it("saves a chosen sync delay", async () => {
    const { findByRole } = showing(CONNECTED);

    await fireEvent.click(await findByRole("radio", { name: "2 s" }));
    expect(setSetting).toHaveBeenCalledWith("sync.delayMs", 2000);
  });

  it("saves a chosen retry delay", async () => {
    const { findByRole } = showing(CONNECTED);

    const group = within(await findByRole("radiogroup", { name: "Retry delay" }));
    await fireEvent.click(group.getByRole("radio", { name: "1 min" }));
    expect(setSetting).toHaveBeenCalledWith("sync.retrySec", 60);
  });
});

describe("SettingsSync web reset", () => {
  it("resets the sync and retry delays", async () => {
    const { findByRole, queryAllByRole } = showing(CONNECTED);

    const delay = within(await findByRole("radiogroup", { name: "Sync delay" }));
    await fireEvent.click(delay.getByRole("radio", { name: "10 s" }));
    const retry = within(await findByRole("radiogroup", { name: "Retry delay" }));
    await fireEvent.click(retry.getByRole("radio", { name: "1 min" }));
    expect(queryAllByRole("button", { name: "Reset" })).toHaveLength(2);

    await fireEvent.click(queryAllByRole("button", { name: "Reset" })[0]);
    expect(setSetting).toHaveBeenLastCalledWith("sync.delayMs", 300);
    await fireEvent.click(queryAllByRole("button", { name: "Reset" })[0]);
    expect(setSetting).toHaveBeenLastCalledWith("sync.retrySec", 30);
    expect(queryAllByRole("button", { name: "Reset" })).toHaveLength(0);
  });
});
