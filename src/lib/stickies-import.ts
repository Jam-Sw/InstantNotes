import { stickiesLocation } from "$lib/api/client";
import type { ImportOutcome } from "$lib/api/types";
import { pickFolder, type FolderChoice } from "$lib/folder-picker";

export const DEFAULT_SPACE = "Apple Stickies";

export const STICKIES_PATH_HINT = "~/Library/Containers/com.apple.Stickies/Data/Library/Stickies";

export const PRIVACY_SETTINGS_URL = "x-apple.systempreferences:com.apple.preference.security?Privacy";

export const STICKY_YELLOW = "#fef49c";

export async function chooseStickiesFolder(): Promise<FolderChoice> {
  const defaultPath = (await stickiesLocation().catch(() => null)) ?? undefined;
  return pickFolder({ title: "Choose your Stickies folder", defaultPath });
}

export function stickyBody(text: string): string {
  const lines = text.split("\n");
  const first = lines.findIndex((l) => l.trim() !== "");
  return first < 0 ? "" : lines.slice(first + 1).join("\n").trim();
}

export function stickyDate(iso: string, now = new Date()): string {
  const d = new Date(iso);
  const sameYear = d.getFullYear() === now.getFullYear();
  return d.toLocaleDateString([], {
    month: "short",
    day: "numeric",
    ...(sameYear ? {} : { year: "numeric" }),
  });
}

function stickies(n: number): string {
  return n === 1 ? "1 sticky" : `${n} stickies`;
}

export function describeSelection(total: number, selected: number, imported: number): string {
  const parts = [stickies(total), `${selected} selected`];
  if (imported) parts.push(`${imported} already imported`);
  return parts.join(" · ");
}

export function describeImport(outcome: ImportOutcome, space: string | null): string {
  const n = outcome.imported;
  let line =
    n === 0
      ? "Nothing new to import."
      : space && outcome.workspaceId
        ? `Imported ${stickies(n)} into ${space}.`
        : `Imported ${stickies(n)}.`;
  if (outcome.skipped) {
    line += ` ${outcome.skipped === 1 ? "1 was" : `${outcome.skipped} were`} already here.`;
  }
  return line;
}
