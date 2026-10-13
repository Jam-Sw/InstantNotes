import { save } from "@tauri-apps/plugin-dialog";
import { exportNoteFile, sheetCsv } from "$lib/api/client";
import { library } from "$lib/stores/library.svelte";
import { excalidrawFile, parseBoard } from "$lib/whiteboard/document";

export async function exportSelectedNote(): Promise<void> {
  const note = library.selected;
  if (!note) return;
  await library.flushPendingEdits();
  const filename = (note.title || "Untitled").replace(/[/\\?%*:|"<>]/g, "-");
  const board = note.contentKind === "whiteboard";
  const sheet = note.contentKind === "sheet";
  const [ext, filter] = board
    ? ["excalidraw", { name: "Excalidraw", extensions: ["excalidraw"] }]
    : sheet
      ? ["csv", { name: "CSV", extensions: ["csv"] }]
      : ["md", { name: "Markdown", extensions: ["md"] }];
  const path = await save({ defaultPath: `${filename}.${ext}`, filters: [filter] });
  if (!path) return;
  const contents = board
    ? excalidrawFile(parseBoard(note.surfaceData))
    : sheet
      ? await sheetCsv(note.id)
      : note.body;
  await exportNoteFile(path, contents);
}
