import { beforeEach, describe, expect, it, vi } from "vitest";

const run = vi.fn();
const emit = vi.fn();
const keys = {
  getKey: vi.fn(),
  setKey: vi.fn(),
  clearKey: vi.fn(),
  forgetAll: vi.fn(),
};

vi.mock("./core", () => ({
  run: (...args: unknown[]) => run(...args),
  emit: (...args: unknown[]) => emit(...args),
  isStopped: () => false,
  wipeLibrary: () => Promise.resolve(),
}));
vi.mock("./keys", () => ({
  getKey: (slot?: string) => keys.getKey(slot),
  setKey: (k: string, slot?: string) => keys.setKey(k, slot),
  clearKey: (slot?: string) => keys.clearKey(slot),
  forgetAll: () => keys.forgetAll(),
}));
vi.mock("./tab.svelte", () => ({ tab: { claim: () => Promise.resolve(true) } }));

type Sync = typeof import("./sync");
type Route = (url: string, init?: RequestInit) => unknown;
let routes: Route;
let fetched: { url: string; method: string }[];
let settings: Map<string, unknown>;
let syncAnswer: Record<string, unknown>;
let worker: Record<string, (...args: unknown[]) => unknown>;
let sync: Sync;

function answer(body: unknown, status = 200): Response {
  return new Response(body === undefined ? "" : JSON.stringify(body), { status });
}

beforeEach(async () => {
  vi.resetModules();
  emit.mockReset();
  keys.getKey.mockReset().mockResolvedValue(null);
  keys.setKey.mockReset().mockResolvedValue(undefined);
  keys.clearKey.mockReset().mockResolvedValue(undefined);
  keys.forgetAll.mockReset().mockResolvedValue(undefined);
  settings = new Map();
  syncAnswer = { stage: "upToDate" };
  worker = {};
  run.mockReset().mockImplementation(async (fn: string, ...args: unknown[]) => {
    if (worker[fn]) return worker[fn](...args);
    if (fn === "sync") return JSON.stringify(syncAnswer);
    if (fn === "call") {
      const [cmd, raw] = args as [string, string];
      const body = JSON.parse(raw) as { key: string; value?: unknown };
      if (cmd === "get_setting") return JSON.stringify({ value: settings.get(body.key) ?? null, changes: [] });
      if (cmd === "set_setting") settings.set(body.key, body.value);
      return JSON.stringify({ value: null, changes: [] });
    }
    return null;
  });
  fetched = [];
  routes = (url) => (url.endsWith("/legacy") ? new Response("", { status: 404 }) : {});
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      fetched.push({ url, method: init?.method ?? "GET" });
      const body = routes(url, init);
      return body instanceof Response ? body : answer(body);
    }),
  );
  sync = await import("./sync");
});

const status = async () => (await sync.syncCommands.get_sync_server_status({})) as {
  stage: string;
  message: string | null;
  joinWords: string[] | null;
};

