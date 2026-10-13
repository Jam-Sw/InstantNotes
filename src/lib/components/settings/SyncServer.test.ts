import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { render, fireEvent, cleanup, waitFor } from "@testing-library/svelte";
import SyncServer from "./SyncServer.svelte";
import {
  acceptPlainServer,
  cancelSyncSignIn,
  confirmRecoverySaved,
  confirmSyncJoin,
  confirmSyncRemovals,
  connectSyncServer,
  disconnectSyncServer,
  enterRecoveryKey,
  getSyncServerStatus,
  listSyncDevices,
  revokeSyncDevice,
  setSyncEncryption,
  showRecoveryKey,
  startSyncJoin,
} from "$lib/api/client";
import { listen } from "@tauri-apps/api/event";
import { confirmDialog } from "$lib/stores/confirm.svelte";
import type { SyncDevice, SyncServerStatus } from "$lib/api/types";

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
vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn(() => Promise.resolve(() => {})),
}));
vi.mock("$lib/stores/confirm.svelte", () => ({
  confirmDialog: { ask: vi.fn() },
}));

const KEY = "AGE-SECRET-KEY-1QYQSZQGPQYQSZQGPQYQSZQGPQYQSZQGPQYQSZQGPQYQSZQGPQYQSQ8F3ZK";

