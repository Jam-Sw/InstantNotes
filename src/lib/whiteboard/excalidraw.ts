// Loading Excalidraw, the canvas engine behind whiteboards. It is large and
// only a board needs it, so it loads on first use, never with the app.

import { emptyBoard, serializeBoard, type BoardElement } from "./document";

/** Where the build serves Excalidraw's fonts (scripts/copy-excalidraw-fonts.mjs).
 *  Without it Excalidraw fetches them from a CDN, which the app's content
 *  security policy blocks: InstantNotes makes no network requests. */
export const EXCALIDRAW_ASSET_PATH = "/excalidraw/";

export function loadExcalidraw() {
  const w = window as Window & { EXCALIDRAW_ASSET_PATH?: string };
  w.EXCALIDRAW_ASSET_PATH ??= EXCALIDRAW_ASSET_PATH;
  return import("@excalidraw/excalidraw");
}

/**
 * A new board holding `text` as one text element at the origin, so
 * converting a note to a whiteboard carries its words onto the canvas
 * instead of hiding them. Empty text gives an empty board without loading
 * the engine.
 */
export async function boardFromText(text: string): Promise<string> {
  const board = emptyBoard();
  const trimmed = text.trim();
  if (trimmed) {
    const { convertToExcalidrawElements } = await loadExcalidraw();
    board.elements = convertToExcalidrawElements([
      { type: "text", x: 0, y: 0, text: trimmed },
    ]) as unknown as BoardElement[];
  }
  return serializeBoard(board);
}
