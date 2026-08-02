// Optional registry for non-component engines. Excalidraw is mounted as a
// Svelte host wrapping a React root (ExcalidrawCanvas.svelte).

import type { WhiteboardAdapter } from "./types";
import { EXCALIDRAW_ENGINE_ID } from "./types";

const adapters = new Map<string, WhiteboardAdapter>();

export function getAdapter(engineId: string): WhiteboardAdapter | null {
  return adapters.get(engineId) ?? null;
}

export function listAdapters(): WhiteboardAdapter[] {
  return [...adapters.values()];
}

export function registerAdapter(adapter: WhiteboardAdapter): void {
  adapters.set(adapter.id, adapter);
}

export { EXCALIDRAW_ENGINE_ID };
