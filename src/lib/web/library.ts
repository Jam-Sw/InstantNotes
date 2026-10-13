import { clientId } from "$lib/api/runtime";
import { emit, run } from "./core";
import { startSync, syncCommands, syncSoon } from "./sync";

type Answer = { value: unknown; changes: { event: string; payload: unknown }[] };

let version: string | null = null;
let served = false;

function serveAttachments(): void {
  if (served || !("serviceWorker" in navigator)) return;
  served = true;
  navigator.serviceWorker.addEventListener("message", (event: MessageEvent) => {
    const name = (event.data as { attachment?: string } | null)?.attachment;
    const port = event.ports[0];
    if (!name || !port) return;
    void libraryAttachment(name).then(
      (bytes) => port.postMessage(bytes),
      () => port.postMessage(null),
    );
  });
  void navigator.serviceWorker
    .register("/sw.js")
    .then(() => navigator.serviceWorker.ready)
    .then((registration) => {
      const loaded = performance
        .getEntriesByType("resource")
        .map((entry) => entry.name)
        .filter((url) => url.startsWith(location.origin));
      registration.active?.postMessage({ cache: loaded });
    })
    .catch(() => {});
}

async function appVersion(): Promise<string> {
  if (version) return version;
  const res = await fetch("/sync/v1/info");
  const info = (await res.json()) as { version: string };
  version = info.version;
  return version;
}

export async function callLibrary<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  serveAttachments();
  await startSync();
  const local = syncCommands[cmd];
  if (local) return (await local(args ?? {})) as T;
  if (cmd === "app_version") return (await appVersion()) as T;
  const answer = JSON.parse(
    await run<string>("call", cmd, JSON.stringify(args ?? null), clientId),
  ) as Answer;
  for (const change of answer.changes) emit(change.event, change.payload);
  if (answer.changes.length || cmd === "set_setting" || cmd === "delete_setting") syncSoon();
  return answer.value as T;
}

export async function saveLibraryAttachment(bytes: Uint8Array, ext: string): Promise<string> {
  await startSync();
  const name = await run<string>("save_attachment", bytes, ext);
  syncSoon();
  return name;
}

export async function exportLibraryArchive(): Promise<Uint8Array> {
  await startSync();
  return run<Uint8Array>("export_archive");
}

export async function libraryAttachment(name: string): Promise<Uint8Array | null> {
  await startSync();
  return (await run<Uint8Array | undefined>("attachment", name)) ?? null;
}
