import { library } from "$lib/stores/library.svelte";
import { layout } from "$lib/stores/layout.svelte";
import { shell } from "$lib/stores/shell.svelte";
import { sidebar } from "$lib/stores/sidebar.svelte";

// The list can take a pane transition, or a history step on the phone, to
// become focusable, so the field is retried each frame for about half a second.
const FRAMES = 30;

function nextFrame(win: Window): Promise<void> {
  return new Promise((resolve) => win.requestAnimationFrame(() => resolve()));
}

function take(doc: Document, input: HTMLInputElement | null): boolean {
  if (!input || input.closest("[inert]")) return false;
  input.focus();
  if (doc.activeElement !== input) return false;
  input.select();
  return true;
}

// Puts the cursor in the note search with the query selected: the welcome
// screen's finder when it is showing (the list is hidden and no note is open),
// otherwise the list's own field, brought into view wherever the layout keeps it.
export async function focusSearch(doc: Document = document): Promise<boolean> {
  shell.closeSettings();
  if (take(doc, doc.querySelector<HTMLInputElement>(".welcome-search input.search"))) return true;
  library.graphMode = false;
  if (layout.phone) layout.back();
  else sidebar.revealList();
  const win = doc.defaultView ?? window;
  for (let frame = 0; frame < FRAMES; frame++) {
    await nextFrame(win);
    if (take(doc, doc.querySelector<HTMLInputElement>(".list-pane input.search"))) return true;
  }
  return false;
}
