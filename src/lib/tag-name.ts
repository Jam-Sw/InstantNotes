export function normalizeTagInput(raw: string): string | null {
  const trimmed = raw.trim();
  const withoutHash = trimmed.startsWith("#") ? trimmed.slice(1) : trimmed;
  const result = withoutHash.trim();
  return result.length > 0 ? result : null;
}
