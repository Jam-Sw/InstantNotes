// @vitest-environment jsdom
// `editorPrefs.init()`'s read-from-settings path (and the touched-field race
// guard) is covered directly in stores/editor.svelte.test.ts; this file only
// covers what the page renders and persists, following SettingsImages.test.ts's
// convention of resetting the singleton's $state fields directly per test.
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
    const sw = await findByRole("switch", { name: "Open the formatting toolbar by default" });
    await fireEvent.click(sw);
    expect(vi.mocked(setSetting)).toHaveBeenCalledWith("editor.toolbarOpen", true);
    // The other toggle must not have moved.
    expect(
      (await findByRole("switch", { name: "Show exact save time" })).getAttribute(
        "aria-checked",
      ),
    ).toBe("false");
  });
});
