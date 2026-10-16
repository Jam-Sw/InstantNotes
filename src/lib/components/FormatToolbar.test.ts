import { describe, it, expect, vi, afterEach } from "vitest";
import { render, fireEvent, cleanup } from "@testing-library/svelte";
import FormatToolbar from "./FormatToolbar.svelte";
import { NO_MARKS } from "$lib/markdown-active";

vi.mock("$lib/stores/editor.svelte", () => ({
  editorPrefs: { zoom: 1, zoomIn: vi.fn(), zoomOut: vi.fn(), resetZoom: vi.fn() },
}));

afterEach(cleanup);

const LABELS = [
  "Undo",
  "Redo",
  "Heading",
  "Bold",
  "Italic",
  "Strikethrough",
  "Code",
  "Blockquote",
  "Bulleted list",
  "Task list",
  "Link",
  "Insert image",
  "Markdown source",
  "Zoom out",
  "Reset zoom",
  "Zoom in",
];

describe("FormatToolbar", () => {
  it("labels every button and groups them in one toolbar", () => {
    const { getByRole } = render(FormatToolbar, {
      active: NO_MARKS,
      onFormat: vi.fn(),
      onImage: vi.fn(),
      onToggleSource: vi.fn(),
    });
    expect(getByRole("toolbar", { name: "Formatting" })).toBeTruthy();
    for (const label of LABELS) expect(getByRole("button", { name: label })).toBeTruthy();
  });

  it("presses the buttons whose mark is active, and the heading at any level", () => {
    const { getByRole } = render(FormatToolbar, {
      active: { ...NO_MARKS, bold: true, heading: 2 },
      onFormat: vi.fn(),
    });
    expect(getByRole("button", { name: "Bold" }).getAttribute("aria-pressed")).toBe("true");
    expect(getByRole("button", { name: "Italic" }).getAttribute("aria-pressed")).toBe("false");
    expect(getByRole("button", { name: "Heading" }).getAttribute("aria-pressed")).toBe("true");
    expect(getByRole("button", { name: "Heading" }).getAttribute("title")).toBe(
      "Heading 2 (click for heading 3)",
    );
  });

  it("disables undo and redo until there is something to undo or redo", async () => {
    const onUndo = vi.fn();
    const onRedo = vi.fn();
    const { getByRole, rerender } = render(FormatToolbar, {
      active: NO_MARKS,
      onFormat: vi.fn(),
      onUndo,
      onRedo,
    });
    expect((getByRole("button", { name: "Undo" }) as HTMLButtonElement).disabled).toBe(true);
    expect((getByRole("button", { name: "Redo" }) as HTMLButtonElement).disabled).toBe(true);

    await rerender({ active: NO_MARKS, onFormat: vi.fn(), onUndo, onRedo, history: { undo: true, redo: false } });
    await fireEvent.click(getByRole("button", { name: "Undo" }));
    expect(onUndo).toHaveBeenCalledOnce();
    expect((getByRole("button", { name: "Redo" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("reflects the source view on the Markdown button and sends every format kind", async () => {
    const onFormat = vi.fn();
    const onToggleSource = vi.fn();
    const { getByRole } = render(FormatToolbar, {
      active: NO_MARKS,
      sourceMode: true,
      onFormat,
      onToggleSource,
    });
    const source = getByRole("button", { name: "Markdown source" });
    expect(source.getAttribute("aria-pressed")).toBe("true");
    await fireEvent.click(source);
    expect(onToggleSource).toHaveBeenCalledOnce();

    for (const [label, kind] of [
      ["Heading", "heading"],
      ["Bold", "bold"],
      ["Italic", "italic"],
      ["Strikethrough", "strike"],
      ["Code", "code"],
      ["Blockquote", "quote"],
      ["Bulleted list", "list"],
      ["Task list", "task"],
      ["Link", "link"],
    ]) {
      await fireEvent.click(getByRole("button", { name: label }));
      expect(onFormat).toHaveBeenLastCalledWith(kind);
    }
  });

  it("offers the image button only when the host can insert one", () => {
    const { queryByRole } = render(FormatToolbar, { active: NO_MARKS, onFormat: vi.fn() });
    expect(queryByRole("button", { name: "Insert image" })).toBeNull();
    expect(queryByRole("button", { name: "Markdown source" })).toBeNull();
  });
});
