// The only caller of Tauri `invoke` in the app (staff-engineer convention).
// Every command is a typed wrapper; errors become ApiError with API.md codes.

import { invoke } from "@tauri-apps/api/core";
import type {
  CreateNoteInput,
  Note,
  NoteFilter,
  SearchResult,
  Tag,
  TagWithCount,
  UpdateNotePatch,
  Workspace,
  WorkspaceWithCount,
} from "./types";

export class ApiError extends Error {
  code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = "ApiError";
    this.code = code;
  }
}

async function call<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  try {
    return await invoke<T>(cmd, args);
  } catch (e) {
    if (e && typeof e === "object" && "code" in e && "message" in e) {
      throw new ApiError(String(e.code), String(e.message));
    }
    throw new ApiError("STORAGE_ERROR", String(e));
  }
}

// ---- notes ----
export const createNote = (input: CreateNoteInput) =>
  call<Note>("create_note", { input });
export const getNote = (id: string, touch = false) =>
  call<Note>("get_note", { id, touch });
export const updateNote = (id: string, patch: UpdateNotePatch) =>
  call<Note>("update_note", { id, patch });
export const softDeleteNote = (id: string) =>
  call<Note>("soft_delete_note", { id });
export const restoreNote = (id: string) => call<Note>("restore_note", { id });
export const permanentlyDeleteNote = (id: string, confirm: boolean) =>
  call<void>("permanently_delete_note", { id, confirm });
export const listNotes = (filter: NoteFilter = {}) =>
  call<Note[]>("list_notes", { filter });
export const searchNotes = (text: string, limit = 50) =>
  call<SearchResult[]>("search_notes", { text, limit });

// ---- tags ----
export const listTags = () => call<TagWithCount[]>("list_tags");
export const getOrCreateTag = (name: string) =>
  call<Tag>("get_or_create_tag", { name });
export const updateTag = (id: string, name?: string, color?: string) =>
  call<Tag>("update_tag", { id, name, color });
export const deleteTag = (id: string) => call<void>("delete_tag", { id });
export const addTagToNote = (noteId: string, name: string) =>
  call<Tag>("add_tag_to_note", { noteId, name });
export const removeTagFromNote = (noteId: string, tagId: string) =>
  call<void>("remove_tag_from_note", { noteId, tagId });
export const tagsForNote = (noteId: string) =>
  call<Tag[]>("tags_for_note", { noteId });

// ---- workspaces ----
export const listWorkspaces = () =>
  call<WorkspaceWithCount[]>("list_workspaces");
export const getOrCreateWorkspace = (name: string) =>
  call<Workspace>("get_or_create_workspace", { name });
export const renameWorkspace = (id: string, name: string) =>
  call<Workspace>("rename_workspace", { id, name });
export const deleteWorkspace = (id: string) =>
  call<void>("delete_workspace", { id });
export const addNoteToWorkspace = (noteId: string, workspaceId: string) =>
  call<void>("add_note_to_workspace", { noteId, workspaceId });
export const removeNoteFromWorkspace = (noteId: string, workspaceId: string) =>
  call<void>("remove_note_from_workspace", { noteId, workspaceId });
export const workspacesForNote = (noteId: string) =>
  call<Workspace[]>("workspaces_for_note", { noteId });

// ---- settings ----
export const getSetting = <T>(key: string) =>
  call<T | null>("get_setting", { key });
export const setSetting = (key: string, value: unknown) =>
  call<void>("set_setting", { key, value });
export const deleteSetting = (key: string) =>
  call<void>("delete_setting", { key });

// ---- windows ----
export const hideCapture = () => call<void>("hide_capture");
export const openLibrary = () => call<void>("open_library");
// Apply (or clear, with null) a native macOS vibrancy material on the library
// window. A no-op off macOS; the material string is one of theme MATERIAL_KEYS.
export const setWindowVibrancy = (material: string | null) =>
  call<void>("set_window_vibrancy", { material });

// ---- theme files ----
// Byte I/O for portable .intheme.json files; the open/save dialog runs in JS.
export const exportThemeFile = (path: string, contents: string) =>
  call<void>("export_theme_file", { path, contents });
export const importThemeFile = (path: string) =>
  call<string>("import_theme_file", { path });
