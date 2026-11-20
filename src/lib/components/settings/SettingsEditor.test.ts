import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { render, fireEvent, cleanup } from "@testing-library/svelte";
import SettingsEditor from "./SettingsEditor.svelte";
import { editorPrefs } from "$lib/stores/editor.svelte";
import { pluginPrefs } from "$lib/stores/plugins.svelte";
import { plugins } from "$lib/plugin";
import { setSetting } from "$lib/api/client";

vi.mock("$lib/api/client", () => ({
  getSetting: vi.fn().mockResolvedValue(undefined),
  setSetting: vi.fn().mockResolvedValue(undefined),
}));

afterEach(cleanup);

beforeEach(() => {
  editorPrefs.showExactTime = false;
  editorPrefs.toolbarOpen = false;
  editorPrefs.sourceMode = false;
  editorPrefs.spellcheck = false;
  editorPrefs.wrap = true;
  editorPrefs.titleWrap = true;
  editorPrefs.autosaveMs = 400;
  editorPrefs.indentWidth = 2;
  for (const p of plugins) for (const spec of p.prefs ?? []) pluginPrefs.setValue(p, spec, spec.default);
  vi.mocked(setSetting).mockClear();
});

describe("SettingsEditor", () => {
  it("shows Show exact save time off by default", async () => {
    const { findByRole } = render(SettingsEditor);
    const sw = await findByRole("switch", { name: "Show exact save time" });
    expect(sw.getAttribute("aria-checked")).toBe("false");
  });

  it("toggling Show exact save time persists the setting", async () => {
    const { findByRole } = render(SettingsEditor);
    const sw = await findByRole("switch", { name: "Show exact save time" });
    await fireEvent.click(sw);
    expect(sw.getAttribute("aria-checked")).toBe("true");
    expect(vi.mocked(setSetting)).toHaveBeenCalledWith("editor.showExactTime", true);
  });

  it("reflects an already-on showExactTime from the store", async () => {
    editorPrefs.showExactTime = true;
    const { findByRole } = render(SettingsEditor);
    const sw = await findByRole("switch", { name: "Show exact save time" });
    expect(sw.getAttribute("aria-checked")).toBe("true");
  });

  it("toggling the formatting toolbar default persists separately from the timestamp toggle", async () => {
    const { findByRole } = render(SettingsEditor);
    const sw = await findByRole("switch", { name: "Show the formatting toolbar" });
    await fireEvent.click(sw);
    expect(vi.mocked(setSetting)).toHaveBeenCalledWith("editor.toolbarOpen", true);
    const source = await findByRole("switch", { name: "Show Markdown source" });
    expect(source.getAttribute("aria-checked")).toBe("false");
    await fireEvent.click(source);
    expect(vi.mocked(setSetting)).toHaveBeenCalledWith("editor.sourceMode", true);
    expect(
      (await findByRole("switch", { name: "Show exact save time" })).getAttribute(
        "aria-checked",
      ),
    ).toBe("false");
  });

  it("turns tag suggestions off and sets how sure they must be, saved under one key", async () => {
    const { findByRole, findAllByRole } = render(SettingsEditor);
    const sw = await findByRole("switch", { name: "Tag suggestions" });
    expect(sw.getAttribute("aria-checked")).toBe("true");
    await fireEvent.click(sw);
    expect(vi.mocked(setSetting)).toHaveBeenLastCalledWith("suggest.tags", { enabled: false, showAt: 0.5 });
    const [tagCareful] = await findAllByRole("radio", { name: "Careful" });
    await fireEvent.click(tagCareful);
    expect(vi.mocked(setSetting)).toHaveBeenLastCalledWith("suggest.tags", { enabled: false, showAt: 0.7 });
  });

  it("turns notes around this one off and sets how close they must be under suggest.related", async () => {
    const { findByRole, findAllByRole } = render(SettingsEditor);
    const sw = await findByRole("switch", { name: "Around this note" });
    expect(sw.getAttribute("aria-checked")).toBe("true");
    await fireEvent.click(sw);
    expect(vi.mocked(setSetting)).toHaveBeenLastCalledWith("suggest.related", { enabled: false, showAt: 0.5 });
    const [, relatedCareful] = await findAllByRole("radio", { name: "Careful" });
    await fireEvent.click(relatedCareful);
    expect(vi.mocked(setSetting)).toHaveBeenLastCalledWith("suggest.related", { enabled: false, showAt: 0.7 });
  });

  it("toggles spellcheck, off by default, under editor.spellcheck", async () => {
    const { findByRole } = render(SettingsEditor);
    const sw = await findByRole("switch", { name: "Spellcheck" });
    expect(sw.getAttribute("aria-checked")).toBe("false");
    await fireEvent.click(sw);
    expect(vi.mocked(setSetting)).toHaveBeenCalledWith("editor.spellcheck", true);
  });

  it("toggles wrap lines, on by default, under editor.wrap", async () => {
    const { findByRole } = render(SettingsEditor);
    const sw = await findByRole("switch", { name: "Wrap lines" });
    expect(sw.getAttribute("aria-checked")).toBe("true");
    await fireEvent.click(sw);
    expect(vi.mocked(setSetting)).toHaveBeenCalledWith("editor.wrap", false);
  });

  it("toggles wrap long titles, on by default, under editor.titleWrap", async () => {
    const { findByRole } = render(SettingsEditor);
    const sw = await findByRole("switch", { name: "Wrap long titles" });
    expect(sw.getAttribute("aria-checked")).toBe("true");
    await fireEvent.click(sw);
    expect(vi.mocked(setSetting)).toHaveBeenCalledWith("editor.titleWrap", false);
  });

  it("saves calc precision, autosave delay and indent width under their own keys", async () => {
    const { findByRole } = render(SettingsEditor);
    expect((await findByRole("radio", { name: "Short" })).getAttribute("aria-checked")).toBe("true");
    await fireEvent.click(await findByRole("radio", { name: "Long" }));
    expect(vi.mocked(setSetting)).toHaveBeenLastCalledWith("plugin.calc.precision", "long");
    expect((await findByRole("radio", { name: "Normal" })).getAttribute("aria-checked")).toBe("true");
    await fireEvent.click(await findByRole("radio", { name: "Instant" }));
    expect(vi.mocked(setSetting)).toHaveBeenLastCalledWith("editor.autosaveMs", 150);
    await fireEvent.click(await findByRole("radio", { name: "Relaxed" }));
    expect(vi.mocked(setSetting)).toHaveBeenLastCalledWith("editor.autosaveMs", 1000);
    expect((await findByRole("radio", { name: "2" })).getAttribute("aria-checked")).toBe("true");
    await fireEvent.click(await findByRole("radio", { name: "4" }));
    expect(vi.mocked(setSetting)).toHaveBeenLastCalledWith("editor.indentWidth", 4);
  });
});

