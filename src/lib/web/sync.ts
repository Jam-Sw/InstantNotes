import { emit, isStopped, run, wipeLibrary } from "./core";
import { clearKey, forgetAll, getKey, setKey } from "./keys";
import { tab } from "./tab.svelte";
import type { SyncDevice, SyncJoinRequest, SyncServerStatus, SyncStage } from "$lib/api/types";

const API = "/sync/v1/";
const HEADERS = { "X-InstantNotes": "1" };
const QUIET_MS = 300;
const RETRY_MS = 30_000;
const OPEN_TRIES = 10;
const OPEN_RETRY_MS = 300;
const WAIT_SECONDS = 25;
const REQUEST_TIMEOUT_MS = 60_000;
const JOIN_REPEAT_MS = 3_000;
const MAX_ROUNDS = 5;
const LEGACY_RETRY_MS = 60 * 60 * 1000;
const PLAIN_OK = "instantnotes.plainOk";
const LEGACY = "sync.legacy";
const LEGACY_IMPORTED = "imported";
const LEGACY_DONE = "done";
const PAUSED = new Set<SyncStage>(["joining", "confirmPlain", "otherLibrary"]);

type SyncAnswer = {
  stage: SyncStage | "unset";
  message?: string | null;
  notes?: string[];
  labelsChanged?: boolean;
  settingsChanged?: boolean;
  conflicts?: number;
  heldRemovals?: number;
  tooLarge?: string[];
  modeChanged?: boolean;
  retry?: boolean;
  encrypted?: boolean;
  dropKey?: boolean;
};

type JoinWait = { state: "pending" | "approved" | "denied"; key?: string };
type Pending = { id: string; publicKey: string; deviceName: string };
type Failure = { code: string; message: string; status?: number };

const status: SyncServerStatus = {
  stage: "syncing",
  message: null,
  address: typeof location === "undefined" ? null : location.host,
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

let timer: ReturnType<typeof setTimeout> | null = null;
let running: Promise<void> | null = null;
let again = false;
let allowRemovals = false;
let starting: Promise<void> | null = null;
let legacyWaitUntil = 0;
let joining: string | null = null;

function changed(): void {
  emit("vault:status");
}

const messageOf = (e: unknown): string =>
  e && typeof e === "object" && "message" in e ? String(e.message) : String(e);

async function api<T>(path: string, init: RequestInit = {}, waitSeconds = 0): Promise<T> {
  const res = await fetch(API + path, {
    ...init,
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS + waitSeconds * 1000),
    headers: { ...HEADERS, ...(init.body ? { "Content-Type": "application/json" } : {}) },
  });
  if (res.status === 401) location.assign("/auth/login");
  if (!res.ok) {
    throw {
      code: "STORAGE_ERROR",
      message: `server answered ${res.status}`,
      status: res.status,
    } satisfies Failure;
  }
  const text = await res.text();
  return (text ? JSON.parse(text) : null) as T;
}

function plainOk(): boolean {
  try {
    return localStorage.getItem(PLAIN_OK) === "1";
  } catch {
    return false;
  }
}

function setPlainOk(ok: boolean): void {
  try {
    if (ok) localStorage.setItem(PLAIN_OK, "1");
    else localStorage.removeItem(PLAIN_OK);
  } catch {
    return;
  }
}

async function setting(key: string): Promise<unknown> {
  const answer = JSON.parse(await run<string>("call", "get_setting", JSON.stringify({ key }), null));
  return (answer as { value: unknown }).value;
}

async function setSetting(key: string, value: unknown): Promise<void> {
  await run("call", "set_setting", JSON.stringify({ key, value }), null);
}

