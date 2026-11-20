import { downloadDir } from "@tauri-apps/api/path";
import type { FolderScan, ImportOutcome } from "$lib/api/types";
import { pickFile, pickFolder, type FolderChoice } from "$lib/folder-picker";

export function chooseObsidianVault(): Promise<FolderChoice> {
  return pickFolder({ title: "Choose your Obsidian vault" });
}

export async function chooseNotionExport(): Promise<FolderChoice> {
  const defaultPath = (await downloadDir().catch(() => null)) ?? undefined;
  return pickFile({
    title: "Choose your Notion export",
    defaultPath,
    filters: [{ name: "Notion export", extensions: ["zip"] }],
  });
}

export async function chooseNotionFolder(): Promise<FolderChoice> {
  const defaultPath = (await downloadDir().catch(() => null)) ?? undefined;
  return pickFolder({ title: "Choose your unzipped Notion export", defaultPath });
}

export function shortName(path: string): string {
  const name = path.split(/[\\/]/).filter(Boolean).pop() ?? path;
  return name.replace(/\.zip$/i, "");
}

function notes(n: number): string {
  return n === 1 ? "1 note" : `${n} notes`;
}

export function describeFound(scan: FolderScan): string {
  if (scan.notes === 0) return "No notes found";
  const parts = [`Found ${notes(scan.notes)}`];
  if (scan.images) parts.push(scan.images === 1 ? "1 image" : `${scan.images} images`);
  if (scan.imported) parts.push(`${scan.imported} already imported`);
  return parts.join(" · ");
}

export function describeNoteImport(outcome: ImportOutcome, space: string | null): string {
  const n = outcome.imported;
  let line =
    n === 0
      ? "Nothing new"
      : space && outcome.workspaceId
        ? `Imported ${notes(n)} into ${space}`
        : `Imported ${notes(n)}`;
  if (outcome.skipped) {
    line += ` · ${outcome.skipped} already imported`;
  }
  return line;
}
