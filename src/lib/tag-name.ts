// Client-side pre-check for a tag rename input, before it is sent to the
// backend. `store::update_tag` (via `domain::normalize_tag_name`) is the
// source of truth for the canonical form: lowercase, collapsed whitespace,
// all leading '#' stripped. This only trims, strips one leading '#', and
// rejects an empty result, so the UI can refuse an obviously-empty commit
// without a round trip; the server-normalized name comes back on refresh.
export function normalizeTagInput(raw: string): string | null {
  const trimmed = raw.trim();
  const withoutHash = trimmed.startsWith("#") ? trimmed.slice(1) : trimmed;
  const result = withoutHash.trim();
  return result.length > 0 ? result : null;
}
