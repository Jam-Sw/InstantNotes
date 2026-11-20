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
      ? "Offline: folder not found"
      : why.startsWith("vault folder has no")
        ? "Offline: folder empty or not mounted"
        : `Offline: ${why.replace(/\.$/, "")}`;
    const waiting = s.pending > 0 ? ` · ${notes(s.pending)} waiting` : "";
    return { line: reason + waiting, tone: "warn" };
  }
  if (s.heldRemovals > 0) {
    return {
      line: `Held: ${notes(s.heldRemovals)} missing from the folder`,
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
    lines.push(`Edited outside (${r.diverged.length}): ${names(r.diverged)}`);
  }
  if (r.missing.length) {
    lines.push(`Missing (${r.missing.length}): ${names(r.missing)}`);
  }
  if (r.orphans.length) {
    lines.push(`Not from InstantNotes (${r.orphans.length}): ${names(r.orphans)}`);
  }
  if (!r.manifestOk) lines.push("instantnotes.yaml out of date");

  if (lines.length === 0) lines.push(count(r.checked, "note matches", "notes match"));
  if (r.pending > 0) lines.push(`${r.pending} still writing`);
  return lines;
}
