// IPC contract types shared by the Svelte UI and the Rust desktop layer.
// Field names are camelCase over the wire (serde).

import type { ErrorCode } from "./error-codes";
import type { FeedbackCategory } from "$lib/feedback";

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

/** Where a sticky sits: above every window, as an ordinary window, or below
 *  every window like a desktop widget. */
export type StickyLevel = "float" | "normal" | "desktop";

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
  /** Apply only if the note's updatedAt still equals this; CONFLICT if not. */
  expectedUpdatedAt?: string;
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
  code: ErrorCode;
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
  category: FeedbackCategory;
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

/** One Apple Sticky as Settings > Import previews it (API.md §16). */
export interface StickyPreview {
  id: string;
  /** The title the note will get. */
  title: string;
  /** The start of the note's Markdown. */
  text: string;
  /** The sticky's paper, `#rrggbb`, when Stickies recorded it. */
  color: string | null;
  createdAt: string;
  updatedAt: string;
  images: number;
  /** Imported before, and its note still exists. */
  imported: boolean;
}

/** A Stickies folder, read. `readable` is false when macOS refused access. */
export interface StickiesScan {
  folder: string;
  readable: boolean;
  stickies: StickyPreview[];
}

export interface ImportOutcome {
  imported: number;
  /** Imported before, and their note still exists. */
  skipped: number;
  /** The Space they were filed in, when one was named and any landed. */
  workspaceId: string | null;
}

/** What an attachment cleanup removed, or would remove. */
export interface AttachmentCleanup {
  count: number;
  bytes: number;
}

/** The library as a graph: live notes, the tags and Spaces they carry, and
 *  one link per membership. Derived on every read; nothing is stored. */
export interface LibraryGraph {
  notes: { id: string; title: string; contentKind: ContentKind; isPinned: boolean }[];
  tags: { id: string; name: string; color?: string | null }[];
  spaces: { id: string; name: string }[];
  /** A tag link says how it got there: written in the text (`inline`) or
   *  added to the note (`manual`). A Space link has no source. */
  links: {
    noteId: string;
    targetId: string;
    kind: "tag" | "space";
    source?: "inline" | "manual" | null;
  }[];
}

/** Where an unfiled note most likely belongs: one Space, how sure the model
 *  is (0 to 1), and the evidence, strongest first (API.md section 4). */
export interface SpaceSuggestion {
  noteId: string;
  noteTitle: string;
  spaceId: string;
  spaceName: string;
  probability: number;
  reasons: SuggestionReason[];
}

/** One reason behind a suggestion: a tag the note carries (label with its
 *  `#`) or a word in its text. */
export interface SuggestionReason {
  label: string;
  kind: "tag" | "word";
}
