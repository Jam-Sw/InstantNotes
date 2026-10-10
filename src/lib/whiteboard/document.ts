const EXCALIDRAW_ENGINE = "excalidraw";

export interface BoardElement {
  id: string;
  type: string;
  x: number;
  y: number;
  version: number;
  isDeleted?: boolean;
  text?: string;
  originalText?: string;
  name?: string | null;
  [key: string]: unknown;
}

export interface Board {
  elements: BoardElement[];
  appState: Record<string, unknown>;
  files: Record<string, unknown>;
}

export function emptyBoard(): Board {
  return { elements: [], appState: { viewBackgroundColor: "transparent" }, files: {} };
}

export function serializeBoard(board: Board): string {
  return JSON.stringify({ v: 1, engine: EXCALIDRAW_ENGINE, data: board });
}

const isObject = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === "object" && !Array.isArray(v);

export function parseBoard(raw: string | null | undefined): Board {
  let parsed: unknown;
  try {
    parsed = raw ? JSON.parse(raw) : null;
  } catch {
    return emptyBoard();
  }
  if (!isObject(parsed) || parsed.engine !== EXCALIDRAW_ENGINE || !isObject(parsed.data)) {
    return emptyBoard();
  }
  const { elements, appState, files } = parsed.data;
  return {
    elements: Array.isArray(elements) ? (elements as BoardElement[]) : [],
    appState: isObject(appState) ? appState : emptyBoard().appState,
    files: isObject(files) ? files : {},
  };
}

export function boardText(elements: readonly BoardElement[]): string {
  return elements
    .filter((el) => !el.isDeleted)
    .map((el) => {
      const words =
        el.type === "text"
          ? (typeof el.originalText === "string" ? el.originalText : el.text)
          : el.type === "frame" || el.type === "magicframe"
            ? el.name
            : null;
      return { el, words: typeof words === "string" ? words.trim() : "" };
    })
    .filter((entry) => entry.words)
    .sort((a, b) => a.el.y - b.el.y || a.el.x - b.el.x)
    .map((entry) => entry.words)
    .join("\n\n");
}

export function sceneFingerprint(
  elements: readonly { id: string; version: number }[],
  files: Record<string, unknown>,
): string {
  let hash = 5381;
  const mix = (s: string) => {
    for (let i = 0; i < s.length; i++) hash = ((hash * 33) ^ s.charCodeAt(i)) >>> 0;
  };
  for (const el of elements) mix(`${el.id}:${el.version};`);
  for (const id of Object.keys(files)) mix(`f${id};`);
  return `${elements.length}:${hash}`;
}

export function excalidrawFile(board: Board): string {
  const file = {
    type: "excalidraw",
    version: 2,
    source: "InstantNotes",
    elements: board.elements,
    appState: board.appState,
    files: board.files,
  };
  return `${JSON.stringify(file, null, 2)}\n`;
}
