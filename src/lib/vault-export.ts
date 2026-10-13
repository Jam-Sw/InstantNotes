import { open } from "@tauri-apps/plugin-dialog";
import { exportArchive, exportVault } from "$lib/api/client";

export type ExportResult =
  | { ok: true }
  | { ok: false; error: string }
  | { cancelled: true };

export async function exportVaultToFolder(): Promise<ExportResult> {
  let dest: string | string[] | null;
  try {
    dest = await open({ directory: true, multiple: false });
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Could not open the folder picker." };
  }
  if (!dest || typeof dest !== "string") return { cancelled: true };

  try {
    await exportVault(dest);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Could not export the vault." };
  }
}

function archiveName(now = new Date()): string {
  return `InstantNotes-${now.toISOString().slice(0, 10)}.zip`;
}

export async function exportArchiveDownload(): Promise<ExportResult> {
  try {
    const bytes = await exportArchive();
    const copy = new Uint8Array(bytes.byteLength);
    copy.set(bytes);
    const url = URL.createObjectURL(new Blob([copy], { type: "application/zip" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = archiveName();
    link.click();
    URL.revokeObjectURL(url);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Could not export the notes." };
  }
}
