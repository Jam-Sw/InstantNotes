import { describe, expect, it } from "vitest";
import { EditorSelection, EditorState } from "@codemirror/state";
import { history, undo } from "@codemirror/commands";
import { externalEdit, externalEditSpec, minimalChange } from "./external-edit";

describe("minimalChange", () => {
  it("finds an append", () => {
    expect(minimalChange("a\nb", "a\nb\n- c")).toEqual({ from: 3, to: 3, insert: "\n- c" });
  });
  it("finds a replacement in the middle", () => {
    expect(minimalChange("one two three", "one 2 three")).toEqual({
      from: 4,
      to: 7,
      insert: "2",
    });
  });
  it("handles repeated characters without overlapping prefix and suffix", () => {
    const c = minimalChange("aaa", "aaaa")!;
    expect("aaa".slice(0, c.from) + c.insert + "aaa".slice(c.to)).toBe("aaaa");
  });
  it("is null when nothing changed", () => {
    expect(minimalChange("same", "same")).toBeNull();
  });
});

describe("externalEditSpec", () => {
  const state = (doc: string, caret: number) =>
    EditorState.create({
      doc,
      selection: EditorSelection.cursor(caret),
      extensions: [history(), externalEdit],
    });

  it("keeps the caret where the user left it when text lands after it", () => {
    const s = state("Groceries\nmilk", 4);
    const next = s.update(externalEditSpec(s, "Groceries\nmilk\neggs")!).state;
    expect(next.doc.toString()).toBe("Groceries\nmilk\neggs");
    expect(next.selection.main.head).toBe(4);
  });

  it("moves the caret with its text when the edit lands before it", () => {
    const s = state("milk", 4);
    const next = s.update(externalEditSpec(s, "fresh milk")!).state;
    expect(next.selection.main.head).toBe(10);
  });

  it("can be undone like any edit", () => {
    const s = state("draft", 0);
    const edited = s.update(externalEditSpec(s, "draft\nagent line")!).state;
    let undone = edited;
    undo({ state: edited, dispatch: (tr) => (undone = tr.state) });
    expect(undone.doc.toString()).toBe("draft");
  });

  it("is null when the editor already shows the text", () => {
    expect(externalEditSpec(state("x", 0), "x")).toBeNull();
  });
});
