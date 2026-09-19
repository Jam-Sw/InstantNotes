// @vitest-environment jsdom
//
// Regression coverage for the per-note state isolation fix (loadDoc,
// Editor.svelte): each note used to share one CodeMirror state, so undo could
// reach into a previously open note and the caret could carry over. Neither
// existing suite exercises this — library.svelte.test.ts's "undo" coverage is
// workspace-delete undo, and kernel.test.ts's "caret" coverage is fold
// behavior over a headless EditorState, not a mounted view switching notes.
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

/** Recover the mounted EditorView from the DOM, the way findFromDOM is meant
 *  to be used: Editor.svelte deliberately exposes no view of its own. */
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

    // Simulate typing in note A: move the caret to the end (insertText
    // inserts at the current selection), then make an edit CM6's history
    // tracks like any other.
    const view = findView(container);
    view.dispatch({ selection: { anchor: noteA.length } });
    component.insertText(" plus a typed addition");
    expect(view.state.doc.toString()).toBe("Note A original plus a typed addition");

    // Switch to note B on the SAME component instance by changing the `value`
    // prop, exactly like the library selecting a different note — a fresh
    // render() would mount a brand new EditorView and trivially pass this
    // test regardless of whether loadDoc's isolation actually works.
    await rerender({ value: noteB });
    // loadDoc is async (it awaits linkedImagePaths/allowImageFile before
    // calling setState); let its microtasks flush.
    await Promise.resolve();
    await Promise.resolve();

    const viewAfterSwitch = findView(container);
    // Undo must be a no-op on B's fresh history, not a reach back into A.
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
    // Move the caret away from the start, as if the user clicked into the
    // middle of note A.
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
