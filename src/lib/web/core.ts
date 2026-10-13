type Waiter = { resolve: (value: unknown) => void; reject: (error: unknown) => void };
type Reply = {
  id: number;
  ok: boolean;
  value?: unknown;
  error?: { code: string; message: string };
};

const WORKER_URL = "/web/worker.js";
const MOVED = { code: "STORAGE_ERROR", message: "InstantNotes moved to another tab" };

let worker: Worker | null = null;
let stopped = false;
let next = 0;
const waiting = new Map<number, Waiter>();

function failAll(error: { code: string; message: string }): void {
  for (const waiter of waiting.values()) waiter.reject(error);
  waiting.clear();
}

function started(): Worker {
  if (worker) return worker;
  worker = new Worker(WORKER_URL, { type: "module" });
  worker.onmessage = ({ data }: MessageEvent<Reply>) => {
    const waiter = waiting.get(data.id);
    if (!waiter) return;
    waiting.delete(data.id);
    if (data.ok) waiter.resolve(data.value);
    else waiter.reject(data.error);
  };
  worker.onerror = (event) => {
    event.preventDefault();
    worker?.terminate();
    worker = null;
    failAll({
      code: "STORAGE_ERROR",
      message: `the notes engine could not start: ${event.message || "it failed to load"}`,
    });
  };
  return worker;
}

export function isStopped(): boolean {
  return stopped;
}

export function stopWorker(): void {
  stopped = true;
  worker?.terminate();
  worker = null;
  failAll(MOVED);
}

export async function wipeLibrary(): Promise<void> {
  stopWorker();
  const root = await navigator.storage.getDirectory();
  const names: string[] = [];
  for await (const name of root.keys()) names.push(name);
  for (const name of names) await root.removeEntry(name, { recursive: true });
}

export function run<T>(fn: string, ...args: unknown[]): Promise<T> {
  if (stopped) return Promise.reject(MOVED);
  const id = ++next;
  return new Promise<T>((resolve, reject) => {
    waiting.set(id, { resolve: resolve as (value: unknown) => void, reject });
    started().postMessage({ id, fn, args });
  });
}

type Handler = (payload: unknown) => void;
const handlers = new Map<string, Set<Handler>>();

export function on(event: string, handler: Handler): () => void {
  let set = handlers.get(event);
  if (!set) handlers.set(event, (set = new Set()));
  set.add(handler);
  return () => set.delete(handler);
}

export function emit(event: string, payload: unknown = null): void {
  for (const handler of handlers.get(event) ?? []) handler(payload);
}
