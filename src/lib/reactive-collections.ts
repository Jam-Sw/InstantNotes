// Svelte 5 runes track reassignment of a $state Map or Set, not in-place
// mutation. These return a fresh collection so `store.x = withMapEntry(store.x,
// ...)` triggers an update, keeping the copy-then-mutate boilerplate (and the
// easy-to-forget reassignment) out of the call sites.

export function withMapEntry<K, V>(
  map: ReadonlyMap<K, V>,
  key: K,
  value: V,
): Map<K, V> {
  return new Map(map).set(key, value);
}

export function withoutMapKeys<K, V>(
  map: ReadonlyMap<K, V>,
  keys: Iterable<K>,
): Map<K, V> {
  const next = new Map(map);
  for (const key of keys) next.delete(key);
  return next;
}

export function withSetEntry<T>(set: ReadonlySet<T>, value: T): Set<T> {
  return new Set(set).add(value);
}

export function withoutSetEntries<T>(
  set: ReadonlySet<T>,
  values: Iterable<T>,
): Set<T> {
  const next = new Set(set);
  for (const value of values) next.delete(value);
  return next;
}
