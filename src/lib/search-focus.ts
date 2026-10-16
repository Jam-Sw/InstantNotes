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

// Brings the note list into view, wherever the layout keeps it, and puts the
// cursor in its search field with the current query selected.
export async function focusSearch(doc: Document = document): Promise<boolean> {
  shell.closeSettings();
  library.graphMode = false;
  if (layout.phone) layout.back();
  else sidebar.revealList();
  const win = doc.defaultView ?? window;
  for (let frame = 0; frame < FRAMES; frame++) {
    await nextFrame(win);
    const input = doc.querySelector<HTMLInputElement>(".list-pane input.search");
    if (!input || input.closest("[inert]")) continue;
    input.focus();
    if (doc.activeElement !== input) continue;
    input.select();
    return true;
  }
  return false;
}
