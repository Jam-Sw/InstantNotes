// IPC contract types shared by the Svelte UI and the Rust desktop layer.
// Field names are camelCase over the wire (serde).

/** A Markdown document, or a whiteboard whose text is kept in `body`. */
export type ContentKind = "document" | "whiteboard";

export interface Note {
  id: string;
  title: string;
  body: string;
  createdAt: string;
  updatedAt: string;
  lastOpenedAt?: string | null;
  isPinned: boolean;
  isArchived: boolean;
  isDeleted: boolean;
  deletedAt?: string | null;
  contentKind: ContentKind;
  /** A whiteboard's canvas (JSON). Only `getNote` carries it: list rows and
   *  `updateNote`'s reply leave it out, since a board can hold images. */
  surfaceData?: string | null;
}

export interface Tag {
  id: string;
  name: string;
  color?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface TagWithCount extends Tag {
  usageCount: number;
}

export interface Workspace {
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
}

export interface WorkspaceWithCount extends Workspace {
  noteCount: number;
}

export interface CreateNoteInput {
  title?: string;
  body?: string;
  tags?: string[];
}

export interface UpdateNotePatch {
  title?: string;
  body?: string;
  isPinned?: boolean;
  isArchived?: boolean;
  /** Only ever "whiteboard": converting is one-way. */
  contentKind?: ContentKind;
  /** A whiteboard's canvas; rejected on a document. */
  surfaceData?: string;
}

export interface NoteFilter {
  query?: string;
  tagIds?: string[];
  workspaceId?: string;
  isPinned?: boolean;
  isArchived?: boolean;
  isDeleted?: boolean;
  /** Only notes never opened in the library (capture-born, untriaged). */
  neverOpened?: boolean;
  /** Only notes created strictly before this ISO-8601 timestamp. */
  createdBefore?: string;
  sortBy?: "updatedAt" | "createdAt" | "lastOpenedAt" | "title";
  sortOrder?: "asc" | "desc";
  limit?: number;
  offset?: number;
}

export interface SearchResult {
  noteId: string;
  title: string;
  excerpt: string;
  score: number;
  updatedAt: string;
}

export interface AppErrorPayload {
  code: string;
  message: string;
}

/** Reveal-to-input-ready timing for the capture panel (no note content). */
export interface CaptureLatencySummary {
  lastMs: number | null;
  medianMs: number | null;
  samples: number;
}

/** Aggregate library + attachment counts for the Settings dashboard. */
export interface DashboardStats {
  notesTotal: number;
  notesActive: number;
  notesPinned: number;
  notesArchived: number;
  notesTrashed: number;
  tags: number;
  spaces: number;
  attachmentsCount: number;
  attachmentsBytes: number;
}

/** One in-app feedback submission, persisted to the local log by the backend. */
export interface FeedbackInput {
  category: string;
  message: string;
  appVersion?: string | null;
  /** Opt-in diagnostics snapshot the user agreed to attach. */
  diagnostics?: unknown;
}

/** The live vault mirror (API.md §12). `path` is null when mirroring is off. */
export interface VaultStatus {
  path: string | null;
  /** Notes changed since their file was last written. */
  pending: number;
  lastError: string | null;
  lastFlushedAt: string | null;
}

/** A read-only comparison of the vault folder with the library. Paths are
 *  relative to the vault folder. */
export interface VaultReport {
  checked: number;
  /** Notes whose file is gone. */
  missing: string[];
  /** Files that no longer match their note (edited outside the app). */
  diverged: string[];
  /** Markdown files in the folder that are not notes the mirror wrote. */
  orphans: string[];
  pending: number;
  manifestOk: boolean;
}

/** What an attachment cleanup removed, or would remove. */
export interface AttachmentCleanup {
  count: number;
  bytes: number;
}
