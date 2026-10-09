import {
  OPTIONAL_TOKEN_KEYS,
  OPTIONAL_TOKEN_VAR,
  TOKEN_KEYS,
  TOKEN_VAR,
  type OptionalTokenKey,
  type Theme,
  type TokenSet,
  type Variant,
} from "./types";

function optionalFallback(key: OptionalTokenKey, t: TokenSet): string {
  switch (key) {
    case "success":
      return t.accent;
    case "warning":
      return `color-mix(in srgb, ${t.danger} 55%, ${t.accent})`;
    case "selection":
      return t.accentSoft;
    case "codeBg":
      return t.bgSidebar;
    case "focus":
      return t.accent;
  }
}

export function effectiveVariant(theme: Theme, requested: Variant): Variant {
  if (requested === "dark") return theme.dark ? "dark" : "light";
  return theme.light ? "light" : "dark";
}

function tokensFor(theme: Theme, variant: Variant): TokenSet {
  const v = effectiveVariant(theme, variant);
  return (v === "dark" ? theme.dark : theme.light) as TokenSet;
}

/** @internal */
export function themeToVars(theme: Theme, variant: Variant): Record<string, string> {
  const tokens = tokensFor(theme, variant);
  const vars: Record<string, string> = {};
  for (const key of TOKEN_KEYS) {
    vars[TOKEN_VAR[key]] = tokens[key];
  }
  for (const key of OPTIONAL_TOKEN_KEYS) {
    vars[OPTIONAL_TOKEN_VAR[key]] = tokens[key] ?? optionalFallback(key, tokens);
  }
  vars["--font-ui"] = theme.fonts.ui;
  vars["--font-mono"] = theme.fonts.mono;
  vars["--font-body"] = theme.fonts.body === "mono" ? theme.fonts.mono : theme.fonts.ui;
  vars["--font-meta"] = theme.fonts.meta === "mono" ? theme.fonts.mono : theme.fonts.ui;
  vars["--radius"] = theme.metrics.radius;
  vars["--radius-lg"] = theme.metrics.radiusLg ?? `calc(${theme.metrics.radius} + 4px)`;
  vars["--density"] = String(theme.metrics.density);
  vars["--shadow"] = theme.metrics.shadow ?? "0 2px 8px rgba(0, 0, 0, 0.12)";
  vars["--shadow-lg"] = theme.metrics.shadowLg ?? "0 18px 50px rgba(0, 0, 0, 0.4)";
  vars["--leading"] = theme.metrics.leading ?? "1.5";
  vars["--tracking"] = theme.metrics.tracking ?? "0";
  return vars;
}

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
