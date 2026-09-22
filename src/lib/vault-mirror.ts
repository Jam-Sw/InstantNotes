// The live vault mirror (stage 2 of openspec/changes/feat-portable-vault-sync):
// picking its folder, and turning a verify report into sentences for the
// Vault settings page. The writing itself happens in Rust.

import { open } from "@tauri-apps/plugin-dialog";
import type { VaultReport } from "$lib/api/types";

export type FolderChoice = { path: string } | { cancelled: true } | { error: string };

/** Prompt for the folder the mirror writes into. */
export async function chooseVaultFolder(): Promise<FolderChoice> {
  let picked: string | string[] | null;
  try {
    picked = await open({ directory: true, multiple: false, title: "Choose a vault folder" });
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Could not open the folder picker." };
  }
  if (!picked || typeof picked !== "string") return { cancelled: true };
  return { path: picked };
}

const NAMED = 3;

function names(paths: string[]): string {
  const shown = paths.slice(0, NAMED).join(", ");
  const rest = paths.length - NAMED;
  return rest > 0 ? `${shown} and ${rest} more` : shown;
}

function count(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`;
}

/** One sentence per finding, clean result first-class rather than silent. */
export function describeVaultReport(r: VaultReport): string[] {
  const lines: string[] = [];
  if (r.diverged.length) {
    lines.push(
      `${count(r.diverged.length, "file was", "files were")} edited outside InstantNotes: ${names(r.diverged)}`,
    );
  }
  if (r.missing.length) {
    lines.push(
      `${count(r.missing.length, "note file is", "note files are")} missing: ${names(r.missing)}`,
    );
  }
  if (r.orphans.length) {
    lines.push(
      `${count(r.orphans.length, "file is", "files are")} not notes InstantNotes wrote: ${names(r.orphans)}`,
    );
  }
  if (!r.manifestOk) lines.push("instantnotes.yaml does not match your tags and Spaces.");

  if (lines.length === 0) {
    lines.push(
      r.checked === 1
        ? "The 1 note matches its file."
        : `All ${r.checked} notes match their files.`,
    );
  }
  if (r.pending > 0) lines.push(`${r.pending} more ${r.pending === 1 ? "is" : "are"} still being written.`);
  return lines;
}
