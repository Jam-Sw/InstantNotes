import { describe, expect, it } from "vitest";
import { cellKey, evaluateGrid, isFormula, parseNumber } from "./table";

const text = (out: Map<number, { text: string; error: boolean }>, r: number, c: number) =>
  out.get(cellKey(r, c))?.text;

describe("formula detection", () => {
  it("needs an expression after the equals sign", () => {
    expect(isFormula("=1+1")).toBe(true);
    expect(isFormula("= sum(above)")).toBe(true);
    expect(isFormula("=>")).toBe(false);
    expect(isFormula("==")).toBe(false);
    expect(isFormula("")).toBe(false);
    expect(isFormula("x = 1")).toBe(false);
  });

  it("reads numbers the way people type them", () => {
    expect(parseNumber(" 1,250.5 ")).toBe(1250.5);
    expect(parseNumber("$40")).toBe(40);
    expect(parseNumber("-€3")).toBe(-3);
    expect(parseNumber("12%")).toBe(0.12);
    expect(parseNumber("Pen")).toBeNull();
    expect(parseNumber("")).toBeNull();
  });
});

describe("a note table", () => {
  const grid = [
    ["Item", "Price", "Qty", "Total"],
    ["Pen", "2.5", "4", "=Price*Qty"],
    ["Pad", "$4", "2", "=Price*Qty"],
    ["", "=sum(above)", "=sum(above)", "=sum(above)"],
  ];

  it("uses header names on the same row and sums above", () => {
    const out = evaluateGrid(grid, true);
    expect(text(out, 1, 3)).toBe("10");
    expect(text(out, 2, 3)).toBe("8");
    expect(text(out, 3, 1)).toBe("6.5");
    expect(text(out, 3, 2)).toBe("6");
    expect(text(out, 3, 3)).toBe("18");
    expect(out.size).toBe(5);
  });

  it("takes A1 references and ranges, with the header as row 1", () => {
    const out = evaluateGrid([...grid, ["", "=B2+B3", "=mean(C2:C3)", "=max(B2:C3)"]], true);
    expect(text(out, 4, 1)).toBe("6.5");
    expect(text(out, 4, 2)).toBe("3");
    expect(text(out, 4, 3)).toBe("4");
  });

  it("gives a header name with (:) the rest of the column", () => {
    const out = evaluateGrid([...grid.slice(0, 3), ["", "=sum(Price(:))", "", "=mean(Total(:))"]], true);
    expect(text(out, 3, 1)).toBe("6.5");
    expect(text(out, 3, 3)).toBe("9");
  });

  it("reads note variables through the outer scope", () => {
    const vars = new Map([["rate", 0.2]]);
    const out = evaluateGrid([["Net", "Tax"], ["100", "=Net*rate"]], true, {
      get: (n) => vars.get(n),
      set: () => {},
    });
    expect(text(out, 1, 1)).toBe("20");
  });

  it("names the problems", () => {
    const out = evaluateGrid(
      [
        ["a", "b"],
        ["=B2", "=A2"],
        ["=Z9", "=a"],
        ["Pen", "=A4"],
        ["=1/0", "=nope"],
      ],
      true,
    );
    expect(out.get(cellKey(1, 0))).toMatchObject({ error: true });
    expect(text(out, 1, 1)).toMatch(/circular/);
    expect(text(out, 2, 0)).toMatch(/outside/);
    expect(text(out, 2, 1)).toMatch(/A3: /);
    expect(text(out, 3, 1)).toMatch(/isn't a number/);
    expect(text(out, 4, 0)).toBe("Inf");
    expect(text(out, 4, 1)).toMatch(/undefined: nope/);
  });

  it("skips text and blanks in columns and blocks", () => {
    const out = evaluateGrid(
      [["n", "m"], ["1", "x"], ["x", "2"], ["", ""], ["3", "4"], ["=sum(above)", "=sum(A2:B5)"], ["=sum(A2:A5)", "=count(A2:B5)"]],
      true,
    );
    expect(text(out, 5, 0)).toBe("4");
    expect(text(out, 5, 1)).toBe("10");
    expect(text(out, 6, 0)).toBe("4");
    expect(text(out, 6, 1)).toBe("4");
  });
});

describe("a sheet", () => {
  it("has no header, so A1 is the first row", () => {
    const out = evaluateGrid([["5", "=A1*2"], ["=sum(above)", "=sum(B1:B1)"]], false);
    expect(text(out, 0, 1)).toBe("10");
    expect(text(out, 1, 0)).toBe("5");
    expect(text(out, 1, 1)).toBe("10");
  });

  it("refuses assignment inside a cell", () => {
    const out = evaluateGrid([["=x = 2"]], false);
    expect(text(out, 0, 0)).toMatch(/can't assign/);
  });
});
