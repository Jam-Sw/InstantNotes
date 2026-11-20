export function toggleSelection(
  selected: ReadonlySet<string>,
  id: string,
): Set<string> {
  const next = new Set(selected);
  if (next.has(id)) {
    next.delete(id);
  } else {
    next.add(id);
  }
  return next;
}

export function rangeSelection(
  ids: readonly string[],
  anchorId: string | null,
  targetId: string,
): Set<string> {
  const anchor = anchorId === null ? -1 : ids.indexOf(anchorId);
  const target = ids.indexOf(targetId);
  if (anchor === -1 || target === -1) return new Set([targetId]);
  const [lo, hi] = anchor <= target ? [anchor, target] : [target, anchor];
  return new Set(ids.slice(lo, hi + 1));
}

export function stepId(
  ids: readonly string[],
  currentId: string | null,
  delta: number,
): string | null {
  if (ids.length === 0) return null;
  const current = currentId === null ? -1 : ids.indexOf(currentId);
  if (current === -1) return ids[0];
  const next = Math.min(Math.max(current + delta, 0), ids.length - 1);
  return ids[next];
}
