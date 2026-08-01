// Whiteboard surface contracts. InstantNotes owns note chrome and persistence;
// adapters own the canvas. Keep this free of Svelte/runes so it stays testable.

/** Default engine until a real library is registered. */
export const SHELL_ENGINE_ID = "shell";

/** Versioned envelope stored in note.surfaceData (JSON string). */
export interface SurfaceDocument {
  /** Envelope version; bump when the InstantNotes wrapper shape changes. */
  v: 1;
  /** Adapter id that understands `data` (e.g. "shell", "tldraw"). */
  engine: string;
  /** Opaque engine document; shape is owned by the adapter. */
  data: unknown;
}

export interface WhiteboardMountOptions {
  /** Parsed engine payload (`SurfaceDocument.data`), not the full envelope. */
  data: unknown;
  readonly: boolean;
  /** Called when the engine document changes; host serializes + persists. */
  onChange: (data: unknown) => void;
}

export interface WhiteboardMountHandle {
  dispose: () => void;
  focus?: () => void;
}

/**
 * Pluggable canvas engine. InstantNotes never imports a specific library in
 * chrome code: only the registry and this adapter do.
 */
export interface WhiteboardAdapter {
  id: string;
  label: string;
  /** Short line for empty-state / about copy. */
  description: string;
  mount: (host: HTMLElement, opts: WhiteboardMountOptions) => WhiteboardMountHandle;
}
