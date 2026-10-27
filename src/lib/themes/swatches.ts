import { SWATCH_NAMES, SWATCH_VAR, type SwatchName, type SwatchSet, type Variant } from "./types";

const DEFAULT_SWATCHES: Record<Variant, SwatchSet> = {
  dark: {
    red: "#ec6a5e",
    orange: "#f0a35a",
    yellow: "#e8cb62",
    green: "#7fc48a",
    teal: "#5cc4bd",
    blue: "#6aa9f0",
    purple: "#a98bf0",
    pink: "#ee8fb4",
    grey: "#9a9aa2",
  },
  light: {
    red: "#d0453a",
    orange: "#d9772a",
    yellow: "#c79a14",
    green: "#3f9a55",
    teal: "#1f9a98",
    blue: "#2f7fd6",
    purple: "#7a56d6",
    pink: "#d6528a",
    grey: "#7b7b84",
  },
};

export function swatchVars(
  overrides: Partial<SwatchSet> | undefined,
  variant: Variant,
): Record<string, string> {
  const vars: Record<string, string> = {};
  for (const name of SWATCH_NAMES) {
    vars[SWATCH_VAR[name]] = overrides?.[name] ?? DEFAULT_SWATCHES[variant][name];
  }
  return vars;
}

export function isSwatchName(value: unknown): value is SwatchName {
  return typeof value === "string" && (SWATCH_NAMES as readonly string[]).includes(value);
}
