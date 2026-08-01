// One-way document → whiteboard conversion. Product rule: permanent from the
// UI; never offer convert-back. Callers must go through this confirm so a note
// is never overwritten by accident.

import { library } from "$lib/stores/library.svelte";
import { confirmDialog } from "$lib/stores/confirm.svelte";

const CONFIRM = {
  title: "Convert to whiteboard permanently?",
  body: "This note becomes a whiteboard. The written text will leave the editor and you cannot convert it back to a document. Copy anything you still need first, or use a fresh note for the board.",
  confirmLabel: "Convert to Whiteboard",
  tone: "danger" as const,
};

/**
 * Confirm, then permanently convert the open note to a whiteboard.
 * Returns true only when the conversion ran.
 */
export async function confirmConvertToWhiteboard(): Promise<boolean> {
  const note = library.selected;
  if (!note || note.isDeleted || note.contentKind === "whiteboard") return false;

  const ok = await confirmDialog.ask(CONFIRM);
  if (!ok) return false;

  await library.convertToWhiteboard();
  return true;
}
