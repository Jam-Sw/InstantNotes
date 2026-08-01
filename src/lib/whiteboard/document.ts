// Pure surface-document helpers (parse, empty, serialize). No DOM, no stores.

import {
  SHELL_ENGINE_ID,
  type SurfaceDocument,
} from "./types";

/** Empty shell document used when first converting a note to a whiteboard. */
export function emptySurfaceDocument(engine = SHELL_ENGINE_ID): SurfaceDocument {
  return {
    v: 1,
    engine,
    data: engine === SHELL_ENGINE_ID ? { nodes: [] as unknown[] } : {},
  };
}

export function serializeSurfaceDocument(doc: SurfaceDocument): string {
  return JSON.stringify(doc);
}

/**
 * Parse stored surface_data. Invalid or empty input yields a fresh shell doc
 * so a corrupt row never blocks opening the note.
 */
export function parseSurfaceDocument(raw: string | null | undefined): SurfaceDocument {
  if (!raw || !raw.trim()) return emptySurfaceDocument();
  try {
    const parsed = JSON.parse(raw) as Partial<SurfaceDocument>;
    if (parsed && parsed.v === 1 && typeof parsed.engine === "string") {
      return {
        v: 1,
        engine: parsed.engine,
        data: parsed.data ?? {},
      };
    }
  } catch {
    // fall through
  }
  return emptySurfaceDocument();
}

/** Write a new engine payload into an existing envelope (or a fresh one). */
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
