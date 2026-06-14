// Theme sharing: orchestrates the native open/save dialog (JS), the Rust file
// byte I/O (via the API client), validation, and the theme store. A theme is
// exchanged as a single `.intheme.json` file. Import always validates before
// the theme reaches the store, so a malformed or hostile file is rejected with
// a friendly message and nothing is applied.

import { open, save } from "@tauri-apps/plugin-dialog";
import { exportThemeFile, importThemeFile } from "$lib/api/client";
import { theme } from "$lib/stores/theme.svelte";
import { parseTheme } from "./validate";
import { THEME_FILE_EXT } from "./types";

export type ShareResult =
  | { ok: true; name: string }
  | { ok: false; error: string }
  | { cancelled: true };

// Native dialogs filter by simple extension; .intheme.json files are JSON, so
// "json" is the right filter. The full .intheme.json name comes from defaultPath.
const FILTERS = [{ name: "InstantNotes Theme (.intheme.json)", extensions: ["json"] }];

/** Prompt for a destination and write the active (or given) theme to it. */
export async function exportTheme(id?: string): Promise<ShareResult> {
  const target = theme.allThemes.find((t) => t.id === (id ?? theme.activeId)) ?? theme.activeTheme;
  const suggested = `${target.name.replace(/[^\w-]+/g, "-")}.${THEME_FILE_EXT}`;
  try {
    const path = await save({ defaultPath: suggested, filters: FILTERS });
    if (!path) return { cancelled: true };
    await exportThemeFile(path, theme.serialize(target.id));
    return { ok: true, name: target.name };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Could not export theme." };
  }
}

/** Prompt for a file, read + validate it, and add it to the store on success. */
export async function importTheme(): Promise<ShareResult> {
  try {
    const path = await open({ multiple: false, directory: false, filters: FILTERS });
    if (!path || typeof path !== "string") return { cancelled: true };
    const json = await importThemeFile(path);
    const result = parseTheme(json);
    if (!result.ok) return { ok: false, error: result.error };
    theme.addCustomTheme(result.theme);
    return { ok: true, name: result.theme.name };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Could not import theme." };
  }
}
