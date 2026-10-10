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
  ShortcutFailure,
  SpaceSuggestion,
  StickyLevel,
  StickiesScan,
  TagSuggestion,
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

function asApiError(e: unknown): ApiError {
  if (e && typeof e === "object" && "code" in e && "message" in e) {
    const code = String(e.code);
    const message = String(e.message);
    if (isErrorCode(code)) return new ApiError(code, message);
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

export const createNote = (input: CreateNoteInput) =>
  call<Note>("create_note", { input });
export const getNote = (id: string, touch = false) =>
  call<Note>("get_note", { id, touch });
export const updateNote = (id: string, patch: UpdateNotePatch) =>
  call<Note>("update_note", { id, patch });
export const softDeleteNote = (id: string) =>
  call<Note>("soft_delete_note", { id });
export const restoreNote = (id: string) => call<Note>("restore_note", { id });
export const libraryGraph = () => call<LibraryGraph>("library_graph");
export const spaceSuggestions = () => call<SpaceSuggestion[]>("space_suggestions");
export const tagSuggestion = (noteId: string) =>
  call<TagSuggestion | null>("tag_suggestion", { noteId });
export const dismissSpaceSuggestion = (noteId: string, spaceId: string) =>
  call<void>("dismiss_space_suggestion", { noteId, spaceId });
export const restoreSpaceSuggestion = (noteId: string, spaceId: string) =>
  call<void>("restore_space_suggestion", { noteId, spaceId });
export const listNotes = (filter: NoteFilter = {}) =>
  call<Note[]>("list_notes", { filter });
export const countNotes = (filter: NoteFilter = {}) =>
  call<number>("count_notes", { filter });
export const searchNotes = (text: string, limit = 50) =>
  call<SearchResult[]>("search_notes", { text, limit });

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

export const listWorkspaces = () =>
  call<WorkspaceWithCount[]>("list_workspaces");
export const getOrCreateWorkspace = (name: string) =>
  call<Workspace>("get_or_create_workspace", { name });
export const renameWorkspace = (id: string, name: string) =>
  call<Workspace>("rename_workspace", { id, name });
export const deleteWorkspace = (id: string) =>
  call<string[]>("delete_workspace", { id });
export const listWorkspaceTags = (workspaceId: string) =>
  call<TagWithCount[]>("list_workspace_tags", { workspaceId });
export const addNoteToWorkspace = (noteId: string, workspaceId: string) =>
  call<void>("add_note_to_workspace", { noteId, workspaceId });
export const removeNoteFromWorkspace = (noteId: string, workspaceId: string) =>
  call<void>("remove_note_from_workspace", { noteId, workspaceId });
export const workspacesForNote = (noteId: string) =>
  call<Workspace[]>("workspaces_for_note", { noteId });

export const captureInputReady = () =>
  call<number | null>("capture_input_ready");
export const getCaptureLatency = () =>
  call<CaptureLatencySummary>("get_capture_latency");

export const getSetting = <T>(key: string) =>
  call<T | null>("get_setting", { key });
export const setSetting = (key: string, value: unknown) =>
  call<void>("set_setting", { key, value });
export const deleteSetting = (key: string) =>
  call<void>("delete_setting", { key });

export const hideCapture = () => call<void>("hide_capture");
export const openLibrary = () => call<void>("open_library");
export const openUrl = (url: string) => call<void>("open_url", { url });

export const installUpdate = (
  rid: number,
  onEvent: (event: DownloadEvent) => void,
) => {
  const channel = new Channel<DownloadEvent>();
  channel.onmessage = onEvent;
  return call<void>("install_update", { rid, onEvent: channel });
};
export const setWindowVibrancy = (material: string | null) =>
  call<void>("set_window_vibrancy", { material });
export const setWindowTheme = (variant: "light" | "dark", background: string | null = null) =>
  call<void>("set_window_theme", { variant, background });

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

export const exportThemeFile = (path: string, contents: string) =>
  call<void>("export_theme_file", { path, contents });
export const importThemeFile = (path: string) =>
  call<string>("import_theme_file", { path });

export const exportNoteFile = (path: string, contents: string) =>
  call<void>("export_note_file", { path, contents });
export const sheetCsv = (id: string) => call<string>("sheet_csv", { id });

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
export const importImageFile = (path: string) =>
  call<string>("import_image_file", { path });
export const allowImageFile = (path: string) =>
  call<void>("allow_image_file", { path });
export const openAttachmentsFolder = () =>
  call<void>("open_attachments_folder");
export const unusedAttachments = () => call<AttachmentCleanup>("unused_attachments");
export const removeUnusedAttachments = () =>
  call<AttachmentCleanup>("remove_unused_attachments");

export const exportVault = (dest: string) => call<void>("export_vault", { dest });

export const getVaultStatus = () => call<VaultStatus>("get_vault_status");
export const setVaultFolder = (path: string | null) =>
  call<VaultStatus>("set_vault_folder", { path });
export const verifyVault = () => call<VaultReport>("verify_vault");

export const stickiesLocation = () => call<string | null>("stickies_location");
export const scanStickies = (folder: string) => call<StickiesScan>("scan_stickies", { folder });
export const importStickies = (folder: string, ids: string[], space: string | null) =>
  call<ImportOutcome>("import_stickies", { folder, ids, space });

export const getLibraryStats = () => call<DashboardStats>("library_stats");
export const submitFeedback = (input: FeedbackInput) =>
  call<void>("submit_feedback", { input });
export const openFeedbackLog = () => call<void>("open_feedback_log");

export const quitApp = () => call<void>("quit_app");
export const restartApp = () => call<void>("restart_app");
export const getShortcutFailure = () =>
  call<ShortcutFailure | null>("get_shortcut_failure");

export const getAgentConnection = () =>
  call<AgentConnection>("agent_connection");
export const listAgentActivity = (limit = 200, offset = 0) =>
  call<AgentActivity[]>("list_agent_activity", { limit, offset });
export const agentActivityBefore = (seq: number) =>
  call<NoteSnapshot | null>("agent_activity_before", { seq });
export const listAgentSessions = () => call<AgentPresence[]>("list_agent_sessions");
export const endAgentSession = (session: string) => call<void>("end_agent_session", { session });
export const agentActivityWire = (seq: number) =>
  call<AgentWire>("agent_activity_wire", { seq });
export const revertAgentActivity = (seq: number) =>
  call<AgentActivity>("revert_agent_activity", { seq });
export const clearAgentActivity = () => call<void>("clear_agent_activity");
