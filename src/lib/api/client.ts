// The only caller of Tauri `invoke` in the app (staff-engineer convention).
// Every command is a typed wrapper; errors become ApiError with API.md codes.

import { Channel, invoke } from "@tauri-apps/api/core";
import type { DownloadEvent } from "@tauri-apps/plugin-updater";
import { ERROR_CODES, isErrorCode, type ErrorCode } from "./error-codes";
import type {
  AgentActivity,
  AgentConnection,
  AgentPresence,
  AgentWire,
  NoteSnapshot,
} from "$lib/agent-activity";
import type {
  AttachmentCleanup,
  LibraryGraph,
  CaptureLatencySummary,
  CreateNoteInput,
  DashboardStats,
  FeedbackInput,
  ImportOutcome,
  Note,
  NoteFilter,
  SearchResult,
  SpaceSuggestion,
  StickyLevel,
  StickiesScan,
  Tag,
  TagWithCount,
  UpdateNotePatch,
  VaultReport,
  VaultStatus,
  Workspace,
  WorkspaceWithCount,
} from "./types";

export class ApiError extends Error {
  code: ErrorCode;
  constructor(code: ErrorCode, message: string) {
    super(message);
    this.name = "ApiError";
    this.code = code;
  }
}

// The one place a rejection becomes an ApiError, so an unknown code can only
// be mishandled once. A rejection that is not the { code, message } shape
// never left the core (a dropped IPC call, a thrown string), which is a
// failure to complete the operation: STORAGE_ERROR.
function asApiError(e: unknown): ApiError {
  if (e && typeof e === "object" && "code" in e && "message" in e) {
    const code = String(e.code);
    const message = String(e.message);
    if (isErrorCode(code)) return new ApiError(code, message);
    // The backend sent a code this build does not know, so no friendly copy
    // exists for it; keep it in the message rather than losing it.
    return new ApiError(ERROR_CODES.STORAGE_ERROR, `${code}: ${message}`);
  }
  return new ApiError(ERROR_CODES.STORAGE_ERROR, String(e));
}

async function call<T>(
  cmd: string,
  args?: Record<string, unknown>,
): Promise<T> {
  try {
    return await invoke<T>(cmd, args);
  } catch (e) {
    throw asApiError(e);
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
export const libraryGraph = () => call<LibraryGraph>("library_graph");
// Where each live note in no Space most likely belongs, newest note first,
// judged from the tags and words it shares with the notes already filed.
// Nothing is trained: filing the note is what teaches it.
export const spaceSuggestions = () => call<SpaceSuggestion[]>("space_suggestions");
// "Not this one": the pair stays out of the suggestions from then on, and
// its Undo brings it back.
export const dismissSpaceSuggestion = (noteId: string, spaceId: string) =>
  call<void>("dismiss_space_suggestion", { noteId, spaceId });
export const restoreSpaceSuggestion = (noteId: string, spaceId: string) =>
  call<void>("restore_space_suggestion", { noteId, spaceId });
export const listNotes = (filter: NoteFilter = {}) =>
  call<Note[]>("list_notes", { filter });
export const searchNotes = (text: string, limit = 50) =>
  call<SearchResult[]>("search_notes", { text, limit });

// Bulk variants: one transaction and one change event for a whole multi-select.
export const setNotesFlags = (
  ids: string[],
  flags: { isPinned?: boolean; isArchived?: boolean },
) =>
  call<void>("set_notes_flags", {
    ids,
    isPinned: flags.isPinned ?? null,
    isArchived: flags.isArchived ?? null,
  });
export const softDeleteNotes = (ids: string[]) =>
  call<void>("soft_delete_notes", { ids });
export const restoreNotes = (ids: string[]) =>
  call<void>("restore_notes", { ids });
export const destroyNotes = (ids: string[], confirm: boolean) =>
  call<void>("destroy_notes", { ids, confirm });

// ---- tags ----
export const listTags = () => call<TagWithCount[]>("list_tags");
export const updateTag = (id: string, name?: string, color?: string) =>
  call<Tag>("update_tag", { id, name, color });
export const deleteTag = (id: string) => call<void>("delete_tag", { id });
export const addTagToNote = (noteId: string, name: string) =>
  call<Tag>("add_tag_to_note", { noteId, name });
export const removeTagFromNote = (noteId: string, tagId: string) =>
  call<void>("remove_tag_from_note", { noteId, tagId });
export const tagsForNote = (noteId: string) =>
  call<Tag[]>("tags_for_note", { noteId });

// ---- workspaces (the UI calls these "Spaces") ----
// GLOSSARY / naming boundary: the product term is "Space" everywhere the user
// sees it (sidebar, copy, component names); the command strings, storage
// tables, and these wrapper names keep "workspace". This file is the single
// place the two vocabularies meet, by decision: renaming the storage internals
// is churn with no user value (see openspec/project.md and
// docs/superpowers/specs/2026-07-10-spaces-design.md). One concept, two names,
// documented here so no layer has to guess which it is in.
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

// ---- updates ----
// Download, verify, and install the update a plugin `check()` returned (its
// resource id). Stands in for `Update.downloadAndInstall` so an AppImage in a
// root-owned folder can be installed through the system password prompt.
export const installUpdate = (
  rid: number,
  onEvent: (event: DownloadEvent) => void,
) => {
  const channel = new Channel<DownloadEvent>();
  channel.onmessage = onEvent;
  return call<void>("install_update", { rid, onEvent: channel });
};
// Apply (or clear, with null) a native macOS vibrancy material on the library
// window. A no-op off macOS; the material string is one of theme MATERIAL_KEYS.
export const setWindowVibrancy = (material: string | null) =>
  call<void>("set_window_vibrancy", { material });
// Match the native library window theme (titlebar / traffic-light treatment) to
// the in-app variant. A no-op off macOS; the capture window is left alone.
export const setWindowTheme = (variant: "light" | "dark") =>
  call<void>("set_window_theme", { variant });

// ---- stickies ----
// A sticky is a note popped out into its own window, which is then that
// note's only editor. Popping in resolves once the sticky's edits are on disk
// and its window is gone. The level and geometry commands act on the calling
// sticky window, never on an id the webview names.
export const popOutNote = (id: string) => call<void>("pop_out_note", { id });
export const popInNote = (id: string) => call<void>("pop_in_note", { id });
export const listStickies = () => call<string[]>("list_stickies");
export const answerPopIn = (saved: boolean) => call<void>("answer_pop_in", { saved });
export const getStickyView = () =>
  call<{ level: StickyLevel; collapsed: boolean }>("get_sticky_view");
export const setStickyLevel = (level: StickyLevel) =>
  call<void>("set_sticky_level", { level });
export const setStickyCollapsed = (collapsed: boolean) =>
  call<void>("set_sticky_collapsed", { collapsed });
export const saveStickyGeometry = () => call<void>("save_sticky_geometry");

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
    throw asApiError(e);
  }
};
export const getAttachmentsDir = () => call<string>("get_attachments_dir");
// Copy a dialog-picked image into attachments (the "copy in" storage mode);
// returns the stored filename. `allow` opens one existing local image to the
// asset protocol so a linked (not copied) image can render inline.
export const importImageFile = (path: string) =>
  call<string>("import_image_file", { path });
