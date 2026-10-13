const DB = "instantnotes-keys";
const STORE = "keys";
const WRAP = "wrap";

export type Slot = "library" | "next";

type Sealed = { iv: Uint8Array; data: ArrayBuffer };

const memory = new Map<Slot, string>();

function database(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const open = indexedDB.open(DB, 1);
    open.onupgradeneeded = () => open.result.createObjectStore(STORE);
    open.onsuccess = () => resolve(open.result);
    open.onerror = () => reject(open.error);
  });
}

async function request<T>(
  mode: IDBTransactionMode,
  act: (store: IDBObjectStore) => IDBRequest,
): Promise<T> {
  const db = await database();
  try {
    return await new Promise<T>((resolve, reject) => {
      const req = act(db.transaction(STORE, mode).objectStore(STORE));
      req.onsuccess = () => resolve(req.result as T);
      req.onerror = () => reject(req.error);
    });
  } finally {
    db.close();
  }
}

async function wrapKey(): Promise<CryptoKey> {
  const found = await request<CryptoKey | undefined>("readonly", (s) => s.get(WRAP));
  if (found) return found;
  const made = await crypto.subtle.generateKey({ name: "AES-GCM", length: 256 }, false, [
    "encrypt",
    "decrypt",
  ]);
  await request("readwrite", (s) => s.put(made, WRAP));
  return made;
}

export async function getKey(slot: Slot = "library"): Promise<string | null> {
  const known = memory.get(slot);
  if (known) return known;
  const sealed = await request<Sealed | undefined>("readonly", (s) => s.get(slot));
  if (!sealed) return null;
  const plain = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: sealed.iv as BufferSource },
    await wrapKey(),
    sealed.data,
  );
  const recovery = new TextDecoder().decode(plain);
  memory.set(slot, recovery);
  return recovery;
}

export async function setKey(recovery: string, slot: Slot = "library"): Promise<void> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const data = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    await wrapKey(),
    new TextEncoder().encode(recovery),
  );
  await request("readwrite", (s) => s.put({ iv, data } satisfies Sealed, slot));
  memory.set(slot, recovery);
}

export async function clearKey(slot: Slot = "library"): Promise<void> {
  memory.delete(slot);
  await request("readwrite", (s) => s.delete(slot));
}

export async function forgetAll(): Promise<void> {
  memory.clear();
  await new Promise<void>((resolve) => {
    const gone = indexedDB.deleteDatabase(DB);
    gone.onsuccess = gone.onerror = gone.onblocked = () => resolve();
  });
}
