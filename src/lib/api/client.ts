// The only caller of Tauri `invoke` in the app (staff-engineer convention).
// Every command is a typed wrapper; errors become ApiError with API.md codes.

import { invoke } from "@tauri-apps/api/core";
import type {
  CaptureLatencySummary,
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

async function call<T>(
  cmd: string,
  args?: Record<string, unknown>,
): Promise<T> {
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
// Returns the member note ids (including archived and trashed members) so
// the caller can offer an undo that restores every membership.
export const deleteWorkspace = (id: string) =>
  call<string[]>("delete_workspace", { id });
// Tags on the workspace's visible notes, counts scoped to the workspace.
export const listWorkspaceTags = (workspaceId: string) =>
  call<TagWithCount[]>("list_workspace_tags", { workspaceId });
export const addNoteToWorkspace = (noteId: string, workspaceId: string) =>
  call<void>("add_note_to_workspace", { noteId, workspaceId });
export const removeNoteFromWorkspace = (noteId: string, workspaceId: string) =>
  call<void>("remove_note_from_workspace", { noteId, workspaceId });
export const workspacesForNote = (noteId: string) =>
  call<Workspace[]>("workspaces_for_note", { noteId });

// ---- capture latency ----
// Reports that the capture textarea is focused and painted; the backend
// turns the pending reveal stamp into one latency sample.
export const captureInputReady = () =>
  call<number | null>("capture_input_ready");
export const getCaptureLatency = () =>
  call<CaptureLatencySummary>("get_capture_latency");

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
export const openUrl = (url: string) => call<void>("open_url", { url });
// Apply (or clear, with null) a native macOS vibrancy material on the library
// window. A no-op off macOS; the material string is one of theme MATERIAL_KEYS.
export const setWindowVibrancy = (material: string | null) =>
  call<void>("set_window_vibrancy", { material });
// Match the native library window theme (titlebar / traffic-light treatment) to
// the in-app variant. A no-op off macOS; the capture window is left alone.
export const setWindowTheme = (variant: "light" | "dark") =>
  call<void>("set_window_theme", { variant });

// ---- theme files ----
// Byte I/O for portable .intheme.json files; the open/save dialog runs in JS.
export const exportThemeFile = (path: string, contents: string) =>
  call<void>("export_theme_file", { path, contents });
export const importThemeFile = (path: string) =>
  call<string>("import_theme_file", { path });

// ---- note export ----
export const exportNoteFile = (path: string, contents: string) =>
  call<void>("export_note_file", { path, contents });

// ---- attachments ----
// Raw-body invoke: image bytes go over IPC as-is (no JSON number array), with
// the extension in a header. Returns the stored filename; notes reference it
// as `attachments/<name>`.
export const saveAttachment = async (
  bytes: Uint8Array,
  ext: string,
): Promise<string> => {
  try {
    return await invoke<string>("save_attachment", bytes, {
      headers: { "x-attachment-ext": ext },
    });
  } catch (e) {
    if (e && typeof e === "object" && "code" in e && "message" in e) {
      throw new ApiError(String(e.code), String(e.message));
    }
    throw new ApiError("STORAGE_ERROR", String(e));
  }
};
export const getAttachmentsDir = () => call<string>("get_attachments_dir");

// ---- app lifecycle ----
// Answer to "app:quit-requested": pending edits are flushed, exit for real now.
export const quitApp = () => call<void>("quit_app");
// Label of the capture shortcut when startup registration failed, else null.
// A command rather than an event alone: the failure happens before the library
// webview has listeners attached, so an event would be lost.
export const getShortcutFailure = () =>
  call<string | null>("get_shortcut_failure");