export const allowImageFile = (path: string) =>
  call<void>("allow_image_file", { path });
export const openAttachmentsFolder = () =>
  call<void>("open_attachments_folder");
// Images no note references any more (older than an hour), and removing
// them along with their unchanged copies in the live vault.
export const unusedAttachments = () => call<AttachmentCleanup>("unused_attachments");
export const removeUnusedAttachments = () =>
  call<AttachmentCleanup>("remove_unused_attachments");

// ---- vault export ----
// Stage 1 of the portable vault (openspec/changes/feat-portable-vault-sync):
// a one-way, read-only snapshot. SQLite stays authoritative; nothing reads
// this folder back yet. The destination is chosen by a native folder-picker
// dialog in JS, same trust boundary as exportNoteFile.
export const exportVault = (dest: string) => call<void>("export_vault", { dest });

// ---- live vault mirror ----
// Stage 2: every change is written into the chosen folder shortly after it
// happens. SQLite stays authoritative; the folder is written, never read.
export const getVaultStatus = () => call<VaultStatus>("get_vault_status");
/** Start, move, or (with null) stop the mirror. */
export const setVaultFolder = (path: string | null) =>
  call<VaultStatus>("set_vault_folder", { path });
export const verifyVault = () => call<VaultReport>("verify_vault");

// ---- import (Settings > Import) ----
// The folder comes from a native folder picker, which is also what lets the
// app read another app's data on macOS. Rust only ever reads it.
/** Where Stickies keeps its notes, for the picker to open at; null off macOS. */
export const stickiesLocation = () => call<string | null>("stickies_location");
export const scanStickies = (folder: string) => call<StickiesScan>("scan_stickies", { folder });
export const importStickies = (folder: string, ids: string[], space: string | null) =>
  call<ImportOutcome>("import_stickies", { folder, ids, space });

// ---- dashboard + feedback ----
export const getLibraryStats = () => call<DashboardStats>("library_stats");
export const submitFeedback = (input: FeedbackInput) =>
  call<void>("submit_feedback", { input });
export const openFeedbackLog = () => call<void>("open_feedback_log");

// ---- app lifecycle ----
// Answer to "app:quit-requested": pending edits are flushed, exit for real now.
export const quitApp = () => call<void>("quit_app");
// Label of the capture shortcut when startup registration failed, else null.
// A command rather than an event alone: the failure happens before the library
// webview has listeners attached, so an event would be lost.
export const getShortcutFailure = () =>
  call<string | null>("get_shortcut_failure");

// ---- agents ----
// The app executable (which is also the MCP server) and the live library, so
// Settings > Agents prints a connect command that works as shown.
export const getAgentConnection = () =>
  call<AgentConnection>("agent_connection");
// The trace of agent calls (newest first), what a write replaced, and the
// undo of one write. A revert is itself a traced write.
export const listAgentActivity = (limit = 200, offset = 0) =>
  call<AgentActivity[]>("list_agent_activity", { limit, offset });
export const agentActivityBefore = (seq: number) =>
  call<NoteSnapshot | null>("agent_activity_before", { seq });
// Every known agent connection, newest first, each with whether its process
// is alive right now.
export const listAgentSessions = () => call<AgentPresence[]>("list_agent_sessions");
// The raw exchange behind a call: the JSON-RPC request and response as JSON
// text, or null where none was kept.
export const agentActivityWire = (seq: number) =>
  call<AgentWire>("agent_activity_wire", { seq });
export const revertAgentActivity = (seq: number) =>
  call<AgentActivity>("revert_agent_activity", { seq });
export const clearAgentActivity = () => call<void>("clear_agent_activity");
