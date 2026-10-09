import { getSetting, setSetting, setWindowVibrancy, setWindowTheme } from "$lib/api/client";
import { applyTheme } from "$lib/themes/apply";
import { BUILTIN_THEMES, DEFAULT_THEME_ID } from "$lib/themes/builtin";
import { validateTheme } from "$lib/themes/validate";
import { BODY_FONTS, type BodyFontId } from "$lib/themes/fonts";
import type { Theme, ThemeMaterial, Variant } from "$lib/themes/types";
import { isMac } from "$lib/platform";

export type ThemeMode = "auto" | "light" | "dark";

const DEFAULT_MATERIAL: ThemeMaterial = "sidebar";

const KEY_ACTIVE = "theme.active";
const KEY_MODE = "theme.mode";
const KEY_CUSTOM = "theme.custom";
const KEY_BODY_FONT = "theme.font.body";

class ThemeStore {
  activeId = $state(DEFAULT_THEME_ID);
  mode = $state<ThemeMode>("auto");
  customThemes = $state<Theme[]>([]);
  bodyFontId = $state<BodyFontId | null>(null);
  systemDark = $state(true);

  #initialized = false;

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
    await this.#load();
    this.#apply();
  }

  async #load(): Promise<void> {
    try {
      const [active, mode, custom, bodyFont] = await Promise.all([
        getSetting<string>(KEY_ACTIVE),
        getSetting<ThemeMode>(KEY_MODE),
        getSetting<unknown[]>(KEY_CUSTOM),
        getSetting<string>(KEY_BODY_FONT),
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
    } catch {
    }
  }

  #apply(): void {
    applyTheme(this.activeTheme, this.resolvedVariant);
    if (this.bodyFontId) {
      const font = BODY_FONTS.find((f) => f.id === this.bodyFontId);
      if (font) document.documentElement.style.setProperty("--font-body", font.value);
    }
    void this.#syncVibrancy();
    void this.#syncWindowTheme();
  }

  async #syncVibrancy(): Promise<void> {
    if (location.pathname !== "/") return;
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
    if (location.pathname.startsWith("/capture")) return;
    try {
      await setWindowTheme(this.resolvedVariant);
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

  serialize(id: string = this.activeId): string {
    const theme = this.allThemes.find((t) => t.id === id) ?? this.activeTheme;
    return JSON.stringify(theme, null, 2);
  }
}

export const theme = new ThemeStore();
