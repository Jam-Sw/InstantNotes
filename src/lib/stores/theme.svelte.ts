import { getSetting, setSetting, setWindowVibrancy, setWindowTheme } from "$lib/api/client";
import { isWeb } from "$lib/api/runtime";
import { applyTheme, type ThemeTweaks } from "$lib/themes/apply";
import { cssColor } from "$lib/space-colors";
import { bootSnapshot, rememberBoot, windowBackground } from "$lib/themes/boot";
import { BUILTIN_THEMES, DEFAULT_THEME_ID } from "$lib/themes/builtin";
import { validateTheme } from "$lib/themes/validate";
import { BODY_FONTS, type BodyFontId } from "$lib/themes/fonts";
import type { Theme, ThemeMaterial, Variant } from "$lib/themes/types";
import { isMac } from "$lib/platform";

export type ThemeMode = "auto" | "light" | "dark";
export type Motion = "system" | "full" | "off";
export type Density = "compact" | "default" | "roomy";
export type Leading = "tight" | "default" | "loose";

const DENSITY_SCALE: Record<Density, number> = { compact: 0.85, default: 1, roomy: 1.15 };
const LEADING_VALUE: Record<Leading, string | undefined> = {
  tight: "1.35",
  default: undefined,
  loose: "1.75",
};

export function reducedMotion(): boolean {
  if (theme.motion !== "system") return theme.motion === "off";
  return (
    typeof window.matchMedia === "function" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches
  );
}

const DEFAULT_MATERIAL: ThemeMaterial = "sidebar";

const KEY_ACTIVE = "theme.active";
const KEY_MODE = "theme.mode";
const KEY_CUSTOM = "theme.custom";
const KEY_BODY_FONT = "theme.font.body";
const KEY_MOTION = "theme.motion";
const KEY_DENSITY = "theme.density";
const KEY_LEADING = "theme.leading";
const KEY_SCROLLBARS = "theme.scrollbars";
const KEY_ACCENT = "theme.accent";

export const THEME_DEFAULTS: {
  mode: ThemeMode;
  bodyFontId: BodyFontId | null;
  motion: Motion;
  density: Density;
  leading: Leading;
  scrollbars: boolean;
  accent: string | null;
} = {
  mode: "auto",
  bodyFontId: null,
  motion: "system",
  density: "default",
  leading: "default",
  scrollbars: false,
  accent: null,
};

class ThemeStore {
  activeId = $state(DEFAULT_THEME_ID);
  mode = $state<ThemeMode>(THEME_DEFAULTS.mode);
  customThemes = $state<Theme[]>([]);
  bodyFontId = $state<BodyFontId | null>(THEME_DEFAULTS.bodyFontId);
  systemDark = $state(true);
  motion = $state<Motion>(THEME_DEFAULTS.motion);
  density = $state<Density>(THEME_DEFAULTS.density);
  leading = $state<Leading>(THEME_DEFAULTS.leading);
  scrollbars = $state(THEME_DEFAULTS.scrollbars);
  accent = $state<string | null>(THEME_DEFAULTS.accent);

  #initialized = false;
  #loaded = false;

  get allThemes(): Theme[] {
    return [...BUILTIN_THEMES, ...this.customThemes];
  }

  get activeTheme(): Theme {
    return this.allThemes.find((t) => t.id === this.activeId) ?? BUILTIN_THEMES[0];
  }

  get resolvedVariant(): Variant {
    if (this.mode === "auto") return this.systemDark ? "dark" : "light";
    return this.mode;
  }

  async init(): Promise<void> {
    if (!this.#initialized) {
      this.#initialized = true;
      const mq = window.matchMedia("(prefers-color-scheme: dark)");
      this.systemDark = mq.matches;
      mq.addEventListener("change", (e) => {
        this.systemDark = e.matches;
        if (this.mode === "auto") this.#apply();
      });
    }
    this.#loaded = await this.#load();
    this.#apply();
  }