describe("SettingsEditor plugin rows", () => {
  it("draws a switch, choices and a text field from a plugin's prefs, and shows conditional rows", async () => {
    const { findByRole, queryByRole } = render(SettingsEditor);
    const filler = await findByRole("switch", { name: "Filler words" });
    expect(filler.getAttribute("aria-checked")).toBe("false");
    await fireEvent.click(filler);
    expect(vi.mocked(setSetting)).toHaveBeenLastCalledWith("plugin.assist.filler", "on");
    expect(queryByRole("textbox", { name: "Model address" })).toBeNull();
    await fireEvent.click(await findByRole("radio", { name: "Model" }));
    expect(vi.mocked(setSetting)).toHaveBeenLastCalledWith("plugin.assist.complete", "model");
    const address = await findByRole("textbox", { name: "Model address" });
    await fireEvent.change(address, { target: { value: " http://127.0.0.1:8080 " } });
    expect(vi.mocked(setSetting)).toHaveBeenLastCalledWith("plugin.assist.address", "http://127.0.0.1:8080");
    expect(await findByRole("button", { name: "Choose" })).toBeTruthy();
  });
});

describe("SettingsEditor reset", () => {
  it("shows Reset on a changed row and restores the default", async () => {
    const { findByRole, queryAllByRole, getByRole } = render(SettingsEditor);
    await findByRole("switch", { name: "Spellcheck" });
    editorPrefs.toolbarOpen = true;
    await fireEvent.click(getByRole("switch", { name: "Spellcheck" }));
    await fireEvent.click(getByRole("radio", { name: "Wide" }));
    await fireEvent.click(getByRole("radio", { name: "4" }));
    expect(queryAllByRole("button", { name: "Reset" })).toHaveLength(3);

    await fireEvent.click(getByRole("radiogroup", { name: "Indent width" }).closest(".pref-row")!.querySelector(".pref-reset") as HTMLElement);
    expect(editorPrefs.indentWidth).toBe(2);
    expect(vi.mocked(setSetting)).toHaveBeenLastCalledWith("editor.indentWidth", 2);

    await fireEvent.click(getByRole("radiogroup", { name: "Width" }).closest(".pref-row")!.querySelector(".pref-reset") as HTMLElement);
    expect(editorPrefs.width).toBe("readable");

    await fireEvent.click(getByRole("switch", { name: "Spellcheck" }).closest(".pref-row")!.querySelector(".pref-reset") as HTMLElement);
    expect(editorPrefs.spellcheck).toBe(false);
    expect(queryAllByRole("button", { name: "Reset" })).toHaveLength(0);
  });
});