async function takeLegacy(): Promise<boolean> {
  if (Date.now() < legacyWaitUntil) return false;
  if ((await setting(LEGACY)) !== null) return false;
  const res = await fetch(API + "legacy", {
    headers: HEADERS,
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  if (res.status === 404) {
    await setSetting(LEGACY, LEGACY_DONE);
    return false;
  }
  if (!res.ok) throw new Error(`server answered ${res.status}`);
  const legacy = (await res.json()) as { attachments: string[] };
  for (const name of legacy.attachments) {
    const file = await fetch(`${API}legacy/attachments/${encodeURIComponent(name)}`, {
      headers: HEADERS,
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    if (file.status === 404) continue;
    if (!file.ok) throw new Error(`image ${name}: server answered ${file.status}`);
    await run("import_attachment", name, new Uint8Array(await file.arrayBuffer()));
  }
  await run("import_legacy", JSON.stringify(legacy));
  await setSetting(LEGACY, LEGACY_IMPORTED);
  return true;
}

async function finishLegacy(answer: SyncAnswer): Promise<void> {
  const pushed =
    answer.stage === "upToDate" &&
    !answer.retry &&
    !answer.modeChanged &&
    !answer.tooLarge?.length &&
    !answer.heldRemovals;
  if (!pushed || (await setting(LEGACY)) !== LEGACY_IMPORTED) return;
  const res = await fetch(API + "legacy", {
    method: "DELETE",
    headers: HEADERS,
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  if (res.ok || res.status === 404) await setSetting(LEGACY, LEGACY_DONE);
}

async function once(): Promise<void> {
  if (PAUSED.has(status.stage)) return;
  const key = await getKey();
  let legacyFailure: string | null = null;
  const imported = await takeLegacy().catch((e) => {
    legacyWaitUntil = Date.now() + LEGACY_RETRY_MS;
    legacyFailure = `Your notes from the earlier web version could not be moved yet: ${messageOf(e)}`;
    return false;
  });
  if (imported) emit("notes:changed", { origin: null });
  const answer = JSON.parse(
    await run<string>("sync", key, allowRemovals, plainOk()),
  ) as SyncAnswer;
  allowRemovals = false;
  if (answer.stage === "signedOut") location.assign("/auth/login");
  if (answer.dropKey) {
    await clearKey();
    setPlainOk(true);
  }
  await finishLegacy(answer).catch(() => {});
  if (answer.stage === "unset") {
    status.stage = "off";
    status.message = null;
    changed();
    return;
  }
  if (status.stage !== "recoveryKey" || answer.stage !== "upToDate") status.stage = answer.stage;
  status.message = answer.message ?? legacyFailure;
  status.encrypted = answer.encrypted ?? status.encrypted;
  status.conflicts += answer.conflicts ?? 0;
  status.heldRemovals = answer.heldRemovals ?? 0;
  status.tooLarge = answer.tooLarge ?? [];
  if (answer.stage === "upToDate") status.lastSyncedAt = new Date().toISOString();
  if (answer.notes?.length) {
    emit("notes:changed", { origin: null });
    emit("vault:synced", { noteIds: answer.notes });
  }
  if (answer.labelsChanged) {
    emit("tags:changed");
    emit("workspaces:changed");
  }
  if (answer.settingsChanged) emit("settings:changed");
  changed();
  if (answer.retry || answer.modeChanged) again = true;
}

export function syncNow(): Promise<void> {
  if (running) {
    again = true;
    return running;
  }
  running = (async () => {
    let rounds = 0;
    do {
      again = false;
      rounds += 1;
      try {
        await once();
      } catch (e) {
        status.stage = "problem";
        status.message = messageOf(e);
        changed();
      }
    } while (again && rounds < MAX_ROUNDS && !isStopped());
  })().finally(() => {
    running = null;
  });
  return running;
}

async function exclusive<T>(work: () => Promise<T>): Promise<T> {
  while (running) await running.catch(() => {});
  let result!: T;
  running = (async () => {
    result = await work();
  })().finally(() => {
    running = null;
  });
  await running;
  return result;
}

export function syncSoon(): void {
  if (timer) clearTimeout(timer);
  timer = setTimeout(() => {
    timer = null;
    void syncNow();
  }, QUIET_MS);
}

const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function watchChanges(): Promise<void> {
  let since = 0;
  while (!isStopped()) {
    try {
      const page = await api<{ head: number }>(
        `changes?since=${since}&limit=1&wait=${WAIT_SECONDS}`,
        {},
        WAIT_SECONDS,
      );
      if (page.head !== since) {
        since = page.head;
        syncSoon();
      }
    } catch (e) {
      since = 0;
      if ((e as Failure).status !== 410) await pause(RETRY_MS);
    }
  }
}

async function withWords(pending: Pending[], recipient: string): Promise<SyncJoinRequest[]> {
  return Promise.all(
    pending.map(async (j) => ({
      id: j.id,
      deviceName: j.deviceName,
      publicKey: j.publicKey,
      words: await run<string[]>("words", j.publicKey, recipient),
    })),
  );
}

async function joinRequests(): Promise<SyncJoinRequest[]> {
  const key = await getKey();
  if (!key) return [];
  const recipient = await run<string>("recipient_of", key);
  return withWords(await api<Pending[]>("keys/requests"), recipient);
}

async function watchJoins(): Promise<void> {
  let shown = "";
  while (!isStopped()) {
    try {
      const key = await getKey();
      if (!key) {
        await pause(RETRY_MS);
        continue;
      }
      const pending = await api<Pending[]>(`keys/requests?wait=${WAIT_SECONDS}`, {}, WAIT_SECONDS);
      const ids = pending.map((r) => r.id).join(",");
      if (ids !== shown) {
        shown = ids;
        emit("sync:join-requests", await withWords(pending, await run<string>("recipient_of", key)));
      } else if (pending.length) {
        await pause(JOIN_REPEAT_MS);
      }
    } catch {
      await pause(RETRY_MS);
    }
  }
}

async function openLibrary(): Promise<void> {
  for (let attempt = 1; ; attempt++) {
    try {
      await run("open");
      return;
    } catch (e) {
      if (attempt >= OPEN_TRIES || isStopped()) throw e;
      await pause(OPEN_RETRY_MS);
    }
  }
}

export function startSync(): Promise<void> {
  starting ??= (async () => {
    if (!(await tab.claim())) {
      starting = null;
      throw { code: "STORAGE_ERROR", message: "InstantNotes is open in another tab" };
    }
    try {
      await openLibrary();
    } catch (e) {
      starting = null;
      throw e;
    }
    watch();
  })();
  return starting;
}

function watch(): void {
  void navigator.storage?.persist?.().catch(() => false);
  void syncNow();
  void watchChanges();
  void watchJoins();
}

async function serverRecipient(): Promise<string | null> {
  const keys = await api<{ recipient: string | null }>("keys");
  return keys.recipient;
}

async function waitForApproval(id: string, recipient: string): Promise<void> {
  while (!isStopped()) {
    let answer: JoinWait;
    try {
      answer = await api<JoinWait>(`keys/requests/${id}?wait=${WAIT_SECONDS}`, {}, WAIT_SECONDS);
    } catch (e) {
      if (joining !== id) return;
      if ((e as Failure).status !== 404) {
        await pause(RETRY_MS);
        continue;
      }
      status.stage = "needsKey";
      status.joinWords = null;
      status.message = "The request expired. Start it again.";
      changed();
      return;
    }
    if (joining !== id) return;
    if (answer.state === "pending") continue;
    joining = null;
    status.joinWords = null;
    status.joinKey = null;
    if (answer.state === "approved" && answer.key) {
      try {
        await setKey(await run<string>("join_finish", answer.key, recipient));
        status.stage = "syncing";
        status.message = null;
        changed();
        void syncNow();
      } catch (e) {
        status.stage = "needsKey";
        status.message = messageOf(e);
        changed();
      }
      return;
    }
    status.stage = "needsKey";
    status.message = "The request was not approved.";
    changed();
    return;
  }
}

function browserName(): string {
  const agent = navigator.userAgent;
  const browser = /Firefox\//.test(agent)
    ? "Firefox"
    : /Edg\//.test(agent)
      ? "Edge"
      : /Chrome\//.test(agent)
        ? "Chrome"
        : /Safari\//.test(agent)
          ? "Safari"
          : "A browser";
  const system = /iPhone|iPad/.test(agent)
    ? "iOS"
    : /Android/.test(agent)
      ? "Android"
      : /Mac OS X/.test(agent)
        ? "macOS"
        : /Windows/.test(agent)
          ? "Windows"
          : /Linux/.test(agent)
            ? "Linux"
            : "";
  return system ? `${browser} on ${system}` : browser;
}

async function clearBrowser(): Promise<void> {
  await wipeLibrary();
  await forgetAll();
  setPlainOk(false);
}

export const syncCommands: Record<string, (args: Record<string, unknown>) => Promise<unknown>> = {
  async get_sync_server_status() {
    return { ...status };
  },
  async connect_sync_server(args) {
    if (status.stage === "signedOut") {
      location.assign("/auth/login");
      return { ...status };
    }
    await exclusive(async () => {
      if (args.encrypt) {
        const recovery = await run<string>("new_recovery");
        await setKey(recovery);
        setPlainOk(false);
        await run("set_up", recovery);
        status.stage = "recoveryKey";
        status.recoveryKey = recovery;
        status.encrypted = true;
      } else {
        await run("set_up", null);
        setPlainOk(true);
        status.stage = "syncing";
      }
      changed();
    });
    void syncNow();
    return { ...status };
  },
  async confirm_sync_join() {
    return { ...status };
  },
  async cancel_sync_sign_in() {},
  async confirm_recovery_saved() {
    status.recoveryKey = null;
    status.stage = "syncing";
    changed();
    void syncNow();
  },
  async show_recovery_key() {
    const key = await getKey();
    if (!key) throw { code: "STORAGE_ERROR", message: "this browser holds no encryption key" };
    return key;
  },
  async start_sync_join() {
    const recipient = await serverRecipient();
    if (!recipient) throw { code: "STORAGE_ERROR", message: "this library is not encrypted on the server" };
    const publicKey = await run<string>("join_start");
    const { id } = await api<{ id: string }>("keys/requests", {
      method: "POST",
      body: JSON.stringify({ publicKey, deviceName: browserName() }),
    });
    joining = id;
    status.stage = "joining";
    status.joinWords = await run<string[]>("words", publicKey, recipient);
    status.joinKey = publicKey;
    status.message = null;
    changed();
    void waitForApproval(id, recipient);
    return { ...status };
  },
  async enter_recovery_key(args) {
    const recovery = await run<string>("normalize_recovery", String(args.text ?? ""));
    const recipient = await serverRecipient();
    if (recipient !== (await run<string>("recipient_of", recovery))) {
      throw { code: "VALIDATION_ERROR", message: "this recovery key belongs to another library" };
    }
    await setKey(recovery);
    const waiting = joining;
    joining = null;
    if (waiting) await api(`keys/requests/${waiting}/deny`, { method: "POST", body: "{}" }).catch(() => null);
    status.stage = "syncing";
    status.message = null;
    status.joinWords = null;
    status.joinKey = null;
    changed();
    void syncNow();
    return { ...status };
  },
  async accept_plain_server() {
    setPlainOk(true);
    status.stage = "syncing";
    changed();
    void syncNow();
  },
  async disconnect_sync_server() {
    await clearBrowser();
    location.assign("/auth/logout");
  },
  async clear_browser_library() {
    await clearBrowser();
    location.reload();
  },
  async list_sync_devices() {
    return api<SyncDevice[]>("devices");
  },
  async revoke_sync_device(args) {
    await api(args.id ? `devices/${String(args.id)}` : "devices", { method: "DELETE" });
  },
  async answer_sync_join(args) {
    const id = String(args.id);
    if (!args.approve) {
      await api(`keys/requests/${id}/deny`, { method: "POST", body: "{}" });
      return;
    }
    const key = await getKey();
    if (!key) throw { code: "STORAGE_ERROR", message: "this browser holds no encryption key" };
    const wrapped = await run<string>("wrap_for", key, String(args.publicKey));
    await api(`keys/requests/${id}/approve`, {
      method: "POST",
      body: JSON.stringify({ key: wrapped }),
    });
  },
  async list_sync_join_requests() {
    return joinRequests();
  },
  async confirm_sync_removals() {
    allowRemovals = true;
    void syncNow();
  },
  async set_sync_encryption(args) {
    const on = Boolean(args.on);
    await exclusive(async () => {
      const current = await getKey();
      const next = on ? await run<string>("new_recovery") : null;
      if (next) await setKey(next, "next");
      await run("switch_encryption", current, next);
      if (next) {
        await setKey(next);
        await clearKey("next");
        setPlainOk(false);
        status.stage = "recoveryKey";
        status.recoveryKey = next;
      } else {
        await clearKey();
        setPlainOk(true);
      }
      status.encrypted = on;
      changed();
    });
    void syncNow();
    return { ...status };
  },
};
