import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { render, fireEvent, cleanup } from "@testing-library/svelte";
import SettingsEditor from "./SettingsEditor.svelte";
import { editorPrefs } from "$lib/stores/editor.svelte";
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
});
