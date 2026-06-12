// IPC contract types shared by the Svelte UI and the Rust desktop layer.
// Field names are camelCase over the wire (serde).

export type SyncState =
  | "local_only"
  | "pending_sync"
  | "synced"
  | "conflict"
  | "sync_error";

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
  syncState: SyncState;
  version: number;
  lastSyncedAt?: string | null;
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
}

export interface NoteFilter {
  query?: string;
  tagIds?: string[];
  isPinned?: boolean;
  isArchived?: boolean;
  isDeleted?: boolean;
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
