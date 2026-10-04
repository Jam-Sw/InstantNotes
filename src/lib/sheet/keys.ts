// What a key means to the grid, as a table: keydown in, intent out. Pure, so
// the two modes' tables (design.md §3) are tested as tables, and so the one
// rule that matters outside the grid can be asserted against the app's own
// shortcuts: the grid claims only the keys here, and lets everything else,
// above all every Cmd/Ctrl chord it does not list, pass through untouched.
//
// Copy, cut, and paste are not here: the grid takes them as clipboard events
// on its focused element, so the Edit menu and the keys both reach it.

export interface KeyLike {
  key: string;
  metaKey: boolean;
  ctrlKey: boolean;
  shiftKey: boolean;
  altKey: boolean;
  isComposing?: boolean;
}

export type SelectIntent =
  | { type: "move"; dr: number; dc: number; extend: boolean }
  | { type: "jump"; dr: number; dc: number; extend: boolean }
  | { type: "page"; dir: 1 | -1; extend: boolean }
  | { type: "edge"; where: "rowStart" | "rowEnd" | "first" | "last"; extend: boolean }
  | { type: "tab"; back: boolean }
  /** Start editing the active cell; `replaceWith` is the typed key that
   *  replaces its contents, else the caret goes to the end of what is there. */
  | { type: "edit"; replaceWith?: string }
  | { type: "clear" }
  | { type: "selectAll" }
  | { type: "undo" }
  | { type: "redo" }
  | { type: "leave" };

export type EditIntent =
  | { type: "commit"; move: "down" | "up" | "right" | "left" }
  | { type: "cancel" }
  | { type: "newline" };

const ARROWS: Record<string, [number, number]> = {
  ArrowUp: [-1, 0],
  ArrowDown: [1, 0],
  ArrowLeft: [0, -1],
  ArrowRight: [0, 1],
};

const mod = (e: KeyLike) => e.metaKey || e.ctrlKey;

/** A key while a cell is selected and no caret is up. Null means the grid
 *  does not handle it, and the event goes on to the window. */
export function selectIntent(e: KeyLike): SelectIntent | null {
  if (e.isComposing) return null;
  const extend = e.shiftKey;
  const arrow = ARROWS[e.key];
  if (arrow) {
    const [dr, dc] = arrow;
    return mod(e) ? { type: "jump", dr, dc, extend } : { type: "move", dr, dc, extend };
  }
  if (mod(e)) {
    // The grid's own chords, and nothing else with Cmd/Ctrl: the palette,
    // new note, pop-out, zoom, and every future app shortcut pass through.
    switch (e.key) {
      case "a":
      case "A":
        return e.shiftKey ? null : { type: "selectAll" };
      case "z":
        return e.shiftKey ? { type: "redo" } : { type: "undo" };
      case "Z":
        return e.shiftKey ? { type: "redo" } : { type: "undo" };
      case "y":
        return e.shiftKey ? null : { type: "redo" };
      case "Home":
        return { type: "edge", where: "first", extend };
      case "End":
        return { type: "edge", where: "last", extend };
      default:
        return null;
    }
  }
  switch (e.key) {
    case "Tab":
      return { type: "tab", back: e.shiftKey };
    case "Enter":
    case "F2":
      return e.altKey ? null : { type: "edit" };
    case "Delete":
    case "Backspace":
      return { type: "clear" };
    case "Escape":
      return { type: "leave" };
    case "Home":
      return { type: "edge", where: "rowStart", extend };
    case "End":
      return { type: "edge", where: "rowEnd", extend };
    case "PageUp":
      return { type: "page", dir: -1, extend };
    case "PageDown":
      return { type: "page", dir: 1, extend };
    default:
      break;
  }
  // Any printable key starts editing, replacing the cell with it. Option
  // combinations are printable on macOS (⌥e is ´), so Alt is not a chord.
  if (e.key.length === 1 && !e.ctrlKey && !e.metaKey) return { type: "edit", replaceWith: e.key };
  return null;
}

/** A key while a caret is in a cell. Null means the input handles it (the
 *  caret moves, text is typed, native undo and clipboard apply). */
export function editIntent(e: KeyLike): EditIntent | null {
  if (e.isComposing) return null;
  switch (e.key) {
    case "Enter":
      if (e.altKey) return { type: "newline" };
      return { type: "commit", move: e.shiftKey ? "up" : "down" };
    case "Tab":
      return { type: "commit", move: e.shiftKey ? "left" : "right" };
    case "Escape":
      return { type: "cancel" };
    default:
      return null;
  }
}

/** Whether the grid would swallow this key in either mode: the predicate the
 *  shortcut-collision test checks the app's registry against. */
export function claimsKey(e: KeyLike): boolean {
  return selectIntent(e) !== null || editIntent(e) !== null;
}
