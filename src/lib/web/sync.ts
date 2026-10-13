import { emit, run } from "./core";
import { clearKey, getKey, setKey } from "./keys";
import { tab } from "./tab.svelte";
import type { SyncDevice, SyncJoinRequest, SyncServerStatus, SyncStage } from "$lib/api/types";

const API = "/sync/v1/";
const HEADERS = { "X-InstantNotes": "1" };
const QUIET_MS = 300;
const RETRY_MS = 30_000;
const OPEN_TRIES = 10;
const OPEN_RETRY_MS = 300;
const WAIT_SECONDS = 25;
const PLAIN_OK = "instantnotes.plainOk";

type SyncAnswer = {
  stage: SyncStage | "unset";
  message?: string | null;
  notes?: string[];
  labelsChanged?: boolean;
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
};

let timer: ReturnType<typeof setTimeout> | null = null;
let running: Promise<void> | null = null;
let again = false;
let allowRemovals = false;
let starting: Promise<void> | null = null;

function changed(): void {
  emit("vault:status");
}

async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(API + path, {
    ...init,
    headers: { ...HEADERS, ...(init.body ? { "Content-Type": "application/json" } : {}) },
  });
  if (res.status === 401) location.assign("/auth/login");
  if (!res.ok) throw { code: "STORAGE_ERROR", message: `server answered ${res.status}` };
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

async function once(): Promise<void> {
  const key = await getKey();
  const answer = JSON.parse(
    await run<string>("sync", key, allowRemovals, plainOk()),
  ) as SyncAnswer;
  allowRemovals = false;
  if (answer.stage === "signedOut") location.assign("/auth/login");
  if (answer.dropKey) await clearKey();
  if (answer.stage === "unset") {
    status.stage = "off";
    status.message = null;
    changed();
    return;
  }
  status.stage = answer.stage;
  status.message = answer.message ?? null;
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
  changed();
  if (answer.retry || answer.modeChanged) again = true;
}

export function syncNow(): Promise<void> {
  if (running) {
    again = true;
    return running;
  }
  running = (async () => {
    do {
      again = false;
      try {
        await once();
      } catch (e) {
        status.stage = "problem";
        status.message = e && typeof e === "object" && "message" in e ? String(e.message) : String(e);
        changed();
      }
    } while (again);
  })().finally(() => {
    running = null;
  });
  return running;
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
  for (;;) {
    try {
      const page = await api<{ head: number }>(`changes?since=${since}&limit=1&wait=${WAIT_SECONDS}`);
      if (page.head !== since) {
        since = page.head;
        syncSoon();
      }
    } catch {
      since = 0;
      await pause(RETRY_MS);
    }
  }
}

async function joinRequests(): Promise<SyncJoinRequest[]> {
  const key = await getKey();
  if (!key) return [];
  const recipient = await run<string>("recipient_of", key);
  const pending = await api<Pending[]>("keys/requests");
  return Promise.all(
    pending.map(async (j) => ({
      id: j.id,
      deviceName: j.deviceName,
      publicKey: j.publicKey,
      words: await run<string[]>("words", j.publicKey, recipient),
    })),
  );
}

async function watchJoins(): Promise<void> {
  let shown = "";
  for (;;) {
    try {
      if (!(await getKey())) {
        await pause(RETRY_MS);
        continue;
      }
      await api(`keys/requests?wait=${WAIT_SECONDS}`);
      const requests = await joinRequests();
      const ids = requests.map((r) => r.id).join(",");
      if (ids !== shown) {
        shown = ids;
        emit("sync:join-requests", requests);
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
      if (attempt >= OPEN_TRIES) throw e;
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
  void syncNow();
  void watchChanges();
  void watchJoins();
}

async function serverRecipient(): Promise<string | null> {
  const keys = await api<{ recipient: string | null }>("keys");
  return keys.recipient;
}

async function waitForApproval(id: string, recipient: string): Promise<void> {
  for (;;) {
    let answer: JoinWait;
    try {
      answer = await api<JoinWait>(`keys/requests/${id}?wait=${WAIT_SECONDS}`);
    } catch {
      status.stage = "needsKey";
      status.joinWords = null;
      status.message = "The request expired. Start it again.";
      changed();
      return;
    }
    if (answer.state === "pending") continue;
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
        status.message = String((e as { message?: string }).message ?? e);
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

export const syncCommands: Record<string, (args: Record<string, unknown>) => Promise<unknown>> = {
  async get_sync_server_status() {
    return { ...status };
  },
  async connect_sync_server(args) {
    const recovery = await run<string | null>("set_up", Boolean(args.encrypt));
    if (recovery) {
      await setKey(recovery);
      status.stage = "recoveryKey";
      status.recoveryKey = recovery;
      status.encrypted = true;
    } else {
      status.stage = "syncing";
    }
    changed();
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
    status.stage = "syncing";
    status.message = null;
    changed();
    void syncNow();
    return { ...status };
  },
  async accept_plain_server() {
    try {
      localStorage.setItem(PLAIN_OK, "1");
    } catch {
      return;
    }
    void syncNow();
  },
  async disconnect_sync_server() {
    await clearKey();
    location.assign("/auth/logout");
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
    const recovery = await run<string | null>("switch_encryption", on, await getKey());
    if (recovery) {
      await setKey(recovery);
      status.stage = "recoveryKey";
      status.recoveryKey = recovery;
    } else {
      await clearKey();
    }
    status.encrypted = on;
    changed();
    void syncNow();
    return { ...status };
  },
};
