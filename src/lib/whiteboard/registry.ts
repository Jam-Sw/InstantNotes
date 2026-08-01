// Adapter registry. Svelte Flow is mounted as a Svelte component (FlowCanvas);
// this registry remains for future non-Svelte engines.

import type { WhiteboardAdapter } from "./types";
import { FLOW_ENGINE_ID, SHELL_ENGINE_ID } from "./types";

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

export { FLOW_ENGINE_ID, SHELL_ENGINE_ID };
