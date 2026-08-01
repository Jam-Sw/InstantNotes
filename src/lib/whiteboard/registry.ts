// Adapter registry. Only the shell ships today; real engines register here.

import type { WhiteboardAdapter } from "./types";
import { SHELL_ENGINE_ID } from "./types";
import { shellAdapter } from "./shell-adapter";

const adapters = new Map<string, WhiteboardAdapter>([[SHELL_ENGINE_ID, shellAdapter]]);

export function getAdapter(engineId: string): WhiteboardAdapter {
  return adapters.get(engineId) ?? shellAdapter;
}

export function listAdapters(): WhiteboardAdapter[] {
  return [...adapters.values()];
}

/** For tests or future dynamic registration of engine packages. */
export function registerAdapter(adapter: WhiteboardAdapter): void {
  adapters.set(adapter.id, adapter);
}
