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

  it("emits new metric vars with defaults when not set by the theme", () => {
    // Built-in themes now set their own elevation/typography, so use a bare
    // theme that omits the optional metrics to exercise the default fallback.
    const bare: Theme = { ...manuscript, metrics: { radius: "8px", density: 1.15 } };
    const vars = themeToVars(bare, "dark");
    expect(vars["--radius-lg"]).toBe("calc(8px + 4px)");
    expect(vars["--shadow"]).toMatch(/^0 \d/);
    expect(vars["--shadow-lg"]).toMatch(/^0 \d/);
    expect(vars["--leading"]).toBe("1.5");
    expect(vars["--tracking"]).toBe("0");
  });

  it("uses explicit metric overrides when provided", () => {
    const custom: typeof manuscript = {
      ...manuscript,
      metrics: {
        ...manuscript.metrics,
        radiusLg: "16px",
        shadow: "none",
        shadowLg: "0 24px 64px rgba(0,0,0,0.6)",
        leading: "1.7",
        tracking: "-0.01em",
      },
    };
    const vars = themeToVars(custom, "dark");
    expect(vars["--radius-lg"]).toBe("16px");
    expect(vars["--shadow"]).toBe("none");
    expect(vars["--shadow-lg"]).toBe("0 24px 64px rgba(0,0,0,0.6)");
    expect(vars["--leading"]).toBe("1.7");
    expect(vars["--tracking"]).toBe("-0.01em");
  });

  it("uses mono for body when the theme says so", () => {
    const vars = themeToVars(terminal, "dark");
    expect(vars["--font-body"]).toBe(terminal.fonts.mono);
  });
});
