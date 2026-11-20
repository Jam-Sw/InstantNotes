import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { render, fireEvent, cleanup, waitFor } from "@testing-library/svelte";
import SettingsBehavior from "./SettingsBehavior.svelte";
import { getSetting, setCaptureShortcut, setSetting } from "$lib/api/client";
import { confirmDialog } from "$lib/stores/confirm.svelte";
import { layout } from "$lib/stores/layout.svelte";
import { sidebar } from "$lib/stores/sidebar.svelte";
import { toasts } from "$lib/stores/toasts.svelte";
import { updater } from "$lib/stores/updater.svelte";

vi.mock("$lib/api/client", () => ({
  getSetting: vi.fn(),
  setSetting: vi.fn(),
  setCaptureShortcut: vi.fn(),
  installUpdate: vi.fn(),
  restartApp: vi.fn(),
}));
vi.mock("@tauri-apps/plugin-updater", () => ({ check: vi.fn() }));

afterEach(cleanup);

beforeEach(() => {
  toasts.items.splice(0);
  vi.mocked(getSetting).mockReset().mockResolvedValue(undefined);
  vi.mocked(setSetting).mockReset().mockResolvedValue(undefined);
  vi.mocked(setCaptureShortcut).mockReset().mockResolvedValue(undefined);
  confirmDialog.level = "always";
  layout.paneMax = "default";
  updater.checkInterval = "6h";
});

describe("SettingsBehavior", () => {
  it("shows the shortcut and tray rows, with the rest under More", () => {
    const { getByRole, getByText } = render(SettingsBehavior);
    getByRole("textbox", { name: "Capture shortcut" });
    getByRole("switch", { name: "Close to tray" });
    const more = getByText("More").closest("details");
    expect(more?.open).toBe(false);
    expect(more?.querySelector('[aria-label="Check for updates"]')).not.toBeNull();
    expect(more?.querySelector('[aria-label="Confirm before"]')).not.toBeNull();
    expect(more?.querySelector('[aria-label="Pane width limit"]')).not.toBeNull();
  });

  it("starts from today's behaviour", () => {
    const { getByRole } = render(SettingsBehavior);
    expect((getByRole("textbox", { name: "Capture shortcut" }) as HTMLInputElement).value).toBe("");
    expect(getByRole("radio", { name: "6 hours" }).getAttribute("aria-checked")).toBe("true");
    expect(getByRole("radio", { name: "Always" }).getAttribute("aria-checked")).toBe("true");
    expect(getByRole("radio", { name: "Default" }).getAttribute("aria-checked")).toBe("true");
  });

  it("offers no way to turn confirmations off", () => {
    const { getAllByRole } = render(SettingsBehavior);
    const confirm = getAllByRole("radiogroup").find((g) => g.getAttribute("aria-label") === "Confirm before");
    expect(Array.from(confirm!.querySelectorAll("button")).map((b) => b.textContent?.trim())).toEqual([
      "Always",
      "Permanent only",
    ]);
  });

  it("shows the saved shortcut and tray choice", async () => {
    vi.mocked(getSetting).mockImplementation(async (key: string) =>
      key === "shortcuts.capture" ? "Ctrl+Alt+K" : key === "window.closeToTray" ? false : undefined,
    );
    const { getByRole } = render(SettingsBehavior);
    await waitFor(() =>
      expect((getByRole("textbox", { name: "Capture shortcut" }) as HTMLInputElement).value).toBe("Ctrl+Alt+K"),
    );
    expect(getByRole("switch", { name: "Close to tray" }).getAttribute("aria-checked")).toBe("false");
  });

  it("sets a new shortcut", async () => {
    const { getByRole } = render(SettingsBehavior);
    const input = getByRole("textbox", { name: "Capture shortcut" }) as HTMLInputElement;
    await fireEvent.input(input, { target: { value: " Ctrl+Shift+K " } });
    await fireEvent.change(input);
    expect(setCaptureShortcut).toHaveBeenCalledWith("Ctrl+Shift+K");
    expect(toasts.items).toHaveLength(0);
  });

  it("explains a refused shortcut and keeps the old one", async () => {
    vi.mocked(getSetting).mockImplementation(async (key: string) =>
      key === "shortcuts.capture" ? "Ctrl+Alt+K" : undefined,
    );
    vi.mocked(setCaptureShortcut).mockRejectedValue(new Error("already in use"));
    const { getByRole } = render(SettingsBehavior);
    const input = getByRole("textbox", { name: "Capture shortcut" }) as HTMLInputElement;
    await waitFor(() => expect(input.value).toBe("Ctrl+Alt+K"));
    await fireEvent.input(input, { target: { value: "Ctrl+Shift+J" } });
    await fireEvent.change(input);
    await waitFor(() => expect(input.value).toBe("Ctrl+Alt+K"));
    expect(toasts.items.map((t) => t.message)).toEqual(["Couldn't set shortcut: already in use"]);
  });

  it("saves the tray choice", async () => {
    const { getByRole } = render(SettingsBehavior);
    const toggle = getByRole("switch", { name: "Close to tray" });
    const before = toggle.getAttribute("aria-checked") === "true";
    await fireEvent.click(toggle);
    expect(setSetting).toHaveBeenLastCalledWith("window.closeToTray", !before);
  });

  it("saves the update interval and the confirm level", async () => {
    const { getByRole } = render(SettingsBehavior);
    await fireEvent.click(getByRole("radio", { name: "Daily" }));
    expect(setSetting).toHaveBeenLastCalledWith("updates.checkInterval", "daily");
    await fireEvent.click(getByRole("radio", { name: "Permanent only" }));
    expect(setSetting).toHaveBeenLastCalledWith("confirm.level", "permanent");
  });

  it("saves the pane limit and refits the saved widths", async () => {
    const refit = vi.spyOn(sidebar, "refitPanes").mockImplementation(() => {});
    const { getByRole } = render(SettingsBehavior);
    await fireEvent.click(getByRole("radio", { name: "Wide" }));
    expect(setSetting).toHaveBeenLastCalledWith("layout.paneMax", "wide");
    expect(refit).toHaveBeenCalled();
    refit.mockRestore();
  });
});

