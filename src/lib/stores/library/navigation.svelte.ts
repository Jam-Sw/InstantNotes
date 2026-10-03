// The library's navigation: which primary view is showing (All Notes, one
// Space, one tag, Revisit, the Graph), the status filter within it, and the
// tag chip scoped inside a Space.

import type { NoteFilter } from "$lib/api/types";

// Archived and trash are a list filter in All Notes, not top-level sections.
export type StatusFilter = "active" | "archived" | "trash";

/** The Revisit query: only the flag, which core expands into the open loops
 *  (never-opened captures old enough to resurface), the same list the MCP tool gets. */
export function revisitFilter(): NoteFilter {
  return { revisit: true };
}

export class NavigationModel {
  statusFilter = $state<StatusFilter>("active");
  activeWorkspaceId = $state<string | null>(null);
  activeTagId = $state<string | null>(null);
  // Tag filter applied within the active workspace (the note list's chip
  // row). Composes with activeWorkspaceId; the global activeTagId replaces
  // the workspace instead.
  scopedTagId = $state<string | null>(null);
  revisitMode = $state(false);
  /** The Graph view: the library drawn as notes, tags, and Spaces. */
  graphMode = $state(false);

  /** Clear every primary dimension so a caller can set exactly one. */
  reset(): void {
    this.activeWorkspaceId = null;
    this.activeTagId = null;
    this.scopedTagId = null;
    this.revisitMode = false;
    this.graphMode = false;
    this.statusFilter = "active";
  }

  showGraph(): void {
    this.reset();
    this.graphMode = true;
  }

  showWorkspace(id: string | null): void {
    this.reset();
    this.activeWorkspaceId = id;
  }

  showRevisit(): void {
    this.reset();
    this.revisitMode = true;
  }

  showTag(id: string | null): void {
    this.reset();
    this.activeTagId = id;
  }

  /** Status composes with the active space or tag; it only leaves revisit
   *  and the graph. */
  setStatus(filter: StatusFilter): void {
    this.statusFilter = filter;
    this.revisitMode = false;
    this.graphMode = false;
  }

  /** Toggle a chip inside the active workspace. False when there is no
   *  active workspace, so the caller does nothing. */
  toggleScopedTag(tagId: string): boolean {
    if (!this.activeWorkspaceId) return false;
    this.scopedTagId = this.scopedTagId === tagId ? null : tagId;
    return true;
  }

  filter(): NoteFilter {
    if (this.revisitMode) return revisitFilter();
    const f: NoteFilter = {};
    if (this.statusFilter === "archived") f.isArchived = true;
    if (this.statusFilter === "trash") f.isDeleted = true;
    if (this.activeWorkspaceId) {
      f.workspaceId = this.activeWorkspaceId;
      if (this.scopedTagId) f.tagIds = [this.scopedTagId];
    }
    if (this.activeTagId) f.tagIds = [this.activeTagId];
    return f;
  }
}
