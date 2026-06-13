import { describe, expect, it } from "vitest";
import { parseTheme, validateTheme } from "./validate";
import { manuscript } from "./builtin";

// A round-trip of a built-in theme is the canonical valid input.
const validJson = JSON.stringify(manuscript);

describe("validateTheme", () => {
  it("accepts a serialized built-in theme", () => {
    const r = parseTheme(validJson);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.theme.id).toBe(manuscript.id);
  });

  it("rejects a non-object", () => {
    expect(validateTheme(null).ok).toBe(false);
    expect(validateTheme("nope").ok).toBe(false);
  });

  it("rejects unsupported versions", () => {
    expect(validateTheme({ ...manuscript, version: 2 }).ok).toBe(false);
  });

  it("rejects a theme with no palette", () => {
    const r = validateTheme({ ...manuscript, dark: undefined, light: undefined });
    expect(r.ok).toBe(false);
  });

  it("rejects a CSS-injection attempt in a color value", () => {
    const hostile = {
      ...manuscript,
      dark: { ...manuscript.dark, bg: "#000; background: url(http://evil/x)" },
    };
    const r = validateTheme(hostile);
    expect(r.ok).toBe(false);
  });

  it("rejects url() and expression() payloads", () => {
    for (const bad of ["url(x)", "expression(alert(1))", "#fff} body{display:none", "@import 'x'"]) {
      const r = validateTheme({
        ...manuscript,
        dark: { ...manuscript.dark, accent: bad },
      });
      expect(r.ok, bad).toBe(false);
    }
  });

  it("rejects a hostile font family", () => {
    const r = validateTheme({
      ...manuscript,
      fonts: { ...manuscript.fonts, ui: "sans; } * { display:none }" },
    });
    expect(r.ok).toBe(false);
  });

  it("rejects an out-of-range density", () => {
    expect(validateTheme({ ...manuscript, metrics: { radius: "8px", density: 9 } }).ok).toBe(false);
  });

  it("rejects an invalid radius length", () => {
    expect(
      validateTheme({ ...manuscript, metrics: { radius: "8", density: 1 } }).ok,
    ).toBe(false);
  });

  it("accepts rgba and hex colors", () => {
    const ok = validateTheme({
      ...manuscript,
      dark: { ...manuscript.dark, accentSoft: "rgba(10, 20, 30, 0.5)", bg: "#abc" },
    });
    expect(ok.ok).toBe(true);
  });

  it("reports invalid JSON for parseTheme", () => {
    const r = parseTheme("{ not json");
    expect(r.ok).toBe(false);
  });
});
