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

export function selectIntent(e: KeyLike): SelectIntent | null {
  if (e.isComposing) return null;
  const extend = e.shiftKey;
  const arrow = ARROWS[e.key];
  if (arrow) {
    const [dr, dc] = arrow;
    return mod(e) ? { type: "jump", dr, dc, extend } : { type: "move", dr, dc, extend };
  }
  if (mod(e)) {
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
  if (e.key.length === 1 && !e.ctrlKey && !e.metaKey) return { type: "edit", replaceWith: e.key };
  return null;
}

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
