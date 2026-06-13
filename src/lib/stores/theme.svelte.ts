// Theme state (Svelte 5 runes). Holds the active theme id, the light/dark
// mode, and any imported custom themes; resolves the effective variant and
// writes tokens to :root via apply. Persists to the existing settings KV so
// the choice survives restarts and is shared with the capture window.

import { getSetting, setSetting } from "$lib/api/client";
import { applyTheme } from "$lib/themes/apply";
import { BUILTIN_THEMES, DEFAULT_THEME_ID } from "$lib/themes/builtin";
import { validateTheme } from "$lib/themes/validate";
import type { Theme, Variant } from "$lib/themes/types";

export type ThemeMode = "auto" | "light" | "dark";

const KEY_ACTIVE = "theme.active";
const KEY_MODE = "theme.mode";
const KEY_CUSTOM = "theme.custom";

class ThemeStore {
  activeId = $state(DEFAULT_THEME_ID);
  mode = $state<ThemeMode>("auto");
  customThemes = $state<Theme[]>([]);
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

  /** Read system preference + persisted settings, then apply. Idempotent. */
  async init(): Promise<void> {
    if (this.#initialized) {
      this.#apply();
      return;
    }
    this.#initialized = true;

    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    this.systemDark = mq.matches;
    mq.addEventListener("change", (e) => {
      this.systemDark = e.matches;
      if (this.mode === "auto") this.#apply();
    });

    try {
      const [active, mode, custom] = await Promise.all([
        getSetting<string>(KEY_ACTIVE),
        getSetting<ThemeMode>(KEY_MODE),
        getSetting<unknown[]>(KEY_CUSTOM),
      ]);
      if (Array.isArray(custom)) {
        this.customThemes = custom
          .map((c) => validateTheme(c))
          .filter((r): r is { ok: true; theme: Theme } => r.ok)
          .map((r) => r.theme);
      }
      if (mode === "auto" || mode === "light" || mode === "dark") this.mode = mode;
      if (active && this.allThemes.some((t) => t.id === active)) this.activeId = active;
    } catch {
      // Settings are best-effort; fall back to the default theme silently.
    }
    this.#apply();
  }

  #apply(): void {
    applyTheme(this.activeTheme, this.resolvedVariant);
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

  /** Serialize a theme to pretty JSON for export. Defaults to the active one. */
  serialize(id: string = this.activeId): string {
    const theme = this.allThemes.find((t) => t.id === id) ?? this.activeTheme;
    return JSON.stringify(theme, null, 2);
  }
}

export const theme = new ThemeStore();
