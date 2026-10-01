// Settings > Import, Apple Stickies: picking the folder, and the words the
// page shows. Reading and converting happen in Rust
// (openspec/changes/feat-stickies-import).

import { stickiesLocation } from "$lib/api/client";
import type { ImportOutcome } from "$lib/api/types";
import { pickFolder, type FolderChoice } from "$lib/folder-picker";

/** The Space an import files into unless the user names another. */
export const DEFAULT_SPACE = "Apple Stickies";

/** Where Stickies keeps its notes, said when a folder holds none. */
export const STICKIES_PATH_HINT = "~/Library/Containers/com.apple.Stickies/Data/Library/Stickies";

/** Privacy & Security, where macOS lets an app read other apps' data. */
export const PRIVACY_SETTINGS_URL = "x-apple.systempreferences:com.apple.preference.security?Privacy";

/** Stickies' yellow, for a sticky whose color was not recorded. */
export const STICKY_YELLOW = "#fef49c";

/** Prompt for the Stickies folder, starting in it. Choosing it is what lets
 *  the app read it: macOS 27 refuses another app's data otherwise. */
export async function chooseStickiesFolder(): Promise<FolderChoice> {
  const defaultPath = (await stickiesLocation().catch(() => null)) ?? undefined;
  return pickFolder({ title: "Choose your Stickies folder", defaultPath });
}

/** A sticky's text under its title: everything after the first line that
 *  has anything on it. */
export function stickyBody(text: string): string {
  const lines = text.split("\n");
  const first = lines.findIndex((l) => l.trim() !== "");
  return first < 0 ? "" : lines.slice(first + 1).join("\n").trim();
}

/** "Jun 5" this year, "Jun 5, 2022" before it: stickies can be years old. */
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

/** The line above the miniatures. */
export function describeSelection(total: number, selected: number, imported: number): string {
  const parts = [stickies(total), `${selected} selected`];
  if (imported) parts.push(`${imported} already imported`);
  return parts.join(" · ");
}

/** What an import did, in one or two sentences. */
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
