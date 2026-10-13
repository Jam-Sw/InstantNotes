import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { render, fireEvent, cleanup, waitFor } from "@testing-library/svelte";
import SyncServer from "./SyncServer.svelte";
import {
  connectSyncServer,
  disconnectSyncServer,
  getSyncServerStatus,
  listSyncDevices,
} from "$lib/api/client";
import { confirmDialog } from "$lib/stores/confirm.svelte";
import type { SyncServerStatus } from "$lib/api/types";

vi.mock("$lib/api/runtime", () => ({ clientId: "tab-1", isWeb: true }));
vi.mock("$lib/api/client", () => ({
  acceptPlainServer: vi.fn(),
  cancelSyncSignIn: vi.fn(),
  confirmRecoverySaved: vi.fn(),
  confirmSyncJoin: vi.fn(),
  confirmSyncRemovals: vi.fn(),
  connectSyncServer: vi.fn(),
  disconnectSyncServer: vi.fn(),
  enterRecoveryKey: vi.fn(),
  getSyncServerStatus: vi.fn(),
  listSyncDevices: vi.fn(),
  revokeSyncDevice: vi.fn(),
  setSyncEncryption: vi.fn(),
  showRecoveryKey: vi.fn(),
  startSyncJoin: vi.fn(),
}));
vi.mock("$lib/api/events", () => ({
  EVENTS: { VAULT_STATUS: "vault:status" },
  listen: vi.fn(() => Promise.resolve(() => {})),
}));
vi.mock("$lib/stores/confirm.svelte", () => ({
  confirmDialog: { ask: vi.fn() },
}));

const KEY = "AGE-SECRET-KEY-1QYQSZQGPQYQSZQGPQYQSZQGPQYQSZQGPQYQSZQGPQYQSZQGPQYQSQ8F3ZK";

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
};

function at(stage: SyncServerStatus["stage"], overrides: Partial<SyncServerStatus> = {}): SyncServerStatus {
  return { ...OFF, stage, person: "sam@example.org", encrypted: true, ...overrides };
}

const ask = vi.mocked(confirmDialog.ask);

function showing(status: SyncServerStatus) {
  vi.mocked(getSyncServerStatus).mockResolvedValue(status);
  return render(SyncServer);
}

afterEach(cleanup);

beforeEach(() => {
  vi.mocked(connectSyncServer).mockReset();
  vi.mocked(disconnectSyncServer).mockReset().mockResolvedValue(undefined);
  vi.mocked(getSyncServerStatus).mockReset().mockResolvedValue(OFF);
  vi.mocked(listSyncDevices).mockReset().mockResolvedValue([]);
  ask.mockReset();
});

describe("SyncServer on the web, first device", () => {
  it("offers to set up this server instead of asking for an address", async () => {
    const { findByText, queryByRole } = showing(OFF);

    expect(await findByText("This server has no library yet.")).toBeTruthy();
    expect(queryByRole("textbox", { name: "Server address" })).toBeNull();
  });

  it("sets up this server with encryption on by default", async () => {
    vi.mocked(connectSyncServer).mockResolvedValue(at("recoveryKey", { recoveryKey: KEY }));
    const { findByRole, findByText } = showing(OFF);

    await fireEvent.click(await findByRole("button", { name: "Set up" }));

    expect(connectSyncServer).toHaveBeenCalledWith(location.host, true);
    expect(await findByText(/If you lose this recovery key/)).toBeTruthy();
  });

  it("sets up this server without encryption when the switch is turned off first", async () => {
    vi.mocked(connectSyncServer).mockResolvedValue(at("syncing", { encrypted: false }));
    const { findByRole, getByRole, getByText } = showing(OFF);

    await fireEvent.click(await findByRole("switch", { name: "End-to-end encryption" }));
    expect(getByText(/Your server can read your notes/)).toBeTruthy();
    expect(ask).not.toHaveBeenCalled();
    await fireEvent.click(getByRole("button", { name: "Set up" }));

    expect(connectSyncServer).toHaveBeenCalledWith(location.host, false);
  });

  it("says why setting up failed", async () => {
    vi.mocked(connectSyncServer).mockRejectedValue({ code: "STORAGE_ERROR", message: "server answered 503" });
    const { findByRole, findByText } = showing(OFF);

    await fireEvent.click(await findByRole("button", { name: "Set up" }));

    expect(await findByText("Couldn't set up: server answered 503")).toBeTruthy();
  });
});

describe("SyncServer on the web, signing out", () => {
  it("asks first and stays signed in when declined", async () => {
    ask.mockResolvedValue(false);
    const { findByRole } = showing(at("upToDate"));

    await fireEvent.click(await findByRole("button", { name: "Sign out of this browser" }));

    await waitFor(() =>
      expect(ask).toHaveBeenCalledWith(
        expect.objectContaining({
          title: "Sign out of this browser?",
          body: "This browser's copy of your notes is removed. They stay on your server and your other devices.",
        }),
      ),
    );
    expect(disconnectSyncServer).not.toHaveBeenCalled();
  });

  it("signs out when confirmed", async () => {
    ask.mockResolvedValue(true);
    const { findByRole } = showing(at("upToDate"));

    await fireEvent.click(await findByRole("button", { name: "Sign out of this browser" }));

    await waitFor(() => expect(disconnectSyncServer).toHaveBeenCalled());
  });
});