describe("sync in the browser", () => {
  it("reports the server's answer and tells the app what changed", async () => {
    keys.getKey.mockResolvedValue("AGE-SECRET-KEY-1");
    syncAnswer = { stage: "upToDate", notes: ["n1"], labelsChanged: true, encrypted: true };
    await sync.syncNow();
    expect(run).toHaveBeenCalledWith("sync", "AGE-SECRET-KEY-1", false, false);
    expect((await status()).stage).toBe("upToDate");
    expect(emit).toHaveBeenCalledWith("notes:changed", { origin: null });
    expect(emit).toHaveBeenCalledWith("tags:changed");
    expect(emit).toHaveBeenCalledWith("vault:status");
  });

  it("forgets the key when a device holding it proved encryption was turned off", async () => {
    keys.getKey.mockResolvedValue("AGE-SECRET-KEY-1");
    syncAnswer = { stage: "upToDate", dropKey: true };
    await sync.syncNow();
    expect(keys.clearKey).toHaveBeenCalledOnce();
  });

  it("keeps the recovery key on screen while sync runs behind it", async () => {
    worker.new_recovery = () => "AGE-SECRET-KEY-NEW";
    await sync.syncCommands.connect_sync_server({ encrypt: true });
    await sync.syncNow();
    expect((await status()).stage).toBe("recoveryKey");
  });

  it("saves a new library key before the server ever sees it", async () => {
    const order: string[] = [];
    worker.new_recovery = () => "AGE-SECRET-KEY-NEW";
    worker.set_up = () => order.push("server");
    keys.setKey.mockImplementation(async () => {
      order.push("saved");
    });
    await sync.syncCommands.connect_sync_server({ encrypt: true });
    expect(order).toEqual(["saved", "server"]);
  });

  it("stops syncing a browser that holds another library, and says so", async () => {
    syncAnswer = { stage: "otherLibrary" };
    await sync.syncNow();
    expect((await status()).stage).toBe("otherLibrary");
    run.mockClear();
    await sync.syncNow();
    expect(run).not.toHaveBeenCalledWith("sync", expect.anything(), expect.anything(), expect.anything());
  });

  it("clears the browser's copy when it signs out", async () => {
    vi.stubGlobal("location", { assign: vi.fn(), reload: vi.fn(), host: "notes.example.org" });
    await sync.syncCommands.disconnect_sync_server({});
    expect(keys.forgetAll).toHaveBeenCalledOnce();
    expect(location.assign).toHaveBeenCalledWith("/auth/logout");
  });

  it("asks this browser to join with six words from both keys", async () => {
    routes = (url) => {
      if (url.endsWith("/sync/v1/keys")) return { recipient: "age1library" };
      if (url.endsWith("/sync/v1/keys/requests")) return { id: "join-1" };
      return { state: "pending" };
    };
    worker.join_start = () => "age1temporary";
    worker.words = () => ["a", "b", "c", "d", "e", "f"];
    const joining = (await sync.syncCommands.start_sync_join({})) as {
      stage: string;
      joinWords: string[];
    };
    expect(run).toHaveBeenCalledWith("words", "age1temporary", "age1library");
    expect(joining.stage).toBe("joining");
    expect(joining.joinWords).toHaveLength(6);
  });

  it("refuses a recovery key from another library", async () => {
    routes = () => ({ recipient: "age1library" });
    worker.normalize_recovery = () => "AGE-SECRET-KEY-OTHER";
    worker.recipient_of = () => "age1other";
    await expect(sync.syncCommands.enter_recovery_key({ text: "other" })).rejects.toMatchObject({
      code: "VALIDATION_ERROR",
    });
    expect(keys.setKey).not.toHaveBeenCalled();
  });

  it("keeps a recovery key that matches the library", async () => {
    routes = () => ({ recipient: "age1library" });
    worker.normalize_recovery = () => "AGE-SECRET-KEY-1";
    worker.recipient_of = () => "age1library";
    await sync.syncCommands.enter_recovery_key({ text: " age-secret-key-1 " });
    expect(keys.setKey).toHaveBeenCalledWith("AGE-SECRET-KEY-1", undefined);
  });

  it("takes a recovery key while waiting, withdraws its request and ignores the late answer", async () => {
    let recovered = false;
    routes = (url, init) => {
      if (url.endsWith("/sync/v1/keys")) return { recipient: "age1library" };
      if (url.endsWith("/sync/v1/keys/requests") && init?.method === "POST") return { id: "join-1" };
      if (url.includes("/keys/requests/join-1?")) return { state: recovered ? "denied" : "pending" };
      if (url.endsWith("/legacy")) return new Response("", { status: 404 });
      return undefined;
    };
    worker.join_start = () => "age1temporary";
    worker.words = () => ["a", "b", "c", "d", "e", "f"];
    worker.normalize_recovery = () => "AGE-SECRET-KEY-1";
    worker.recipient_of = () => "age1library";
    await sync.syncCommands.start_sync_join({});

    await sync.syncCommands.enter_recovery_key({ text: "age-secret-key-1" });
    recovered = true;
    await new Promise((r) => setTimeout(r, 20));

    expect(fetched).toContainEqual({ url: "/sync/v1/keys/requests/join-1/deny", method: "POST" });
    const now = await status();
    expect(now.stage).not.toBe("needsKey");
    expect(now.message).toBeNull();
    expect(now.joinWords).toBeNull();
  });

  it("approves another device by sealing the key to its temporary key", async () => {
    keys.getKey.mockResolvedValue("AGE-SECRET-KEY-1");
    const posted: { url: string; body: unknown }[] = [];
    routes = (url, init) => {
      posted.push({ url, body: init?.body ? JSON.parse(String(init.body)) : null });
      return undefined;
    };
    worker.wrap_for = () => "sealed-for-them";
    await sync.syncCommands.answer_sync_join({ id: "join-1", publicKey: "age1them", approve: true });
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
    await sync.syncCommands.answer_sync_join({ id: "join-1", publicKey: "age1them", approve: false });
    expect(posted).toEqual(["/sync/v1/keys/requests/join-1/deny"]);
    expect(run).not.toHaveBeenCalledWith("wrap_for", expect.anything(), expect.anything());
  });
});

describe("moving a 0.9.5 web library into the browser", () => {
  const legacy = { notes: [{ md: "---\nid: n1\n---\nold", surface: null }], manifest: "", attachments: ["a1.png"] };

  it("imports the notes and images, then deletes the server's copy after a clean push", async () => {
    routes = (url, init) => {
      if (url.endsWith("/legacy") && init?.method === "DELETE") return new Response(null, { status: 204 });
      if (url.endsWith("/legacy")) return legacy;
      if (url.includes("/legacy/attachments/")) return new Response(new Uint8Array([1, 2, 3]));
      return {};
    };
    await sync.syncNow();
    expect(run).toHaveBeenCalledWith("import_attachment", "a1.png", expect.any(Uint8Array));
    expect(run).toHaveBeenCalledWith("import_legacy", JSON.stringify(legacy));
    expect(fetched).toContainEqual({ url: "/sync/v1/legacy", method: "DELETE" });
    expect(settings.get("sync.legacy")).toBe("done");
  });

  it("imports nothing and deletes nothing when an image cannot be fetched", async () => {
    routes = (url) => {
      if (url.endsWith("/legacy")) return legacy;
      if (url.includes("/legacy/attachments/")) return new Response(null, { status: 429 });
      return {};
    };
    await sync.syncNow();
    expect(run).not.toHaveBeenCalledWith("import_legacy", expect.anything());
    expect(settings.has("sync.legacy")).toBe(false);
    expect(fetched).not.toContainEqual({ url: "/sync/v1/legacy", method: "DELETE" });
    expect((await status()).message).toMatch(/earlier web version/);
  });

  it("keeps the server's copy after a cycle that only pulled", async () => {
    routes = (url) => {
      if (url.endsWith("/legacy")) return legacy;
      if (url.includes("/legacy/attachments/")) return new Response(new Uint8Array([1]));
      return {};
    };
    syncAnswer = { stage: "upToDate", modeChanged: true };
    await sync.syncNow();
    expect(settings.get("sync.legacy")).toBe("imported");
    expect(fetched).not.toContainEqual({ url: "/sync/v1/legacy", method: "DELETE" });
  });
});
