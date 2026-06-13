// Turns a Theme into CSS custom properties and writes them to the document.
// `themeToVars` is pure (unit-tested); `applyTheme` does the DOM write. Tokens,
// fonts, radius, and density all land on :root so every scoped style picks
// them up via var().

import {
  TOKEN_KEYS,
  TOKEN_VAR,
  type Theme,
  type TokenSet,
  type Variant,
} from "./types";

/** The variant actually used, given what the theme defines. A dark-only theme
 *  asked for "light" falls back to its dark set, and vice versa. */
export function effectiveVariant(theme: Theme, requested: Variant): Variant {
  if (requested === "dark") return theme.dark ? "dark" : "light";
  return theme.light ? "light" : "dark";
}

function tokensFor(theme: Theme, variant: Variant): TokenSet {
  const v = effectiveVariant(theme, variant);
  // effectiveVariant guarantees the chosen set exists (schema requires >=1).
  return (v === "dark" ? theme.dark : theme.light) as TokenSet;
}

/** All CSS custom properties for a theme at a variant: colors, fonts, metrics. */
export function themeToVars(theme: Theme, variant: Variant): Record<string, string> {
  const tokens = tokensFor(theme, variant);
  const vars: Record<string, string> = {};
  for (const key of TOKEN_KEYS) {
    vars[TOKEN_VAR[key]] = tokens[key];
  }
  vars["--font-ui"] = theme.fonts.ui;
  vars["--font-mono"] = theme.fonts.mono;
  vars["--font-body"] = theme.fonts.body === "mono" ? theme.fonts.mono : theme.fonts.ui;
  vars["--font-meta"] = theme.fonts.meta === "mono" ? theme.fonts.mono : theme.fonts.ui;
  vars["--radius"] = theme.metrics.radius;
  vars["--density"] = String(theme.metrics.density);
  return vars;
}

/** Apply a theme to the document root: write vars, then tag for flourish CSS. */
export function applyTheme(
  theme: Theme,
  variant: Variant,
  root: HTMLElement = document.documentElement,
): void {
  const vars = themeToVars(theme, variant);
  for (const [name, value] of Object.entries(vars)) {
    root.style.setProperty(name, value);
  }
  root.dataset.theme = theme.id;
  root.dataset.variant = effectiveVariant(theme, variant);
}
