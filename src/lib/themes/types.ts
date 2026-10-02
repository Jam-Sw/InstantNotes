// A theme is the portable, shareable unit of the visual language: colors,
// fonts, and metrics for light and dark, serializable to a single
// `.intheme.json` file. Built-ins are typed objects in `builtin/`; imported
// themes are validated into this same shape before any token is applied.

/** The fixed allow-list of color tokens a theme may set. Each maps to a CSS
 *  custom property consumed across the app (see `app.css`). Keeping this an
 *  explicit const lets `validate` and `apply` share one source of truth. */
export const TOKEN_KEYS = [
  "bg",
  "bgSidebar",
  "bgHover",
  "bgActive",
  "bgInput",
  "text",
  "textSecondary",
  "textTertiary",
  "border",
  "accent",
  "accentText",
  "accentSoft",
  "danger",
  "tag",
] as const;

export type TokenKey = (typeof TOKEN_KEYS)[number];

/** Tokens a theme may set but need not: each has a fallback derived from the
 *  required set (see `apply.ts`), so every theme written before they existed
 *  keeps rendering unchanged. `success` and `warning` are the two states the
 *  app reports besides `danger` (a vault in sync, an agent's change); the
 *  rest tune surfaces that used to borrow neighbouring tokens. */
export const OPTIONAL_TOKEN_KEYS = ["success", "warning", "selection", "codeBg", "focus"] as const;

export type OptionalTokenKey = (typeof OPTIONAL_TOKEN_KEYS)[number];

/** A complete set of color values for one appearance (light or dark), plus
 *  any of the optional tokens. */
export type TokenSet = Record<TokenKey, string> & Partial<Record<OptionalTokenKey, string>>;

/** Which CSS custom property each token writes to. */
export const TOKEN_VAR: Record<TokenKey, string> = {
  bg: "--bg",
  bgSidebar: "--bg-sidebar",
  bgHover: "--bg-hover",
  bgActive: "--bg-active",
  bgInput: "--bg-input",
  text: "--text",
  textSecondary: "--text-secondary",
  textTertiary: "--text-tertiary",
  border: "--border",
  accent: "--accent",
  accentText: "--accent-text",
  accentSoft: "--accent-soft",
  danger: "--danger",
  tag: "--tag",
};

export const OPTIONAL_TOKEN_VAR: Record<OptionalTokenKey, string> = {
  success: "--success",
  warning: "--warning",
  selection: "--selection",
  codeBg: "--code-bg",
  focus: "--focus",
};

/** Native macOS vibrancy materials a theme may request behind the window. Each
 *  maps to an NSVisualEffectMaterial in the Rust layer; a no-op off macOS. */
export const MATERIAL_KEYS = [
  "sidebar",
  "under-window",
  "header",
  "menu",
  "popover",
  "hud",
] as const;

export type ThemeMaterial = (typeof MATERIAL_KEYS)[number];

export type Variant = "light" | "dark";

/** Whether a font slot resolves to the theme's UI font or its mono font. */
export type FontSlot = "ui" | "mono";

export interface ThemeFonts {
  /** The sans/UI font stack (CSS font-family list). */
  ui: string;
  /** The monospace font stack (CSS font-family list). */
  mono: string;
  /** Editor / note body / capture textarea font. */
  body: FontSlot;
  /** Dates, counts, section labels, status bar font. */
  meta: FontSlot;
}

export interface ThemeMetrics {
  /** Corner radius as a CSS length, e.g. "8px". */
  radius: string;
  /** Explicit large-element radius (modals, dialogs). Defaults to radius + 4px. */
  radiusLg?: string;
  /** Unitless multiplier applied to key paddings and base text size. */
  density: number;
  /** Small ambient box-shadow (cards, inputs). Defaults to a subtle dark lift. */
  shadow?: string;
  /** Large modal/overlay box-shadow. Defaults to a deep drop shadow. */
  shadowLg?: string;
  /** Line-height for body/editor text, e.g. "1.5" or "1.75". Defaults to "1.5". */
  leading?: string;
  /** Letter-spacing for body/editor text, e.g. "0" or "-0.01em". Defaults to "0". */
  tracking?: string;
}

export interface Theme {
  id: string;
  name: string;
  author?: string;
  /** One line on what the theme is for, shown on the Appearance page. */
  description?: string;
  version: 1;
  /** "dual" defines both light and dark; otherwise only the named variant. */
  appearance: "dual" | "dark" | "light";
  fonts: ThemeFonts;
  metrics: ThemeMetrics;
  /** Optional native macOS window material. When set, the app makes the sidebar
   *  translucent and asks the OS to render this vibrancy behind it; omit for a
   *  flat, fully opaque theme. */
  material?: ThemeMaterial;
  dark?: TokenSet;
  light?: TokenSet;
}

/** The file extension built-in and shared themes use. */
export const THEME_FILE_EXT = "intheme.json";
