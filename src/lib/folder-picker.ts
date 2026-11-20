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
    return { error: e instanceof Error ? e.message : "Folder picker failed" };
  }
  if (!picked || typeof picked !== "string") return { cancelled: true };
  return { path: picked };
}

export async function pickFile(options: {
  title: string;
  defaultPath?: string;
  filters: { name: string; extensions: string[] }[];
}): Promise<FolderChoice> {
  let picked: string | string[] | null;
  try {
    picked = await open({ directory: false, multiple: false, ...options });
  } catch (e) {
    return { error: e instanceof Error ? e.message : "File picker failed" };
  }
  if (!picked || typeof picked !== "string") return { cancelled: true };
  return { path: picked };
}
