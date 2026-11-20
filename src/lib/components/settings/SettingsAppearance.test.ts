import { describe, it, expect, vi, afterEach } from "vitest";
import { render, cleanup, fireEvent } from "@testing-library/svelte";
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

describe("SettingsAppearance rows", () => {
  it("shows the basic rows and keeps line height and accent under More", () => {
    const { getByRole, getByText } = render(SettingsAppearance);
    for (const name of ["Motion", "Density", "Toast time"]) getByRole("radiogroup", { name });
    getByRole("switch", { name: "Scrollbars" });
    const more = getByText("More").closest("details");
    expect(more?.open).toBe(false);
    expect(more?.querySelector('[aria-label="Line height"]')).not.toBeNull();
    expect(more?.querySelector('[aria-label="Accent"]')).not.toBeNull();
  });

  it("writes the chosen values to the stores", async () => {
    const { theme } = await import("$lib/stores/theme.svelte");
    const { toasts } = await import("$lib/stores/toasts.svelte");
    const { getByRole } = render(SettingsAppearance);
    await fireEvent.click(getByRole("radio", { name: "Off" }));
    expect(theme.motion).toBe("off");
    await fireEvent.click(getByRole("radio", { name: "Roomy" }));
    expect(theme.density).toBe("roomy");
    await fireEvent.click(getByRole("switch", { name: "Scrollbars" }));
    expect(theme.scrollbars).toBe(true);
    await fireEvent.click(getByRole("radio", { name: "Stay" }));
    expect(toasts.durationMs).toBe(0);
    await fireEvent.click(getByRole("radio", { name: "Loose" }));
    expect(theme.leading).toBe("loose");
  });
});

describe("SettingsAppearance reset", () => {
  it("shows Reset only for changed rows and restores the default", async () => {
    const { theme } = await import("$lib/stores/theme.svelte");
    const { toasts } = await import("$lib/stores/toasts.svelte");
    theme.motion = "system";
    theme.density = "default";
    theme.scrollbars = false;
    theme.leading = "default";
    theme.accent = null;
    toasts.durationMs = 5000;
    const { queryAllByRole, getByRole, getByLabelText } = render(SettingsAppearance);
    expect(queryAllByRole("button", { name: "Reset" })).toHaveLength(0);

    await fireEvent.click(getByRole("radio", { name: "Off" }));
    await fireEvent.click(getByRole("radio", { name: "Roomy" }));
    await fireEvent.click(getByRole("switch", { name: "Scrollbars" }));
    await fireEvent.click(getByRole("radio", { name: "Stay" }));
    await fireEvent.click(getByRole("radio", { name: "Loose" }));
    expect(queryAllByRole("button", { name: "Reset" })).toHaveLength(5);

    const group = (name: string) => getByRole("radiogroup", { name }).closest(".pref-row") as HTMLElement;
    for (const name of ["Motion", "Density", "Toast time", "Line height"]) {
      await fireEvent.click(group(name).querySelector(".pref-reset") as HTMLElement);
    }
    await fireEvent.click(getByRole("switch", { name: "Scrollbars" }).closest(".pref-row")!.querySelector(".pref-reset") as HTMLElement);
    expect(theme.motion).toBe("system");
    expect(theme.density).toBe("default");
    expect(theme.leading).toBe("default");
    expect(theme.scrollbars).toBe(false);
    expect(toasts.durationMs).toBe(5000);
    expect(queryAllByRole("button", { name: "Reset" })).toHaveLength(0);
    expect(getByLabelText("Body font")).toBeTruthy();
  });
});
