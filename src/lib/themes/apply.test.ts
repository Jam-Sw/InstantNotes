import { describe, expect, it } from "vitest";
import { effectiveVariant, themeToVars } from "./apply";
import { manuscript, terminal } from "./builtin";
import type { Theme } from "./types";

describe("effectiveVariant", () => {
  it("returns the requested variant when the theme defines it", () => {
    expect(effectiveVariant(manuscript, "dark")).toBe("dark");
    expect(effectiveVariant(manuscript, "light")).toBe("light");
  });

  it("falls back to the available variant for a single-appearance theme", () => {
    const darkOnly: Theme = { ...manuscript, appearance: "dark", light: undefined };
    expect(effectiveVariant(darkOnly, "light")).toBe("dark");
    const lightOnly: Theme = { ...manuscript, appearance: "light", dark: undefined };
    expect(effectiveVariant(lightOnly, "dark")).toBe("light");
  });
});

describe("themeToVars", () => {
  it("maps every token to its CSS custom property", () => {
    const vars = themeToVars(manuscript, "dark");
    expect(vars["--bg"]).toBe(manuscript.dark!.bg);
    expect(vars["--accent"]).toBe(manuscript.dark!.accent);
    expect(vars["--accent-text"]).toBe(manuscript.dark!.accentText);
    expect(vars["--tag"]).toBe(manuscript.dark!.tag);
  });

  it("resolves font slots and metrics", () => {
    const vars = themeToVars(manuscript, "dark");
    // Manuscript uses mono metadata, sans body.
    expect(vars["--font-meta"]).toBe(manuscript.fonts.mono);
    expect(vars["--font-body"]).toBe(manuscript.fonts.ui);
    expect(vars["--radius"]).toBe("8px");
    expect(vars["--density"]).toBe("1.15");
  });

  it("uses mono for body when the theme says so", () => {
    const vars = themeToVars(terminal, "dark");
    expect(vars["--font-body"]).toBe(terminal.fonts.mono);
  });
});
