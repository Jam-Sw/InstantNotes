// Pure surface-document helpers. Freeform board payload (Excalidraw scene).

import type { SurfaceDocument } from "./types";

/** Freeform whiteboard engine (boxes, arrows, freehand — not a rigid graph). */
export const EXCALIDRAW_ENGINE_ID = "excalidraw";

/** Legacy engine ids we may still see in stored rows. */
export const FLOW_ENGINE_ID = "svelte-flow";
export const SHELL_ENGINE_ID = "shell";

/** Excalidraw scene slice we persist (elements + a few appState fields). */
export type ExcalidrawScene = {
  elements: unknown[];
  appState?: Record<string, unknown>;
  files?: Record<string, unknown>;
};

/** Fresh empty board — no starter nodes, no forced layout. */
export function emptyScene(): ExcalidrawScene {
  return {
    elements: [],
    appState: {
      viewBackgroundColor: "transparent",
      currentItemFontFamily: 1,
    },
    files: {},
  };
}

export function emptySurfaceDocument(
  engine = EXCALIDRAW_ENGINE_ID,
): SurfaceDocument {
  return {
    v: 1,
    engine,
    data: emptyScene(),
  };
}

export function serializeSurfaceDocument(doc: SurfaceDocument): string {
  return JSON.stringify(doc);
}

/**
 * Parse stored surface_data. Invalid or legacy graph payloads become a fresh
 * empty freeform board (we do not try to convert rigid flow nodes).
 */
export function parseSurfaceDocument(
  raw: string | null | undefined,
): SurfaceDocument {
  if (!raw || !raw.trim()) return emptySurfaceDocument();
  try {
    const parsed = JSON.parse(raw) as Partial<SurfaceDocument>;
    if (parsed && parsed.v === 1 && typeof parsed.engine === "string") {
      if (parsed.engine === EXCALIDRAW_ENGINE_ID) {
        return {
          v: 1,
          engine: EXCALIDRAW_ENGINE_ID,
          data: normalizeScene(parsed.data),
        };
      }
      // Old shell / svelte-flow rows: open a blank freeform board instead of
      // replaying a rigid starter graph the user never asked for.
      return emptySurfaceDocument();
    }
  } catch {
    // fall through
  }
  return emptySurfaceDocument();
}

export function normalizeScene(raw: unknown): ExcalidrawScene {
  if (!raw || typeof raw !== "object") return emptyScene();
  const obj = raw as ExcalidrawScene;
  return {
    elements: Array.isArray(obj.elements) ? obj.elements : [],
    appState:
      obj.appState && typeof obj.appState === "object" ? obj.appState : emptyScene().appState,
    files: obj.files && typeof obj.files === "object" ? obj.files : {},
  };
}

export function withSurfaceData(
  current: SurfaceDocument | null | undefined,
  data: unknown,
  engine?: string,
): SurfaceDocument {
  const base = current ?? emptySurfaceDocument(engine);
  return {
    v: 1,
    engine: engine ?? base.engine,
    data,
  };
}

export function isWhiteboardKind(kind: string | undefined | null): boolean {
  return kind === "whiteboard";
}
