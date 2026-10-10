import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { applyTheme } from "./apply";
import { bootSnapshot, rememberBoot, windowBackground, type BootMode } from "./boot";
import { BUILTIN_THEMES } from "./builtin";
import { manuscript } from "./builtin/manuscript";
import type { Theme, Variant } from "./types";

const BOOT_KEY = "instantnotes.boot";
const bootScript = readFileSync("static/boot.js", "utf8");

function systemPrefersDark(dark: boolean) {
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    value: vi.fn(() => ({ matches: dark })),
  });
}

function reset() {
  const root = document.documentElement;
  root.removeAttribute("style");
  for (const key of Object.keys(root.dataset)) delete root.dataset[key];
}

function painted(root: HTMLElement) {
  return { style: root.getAttribute("style"), data: { ...root.dataset } };
}

function runBoot() {
  new Function(bootScript)();
}

beforeEach(() => {
  localStorage.clear();
  reset();
});

afterEach(() => {
  localStorage.clear();
  reset();
});

describe("the boot script", () => {
  const modes: BootMode[] = ["auto", "light", "dark"];

  for (const theme of BUILTIN_THEMES) {
    for (const mode of modes) {
      for (const systemDark of [true, false]) {
        const variant: Variant = mode === "auto" ? (systemDark ? "dark" : "light") : mode;
        it(`paints ${theme.id} in ${mode} (system ${systemDark ? "dark" : "light"}) like the theme store`, () => {
          const fresh = document.createElement("html");
          applyTheme(theme, variant, fresh);
          fresh.style.setProperty("--font-body", "Georgia, serif");

          systemPrefersDark(systemDark);
          rememberBoot(bootSnapshot(theme, mode, "Georgia, serif"));
          runBoot();

          expect(painted(document.documentElement)).toEqual(painted(fresh));
        });
      }
    }
  }

  it("leaves the body font alone when none was chosen", () => {
    systemPrefersDark(true);
    rememberBoot(bootSnapshot(manuscript, "dark", null));
    runBoot();
    expect(document.documentElement.style.getPropertyValue("--font-body")).toBe(
      manuscript.fonts.body === "mono" ? manuscript.fonts.mono : manuscript.fonts.ui,
    );
  });

  it("follows a single-appearance theme into the variant it has", () => {
    const darkOnly: Theme = { ...manuscript, appearance: "dark", light: undefined };
    systemPrefersDark(false);
    rememberBoot(bootSnapshot(darkOnly, "light", null));
    runBoot();
    expect(document.documentElement.dataset.variant).toBe("dark");
    expect(document.documentElement.style.getPropertyValue("--bg")).toBe(manuscript.dark!.bg);
  });

  it("does nothing without a remembered theme", () => {
    systemPrefersDark(true);
    runBoot();
    expect(painted(document.documentElement)).toEqual({ style: null, data: {} });
  });

  it("does nothing, and does not throw, when the remembered theme is unreadable", () => {
    systemPrefersDark(true);
    localStorage.setItem(BOOT_KEY, "{not json");
    expect(runBoot).not.toThrow();
    localStorage.setItem(BOOT_KEY, JSON.stringify({ mode: "auto" }));
    expect(runBoot).not.toThrow();
    expect(document.documentElement.dataset.theme).toBeUndefined();
  });
});

describe("remembering the theme", () => {
  it("writes the snapshot only when it changed", () => {
    const set = vi.spyOn(Storage.prototype, "setItem");
    rememberBoot(bootSnapshot(manuscript, "auto", null));
    rememberBoot(bootSnapshot(manuscript, "auto", null));
    expect(set).toHaveBeenCalledTimes(1);
    rememberBoot(bootSnapshot(manuscript, "dark", null));
    expect(set).toHaveBeenCalledTimes(2);
    set.mockRestore();
  });

  it("survives storage that refuses to answer", () => {
    const get = vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    expect(() => rememberBoot(bootSnapshot(manuscript, "auto", null))).not.toThrow();
    get.mockRestore();
  });
});

describe("windowBackground", () => {
  it("returns the background of the variant in use as a six-digit hex", () => {
    expect(windowBackground(manuscript, "dark")).toBe(manuscript.dark!.bg.toLowerCase());
    expect(windowBackground(manuscript, "light")).toBe(manuscript.light!.bg.toLowerCase());
  });

  it("expands a short hex", () => {
    const short: Theme = { ...manuscript, dark: { ...manuscript.dark!, bg: "#1AB" } };
    expect(windowBackground(short, "dark")).toBe("#11aabb");
  });

  it("returns null for colours the window cannot take", () => {
    const rgb: Theme = { ...manuscript, dark: { ...manuscript.dark!, bg: "rgb(10, 10, 10)" } };
    expect(windowBackground(rgb, "dark")).toBeNull();
    const alpha: Theme = { ...manuscript, dark: { ...manuscript.dark!, bg: "#11223344" } };
    expect(windowBackground(alpha, "dark")).toBeNull();
  });

  it("uses the variant a single-appearance theme falls back to", () => {
    const lightOnly: Theme = { ...manuscript, appearance: "light", dark: undefined };
    expect(windowBackground(lightOnly, "dark")).toBe(manuscript.light!.bg.toLowerCase());
  });
});
