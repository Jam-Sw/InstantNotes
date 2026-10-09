import { pickFolder, type FolderChoice } from "$lib/folder-picker";
import type { VaultReport } from "$lib/api/types";

export function chooseVaultFolder(): Promise<FolderChoice> {
  return pickFolder({ title: "Choose a vault folder" });
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
