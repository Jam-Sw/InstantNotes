// Theme state (Svelte 5 runes). Holds the active theme id, the light/dark
// mode, and any imported custom themes; resolves the effective variant and
// writes tokens to :root via apply. Persists to the existing settings KV so
// the choice survives restarts and is shared with the capture window.

import { getSetting, setSetting, setWindowVibrancy, setWindowTheme } from "$lib/api/client";
import { applyTheme } from "$lib/themes/apply";
import { BUILTIN_THEMES, DEFAULT_THEME_ID } from "$lib/themes/builtin";
import { validateTheme } from "$lib/themes/validate";
import { BODY_FONTS, type BodyFontId } from "$lib/themes/fonts";
import type { Theme, Variant } from "$lib/themes/types";

export type ThemeMode = "auto" | "light" | "dark";

const KEY_ACTIVE = "theme.active";
const KEY_MODE = "theme.mode";
const KEY_CUSTOM = "theme.custom";
const KEY_BODY_FONT = "theme.font.body";

class ThemeStore {
  activeId = $state(DEFAULT_THEME_ID);
  mode = $state<ThemeMode>("auto");
  customThemes = $state<Theme[]>([]);
  /** User-chosen body font id, or null to use the theme's default font slot. */
  bodyFontId = $state<BodyFontId | null>(null);
  // Tracks the OS appearance so `auto` can resolve and react to changes.
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

  /** Read system preference + persisted settings, then apply. Safe to call
   *  again (e.g. on capture:shown) to pick up changes made in another window. */
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
      // Settings are best-effort; fall back to the default theme silently.
    }
  }

  #apply(): void {
    applyTheme(this.activeTheme, this.resolvedVariant);
    // Body font override: write --font-body after applyTheme so the user's
    // choice wins regardless of the theme's body font slot.
    if (this.bodyFontId) {
      const font = BODY_FONTS.find((f) => f.id === this.bodyFontId);
      if (font) document.documentElement.style.setProperty("--font-body", font.value);
    }
    void this.#syncVibrancy();
    void this.#syncWindowTheme();
  }

  /** Ask the OS to render (or clear) the active theme's window material, and
   *  mark the document so the CSS can go translucent. Only the library window
   *  owns vibrancy; the capture panel has its own transparent styling. If the
   *  native call is unavailable (browser dev, non-macOS, older OS) the document
   *  stays opaque so nothing looks broken. */
  async #syncVibrancy(): Promise<void> {
    if (location.pathname.startsWith("/capture")) return;
    const material = this.activeTheme.material ?? null;
    try {
      await setWindowVibrancy(material);
    } catch {
      delete document.documentElement.dataset.vibrancy;
      return;
    }
    if (material) document.documentElement.dataset.vibrancy = material;
    else delete document.documentElement.dataset.vibrancy;
  }

  /** Match the native window chrome (titlebar, traffic lights) to the resolved
   *  light/dark variant, so the macOS decorations follow the in-app theme rather
   *  than the launch-time system appearance. Library window only; a no-op in
   *  browser dev or off macOS, where the native call is unavailable. */
  async #syncWindowTheme(): Promise<void> {
    if (location.pathname.startsWith("/capture")) return;
    try {
      await setWindowTheme(this.resolvedVariant);
    } catch {
      // Best-effort; nothing to clean up if the native call is unavailable.
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

  /** Flip to the opposite of whatever is showing, pinning an explicit mode. */
  toggleLightDark(): void {
    this.setMode(this.resolvedVariant === "dark" ? "light" : "dark");
  }

  /** Add or replace a custom theme (by id), persist, and make it active. */
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

  /** Set the user body font override. Pass null to revert to the theme default. */
  setBodyFont(id: BodyFontId | null): void {
    this.bodyFontId = id;
    this.#apply();
    void setSetting(KEY_BODY_FONT, id);
  }

  /** Serialize a theme to pretty JSON for export. Defaults to the active one. */
  serialize(id: string = this.activeId): string {
    const theme = this.allThemes.find((t) => t.id === id) ?? this.activeTheme;
    return JSON.stringify(theme, null, 2);
  }
}

export const theme = new ThemeStore();
