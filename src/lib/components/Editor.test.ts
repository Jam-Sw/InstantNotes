import { describe, it, expect, vi, afterEach } from "vitest";
import { render, cleanup } from "@testing-library/svelte";
import { EditorView } from "@codemirror/view";
import { undo } from "@codemirror/commands";
import Editor from "./Editor.svelte";

vi.mock("$lib/api/client", () => ({
  getAttachmentsDir: vi.fn().mockResolvedValue("/data/attachments"),
  openUrl: vi.fn().mockResolvedValue(undefined),
  saveAttachment: vi.fn().mockResolvedValue("x.png"),
  allowImageFile: vi.fn().mockResolvedValue(undefined),
  getSetting: vi.fn().mockResolvedValue(undefined),
  setSetting: vi.fn().mockResolvedValue(undefined),
}));

afterEach(cleanup);

interface EditorHandle {
  insertText: (t: string) => void;
}

function findView(container: HTMLElement): EditorView {
  const dom = container.querySelector(".cm-content");
  if (!dom) throw new Error("CodeMirror content DOM not found");
  const view = EditorView.findFromDOM(dom as HTMLElement);
  if (!view) throw new Error("EditorView not found from DOM");
  return view;
}

describe("Editor per-note state isolation", () => {
  it("undo after switching notes never reaches the previous note's edit", async () => {
    const noteA = "Note A original";
    const noteB = "Note B original";
    const { component, container, rerender } = render(Editor, { value: noteA }) as unknown as {
      component: EditorHandle;
      container: HTMLElement;
      rerender: (props: Record<string, unknown>) => Promise<void>;
    };

    const view = findView(container);
    view.dispatch({ selection: { anchor: noteA.length } });
    component.insertText(" plus a typed addition");
    expect(view.state.doc.toString()).toBe("Note A original plus a typed addition");

    await rerender({ value: noteB });
    await Promise.resolve();
    await Promise.resolve();

    const viewAfterSwitch = findView(container);
    undo(viewAfterSwitch);
    const doc = viewAfterSwitch.state.doc.toString();
    expect(doc).toBe(noteB);
    expect(doc).not.toContain("typed addition");
    expect(doc).not.toContain("Note A");
  });

  it("the caret resets to the start when switching notes, not carried over", async () => {
    const noteA = "Note A original text";
    const noteB = "Note B original text";
    const { container, rerender } = render(Editor, { value: noteA }) as unknown as {
      container: HTMLElement;
      rerender: (props: Record<string, unknown>) => Promise<void>;
    };

    const view = findView(container);
    view.dispatch({ selection: { anchor: 10 } });
    expect(view.state.selection.main.anchor).toBe(10);

    await rerender({ value: noteB });
    await Promise.resolve();
    await Promise.resolve();

    const viewAfterSwitch = findView(container);
    expect(viewAfterSwitch.state.selection.main.anchor).toBe(0);
    expect(viewAfterSwitch.state.selection.main.head).toBe(0);
  });
});
