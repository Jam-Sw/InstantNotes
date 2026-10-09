// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { render, fireEvent, cleanup, waitFor } from "@testing-library/svelte";
import CapturePage from "./+page.svelte";
import { createNote, getNote, listNotes, updateNote } from "$lib/api/client";
import type { Note } from "$lib/api/types";

vi.mock("$lib/api/client", () => ({
  captureInputReady: vi.fn(),
  createNote: vi.fn(),
  deleteSetting: vi.fn(),
  getNote: vi.fn(),
  getSetting: vi.fn(() => Promise.resolve(null)),
  hideCapture: vi.fn(() => Promise.resolve()),
  listNotes: vi.fn(),
  openLibrary: vi.fn(),
  setSetting: vi.fn(),
  updateNote: vi.fn(),
}));
vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn(() => Promise.resolve(() => {})),
}));
vi.mock("@tauri-apps/api/window", () => ({
  getCurrentWindow: () => ({ onFocusChanged: () => Promise.resolve(() => {}) }),
}));
vi.mock("$lib/stores/theme.svelte", () => ({ theme: { init: vi.fn() } }));
vi.mock("$lib/agreements.svelte", () => ({ agreements: { done: true } }));

const note = (id: string, title: string, over: Partial<Note> = {}) =>
  ({
    id,
    title,
    body: `${title} body`,
    contentKind: "document",
    lastOpenedAt: "2026-10-07T20:00:00Z",
    updatedAt: `u-${id}`,
    ...over,
  }) as Note;

afterEach(cleanup);

beforeEach(() => {
  vi.mocked(createNote).mockReset().mockResolvedValue(note("new", "x"));
  vi.mocked(updateNote).mockReset().mockResolvedValue(note("a", "Roadmap"));
  vi.mocked(getNote).mockReset().mockResolvedValue(note("a", "Roadmap"));
  vi.mocked(listNotes)
    .mockReset()
    .mockResolvedValue([
      note("a", "Roadmap"),
      note("never", "Never opened", { lastOpenedAt: null }),
      note("b", "Groceries"),
    ]);
});

describe("the capture panel", () => {
  it("offers the notes last open in the library and files nothing until one is picked", async () => {
    const { findByRole, getByLabelText, queryByRole } = render(CapturePage);
    await findByRole("button", { name: /Roadmap/ });
    expect(queryByRole("button", { name: /Never opened/ })).toBeNull();
    const box = getByLabelText("Quick capture");
    await fireEvent.input(box, { target: { value: "a new thought" } });
    await fireEvent.keyDown(box, { key: "Enter" });
    await waitFor(() => expect(createNote).toHaveBeenCalledWith({ body: "a new thought" }));
    expect(updateNote).not.toHaveBeenCalled();
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
    await waitFor(() =>
      expect(updateNote).toHaveBeenCalledWith("a", {
        body: "Roadmap body\n\none more line",
        expectedUpdatedAt: "u-a",
      }),
    );
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
});
