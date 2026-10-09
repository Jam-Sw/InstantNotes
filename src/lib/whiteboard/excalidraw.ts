import { emptyBoard, serializeBoard, type BoardElement } from "./document";

const EXCALIDRAW_ASSET_PATH = "/excalidraw/";

export function loadExcalidraw() {
  const w = window as Window & { EXCALIDRAW_ASSET_PATH?: string };
  w.EXCALIDRAW_ASSET_PATH ??= EXCALIDRAW_ASSET_PATH;
  return import("@excalidraw/excalidraw");
}

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