const OFF: SyncServerStatus = {
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

function at(stage: SyncServerStatus["stage"], overrides: Partial<SyncServerStatus> = {}): SyncServerStatus {
  return {
    ...OFF,
    stage,
    address: "https://notes.example.org",
    person: "sam@example.org",
    encrypted: true,
    ...overrides,
  };
}

const NOW = Math.floor(Date.now() / 1000);
const DEVICES: SyncDevice[] = [
  { id: "d1", name: "Work laptop", browser: false, signedInAt: NOW - 86400, lastSeen: NOW, current: true },
  { id: "d2", name: "Home desktop", browser: false, signedInAt: NOW - 86400, lastSeen: NOW - 3 * 3600, current: false },
  { id: "d3", name: "Phone", browser: true, signedInAt: NOW - 86400, lastSeen: NOW - 2 * 86400, current: false },
];

const ask = vi.mocked(confirmDialog.ask);

function showing(status: SyncServerStatus) {
  vi.mocked(getSyncServerStatus).mockResolvedValue(status);
  return render(SyncServer);
}

afterEach(cleanup);

beforeEach(() => {
  vi.mocked(acceptPlainServer).mockReset().mockResolvedValue(undefined);
  vi.mocked(cancelSyncSignIn).mockReset().mockResolvedValue(undefined);
  vi.mocked(confirmRecoverySaved).mockReset().mockResolvedValue(undefined);
  vi.mocked(confirmSyncJoin).mockReset();
  vi.mocked(confirmSyncRemovals).mockReset().mockResolvedValue(undefined);
  vi.mocked(connectSyncServer).mockReset();
  vi.mocked(disconnectSyncServer).mockReset().mockResolvedValue(undefined);
  vi.mocked(enterRecoveryKey).mockReset();
  vi.mocked(getSyncServerStatus).mockReset().mockResolvedValue(OFF);
  vi.mocked(listSyncDevices).mockReset().mockResolvedValue(DEVICES);
  vi.mocked(revokeSyncDevice).mockReset().mockResolvedValue(undefined);
  vi.mocked(setSyncEncryption).mockReset();
  vi.mocked(showRecoveryKey).mockReset();
  vi.mocked(startSyncJoin).mockReset();
  vi.mocked(listen).mockClear();
  ask.mockReset();
});

describe("SyncServer when not connected", () => {
  it("signs in at the typed address with encryption on by default", async () => {
    vi.mocked(connectSyncServer).mockResolvedValue(at("recoveryKey", { recoveryKey: KEY }));
    const { findByRole, getByRole } = showing(OFF);

    await fireEvent.input(await findByRole("textbox", { name: "Server address" }), {
      target: { value: "notes.example.org" },
    });
    await fireEvent.click(getByRole("button", { name: /Sign in/ }));

    expect(connectSyncServer).toHaveBeenCalledWith("notes.example.org", true);
  });

  it("signs in without encryption when the switch is turned off first", async () => {
    vi.mocked(connectSyncServer).mockResolvedValue(at("syncing", { encrypted: false }));
    const { findByRole, getByRole, getByText } = showing(OFF);

    await fireEvent.click(await findByRole("switch", { name: "End-to-end encryption" }));
    expect(getByText(/Your server can read your notes/)).toBeTruthy();
    expect(ask).not.toHaveBeenCalled();
    await fireEvent.input(getByRole("textbox", { name: "Server address" }), {
      target: { value: "notes.example.org" },
    });
    await fireEvent.click(getByRole("button", { name: /Sign in/ }));

    expect(connectSyncServer).toHaveBeenCalledWith("notes.example.org", false);
  });

  it("says why the last try failed", async () => {
    vi.mocked(connectSyncServer).mockRejectedValue({
      code: "STORAGE_ERROR",
      message: "notes.example.org did not answer as an InstantNotes server",
    });
    const { findByRole, getByRole, findByText } = showing(OFF);

    await fireEvent.input(await findByRole("textbox", { name: "Server address" }), {
      target: { value: "notes.example.org" },
    });
    await fireEvent.click(getByRole("button", { name: /Sign in/ }));

    expect(await findByText(/Couldn't sign in: notes.example.org did not answer/)).toBeTruthy();
  });
});

describe("SyncServer setting up", () => {
  it("waits for the browser and cancels the sign-in quietly", async () => {
    const { findByText, getByRole, queryByText } = showing(at("signingIn", { person: null }));

    expect(await findByText("Finish signing in in your browser.")).toBeTruthy();
    vi.mocked(getSyncServerStatus).mockResolvedValue(OFF);
    await fireEvent.click(getByRole("button", { name: "Cancel" }));

    expect(cancelSyncSignIn).toHaveBeenCalled();
    await waitFor(() => expect(getByRole("textbox", { name: "Server address" })).toBeTruthy());
    expect(queryByText(/Couldn't sign in/)).toBeNull();
  });

  it("asks before combining two libraries and offers no replace", async () => {
    vi.mocked(confirmSyncJoin).mockResolvedValue(at("syncing"));
    const { findByText, getByRole, queryByRole } = showing(
      at("confirmJoin", { serverItems: 812, localNotes: 640 }),
    );

    expect(
      await findByText(/This server holds 812 items and this device has 640 notes. They'll be combined/),
    ).toBeTruthy();
    expect(queryByRole("button", { name: /Replace/ })).toBeNull();
    await fireEvent.click(getByRole("button", { name: "Combine" }));

    expect(confirmSyncJoin).toHaveBeenCalledWith(true);
  });

  it("returns to the address form with the reason when combining fails", async () => {
    vi.mocked(confirmSyncJoin).mockRejectedValue({ code: "STORAGE_ERROR", message: "the server did not answer" });
    const { findByRole, findByText } = showing(at("confirmJoin", { serverItems: 3, localNotes: 2 }));

    await findByRole("button", { name: "Combine" });
    vi.mocked(getSyncServerStatus).mockResolvedValue(OFF);
    await fireEvent.click(await findByRole("button", { name: "Combine" }));

    expect(await findByRole("textbox", { name: "Server address" })).toBeTruthy();
    expect(await findByText("Couldn't sign in: the server did not answer")).toBeTruthy();
  });

  it("cancels the join", async () => {
    vi.mocked(confirmSyncJoin).mockResolvedValue(OFF);
    const { findByRole } = showing(at("confirmJoin", { serverItems: 3, localNotes: 2 }));

    await fireEvent.click(await findByRole("button", { name: "Cancel" }));

    expect(confirmSyncJoin).toHaveBeenCalledWith(false);
  });

  it("keeps the join question when a status refresh reports off", async () => {
    let fire: () => void = () => {};
    vi.mocked(listen).mockImplementation((_event, handler) => {
      fire = () => handler({ event: "", id: 0, payload: null });
      return Promise.resolve(() => {});
    });
    vi.mocked(connectSyncServer).mockResolvedValue(at("confirmJoin", { serverItems: 5, localNotes: 4 }));
    const { findByRole, getByRole, findByText } = showing(OFF);

    await fireEvent.input(await findByRole("textbox", { name: "Server address" }), {
      target: { value: "notes.example.org" },
    });
    await fireEvent.click(getByRole("button", { name: /Sign in/ }));
    expect(await findByText(/This server holds 5 items/)).toBeTruthy();
    fire();
    await waitFor(() => expect(getSyncServerStatus).toHaveBeenCalledTimes(2));

    expect(getByRole("button", { name: "Combine" })).toBeTruthy();
  });

  it("shows the recovery key and continues only once it is saved", async () => {
    const { findByText, getByRole, getByLabelText } = showing(at("recoveryKey", { recoveryKey: KEY }));

    expect(await findByText(/If you lose this recovery key and every device you use/)).toBeTruthy();
    expect(getByLabelText("Recovery key").textContent).toBe(KEY);
    expect(getByRole("img", { name: /QR code/ })).toBeTruthy();
    expect(getByRole("button", { name: "Copy" })).toBeTruthy();
    expect(getByRole("button", { name: "Download" })).toBeTruthy();
    expect(getByRole("button", { name: "Print" })).toBeTruthy();
    const next = getByRole("button", { name: "Continue" }) as HTMLButtonElement;
    expect(next.disabled).toBe(true);

    await fireEvent.click(getByRole("checkbox", { name: "I saved it somewhere safe" }));
    await fireEvent.click(next);

    expect(confirmRecoverySaved).toHaveBeenCalled();
  });

  it("asks another device to approve this one", async () => {
    vi.mocked(startSyncJoin).mockResolvedValue(
      at("joining", { joinWords: ["apple", "river", "seven", "lamp", "north", "cedar"] }),
    );
    const { findByText, getByRole, findAllByRole } = showing(at("needsKey"));

    expect(await findByText("Approve this device on one you already use, or enter your recovery key.")).toBeTruthy();
    await fireEvent.click(getByRole("button", { name: "Approve on another device" }));

    expect(startSyncJoin).toHaveBeenCalled();
    const words = (await findAllByRole("listitem")).map((li) => li.textContent);
    expect(words).toEqual(["1apple", "2river", "3seven", "4lamp", "5north", "6cedar"]);
  });

  it("takes the recovery key instead and shows a refusal", async () => {
    vi.mocked(enterRecoveryKey).mockRejectedValue({
      code: "VALIDATION_ERROR",
      message: "this recovery key belongs to another library",
    });
    const { findByRole, getByRole, findByText } = showing(at("needsKey"));

    await fireEvent.input(await findByRole("textbox", { name: "Recovery key" }), {
      target: { value: ` ${KEY} ` },
    });
    await fireEvent.click(getByRole("button", { name: "Use recovery key" }));

    expect(enterRecoveryKey).toHaveBeenCalledWith(KEY);
    expect(await findByText("this recovery key belongs to another library")).toBeTruthy();
  });

  it("says why an approval was not given", async () => {
    const { findByText } = showing(at("needsKey", { message: "The request was not approved." }));
    expect(await findByText("The request was not approved.")).toBeTruthy();
  });

  it("shows the six words to compare while waiting", async () => {
    const { findByText, getByRole } = showing(
      at("joining", { joinWords: ["apple", "river", "seven", "lamp", "north", "cedar"] }),
    );

    expect(await findByText("Check that the same six words show on the device you approve from.")).toBeTruthy();
    expect(getByRole("list", { name: "Six words" }).textContent).toContain("cedar");
  });

  it("asks before syncing with an unencrypted server", async () => {
    const { findByText, getByRole } = showing(at("confirmPlain"));

    expect(await findByText("This server keeps notes unencrypted. Sync with it anyway?")).toBeTruthy();
    await fireEvent.click(getByRole("button", { name: "Sync anyway" }));

    expect(acceptPlainServer).toHaveBeenCalled();
  });

  it("cancels an unencrypted server by disconnecting", async () => {
    const { findByRole } = showing(at("confirmPlain"));
    await fireEvent.click(await findByRole("button", { name: "Cancel" }));
    expect(disconnectSyncServer).toHaveBeenCalled();
  });
});

describe("SyncServer connected", () => {
  it("names the server, the person and the status", async () => {
    const { findByText, getByText } = showing(
      at("upToDate", { lastSyncedAt: "2026-10-12T09:41:00Z", conflicts: 2, tooLarge: ["Site survey.mp4"] }),
    );

    expect(await findByText("notes.example.org")).toBeTruthy();
    expect(getByText("sam@example.org")).toBeTruthy();
    expect(getByText(/Up to date as of/)).toBeTruthy();
    expect(getByText(/2 notes changed in two places/)).toBeTruthy();
    expect(getByText(/too large for this server, kept on this device only/).textContent).toContain(
      "Site survey.mp4",
    );
  });

  it("reports syncing right after connecting", async () => {
    const { findByText } = showing(at("syncing"));
    expect(await findByText("Syncing…")).toBeTruthy();
  });

  it("reports offline with the reason", async () => {
    const { findByText, getByText } = showing(at("offline", { message: "the server did not answer" }));
    expect(await findByText("Offline")).toBeTruthy();
    expect(getByText("The server did not answer. Your changes wait and sync when it's back.")).toBeTruthy();
  });

  it("reports a problem with its message", async () => {
    const { findByText, getByText } = showing(at("problem", { message: "note x: disk full" }));
    expect(await findByText("Problem")).toBeTruthy();
    expect(getByText("Note x: disk full.")).toBeTruthy();
  });

  it("reports a refusal as stopped", async () => {
    const { findByText, getByText } = showing(
      at("refused", { message: "the server says encryption was turned off, but no device holding the key turned it off" }),
    );
    expect(await findByText("Stopped")).toBeTruthy();
    expect(getByText(/The server says encryption was turned off, but no device holding the key/)).toBeTruthy();
  });

  it("holds removals until they are confirmed", async () => {
    const { findByRole, getByText } = showing(at("held", { heldRemovals: 40 }));

    await fireEvent.click(await findByRole("button", { name: "Move 40 notes to Trash" }));

    expect(getByText("Held")).toBeTruthy();
    expect(getByText(/40 notes went missing from the server at once/)).toBeTruthy();
    expect(confirmSyncRemovals).toHaveBeenCalled();
  });

  it("offers Sign in again when signed out, at the saved address", async () => {
    vi.mocked(connectSyncServer).mockResolvedValue(at("syncing"));
    const { findByText, getByRole } = showing(at("signedOut", { encrypted: false }));

    expect(await findByText("Signed out")).toBeTruthy();
    await fireEvent.click(getByRole("button", { name: "Sign in again" }));

    expect(connectSyncServer).toHaveBeenCalledWith("https://notes.example.org", false);
  });

  it("signs out after asking", async () => {
    ask.mockResolvedValue(true);
    const { findByRole } = showing(at("upToDate"));

    await fireEvent.click(await findByRole("button", { name: "Sign out" }));

    expect(ask.mock.calls[0][0]).toMatchObject({
      title: "Stop syncing with notes.example.org?",
      body: "Your notes stay on this device.",
    });
    await waitFor(() => expect(disconnectSyncServer).toHaveBeenCalled());
  });
});

describe("SyncServer security", () => {
  it("describes encryption on and asks before turning it off", async () => {
    vi.mocked(setSyncEncryption).mockResolvedValue(at("syncing", { encrypted: false }));
    ask.mockResolvedValue(true);
    const { findByText, getByRole } = showing(at("upToDate"));

    expect(await findByText(/Your server stores your notes encrypted\. Only your devices can read them/)).toBeTruthy();
    await fireEvent.click(getByRole("switch", { name: "End-to-end encryption" }));

    expect(ask.mock.calls[0][0]).toMatchObject({ title: "Turn off end-to-end encryption?", tone: "danger" });
    await waitFor(() => expect(setSyncEncryption).toHaveBeenCalledWith(false));
    expect(await findByText(/Your server can read your notes, and so can anyone with its backups/)).toBeTruthy();
  });

  it("leaves encryption alone when the question is declined", async () => {
    ask.mockResolvedValue(false);
    const { findByRole } = showing(at("upToDate"));

    await fireEvent.click(await findByRole("switch", { name: "End-to-end encryption" }));

    await waitFor(() => expect(ask).toHaveBeenCalled());
    expect(setSyncEncryption).not.toHaveBeenCalled();
  });

  it("says turning encryption on does not reach old backups", async () => {
    vi.mocked(setSyncEncryption).mockResolvedValue(at("recoveryKey", { recoveryKey: KEY }));
    ask.mockResolvedValue(true);
    const { findByRole, findByText } = showing(at("upToDate", { encrypted: false }));

    await fireEvent.click(await findByRole("switch", { name: "End-to-end encryption" }));

    expect(ask.mock.calls[0][0].body).toMatch(/backups taken while encryption was off/);
    await waitFor(() => expect(setSyncEncryption).toHaveBeenCalledWith(true));
    expect(await findByText(/If you lose this recovery key/)).toBeTruthy();
  });

  it("shows why a switch was refused", async () => {
    vi.mocked(setSyncEncryption).mockRejectedValue({ code: "STORAGE_ERROR", message: "an attachment is missing" });
    ask.mockResolvedValue(true);
    const { findByRole, findByText } = showing(at("upToDate"));

    await fireEvent.click(await findByRole("switch", { name: "End-to-end encryption" }));

    expect(await findByText("Couldn't switch: an attachment is missing")).toBeTruthy();
  });

  it("shows the recovery key again", async () => {
    vi.mocked(showRecoveryKey).mockResolvedValue(KEY);
    const { findByRole, findByLabelText } = showing(at("upToDate"));

    await fireEvent.click(await findByRole("button", { name: "Show again" }));

    expect((await findByLabelText("Recovery key")).textContent).toBe(KEY);
  });

  it("lists devices, marks this one, and revokes another after asking", async () => {
    ask.mockResolvedValue(true);
    const { findByText, getByText, getAllByRole } = showing(at("upToDate"));

    expect(await findByText("Home desktop")).toBeTruthy();
    expect(getByText("This device")).toBeTruthy();
    expect(getByText("Seen 3 h ago")).toBeTruthy();
    expect(getByText("Browser, seen 2 d ago")).toBeTruthy();
    const revokes = getAllByRole("button", { name: "Revoke" });
    expect(revokes).toHaveLength(2);
    await fireEvent.click(revokes[0]);

    expect(ask.mock.calls[0][0]).toMatchObject({ title: "Revoke Home desktop?" });
    await waitFor(() => expect(revokeSyncDevice).toHaveBeenCalledWith("d2"));
  });

  it("signs out everywhere after asking", async () => {
    ask.mockResolvedValue(true);
    const { findByRole } = showing(at("upToDate"));

    await fireEvent.click(await findByRole("button", { name: "Sign out everywhere" }));

    await waitFor(() => expect(revokeSyncDevice).toHaveBeenCalledWith(null));
  });

  it("hides devices while signed out", async () => {
    const { findByText, queryByText } = showing(at("signedOut"));
    expect(await findByText("Signed out")).toBeTruthy();
    expect(queryByText("Sign out everywhere")).toBeNull();
    expect(listSyncDevices).not.toHaveBeenCalled();
  });
});
