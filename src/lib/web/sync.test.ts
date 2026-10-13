import { beforeEach, describe, expect, it, vi } from "vitest";

const run = vi.fn();
const emit = vi.fn();
const keys = { getKey: vi.fn(), setKey: vi.fn(), clearKey: vi.fn() };

vi.mock("./core", () => ({
  run: (...args: unknown[]) => run(...args),
  emit: (...args: unknown[]) => emit(...args),
}));
vi.mock("./keys", () => ({
  getKey: () => keys.getKey(),
  setKey: (k: string) => keys.setKey(k),
  clearKey: () => keys.clearKey(),
}));
vi.mock("./tab.svelte", () => ({ tab: { claim: () => Promise.resolve(true) } }));

import { syncCommands, syncNow } from "./sync";

type Route = (url: string, init?: RequestInit) => unknown;
let routes: Route;

function answer(body: unknown, status = 200): Response {
  return new Response(body === undefined ? "" : JSON.stringify(body), { status });
}

beforeEach(() => {
  run.mockReset();
  emit.mockReset();
  keys.getKey.mockReset().mockResolvedValue(null);
  keys.setKey.mockReset().mockResolvedValue(undefined);
  keys.clearKey.mockReset().mockResolvedValue(undefined);
  routes = () => ({});
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      const body = routes(url, init);
      return body instanceof Response ? body : answer(body);
    }),
  );
});

describe("sync in the browser", () => {
  it("reports the server's answer and tells the app what changed", async () => {
    keys.getKey.mockResolvedValue("AGE-SECRET-KEY-1");
    run.mockResolvedValue(
      JSON.stringify({ stage: "upToDate", notes: ["n1"], labelsChanged: true, encrypted: true }),
    );
    await syncNow();
    expect(run).toHaveBeenCalledWith("sync", "AGE-SECRET-KEY-1", false, false);
    const status = (await syncCommands.get_sync_server_status({})) as { stage: string };
    expect(status.stage).toBe("upToDate");
    expect(emit).toHaveBeenCalledWith("notes:changed", { origin: null });
    expect(emit).toHaveBeenCalledWith("tags:changed");
    expect(emit).toHaveBeenCalledWith("vault:status");
  });

  it("forgets the key when a device holding it proved encryption was turned off", async () => {
    keys.getKey.mockResolvedValue("AGE-SECRET-KEY-1");
    run.mockResolvedValue(JSON.stringify({ stage: "upToDate", dropKey: true }));
    await syncNow();
    expect(keys.clearKey).toHaveBeenCalledOnce();
  });

  it("asks this browser to join with six words from both keys", async () => {
    routes = (url) => {
      if (url.endsWith("/sync/v1/keys")) return { recipient: "age1library" };
      if (url.endsWith("/sync/v1/keys/requests")) return { id: "join-1" };
      return { state: "pending" };
    };
    run.mockImplementation(async (fn: string) =>
      fn === "join_start" ? "age1temporary" : ["a", "b", "c", "d", "e", "f"],
    );
    const status = (await syncCommands.start_sync_join({})) as {
      stage: string;
      joinWords: string[];
    };
    expect(run).toHaveBeenCalledWith("words", "age1temporary", "age1library");
    expect(status.stage).toBe("joining");
    expect(status.joinWords).toHaveLength(6);
  });

  it("refuses a recovery key from another library", async () => {
    routes = () => ({ recipient: "age1library" });
    run.mockImplementation(async (fn: string) =>
      fn === "normalize_recovery" ? "AGE-SECRET-KEY-OTHER" : "age1other",
    );
    await expect(syncCommands.enter_recovery_key({ text: "other" })).rejects.toMatchObject({
      code: "VALIDATION_ERROR",
    });
    expect(keys.setKey).not.toHaveBeenCalled();
  });

  it("keeps a recovery key that matches the library", async () => {
    routes = () => ({ recipient: "age1library" });
    run.mockImplementation(async (fn: string) => {
      if (fn === "normalize_recovery") return "AGE-SECRET-KEY-1";
      if (fn === "recipient_of") return "age1library";
      return JSON.stringify({ stage: "upToDate" });
    });
    await syncCommands.enter_recovery_key({ text: " age-secret-key-1 " });
    expect(keys.setKey).toHaveBeenCalledWith("AGE-SECRET-KEY-1");
  });

  it("approves another device by sealing the key to its temporary key", async () => {
    keys.getKey.mockResolvedValue("AGE-SECRET-KEY-1");
    const posted: { url: string; body: unknown }[] = [];
    routes = (url, init) => {
      posted.push({ url, body: init?.body ? JSON.parse(String(init.body)) : null });
      return undefined;
    };
    run.mockResolvedValue("sealed-for-them");
    await syncCommands.answer_sync_join({ id: "join-1", publicKey: "age1them", approve: true });
    expect(run).toHaveBeenCalledWith("wrap_for", "AGE-SECRET-KEY-1", "age1them");
    expect(posted).toEqual([
      { url: "/sync/v1/keys/requests/join-1/approve", body: { key: "sealed-for-them" } },
    ]);
  });

  it("denies without touching the key", async () => {
    const posted: string[] = [];
    routes = (url) => {
      posted.push(url);
      return undefined;
    };
    await syncCommands.answer_sync_join({ id: "join-1", publicKey: "age1them", approve: false });
    expect(posted).toEqual(["/sync/v1/keys/requests/join-1/deny"]);
    expect(run).not.toHaveBeenCalled();
  });
});
