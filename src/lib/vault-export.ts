import { open } from "@tauri-apps/plugin-dialog";
import { exportVault } from "$lib/api/client";

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
