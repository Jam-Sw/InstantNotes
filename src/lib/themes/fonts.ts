export const SANS_STACK =
  '-apple-system, BlinkMacSystemFont, "SF Pro Text", "Segoe UI", "Noto Sans", "Helvetica Neue", Helvetica, Arial, sans-serif';
export const MONO_STACK =
  'ui-monospace, "SF Mono", Menlo, Consolas, "Liberation Mono", monospace';

export const BODY_FONTS = [
  { id: "system", label: "SF Pro (System)", value: SANS_STACK },
  { id: "new-york", label: "New York", value: '"New York", "Georgia", serif' },
  { id: "georgia", label: "Georgia", value: "Georgia, serif" },
  { id: "helvetica", label: "Helvetica Neue", value: '"Helvetica Neue", Helvetica, sans-serif' },
  { id: "sf-mono", label: "SF Mono", value: MONO_STACK },
  { id: "courier", label: "Courier New", value: '"Courier New", Courier, monospace' },
] as const;

export type BodyFontId = (typeof BODY_FONTS)[number]["id"];
