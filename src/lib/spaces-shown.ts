import type { WorkspaceWithCount } from "$lib/api/types";

export const SPACES_SHOWN = 6;

export function spacesShown(
  spaces: WorkspaceWithCount[],
  activeId: string | null,
  limit = SPACES_SHOWN,
): WorkspaceWithCount[] {
  if (spaces.length <= limit + 1) return spaces;
  const largest = new Set(
    [...spaces]
      .sort((a, b) => b.noteCount - a.noteCount)
      .slice(0, limit)
      .map((s) => s.id),
  );
  return spaces.filter((s) => largest.has(s.id) || s.id === activeId);
}
