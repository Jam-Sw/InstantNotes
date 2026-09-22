// A whiteboard owns its keyboard: arrows nudge shapes, Cmd+A selects them,
// Cmd+= zooms the canvas, Backspace deletes a shape. The library window's
// shortcuts must stand aside for keys aimed at a board, or an arrow press
// would switch notes and Cmd+Backspace would trash the board itself.

/** Whether a key event's target is on a board, or in one of Excalidraw's
 *  dialogs, which it renders outside the board's own element. */
export function isWhiteboardTarget(target: EventTarget | null): boolean {
  return target instanceof Element && target.closest("[data-whiteboard], .excalidraw") !== null;
}
