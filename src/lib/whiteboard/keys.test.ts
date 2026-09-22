// @vitest-environment jsdom
import { describe, it, expect, afterEach } from "vitest";
import { isWhiteboardTarget } from "./keys";

afterEach(() => document.body.replaceChildren());

describe("isWhiteboardTarget", () => {
  it("is true inside a board's canvas and inside Excalidraw's dialogs", () => {
    document.body.innerHTML = `
      <div data-whiteboard><canvas id="c"></canvas></div>
      <div class="excalidraw excalidraw-modal-container"><button id="d"></button></div>
      <div class="note-list"><button id="row"></button></div>`;
    expect(isWhiteboardTarget(document.getElementById("c"))).toBe(true);
    expect(isWhiteboardTarget(document.getElementById("d"))).toBe(true);
    expect(isWhiteboardTarget(document.getElementById("row"))).toBe(false);
  });

  it("is false for non-elements", () => {
    expect(isWhiteboardTarget(null)).toBe(false);
    expect(isWhiteboardTarget(window)).toBe(false);
  });
});
