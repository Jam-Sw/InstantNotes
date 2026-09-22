// Turning a document into a whiteboard, from the palette. It is one-way, so
// it asks first, and the dialog says exactly what happens to the text.

import { library } from "$lib/stores/library.svelte";
import { confirmDialog } from "$lib/stores/confirm.svelte";

/** Ask, then convert the open note. True only when it converted. */
export async function confirmConvertToWhiteboard(): Promise<boolean> {
  const note = library.selected;
  if (!note || note.isDeleted || note.contentKind === "whiteboard") return false;
  const ok = await confirmDialog.ask({
    title: "Turn this note into a whiteboard?",
    body: "Its text moves onto the board as a text block, and stays searchable. A whiteboard can't be turned back into a text note.",
    confirmLabel: "Make Whiteboard",
  });
  if (!ok) return false;
  await library.convertToWhiteboard();
  return true;
}
