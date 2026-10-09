import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { check, type Update } from "@tauri-apps/plugin-updater";
import { fetchUpdateSizeDelta } from "$lib/update/release-size";
import { installUpdate, restartApp } from "$lib/api/client";

vi.mock("@tauri-apps/plugin-updater", () => ({ check: vi.fn() }));
vi.mock("$lib/update/release-size", () => ({ fetchUpdateSizeDelta: vi.fn() }));
vi.mock("$lib/api/client", () => ({ installUpdate: vi.fn(), restartApp: vi.fn() }));

const mockCheck = vi.mocked(check);
const mockDelta = vi.mocked(fetchUpdateSizeDelta);
const mockInstall = vi.mocked(installUpdate);

function mkUpdate(overrides: Partial<Update> = {}): Update {
  return {
    version: "0.10.0",
    currentVersion: "0.9.0",
    body: "### Added\n- Something new",
    date: "2026-09-24T00:00:00.000Z",
    rid: 7,
    ...overrides,
  } as unknown as Update;
}

async function load() {
  const mod = await import("$lib/stores/updater.svelte");
  return mod.updater;
}

async function toastsShown(): Promise<string[]> {
  const { toasts } = await import("$lib/stores/toasts.svelte");
  return toasts.items.map((t) => t.message);
}

beforeEach(() => {
  vi.resetModules();
  vi.useFakeTimers();
  mockCheck.mockReset();
  mockDelta.mockReset().mockResolvedValue(null);
  mockInstall.mockReset().mockResolvedValue(undefined);
});

afterEach(() => {
  vi.useRealTimers();
});

describe("manual vs automatic checks", () => {
  it("answers a manual check that finds nothing with a toast", async () => {
    mockCheck.mockResolvedValue(null);
    const updater = await load();

    await updater.checkNow({ manual: true });

    expect(updater.status).toBe("uptodate");
    expect(updater.pendingUpdate).toBe(false);
    expect(await toastsShown()).toContain("InstantNotes is up to date");
  });

  it("stays silent when an automatic check finds nothing", async () => {
    mockCheck.mockResolvedValue(null);
    const updater = await load();

    await updater.checkNow();

    expect(updater.status).toBe("idle");
    expect(await toastsShown()).toEqual([]);
  });

  it("surfaces a manual check failure, and stays silent on an automatic one", async () => {
    mockCheck.mockRejectedValue(new Error("offline"));
    const updater = await load();

    await updater.checkNow({ manual: true });
    expect(updater.status).toBe("error");
    expect(updater.pendingUpdate).toBe(false);
    expect(await toastsShown()).toHaveLength(1);

    mockCheck.mockRejectedValue(new Error("offline"));
    await updater.checkNow();
    expect(updater.status).toBe("idle");
  });
});

describe("an offered update", () => {
  it("turns on the Space and carries the manifest through", async () => {
    mockCheck.mockResolvedValue(mkUpdate());
    const updater = await load();

    await updater.checkNow();
    await vi.advanceTimersByTimeAsync(0);

    expect(updater.status).toBe("available");
    expect(updater.pendingUpdate).toBe(true);
    expect(updater.version).toBe("0.10.0");
    expect(updater.currentVersion).toBe("0.9.0");
    expect(updater.notes).toBe("### Added\n- Something new");
    expect(updater.date).toBe("2026-09-24T00:00:00.000Z");
  });

  it("loads the size delta in the background and keeps it when known", async () => {
    mockCheck.mockResolvedValue(mkUpdate());
    mockDelta.mockResolvedValue(1_200_000);
    const updater = await load();

    await updater.checkNow();
    await vi.advanceTimersByTimeAsync(0);

    expect(mockDelta).toHaveBeenCalledWith(
      expect.objectContaining({ currentVersion: "0.9.0", version: "0.10.0" }),
    );
    expect(updater.sizeDelta).toBe(1_200_000);
    expect(updater.deltaState).toBe("ready");
  });

  it("reports an unavailable delta without failing the check", async () => {
    mockCheck.mockResolvedValue(mkUpdate());
    mockDelta.mockResolvedValue(null);
    const updater = await load();

    await updater.checkNow();
    await vi.advanceTimersByTimeAsync(0);

    expect(updater.deltaState).toBe("unavailable");
    expect(updater.status).toBe("available");
  });

  it("reports progress while installing and lands on ready", async () => {
    mockInstall.mockImplementation(async (_rid, onEvent) => {
      onEvent({ event: "Started", data: { contentLength: 100 } });
      onEvent({ event: "Progress", data: { chunkLength: 25 } });
      onEvent({ event: "Progress", data: { chunkLength: 25 } });
    });
    mockCheck.mockResolvedValue(mkUpdate());
    const updater = await load();
    await updater.checkNow();

    await updater.downloadAndInstall();

    expect(mockInstall).toHaveBeenCalledWith(7, expect.any(Function));
    expect(updater.progress).toBe(0.5);
    expect(updater.status).toBe("ready");
    expect(updater.pendingUpdate).toBe(true);
  });

  it("keeps the Space up when the install fails, so Try again is reachable", async () => {
    mockInstall.mockRejectedValue(new Error("network"));
    mockCheck.mockResolvedValue(mkUpdate());
    const updater = await load();
    await updater.checkNow();

    await updater.downloadAndInstall();

    expect(updater.status).toBe("error");
    expect(updater.error).toBe("network");
    expect(updater.pendingUpdate).toBe(true);
  });
});

describe("acknowledge", () => {
  it("takes the Space down, and a later check does not bring it back", async () => {
    const update = mkUpdate();
    mockCheck.mockResolvedValue(update);
    const updater = await load();
    await updater.checkNow();
    await updater.downloadAndInstall();
    expect(updater.pendingUpdate).toBe(true);

    updater.acknowledge();
    expect(updater.status).toBe("idle");
    expect(updater.pendingUpdate).toBe(false);

    await updater.checkNow();
    expect(updater.pendingUpdate).toBe(false);
  });
});

describe("restart", () => {
  it("asks the app to restart into the installed version", async () => {
    const updater = await load();
    await updater.restart();
    expect(vi.mocked(restartApp)).toHaveBeenCalledTimes(1);
  });
});

describe("the automatic schedule", () => {
  it("waits before the first check and then repeats", async () => {
    mockCheck.mockResolvedValue(null);
    const updater = await load();

    updater.start();
    expect(mockCheck).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(7_999);
    expect(mockCheck).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(mockCheck).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(6 * 60 * 60 * 1000);
    expect(mockCheck).toHaveBeenCalledTimes(2);
    updater.stop();
  });

  it("answers a manual check at once, while the first automatic one is still waiting", async () => {
    mockCheck.mockResolvedValue(null);
    const updater = await load();

    updater.start();
    await updater.checkNow({ manual: true });

    expect(mockCheck).toHaveBeenCalledTimes(1);
    expect(updater.status).toBe("uptodate");
    updater.stop();
  });

  it("cancels the waiting first check when stopped", async () => {
    mockCheck.mockResolvedValue(null);
    const updater = await load();

    updater.start();
    updater.stop();
    await vi.advanceTimersByTimeAsync(24 * 60 * 60 * 1000);

    expect(mockCheck).not.toHaveBeenCalled();
  });
});