describe("SettingsBehavior reset", () => {
  it("resets the confirm level, pane width and update interval", async () => {
    const { getByRole, queryAllByRole } = render(SettingsBehavior);
    expect(queryAllByRole("button", { name: "Reset" })).toHaveLength(0);
    await fireEvent.click(getByRole("radio", { name: "Permanent only" }));
    await fireEvent.click(getByRole("radio", { name: "Wide" }));
    await fireEvent.click(getByRole("radio", { name: "Never" }));
    const buttons = queryAllByRole("button", { name: "Reset" });
    expect(buttons).toHaveLength(3);
    for (const b of buttons) await fireEvent.click(b);
    expect(confirmDialog.level).toBe("always");
    expect(layout.paneMax).toBe("default");
    expect(updater.checkInterval).toBe("6h");
    expect(queryAllByRole("button", { name: "Reset" })).toHaveLength(0);
  });

  it("resets the capture shortcut to empty", async () => {
    const { getByRole, queryAllByRole } = render(SettingsBehavior);
    const input = getByRole("textbox", { name: "Capture shortcut" }) as HTMLInputElement;
    await fireEvent.input(input, { target: { value: "Ctrl+Alt+N" } });
    await fireEvent.change(input);
    await waitFor(() => expect(setCaptureShortcut).toHaveBeenCalledWith("Ctrl+Alt+N"));
    await fireEvent.click(queryAllByRole("button", { name: "Reset" })[0]);
    await waitFor(() => expect(setCaptureShortcut).toHaveBeenLastCalledWith(""));
    expect(input.value).toBe("");
  });
});
