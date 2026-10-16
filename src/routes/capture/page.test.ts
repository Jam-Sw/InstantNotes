import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { render, fireEvent, cleanup, waitFor } from "@testing-library/svelte";
import CapturePage from "./+page.svelte";
import {
  captureAppend,
  captureTargets,
  createNote,
  hideCapture,
  openLibrary,
} from "$lib/api/client";
import type { Note } from "$lib/api/types";

vi.mock("$lib/api/client", () => ({
  captureAppend: vi.fn(),
  captureInputReady: vi.fn(),
  captureTargets: vi.fn(),
  createNote: vi.fn(),
  deleteSetting: vi.fn(),
  getSetting: vi.fn(() => Promise.resolve(null)),
  hideCapture: vi.fn(() => Promise.resolve()),
  openLibrary: vi.fn(() => Promise.resolve()),
  setSetting: vi.fn(),
}));
vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn(() => Promise.resolve(() => {})),
}));
vi.mock("@tauri-apps/api/window", () => ({
  getCurrentWindow: () => ({ onFocusChanged: () => Promise.resolve(() => {}) }),
}));
vi.mock("$lib/stores/theme.svelte", () => ({ theme: { init: vi.fn() } }));
vi.mock("$lib/agreements.svelte", () => ({ agreements: { done: true } }));

afterEach(cleanup);

beforeEach(() => {
  vi.mocked(createNote).mockReset().mockResolvedValue({ id: "new" } as Note);
  vi.mocked(captureAppend).mockReset().mockResolvedValue();
  vi.mocked(hideCapture).mockClear();
  vi.mocked(openLibrary).mockClear();
  vi.mocked(captureTargets)
    .mockReset()
    .mockResolvedValue([
      { id: "a", title: "Roadmap" },
      { id: "b", title: "Groceries" },
    ]);
});

describe("the capture panel", () => {
  it("offers the notes last open in the library and files nothing until one is picked", async () => {
    const { findByRole, getByLabelText } = render(CapturePage);
    await findByRole("button", { name: /Roadmap/ });
    const box = getByLabelText("Quick capture");
    await fireEvent.input(box, { target: { value: "a new thought" } });
    await fireEvent.keyDown(box, { key: "Enter" });
    await waitFor(() => expect(createNote).toHaveBeenCalledWith({ body: "a new thought" }));
    expect(captureAppend).not.toHaveBeenCalled();
    await waitFor(() => expect(hideCapture).toHaveBeenCalledWith(true));
  });

  it("adds to the note picked with Tab instead of starting a new one", async () => {
    const { findByRole, getByLabelText } = render(CapturePage);
    const chip = await findByRole("button", { name: /Roadmap/ });
    const box = getByLabelText("Quick capture");
    await fireEvent.keyDown(box, { key: "Tab" });
    expect(chip.getAttribute("aria-pressed")).toBe("true");
    expect(box.getAttribute("placeholder")).toBe("Add to “Roadmap”");
    await fireEvent.input(box, { target: { value: "one more line" } });
    await fireEvent.keyDown(box, { key: "Enter" });
    await waitFor(() => expect(captureAppend).toHaveBeenCalledWith("a", "one more line"));
    expect(createNote).not.toHaveBeenCalled();
  });

  it("cycles through the notes and back to a new one", async () => {
    const { findByRole, getByLabelText } = render(CapturePage);
    const second = await findByRole("button", { name: /Groceries/ });
    const box = getByLabelText("Quick capture");
    await fireEvent.keyDown(box, { key: "Tab" });
    await fireEvent.keyDown(box, { key: "Tab" });
    expect(second.getAttribute("aria-pressed")).toBe("true");
    await fireEvent.keyDown(box, { key: "Tab" });
    expect(box.getAttribute("placeholder")).toBe("What's on your mind?");
  });

  it("cycles backwards with Shift+Tab", async () => {
    const { findByRole, getByLabelText } = render(CapturePage);
    const last = await findByRole("button", { name: /Groceries/ });
    const box = getByLabelText("Quick capture");
    await fireEvent.keyDown(box, { key: "Tab", shiftKey: true });
    expect(last.getAttribute("aria-pressed")).toBe("true");
    await fireEvent.keyDown(box, { key: "Tab", shiftKey: true });
    await fireEvent.keyDown(box, { key: "Tab", shiftKey: true });
    expect(box.getAttribute("placeholder")).toBe("What's on your mind?");
  });

  it("leaves Enter to the input method while a word is being composed", async () => {
    const { findByRole, getByLabelText } = render(CapturePage);
    await findByRole("button", { name: /Roadmap/ });
    const box = getByLabelText("Quick capture");
    await fireEvent.input(box, { target: { value: "にほん" } });
    await fireEvent.keyDown(box, { key: "Enter", isComposing: true });
    await fireEvent.keyDown(box, { key: "Escape", keyCode: 229 });
    expect(createNote).not.toHaveBeenCalled();
    expect(hideCapture).not.toHaveBeenCalled();
  });

  it("keeps focus with the library when the save opens it", async () => {
    const { findByRole, getByLabelText } = render(CapturePage);
    await findByRole("button", { name: /Roadmap/ });
    const box = getByLabelText("Quick capture");
    await fireEvent.input(box, { target: { value: "look at this later" } });
    await fireEvent.keyDown(box, { key: "Enter", metaKey: true });
    await waitFor(() => expect(hideCapture).toHaveBeenCalledWith(false));
    expect(openLibrary).toHaveBeenCalled();
  });
});
