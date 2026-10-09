import type { NoteFilter } from "$lib/api/types";

export type StatusFilter = "active" | "archived" | "trash";

export function revisitFilter(): NoteFilter {
  return { revisit: true };
}

export class NavigationModel {
  statusFilter = $state<StatusFilter>("active");
  activeWorkspaceId = $state<string | null>(null);
  activeTagId = $state<string | null>(null);
  scopedTagId = $state<string | null>(null);
  revisitMode = $state(false);
  graphMode = $state(false);

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

  setStatus(filter: StatusFilter): void {
    this.statusFilter = filter;
    this.revisitMode = false;
    this.graphMode = false;
  }

  toggleScopedTag(tagId: string): boolean {
    if (!this.activeWorkspaceId) return false;
    this.scopedTagId = this.scopedTagId === tagId ? null : tagId;
    return true;
  }

  viewKey(): string | null {
    if (this.graphMode) return null;
    if (this.revisitMode) return "revisit";
    if (this.activeTagId) return `tag:${this.activeTagId}`;
    return `space:${this.activeWorkspaceId ?? "all"}:${this.statusFilter}:${this.scopedTagId ?? ""}`;
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
