// Stage 1 vault export: prompt for a destination folder, then hand off to
// the Rust writer (openspec/changes/feat-portable-vault-sync, SEQUENCE.md
// unit 7). One-way and read-only from the app's perspective: nothing reads
// this folder back yet, so there is nothing here to validate before writing,
// unlike theme import (src/lib/themes/share.ts).

import { open } from "@tauri-apps/plugin-dialog";
import { exportVault } from "$lib/api/client";

export type ExportResult =
  | { ok: true }
  | { ok: false; error: string }
  | { cancelled: true };

/** Prompt for a folder and write the whole library into it as a vault. */
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
