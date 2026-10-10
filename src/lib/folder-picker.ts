import { open } from "@tauri-apps/plugin-dialog";

export type FolderChoice = { path: string } | { cancelled: true } | { error: string };

export async function pickFolder(options: {
  title: string;
  defaultPath?: string;
}): Promise<FolderChoice> {
  let picked: string | string[] | null;
  try {
    picked = await open({ directory: true, multiple: false, ...options });
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Could not open the folder picker." };
  }
  if (!picked || typeof picked !== "string") return { cancelled: true };
  return { path: picked };
}
