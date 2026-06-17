// Shared font stacks for built-in themes. Matches the baseline stacks the app
// shipped with so the default look is unchanged when no custom font is set.

export const SANS_STACK =
  '-apple-system, BlinkMacSystemFont, "SF Pro Text", "Helvetica Neue", sans-serif';
export const MONO_STACK = 'ui-monospace, "SF Mono", Menlo, monospace';

/** Curated list of macOS body fonts the user can pick at runtime. Each entry
 *  overrides --font-body independently of the active theme. */
export const BODY_FONTS = [
  { id: "system", label: "SF Pro (System)", value: SANS_STACK },
  { id: "new-york", label: "New York", value: '"New York", "Georgia", serif' },
  { id: "georgia", label: "Georgia", value: "Georgia, serif" },
  { id: "helvetica", label: "Helvetica Neue", value: '"Helvetica Neue", Helvetica, sans-serif' },
  { id: "sf-mono", label: "SF Mono", value: MONO_STACK },
  { id: "courier", label: "Courier New", value: '"Courier New", Courier, monospace' },
] as const;

export type BodyFontId = (typeof BODY_FONTS)[number]["id"];
