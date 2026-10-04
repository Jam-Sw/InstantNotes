// @vitest-environment jsdom
// The grid's save path and its keyboard contract, driven as keys and
// clipboard events on the real DOM: what reaches the owner, and when; what
// the grid stops, and what it lets through to the window.
import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { tick } from "svelte";
import { cleanup, fireEvent, render } from "@testing-library/svelte";
import SheetGrid from "./SheetGrid.svelte";
import { parseSheet, serializeSheet, type Sheet } from "$lib/sheet/model";

vi.mock("$lib/stores/toasts.svelte", () => ({ toasts: { show: vi.fn() } }));
import { toasts } from "$lib/stores/toasts.svelte";

function grid(rows: string[][]): string {
  const width = Math.max(...rows.map((r) => r.length));
  return serializeSheet({
    cols: Array.from({ length: width }, () => ({ w: 120 })),
    rows: rows.map((r) => [...r, ...Array(width - r.length).fill("")]),
  });
}

const STORED = grid([
  ["Date", "Build", "ms"],
  ["2026-10-03", "a1f3", "412"],
  ["", "", ""],
]);

function mount(overrides: Record<string, unknown> = {}) {
  const onchange = vi.fn();
  let flushHook: (() => void) | null = null;
  const view = render(SheetGrid, {
    noteId: "s1",
    surfaceData: STORED,
    readonly: false,
    onchange,
    registerFlush: (f: () => void) => {
      flushHook = f;
      return () => (flushHook = null);
    },
    ...overrides,
  });
  const host = view.container.querySelector<HTMLElement>("[data-sheet]")!;
  const catcher = host.querySelector<HTMLTextAreaElement>(".catcher")!;
  catcher.focus();
  return { view, onchange, host, catcher, flush: () => flushHook?.() };
}

const lastSheet = (onchange: ReturnType<typeof vi.fn>): Sheet =>
  parseSheet(onchange.mock.calls[onchange.mock.calls.length - 1][1]);

function cell(host: HTMLElement, r: number, c: number): HTMLElement {
  return host.querySelector<HTMLElement>(`td[data-r="${r}"][data-c="${c}"]`)!;
}

const key = (target: Element, key: string, init: KeyboardEventInit = {}) =>
  fireEvent.keyDown(target, { key, ...init });

async function type(host: HTMLElement, text: string) {
  const target = document.activeElement ?? host;
  await key(target, text[0]);
  await tick();
  const editor = host.querySelector<HTMLTextAreaElement>(".cell-editor")!;
  editor.value = text;
  await fireEvent.input(editor);
  return editor;
}

beforeEach(() => {
  vi.mocked(toasts.show).mockClear();
});

afterEach(() => {
  cleanup();
});

