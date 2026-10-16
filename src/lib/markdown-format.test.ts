import { describe, it, expect } from "vitest";
import { toggleWrap, toggleLinePrefix, insertLink, formatEdit, cycleHeading } from "./markdown-format";

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

describe("cycleHeading", () => {
  it("makes a plain line an H1 and keeps the caret on the same word", () => {
    expect(cycleHeading("hello", { from: 2, to: 2 })).toEqual({
      text: "# hello",
      selection: { from: 4, to: 4 },
    });
  });

  it("steps an H1 to H2 and an H2 to H3", () => {
    expect(cycleHeading("# hello", { from: 3, to: 3 }).text).toBe("## hello");
    expect(cycleHeading("## hello", { from: 4, to: 4 }).text).toBe("### hello");
  });

  it("takes an H3 back to plain text, and never leaves the caret before the line", () => {
    expect(cycleHeading("### hello", { from: 1, to: 1 })).toEqual({
      text: "hello",
      selection: { from: 0, to: 0 },
    });
  });

  it("touches only the caret's line of a longer document", () => {
    expect(cycleHeading("one\ntwo\nthree", { from: 5, to: 5 }).text).toBe("one\n# two\nthree");
  });

  it("puts the heading after a list marker, so the list stays a list", () => {
    expect(cycleHeading("- item", { from: 4, to: 4 })).toEqual({
      text: "- # item",
      selection: { from: 6, to: 6 },
    });
    expect(cycleHeading("- [ ] # task", { from: 10, to: 10 }).text).toBe("- [ ] ## task");
  });

  it("is what formatEdit does for heading", () => {
    expect(formatEdit("x", { from: 0, to: 0 }, "heading").text).toBe("# x");
  });
});
