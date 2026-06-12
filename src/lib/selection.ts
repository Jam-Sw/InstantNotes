// Pure multi-selection logic for the note list. The store owns the state;
// these helpers only compute the next selection from an ordered id list.

/** Toggle membership of `id`, returning a new set. */
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

/**
 * Inclusive range between `anchorId` and `targetId` in list order.
 * Falls back to just the target when the anchor is missing from `ids`.
 */
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

/**
 * Id `delta` rows away from `currentId`, clamped to the list. Starts from the
 * first row when there is no current id; null only for an empty list.
 */
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
