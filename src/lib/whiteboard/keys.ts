export function isWhiteboardTarget(target: EventTarget | null): boolean {
  return target instanceof Element && target.closest("[data-whiteboard], .excalidraw") !== null;
}
