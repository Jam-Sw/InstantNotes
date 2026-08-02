// Whiteboard surface contracts. InstantNotes owns note chrome and persistence;
// the freeform engine owns the canvas.

/** Freeform engine (Excalidraw). */
export const EXCALIDRAW_ENGINE_ID = "excalidraw";
export const FLOW_ENGINE_ID = "svelte-flow";
export const SHELL_ENGINE_ID = "shell";

/** Versioned envelope stored in note.surfaceData (JSON string). */
export interface SurfaceDocument {
  v: 1;
  engine: string;
  data: unknown;
}

export interface WhiteboardMountOptions {
  data: unknown;
  readonly: boolean;
  onChange: (data: unknown) => void;
}

export interface WhiteboardMountHandle {
  dispose: () => void;
  focus?: () => void;
}

export interface WhiteboardAdapter {
  id: string;
  label: string;
  description: string;
  mount: (host: HTMLElement, opts: WhiteboardMountOptions) => WhiteboardMountHandle;
}
