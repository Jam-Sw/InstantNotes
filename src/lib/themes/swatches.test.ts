import { describe, expect, it } from "vitest";
import { themeToVars } from "./apply";
import { BUILTIN_THEMES } from "./builtin";
import { manuscript } from "./builtin/manuscript";
import { SWATCH_NAMES, SWATCH_VAR, type Theme } from "./types";
import { validateTheme } from "./validate";

describe("swatch palette", () => {
  it("gives every built-in theme a full palette for light and dark", () => {
    for (const t of BUILTIN_THEMES) {
      for (const variant of ["light", "dark"] as const) {
        const sw = t[variant]?.swatches;
        expect(sw, `${t.id} ${variant}`).toBeDefined();
        for (const name of SWATCH_NAMES) expect(sw![name], `${t.id} ${variant} ${name}`).toMatch(/^#[0-9a-f]{6}$/);
      }
    }
  });

  it("tunes the palette per light and dark rather than reusing one", () => {
    expect(manuscript.dark!.swatches!.red).not.toBe(manuscript.light!.swatches!.red);
  });

  it("emits a --swatch-<name> variable for every name", () => {
    const vars = themeToVars(manuscript, "dark");
    for (const name of SWATCH_NAMES) {
      expect(vars[SWATCH_VAR[name]]).toBe(manuscript.dark!.swatches![name]);
    }
    expect(SWATCH_VAR.blue).toBe("--swatch-blue");
  });

  it("recolours when the variant changes", () => {
    expect(themeToVars(manuscript, "light")["--swatch-green"]).toBe(manuscript.light!.swatches!.green);
    expect(themeToVars(manuscript, "light")["--swatch-green"]).not.toBe(
      themeToVars(manuscript, "dark")["--swatch-green"],
    );
  });

  it("falls back to the defaults for a theme without swatches or with only some", () => {
    const { swatches: _d, ...dark } = manuscript.dark!;
    const { swatches: _l, ...light } = manuscript.light!;
    const bare: Theme = { ...manuscript, dark, light: { ...light, swatches: { red: "#ff0000" } } };
    const d = themeToVars(bare, "dark");
    for (const name of SWATCH_NAMES) expect(d[SWATCH_VAR[name]], name).toMatch(/^#[0-9a-f]{6}$/);
    const l = themeToVars(bare, "light");
    expect(l["--swatch-red"]).toBe("#ff0000");
    expect(l["--swatch-blue"]).toMatch(/^#[0-9a-f]{6}$/);
    expect(l["--swatch-blue"]).not.toBe(d["--swatch-blue"]);
  });
});

describe("validateTheme swatches", () => {
  it("round-trips a custom override", () => {
    const r = validateTheme({
      ...manuscript,
      dark: { ...manuscript.dark, swatches: { red: " #ff0000 ", teal: "rgb(10, 200, 200)" } },
    });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.theme.dark?.swatches).toEqual({ red: "#ff0000", teal: "rgb(10, 200, 200)" });
  });

  it("accepts a theme file that predates swatches", () => {
    const { swatches: _s, ...dark } = manuscript.dark!;
    const r = validateTheme({ ...manuscript, dark });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.theme.dark?.swatches).toBeUndefined();
  });

  it("rejects hostile values, unknown names and the wrong shape", () => {
    const withSwatches = (swatches: unknown) =>
      validateTheme({ ...manuscript, dark: { ...manuscript.dark, swatches } }).ok;
    expect(withSwatches({ red: "url(http://evil/x)" })).toBe(false);
    expect(withSwatches({ red: "#f00; background: red" })).toBe(false);
    expect(withSwatches({ mauve: "#ff00ff" })).toBe(false);
    expect(withSwatches("red")).toBe(false);
    expect(withSwatches(null)).toBe(false);
    expect(withSwatches([])).toBe(false);
  });
});