  async #load(): Promise<boolean> {
    try {
      const [active, mode, custom, bodyFont, motion, density, leading, scrollbars, accent] =
        await Promise.all([
          getSetting<string>(KEY_ACTIVE),
          getSetting<ThemeMode>(KEY_MODE),
          getSetting<unknown[]>(KEY_CUSTOM),
          getSetting<string>(KEY_BODY_FONT),
          getSetting<string>(KEY_MOTION),
          getSetting<string>(KEY_DENSITY),
          getSetting<string>(KEY_LEADING),
          getSetting<boolean>(KEY_SCROLLBARS),
          getSetting<string>(KEY_ACCENT),
        ]);
      if (Array.isArray(custom)) {
        this.customThemes = custom
          .map((c) => validateTheme(c))
          .filter((r): r is { ok: true; theme: Theme } => r.ok)
          .map((r) => r.theme);
      }
      if (mode === "auto" || mode === "light" || mode === "dark") this.mode = mode;
      if (active && this.allThemes.some((t) => t.id === active)) this.activeId = active;
      if (bodyFont && BODY_FONTS.some((f) => f.id === bodyFont)) {
        this.bodyFontId = bodyFont as BodyFontId;
      }
      if (motion === "system" || motion === "full" || motion === "off") this.motion = motion;
      if (density && Object.hasOwn(DENSITY_SCALE, density)) this.density = density as Density;
      if (leading && Object.hasOwn(LEADING_VALUE, leading)) this.leading = leading as Leading;
      if (typeof scrollbars === "boolean") this.scrollbars = scrollbars;
      this.accent = typeof accent === "string" && cssColor(accent) ? accent : null;
      return true;
    } catch {
      return false;
    }
  }

  get #tweaks(): ThemeTweaks {
    return {
      density: DENSITY_SCALE[this.density],
      leading: LEADING_VALUE[this.leading],
      accent: cssColor(this.accent) ?? undefined,
    };
  }

  #apply(): void {
    const root = document.documentElement;
    const tweaks = this.#tweaks;
    applyTheme(this.activeTheme, this.resolvedVariant, root, tweaks);
    if (this.motion === "system") delete root.dataset.motion;
    else root.dataset.motion = this.motion;
    if (this.scrollbars) root.dataset.scrollbars = "";
    else delete root.dataset.scrollbars;
    let bodyFont: string | null = null;
    if (this.bodyFontId) {
      const font = BODY_FONTS.find((f) => f.id === this.bodyFontId);
      if (font) {
        bodyFont = font.value;
        document.documentElement.style.setProperty("--font-body", font.value);
      }
    }
    if (this.#loaded) rememberBoot(bootSnapshot(this.activeTheme, this.mode, bodyFont, tweaks));
    void this.#syncVibrancy();
    void this.#syncWindowTheme();
  }

  async #syncVibrancy(): Promise<void> {
    if (isWeb || location.pathname !== "/") return;
    const root = document.documentElement;
    const named = this.activeTheme.material;
    const material = !isMac || named === "none" ? null : (named ?? DEFAULT_MATERIAL);
    try {
      await setWindowVibrancy(material);
    } catch {
      delete root.dataset.vibrancy;
      delete root.dataset.vibrancyDerived;
      return;
    }
    if (material) root.dataset.vibrancy = material;
    else delete root.dataset.vibrancy;
    if (material && !named) root.dataset.vibrancyDerived = "";
    else delete root.dataset.vibrancyDerived;
  }

  async #syncWindowTheme(): Promise<void> {
    if (isWeb || location.pathname.startsWith("/capture")) return;
    try {
      await setWindowTheme(
        this.resolvedVariant,
        windowBackground(this.activeTheme, this.resolvedVariant),
      );
    } catch {
    }
  }

  setTheme(id: string): void {
    if (!this.allThemes.some((t) => t.id === id)) return;
    this.activeId = id;
    this.#apply();
    void setSetting(KEY_ACTIVE, id);
  }

  setMode(mode: ThemeMode): void {
    this.mode = mode;
    this.#apply();
    void setSetting(KEY_MODE, mode);
  }

  toggleLightDark(): void {
    this.setMode(this.resolvedVariant === "dark" ? "light" : "dark");
  }

  addCustomTheme(theme: Theme): void {
    this.customThemes = [
      ...this.customThemes.filter((t) => t.id !== theme.id),
      theme,
    ];
    void setSetting(KEY_CUSTOM, this.customThemes);
    this.setTheme(theme.id);
  }

  removeCustomTheme(id: string): void {
    this.customThemes = this.customThemes.filter((t) => t.id !== id);
    void setSetting(KEY_CUSTOM, this.customThemes);
    if (this.activeId === id) this.setTheme(DEFAULT_THEME_ID);
  }

  setBodyFont(id: BodyFontId | null): void {
    this.bodyFontId = id;
    this.#apply();
    void setSetting(KEY_BODY_FONT, id);
  }

  setMotion(motion: Motion): void {
    this.motion = motion;
    this.#apply();
    void setSetting(KEY_MOTION, motion);
  }

  setDensity(density: Density): void {
    this.density = density;
    this.#apply();
    void setSetting(KEY_DENSITY, density);
  }

  setLeading(leading: Leading): void {
    this.leading = leading;
    this.#apply();
    void setSetting(KEY_LEADING, leading);
  }

  setScrollbars(on: boolean): void {
    this.scrollbars = on;
    this.#apply();
    void setSetting(KEY_SCROLLBARS, on);
  }

  setAccent(color: string | null): void {
    this.accent = color;
    this.#apply();
    void setSetting(KEY_ACCENT, color);
  }

  serialize(id: string = this.activeId): string {
    const theme = this.allThemes.find((t) => t.id === id) ?? this.activeTheme;
    return JSON.stringify(theme, null, 2);
  }
}

export const theme = new ThemeStore();
