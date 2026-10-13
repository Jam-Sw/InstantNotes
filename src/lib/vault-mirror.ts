import { pickFolder, type FolderChoice } from "$lib/folder-picker";
import type { VaultReport, VaultStatus } from "$lib/api/types";

export function chooseVaultFolder(): Promise<FolderChoice> {
  return pickFolder({ title: "Choose a vault folder" });
}

export function parseVaultSynced(payload: unknown): string[] {
  if (typeof payload !== "object" || payload === null) return [];
  const ids = (payload as { noteIds?: unknown }).noteIds;
  return Array.isArray(ids) ? ids.filter((id): id is string => typeof id === "string") : [];
}

export type VaultTone = "ok" | "busy" | "warn";

function notes(n: number): string {
  return `${n} ${n === 1 ? "note" : "notes"}`;
}

export function describeVaultStatus(s: VaultStatus): { line: string; tone: VaultTone } {
  if (!s.path) return { line: "", tone: "ok" };
  if (!s.reachable) {
    const why = s.unreachable ?? "";
    const reason = why.startsWith("vault folder not found")
      ? "Offline: the folder can't be found."
      : why.startsWith("vault folder has no")
        ? "Offline: the folder is there but empty. If it's a network drive, check that it's mounted."
        : `Offline: ${why.replace(/\.?$/, ".")}`;
    const waiting = s.pending > 0 ? ` ${notes(s.pending)} will sync when it's back.` : "";
    return { line: reason + waiting, tone: "warn" };
  }
  if (s.heldRemovals > 0) {
    return {
      line: `Waiting: ${notes(s.heldRemovals)} went missing from the folder at once.`,
      tone: "warn",
    };
  }
  if (s.lastError) return { line: `Problem: ${s.lastError}`, tone: "warn" };
  if (s.pending > 0) return { line: `Syncing ${notes(s.pending)}…`, tone: "busy" };
  return { line: "Up to date", tone: "ok" };
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
