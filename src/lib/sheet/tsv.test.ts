import { describe, expect, it } from "vitest";
import { fromTsv, toTsv } from "./tsv";

describe("toTsv", () => {
  it("joins cells with tabs and rows with newlines", () => {
    expect(toTsv([["a", "b"], ["1", "2"]])).toBe("a\tb\n1\t2");
  });

  it("quotes a cell holding a tab, a newline, or a quote, doubling quotes", () => {
    expect(toTsv([["x\ty", 'say "hi"', "two\nlines", "plain"]])).toBe(
      '"x\ty"\t"say ""hi"""\t"two\nlines"\tplain',
    );
  });
});

describe("fromTsv", () => {
  it("reads plain text as one cell", () => {
    expect(fromTsv("hello")).toEqual([["hello"]]);
    expect(fromTsv("")).toEqual([[""]]);
  });

  it("splits cells and rows, ignoring the trailing newline spreadsheets add", () => {
    expect(fromTsv("a\tb\n1\t2\n")).toEqual([["a", "b"], ["1", "2"]]);
    expect(fromTsv("a\tb\r\n1\t2\r\n")).toEqual([["a", "b"], ["1", "2"]]);
    expect(fromTsv("a\t\n\t2")).toEqual([["a", ""], ["", "2"]]);
  });

  it("reads quoted cells with embedded tabs, newlines, and quotes", () => {
    expect(fromTsv('"x\ty"\t"say ""hi"""\t"two\nlines"\tplain\n')).toEqual([
      ["x\ty", 'say "hi"', "two\nlines", "plain"],
    ]);
  });

  it("round-trips what toTsv wrote", () => {
    const block = [["a\tb", 'q"q', "l1\nl2"], ["", "plain", ""]];
    expect(fromTsv(toTsv(block))).toEqual(block);
  });
});
