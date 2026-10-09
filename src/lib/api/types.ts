import type { ErrorCode } from "./error-codes";
import type { FeedbackCategory } from "$lib/feedback";

export type ContentKind = "document" | "whiteboard" | "sheet";

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
  surfaceData?: string | null;
}

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
  contentKind?: ContentKind;
  surfaceData?: string;
  expectedUpdatedAt?: string;
}

export interface NoteFilter {
  query?: string;
  tagIds?: string[];
  workspaceId?: string;
  isPinned?: boolean;
  isArchived?: boolean;
  isDeleted?: boolean;
  neverOpened?: boolean;
  createdBefore?: string;
  revisit?: boolean;
  sortBy?: "updatedAt" | "createdAt" | "lastOpenedAt" | "title";
  sortOrder?: "asc" | "desc";
  limit?: number;
  offset?: number;
  bodyChars?: number;
}

export interface SearchResult {
  noteId: string;
  title: string;
  excerpt: string;
  score: number;
  updatedAt: string;
}

export interface CaptureLatencySummary {
  lastMs: number | null;
  medianMs: number | null;
  samples: number;
}

export interface TagSuggestion {
  tag: string;
  probability: number;
  reasons: string[];
}

export interface ShortcutFailure {
  label: string;
  wayland: boolean;
}

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

export interface FeedbackInput {
  category: FeedbackCategory;
  message: string;
  appVersion?: string | null;
  diagnostics?: unknown;
}

export interface VaultStatus {
  path: string | null;
  pending: number;
  lastError: string | null;
  lastFlushedAt: string | null;
}

export interface VaultReport {
  checked: number;
  missing: string[];
  diverged: string[];
  orphans: string[];
  pending: number;
  manifestOk: boolean;
}

export interface StickyPreview {
  id: string;
  title: string;
  text: string;
  color: string | null;
  createdAt: string;
  updatedAt: string;
  images: number;
  imported: boolean;
}

export interface StickiesScan {
  folder: string;
  readable: boolean;
  stickies: StickyPreview[];
}

export interface ImportOutcome {
  imported: number;
  skipped: number;
  workspaceId: string | null;
}

export interface AttachmentCleanup {
  count: number;
  bytes: number;
}

export interface LibraryGraph {
  notes: { id: string; title: string; contentKind: ContentKind; isPinned: boolean }[];
  tags: { id: string; name: string; color?: string | null }[];
  spaces: { id: string; name: string }[];
  links: {
    noteId: string;
    targetId: string;
    kind: "tag" | "space";
    source?: "inline" | "manual" | null;
  }[];
}

export interface SpaceSuggestion {
  noteId: string;
  noteTitle: string;
  spaceId: string;
  spaceName: string;
  probability: number;
  reasons: SuggestionReason[];
}

interface SuggestionReason {
  label: string;
  kind: "tag" | "word";
}