describe("SheetGrid", () => {
  it("shows the stored grid with its headers", () => {
    const { host } = mount();
    expect(cell(host, 0, 0).textContent?.trim()).toBe("Date");
    expect(cell(host, 1, 2).textContent?.trim()).toBe("412");
    const heads = [...host.querySelectorAll(".colhead")].map((th) => th.textContent?.trim());
    expect(heads).toEqual(["A", "B", "C"]);
    expect(cell(host, 0, 0).classList.contains("active")).toBe(true);
  });

  it("logs a row by keyboard alone: type, Tab, Tab, Enter adds a row and returns to the start column", async () => {
    const { host, catcher, onchange } = mount();
    await key(catcher, "ArrowDown");
    await key(catcher, "ArrowDown");
    expect(cell(host, 2, 0).classList.contains("active")).toBe(true);

    let editor = await type(host, "2026-10-04");
    await key(editor, "Tab");
    await tick();
    expect(onchange).toHaveBeenCalledTimes(1);
    expect(cell(host, 2, 1).classList.contains("active")).toBe(true);

    editor = await type(host, "b2c4");
    await key(editor, "Tab");
    await tick();
    editor = await type(host, "398");
    await key(editor, "Enter");
    await tick();

    const sheet = lastSheet(onchange);
    expect(sheet.rows[2]).toEqual(["2026-10-04", "b2c4", "398"]);
    // Enter on the last row added one, and went back to where the Tab run began.
    expect(sheet.rows.length).toBe(4);
    expect(cell(host, 3, 0).classList.contains("active")).toBe(true);
    expect(document.activeElement).toBe(catcher);
  });

  it("Enter on a selected cell edits it with the caret at the end; Escape cancels", async () => {
    const { host, catcher, onchange } = mount();
    await key(catcher, "Enter");
    await tick();
    const editor = host.querySelector<HTMLTextAreaElement>(".cell-editor")!;
    expect(editor.value).toBe("Date");
    expect(editor.selectionStart).toBe(4);
    editor.value = "Changed";
    await fireEvent.input(editor);
    await key(editor, "Escape");
    await tick();
    expect(host.querySelector(".cell-editor")).toBeNull();
    expect(cell(host, 0, 0).textContent?.trim()).toBe("Date");
    expect(onchange).not.toHaveBeenCalled();
  });

  it("hands a cell still being typed in over when the library flushes, and on unmount", async () => {
    const { view, host, onchange, flush } = mount();
    await type(host, "Day");
    expect(onchange).not.toHaveBeenCalled();
    flush();
    expect(onchange).toHaveBeenCalledTimes(1);
    expect(lastSheet(onchange).rows[0][0]).toBe("Day");

    await type(host, "Dusk");
    view.unmount();
    expect(onchange).toHaveBeenCalledTimes(2);
    expect(lastSheet(onchange).rows[0][0]).toBe("Dusk");
  });

  it("clears a range, undoes, and redoes", async () => {
    const { host, catcher, onchange } = mount();
    await key(catcher, "ArrowRight", { shiftKey: true });
    await key(catcher, "ArrowDown", { shiftKey: true });
    await key(catcher, "Delete");
    expect(lastSheet(onchange).rows.slice(0, 2)).toEqual([["", "", "ms"], ["", "", "412"]]);
    await key(catcher, "z", { metaKey: true });
    expect(lastSheet(onchange).rows[0]).toEqual(["Date", "Build", "ms"]);
    await key(catcher, "z", { metaKey: true, shiftKey: true });
    expect(lastSheet(onchange).rows[0]).toEqual(["", "", "ms"]);
    expect(cell(host, 1, 1).classList.contains("selected")).toBe(true);
  });

  it("copies a range as TSV and pastes a block from Sheets, growing the grid", async () => {
    const { host, catcher, onchange } = mount();
    await key(catcher, "ArrowRight", { shiftKey: true });
    const copied: Record<string, string> = {};
    const copy = new Event("copy", { bubbles: true, cancelable: true }) as Event & {
      clipboardData: unknown;
    };
    copy.clipboardData = { setData: (t: string, v: string) => (copied[t] = v) };
    catcher.dispatchEvent(copy);
    expect(copied["text/plain"]).toBe("Date\tBuild");

    await key(catcher, "ArrowDown");
    await key(catcher, "ArrowDown");
    await key(catcher, "ArrowDown"); // stays on the last row
    await key(catcher, "ArrowLeft");
    expect(cell(host, 2, 0).classList.contains("active")).toBe(true);
    const paste = new Event("paste", { bubbles: true, cancelable: true }) as Event & {
      clipboardData: unknown;
    };
    paste.clipboardData = { getData: () => "x\ty\tz\tw\n1\t2\t3\t4\n" };
    catcher.dispatchEvent(paste);
    await tick();
    const sheet = lastSheet(onchange);
    expect(sheet.cols.length).toBe(4);
    expect(sheet.rows.length).toBe(4);
    expect(sheet.rows[2]).toEqual(["x", "y", "z", "w"]);
    expect(sheet.rows[3]).toEqual(["1", "2", "3", "4"]);
    expect(cell(host, 3, 3).classList.contains("selected")).toBe(true);
  });

  it("takes in a grid written from outside, as an undoable step, keeping the selection", async () => {
    const { view, host, catcher, onchange } = mount();
    await key(catcher, "ArrowDown");
    const theirs = grid([
      ["Date", "Build", "ms"],
      ["2026-10-03", "a1f3", "412"],
      ["2026-10-04", "agent", "1"],
    ]);
    await view.rerender({ surfaceData: theirs });
    expect(cell(host, 2, 1).textContent?.trim()).toBe("agent");
    expect(cell(host, 1, 0).classList.contains("active")).toBe(true);
    expect(onchange).not.toHaveBeenCalled();
    await key(catcher, "z", { metaKey: true });
    expect(lastSheet(onchange).rows[2]).toEqual(["", "", ""]);
  });

  it("ignores its own grid echoed back through the prop", async () => {
    const { view, host, onchange } = mount();
    await type(host, "Day");
    await key(host.querySelector(".cell-editor")!, "Enter");
    await tick();
    const emitted = onchange.mock.calls[0][1];
    await view.rerender({ surfaceData: emitted });
    expect(cell(host, 0, 0).textContent?.trim()).toBe("Day");
    expect(onchange).toHaveBeenCalledTimes(1);
  });

  it("stops only its own keys: app chords reach the window", async () => {
    const { catcher } = mount();
    const seen: string[] = [];
    const spy = (e: KeyboardEvent) => seen.push(`${e.metaKey ? "⌘" : ""}${e.shiftKey ? "⇧" : ""}${e.key}`);
    window.addEventListener("keydown", spy);
    try {
      await key(catcher, "ArrowDown");
      await key(catcher, "a", { metaKey: true });
      await key(catcher, "k", { metaKey: true });
      await key(catcher, "N", { metaKey: true, shiftKey: true });
      await key(catcher, "\\", { metaKey: true });
      await key(catcher, "A", { metaKey: true, shiftKey: true });
    } finally {
      window.removeEventListener("keydown", spy);
    }
    expect(seen).toEqual(["⌘k", "⌘⇧N", "⌘\\", "⌘⇧A"]);
  });

  it("read only: moves and copies, never edits", async () => {
    const { host, catcher, onchange } = mount({ readonly: true });
    await key(catcher, "x");
    await tick();
    expect(host.querySelector(".cell-editor")).toBeNull();
    await key(catcher, "Delete");
    expect(onchange).not.toHaveBeenCalled();
    await key(catcher, "ArrowRight");
    expect(cell(host, 0, 1).classList.contains("active")).toBe(true);
  });

  it("keeps only the rows near the viewport in the DOM once a sheet is tall", () => {
    const tall = grid(Array.from({ length: 1000 }, (_, i) => [String(i)]));
    const { host } = mount({ surfaceData: tall });
    const rendered = host.querySelectorAll("td[data-r]").length;
    expect(rendered).toBeGreaterThan(0);
    expect(rendered).toBeLessThan(100);
    expect(host.querySelector("tr.pad")).not.toBeNull();
  });

  it("says why when the grid is at its limits", async () => {
    const { host, catcher } = mount({
      surfaceData: grid(Array.from({ length: 5000 }, (_, i) => [String(i)])),
    });
    await key(catcher, "End", { metaKey: true });
    await key(catcher, "Enter");
    await tick();
    await key(host.querySelector(".cell-editor")!, "Enter");
    await tick();
    expect(vi.mocked(toasts.show)).toHaveBeenCalledWith(expect.stringContaining("5,000 rows"));
  });
});
