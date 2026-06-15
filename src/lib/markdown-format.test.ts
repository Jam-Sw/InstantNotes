import { describe, it, expect } from "vitest";
import { toggleWrap, toggleLinePrefix, insertLink, formatEdit } from "./markdown-format";

describe("toggleWrap", () => {
  it("inserts an empty pair and puts the cursor inside when nothing is selected", () => {
    expect(toggleWrap("ab", { from: 1, to: 1 }, "**")).toEqual({
      text: "a****b",
      selection: { from: 3, to: 3 },
    });
  });

  it("wraps the selection and reselects the inner text", () => {
    expect(toggleWrap("hello", { from: 0, to: 5 }, "**")).toEqual({
      text: "**hello**",
      selection: { from: 2, to: 7 },
    });
  });

  it("unwraps when the selection includes the markers", () => {
    expect(toggleWrap("**hello**", { from: 0, to: 9 }, "**")).toEqual({
      text: "hello",
      selection: { from: 0, to: 5 },
    });
  });

  it("unwraps when the markers sit just outside the selection", () => {
    expect(toggleWrap("**hello**", { from: 2, to: 7 }, "**")).toEqual({
      text: "hello",
      selection: { from: 0, to: 5 },
    });
  });

  it("works for single-character markers (italic)", () => {
    expect(toggleWrap("hi", { from: 0, to: 2 }, "*")).toEqual({
      text: "*hi*",
      selection: { from: 1, to: 3 },
    });
  });
});

describe("toggleLinePrefix", () => {
  it("adds a prefix to a single line", () => {
    expect(toggleLinePrefix("hello", { from: 0, to: 5 }, "- ").text).toBe("- hello");
  });

  it("adds a prefix to every selected line", () => {
    expect(toggleLinePrefix("a\nb", { from: 0, to: 3 }, "- ").text).toBe("- a\n- b");
  });

  it("removes the prefix when every selected line already has it", () => {
    expect(toggleLinePrefix("- a\n- b", { from: 0, to: 7 }, "- ").text).toBe("a\nb");
  });

  it("supports the blockquote prefix", () => {
    expect(toggleLinePrefix("note", { from: 0, to: 4 }, "> ").text).toBe("> note");
  });
});

describe("insertLink", () => {
  it("wraps the selection as a link and selects the url placeholder", () => {
    expect(insertLink("see here", { from: 4, to: 8 })).toEqual({
      text: "see [here](url)",
      selection: { from: 11, to: 14 },
    });
  });

  it("inserts a template and selects the text placeholder when nothing is selected", () => {
    expect(insertLink("", { from: 0, to: 0 })).toEqual({
      text: "[text](url)",
      selection: { from: 1, to: 5 },
    });
  });
});

describe("formatEdit", () => {
  it("maps bold to a ** wrap", () => {
    expect(formatEdit("hi", { from: 0, to: 2 }, "bold").text).toBe("**hi**");
  });
  it("maps italic to a * wrap", () => {
    expect(formatEdit("hi", { from: 0, to: 2 }, "italic").text).toBe("*hi*");
  });
  it("maps code to a backtick wrap", () => {
    expect(formatEdit("hi", { from: 0, to: 2 }, "code").text).toBe("`hi`");
  });
  it("maps list to a line prefix", () => {
    expect(formatEdit("hi", { from: 0, to: 2 }, "list").text).toBe("- hi");
  });
  it("maps link to a markdown link", () => {
    expect(formatEdit("hi", { from: 0, to: 2 }, "link").text).toBe("[hi](url)");
  });
});
