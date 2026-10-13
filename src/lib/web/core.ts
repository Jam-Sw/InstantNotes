type Waiter = { resolve: (value: unknown) => void; reject: (error: unknown) => void };
type Reply = {
  id: number;
  ok: boolean;
  value?: unknown;
  error?: { code: string; message: string };
};

const WORKER_URL = "/web/worker.js";

let worker: Worker | null = null;
let next = 0;
const waiting = new Map<number, Waiter>();

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
  return worker;
}

export function stopWorker(): void {
  worker?.terminate();
  worker = null;
  for (const waiter of waiting.values()) {
    waiter.reject({ code: "STORAGE_ERROR", message: "InstantNotes moved to another tab" });
  }
  waiting.clear();
}

export function run<T>(fn: string, ...args: unknown[]): Promise<T> {
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
