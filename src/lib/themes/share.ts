import { open, save } from "@tauri-apps/plugin-dialog";
import { exportThemeFile, importThemeFile } from "$lib/api/client";
import { theme } from "$lib/stores/theme.svelte";
import { parseTheme } from "./validate";
import { THEME_FILE_EXT } from "./types";

export type ShareResult =
  | { ok: true; name: string }
  | { ok: false; error: string }
  | { cancelled: true };

const FILTERS = [{ name: "InstantNotes Theme (.intheme.json)", extensions: ["json"] }];

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
