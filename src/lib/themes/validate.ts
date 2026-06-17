// Import-only guard. A shared theme is untrusted input that becomes CSS values
// written to :root, so every value is checked against a strict allow-list
// before any token is applied. Built-in themes are typed objects and bypass
// this. The goal is no CSS injection: a hostile file is rejected with a
// friendly message and nothing is applied.

import {
  TOKEN_KEYS,
  MATERIAL_KEYS,
  type Theme,
  type TokenSet,
  type FontSlot,
  type ThemeMaterial,
} from "./types";

export type ValidationResult =
  | { ok: true; theme: Theme }
  | { ok: false; error: string };

// Substrings that have no place in a color/font/length value and that could
// break out of a custom-property declaration or pull in remote content.
const FORBIDDEN = ["url(", "expression(", "@import", "javascript:", "/*", "*/", ";", "{", "}", "<", ">", "\\"];

const COLOR_RE =
  /^(#[0-9a-fA-F]{3,8}|rgba?\([\d.,\s%]+\)|hsla?\([\d.,\s%/]+\))$/;
const FONT_RE = /^[\w\s,"'().\-]+$/;
const LENGTH_RE = /^\d+(\.\d+)?(px|rem|em)$/;
const ID_RE = /^[a-z0-9][a-z0-9-]{0,63}$/;

function hasForbidden(value: string): boolean {
  const lower = value.toLowerCase();
  return FORBIDDEN.some((bad) => lower.includes(bad));
}

function isColor(value: unknown): value is string {
  return typeof value === "string" && !hasForbidden(value) && COLOR_RE.test(value.trim());
}

function isFontList(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length <= 200 &&
    !hasForbidden(value) &&
    FONT_RE.test(value.trim())
  );
}

function isLength(value: unknown): value is string {
  return typeof value === "string" && !hasForbidden(value) && LENGTH_RE.test(value.trim());
}

function isFontSlot(value: unknown): value is FontSlot {
  return value === "ui" || value === "mono";
}

function validateTokenSet(input: unknown, label: string): TokenSet | string {
  if (!input || typeof input !== "object") return `${label} palette is missing or not an object`;
  const rec = input as Record<string, unknown>;
  const out = {} as TokenSet;
  for (const key of TOKEN_KEYS) {
    const v = rec[key];
    if (!isColor(v)) return `${label}.${key} is not a valid color`;
    out[key] = (v as string).trim();
  }
  return out;
}

/** Parse + validate untrusted input (already JSON-parsed) into a safe Theme. */
export function validateTheme(input: unknown): ValidationResult {
  if (!input || typeof input !== "object") {
    return { ok: false, error: "Not a theme file." };
  }
  const t = input as Record<string, unknown>;

  if (t.version !== 1) return { ok: false, error: "Unsupported theme version." };
  if (typeof t.id !== "string" || !ID_RE.test(t.id)) {
    return { ok: false, error: "Theme id is missing or invalid." };
  }
  if (typeof t.name !== "string" || t.name.length < 1 || t.name.length > 60) {
    return { ok: false, error: "Theme name is missing or too long." };
  }
  if (t.author !== undefined && (typeof t.author !== "string" || t.author.length > 60)) {
    return { ok: false, error: "Theme author is invalid." };
  }
  if (t.appearance !== "dual" && t.appearance !== "dark" && t.appearance !== "light") {
    return { ok: false, error: "Theme appearance is invalid." };
  }
  if (t.material !== undefined && !MATERIAL_KEYS.includes(t.material as ThemeMaterial)) {
    return { ok: false, error: "Theme material is invalid." };
  }

  const fonts = t.fonts as Record<string, unknown> | undefined;
  if (!fonts || typeof fonts !== "object") return { ok: false, error: "Theme fonts are missing." };
  if (!isFontList(fonts.ui)) return { ok: false, error: "Theme ui font is invalid." };
  if (!isFontList(fonts.mono)) return { ok: false, error: "Theme mono font is invalid." };
  if (!isFontSlot(fonts.body)) return { ok: false, error: "Theme body font slot is invalid." };
  if (!isFontSlot(fonts.meta)) return { ok: false, error: "Theme meta font slot is invalid." };

  const metrics = t.metrics as Record<string, unknown> | undefined;
  if (!metrics || typeof metrics !== "object") return { ok: false, error: "Theme metrics are missing." };
  if (!isLength(metrics.radius)) return { ok: false, error: "Theme radius is invalid." };
  if (typeof metrics.density !== "number" || !(metrics.density >= 0.5 && metrics.density <= 2)) {
    return { ok: false, error: "Theme density must be a number between 0.5 and 2." };
  }

  let dark: TokenSet | undefined;
  let light: TokenSet | undefined;
  if (t.dark !== undefined) {
    const r = validateTokenSet(t.dark, "dark");
    if (typeof r === "string") return { ok: false, error: r };
    dark = r;
  }
  if (t.light !== undefined) {
    const r = validateTokenSet(t.light, "light");
    if (typeof r === "string") return { ok: false, error: r };
    light = r;
  }
  if (!dark && !light) {
    return { ok: false, error: "Theme defines neither a light nor a dark palette." };
  }

  const theme: Theme = {
    id: t.id,
    name: (t.name as string).trim(),
    author: t.author as string | undefined,
    version: 1,
    appearance: t.appearance,
    fonts: {
      ui: (fonts.ui as string).trim(),
      mono: (fonts.mono as string).trim(),
      body: fonts.body,
      meta: fonts.meta,
    },
    metrics: { radius: (metrics.radius as string).trim(), density: metrics.density },
    material: t.material as ThemeMaterial | undefined,
    dark,
    light,
  };
  return { ok: true, theme };
}

/** Parse a JSON string then validate it. */
export function parseTheme(json: string): ValidationResult {
  let data: unknown;
  try {
    data = JSON.parse(json);
  } catch {
    return { ok: false, error: "File is not valid JSON." };
  }
  return validateTheme(data);
}
