import { describe, it, expect, vi, afterEach } from "vitest";
import { render, cleanup } from "@testing-library/svelte";
import SettingsAppearance from "./SettingsAppearance.svelte";

vi.mock("$lib/api/client", () => ({
  getSetting: vi.fn(async () => null),
  setSetting: vi.fn(async () => {}),
  setWindowVibrancy: vi.fn(async () => {}),
  setWindowTheme: vi.fn(async () => {}),
}));
vi.mock("$lib/themes/share", () => ({ exportTheme: vi.fn(), importTheme: vi.fn() }));

afterEach(cleanup);

describe("SettingsAppearance", () => {
  it("draws the Night console miniature from its own palette", () => {
    const { getByRole } = render(SettingsAppearance);
    const pick = getByRole("radio", { name: "Night console" });
    const style = pick.querySelector(".preview")?.getAttribute("style") ?? "";
    expect(style).toMatch(/--p-accent:\s*(#f2b35c|#a8650f)/);
    expect(style).toMatch(/--p-radius:\s*2px/);
    expect(pick.getAttribute("aria-checked")).toBe("false");
  });
});
