import { library } from "$lib/stores/library.svelte";
import { confirmDialog } from "$lib/stores/confirm.svelte";

export async function confirmConvertToWhiteboard(): Promise<boolean> {
  const note = library.selected;
  if (!note || note.isDeleted || note.contentKind === "whiteboard") return false;
  const ok = await confirmDialog.ask({
    title: "Turn this note into a whiteboard?",
    body: "Can't be turned back into text",
    confirmLabel: "Make Whiteboard",
  });
  if (!ok) return false;
  await library.convertToWhiteboard();
  return true;
}
