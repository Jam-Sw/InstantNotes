// Placeholder adapter: no diagram library. Renders a calm empty canvas so the
// note surface mode is real while engines are evaluated and plugged in later.

import type { WhiteboardAdapter, WhiteboardMountHandle, WhiteboardMountOptions } from "./types";
import { SHELL_ENGINE_ID } from "./types";

export const shellAdapter: WhiteboardAdapter = {
  id: SHELL_ENGINE_ID,
  label: "Shell",
  description: "Placeholder canvas. Swap in tldraw, Excalidraw, or another engine later.",
  mount(host, opts) {
    return mountShell(host, opts);
  },
};

function mountShell(host: HTMLElement, opts: WhiteboardMountOptions): WhiteboardMountHandle {
  host.replaceChildren();
  host.classList.add("wb-shell-host");

  const root = document.createElement("div");
  root.className = "wb-shell";
  root.setAttribute("role", "img");
  root.setAttribute(
    "aria-label",
    "Whiteboard surface placeholder. A diagram engine will mount here.",
  );

  const grid = document.createElement("div");
  grid.className = "wb-shell-grid";
  root.appendChild(grid);

  const card = document.createElement("div");
  card.className = "wb-shell-card";

  const title = document.createElement("div");
  title.className = "wb-shell-title";
  title.textContent = "Whiteboard surface";

  const body = document.createElement("p");
  body.className = "wb-shell-body";
  body.textContent =
    "This note is a canvas host. Nodes, frames, arrows, and freehand drawing will come from a plugged-in engine so InstantNotes does not grow a second editor stack.";

  const meta = document.createElement("p");
  meta.className = "wb-shell-meta";
  meta.textContent = "Engine: Shell (placeholder)";

  card.append(title, body, meta);
  root.appendChild(card);
  host.appendChild(root);

  // Keep a minimal document so persistence paths stay exercised.
  const data =
    opts.data && typeof opts.data === "object" ? opts.data : { nodes: [] as unknown[] };
  // No interactive edits in the shell; still report once so callers can assert mount.
  void data;

  return {
    dispose() {
      host.replaceChildren();
      host.classList.remove("wb-shell-host");
    },
    focus() {
      host.focus();
    },
  };
}
