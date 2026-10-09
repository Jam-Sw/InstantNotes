import { effectiveVariant, themeToVars } from "./apply";
import type { Theme, Variant } from "./types";

const BOOT_KEY = "instantnotes.boot";

export type BootMode = "auto" | "light" | "dark";

interface BootPalette {
  variant: Variant;
  vars: Record<string, string>;
}

export interface BootSnapshot {
  themeId: string;
  mode: BootMode;
  bodyFont: string | null;
  light: BootPalette;
  dark: BootPalette;
}

function palette(theme: Theme, variant: Variant): BootPalette {
  return { variant: effectiveVariant(theme, variant), vars: themeToVars(theme, variant) };
}

export function bootSnapshot(theme: Theme, mode: BootMode, bodyFont: string | null): BootSnapshot {
  return {
    themeId: theme.id,
    mode,
    bodyFont,
    light: palette(theme, "light"),
    dark: palette(theme, "dark"),
  };
}

export function rememberBoot(snapshot: BootSnapshot): void {
  try {
    const next = JSON.stringify(snapshot);
    if (localStorage.getItem(BOOT_KEY) !== next) localStorage.setItem(BOOT_KEY, next);
  } catch {
  }
}

const HEX = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i;

export function windowBackground(theme: Theme, variant: Variant): string | null {
  const bg = (effectiveVariant(theme, variant) === "dark" ? theme.dark : theme.light)?.bg.trim();
  if (!bg || !HEX.test(bg)) return null;
  const hex = bg.slice(1).toLowerCase();
  const full = hex.length === 3 ? [...hex].map((c) => c + c).join("") : hex;
  return `#${full}`;
}
