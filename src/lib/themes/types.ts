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

export const OPTIONAL_TOKEN_KEYS = ["success", "warning", "selection", "codeBg", "focus"] as const;

export type OptionalTokenKey = (typeof OPTIONAL_TOKEN_KEYS)[number];

export const SWATCH_NAMES = [
  "red",
  "orange",
  "yellow",
  "green",
  "teal",
  "blue",
  "purple",
  "pink",
  "grey",
] as const;

export type SwatchName = (typeof SWATCH_NAMES)[number];

export type SwatchSet = Record<SwatchName, string>;

export const SWATCH_VAR: Record<SwatchName, string> = {
  red: "--swatch-red",
  orange: "--swatch-orange",
  yellow: "--swatch-yellow",
  green: "--swatch-green",
  teal: "--swatch-teal",
  blue: "--swatch-blue",
  purple: "--swatch-purple",
  pink: "--swatch-pink",
  grey: "--swatch-grey",
};

export type TokenSet = Record<TokenKey, string> &
  Partial<Record<OptionalTokenKey, string>> & { swatches?: Partial<SwatchSet> };

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

export type FontSlot = "ui" | "mono";

interface ThemeFonts {
  ui: string;
  mono: string;
  body: FontSlot;
  meta: FontSlot;
}

interface ThemeMetrics {
  radius: string;
  radiusLg?: string;
  density: number;
  shadow?: string;
  shadowLg?: string;
  leading?: string;
  tracking?: string;
}

export interface Theme {
  id: string;
  name: string;
  author?: string;
  description?: string;
  version: 1;
  appearance: "dual" | "dark" | "light";
  fonts: ThemeFonts;
  metrics: ThemeMetrics;
  material?: ThemeMaterial | "none";
  dark?: TokenSet;
  light?: TokenSet;
}

export const THEME_FILE_EXT = "intheme.json";
