// The sheet model: the stored envelope, the pure edits, and the merge that
// makes an agent's append safe beside unsaved cells.
import { describe, expect, it } from "vitest";
import {
  appendRows,
  clearCells,
  columnName,
  deleteCols,
  deleteRows,
  display,
  emptySheet,
  filledRows,
  insertCols,
  insertRows,
  MAX_CELL_CHARS,
  MAX_COLS,
  MAX_ROWS,
  mergeAppended,
  parseSheet,
  pasteBlock,
  rangeBlock,
  resizeCol,
  serializeSheet,
  setCell,
  type Sheet,
} from "./model";

function sheet(rows: string[][]): Sheet {
  const width = Math.max(...rows.map((r) => r.length));
  return {
    cols: Array.from({ length: width }, () => ({ w: 120 })),
    rows: rows.map((r) => [...r, ...Array(width - r.length).fill("")]),
  };
}

describe("the stored envelope", () => {
  it("round-trips and names its engine", () => {
    const s = sheet([["a", "b"], ["1", ""]]);
    const raw = serializeSheet(s);
    expect(JSON.parse(raw)).toEqual({
      v: 1,
      engine: "grid",
      data: { cols: [{ w: 120 }, { w: 120 }], rows: [["a", "b"], ["1", ""]] },
    });
    expect(parseSheet(raw)).toEqual(s);
    // The Rust side reads widths as numbers; fractions from a drag are rounded.
    expect(JSON.parse(serializeSheet(resizeCol(s, 0, 150.6))).data.cols[0]).toEqual({ w: 151 });
  });

  it("opens anything unreadable as the default empty grid", () => {
    for (const raw of [null, undefined, "", "not json", "{}", '{"v":1,"engine":"excalidraw","data":{}}']) {
      const s = parseSheet(raw);
      expect(s.cols.length).toBe(3);
      expect(s.rows.length).toBe(20);
      expect(filledRows(s)).toBe(0);
    }
  });

  it("makes a ragged or odd grid dense and sane", () => {
    const s = parseSheet(
      JSON.stringify({
        v: 1,
        engine: "grid",
        data: { cols: [{ w: 5 }, {}], rows: [["a"], ["b", "c", "d"], "nope", [1, "e"]] },
      }),
    );
    expect(s.cols).toEqual([{ w: 40 }, { w: 120 }]);
    expect(s.rows).toEqual([["a", ""], ["b", "c"], ["", ""], ["", "e"]]);
  });

  it("the view reads cells through display", () => {
    const s = sheet([["=1+1"]]);
    expect(display(s, 0, 0)).toBe("=1+1");
    expect(display(s, 5, 5)).toBe("");
  });

  it("names columns A to AZ", () => {
    expect([0, 25, 26, 51].map(columnName)).toEqual(["A", "Z", "AA", "AZ"]);
  });
});

describe("edits", () => {
  it("setCell shares untouched rows and returns the same sheet for no change", () => {
    const s = sheet([["a", "b"], ["c", "d"]]);
    const t = setCell(s, 1, 0, "x");
    expect(t.rows[1]).toEqual(["x", "d"]);
    expect(t.rows[0]).toBe(s.rows[0]);
    expect(setCell(t, 1, 0, "x")).toBe(t);
    expect(setCell(t, 9, 0, "x")).toBe(t);
  });

  it("clips a cell to the cap", () => {
    const s = setCell(emptySheet(1, 1), 0, 0, "x".repeat(MAX_CELL_CHARS + 5));
    expect(s.rows[0][0].length).toBe(MAX_CELL_CHARS);
  });

  it("clears a range and reads one back", () => {
    const s = sheet([["a", "b", "c"], ["d", "e", "f"], ["g", "h", "i"]]);
    const range = { r0: 0, c0: 1, r1: 1, c1: 2 };
    expect(rangeBlock(s, range)).toEqual([["b", "c"], ["e", "f"]]);
    const t = clearCells(s, range);
    expect(t.rows).toEqual([["a", "", ""], ["d", "", ""], ["g", "h", "i"]]);
    expect(t.rows[2]).toBe(s.rows[2]);
  });

  it("inserts and deletes rows, keeping at least one", () => {
    const s = sheet([["a"], ["b"]]);
    expect(insertRows(s, 1, 2).rows).toEqual([["a"], [""], [""], ["b"]]);
    expect(insertRows(s, 2, 1).rows).toEqual([["a"], ["b"], [""]]);
    expect(deleteRows(s, 0, 1).rows).toEqual([["b"]]);
    expect(deleteRows(s, 0, 5).rows).toEqual([["b"]]);
    const full = emptySheet(1, MAX_ROWS);
    expect(insertRows(full, 0, 1)).toBe(full);
  });

  it("inserts and deletes columns, keeping at least one", () => {
    const s = sheet([["a", "b"], ["c", "d"]]);
    const wider = insertCols(s, 1, 1);
    expect(wider.cols.length).toBe(3);
    expect(wider.rows).toEqual([["a", "", "b"], ["c", "", "d"]]);
    expect(deleteCols(s, 1, 1).rows).toEqual([["a"], ["c"]]);
    expect(deleteCols(s, 0, 9).rows).toEqual([["b"], ["d"]]);
    const full = emptySheet(MAX_COLS, 1);
    expect(insertCols(full, 0, 1)).toBe(full);
  });

  it("resizes within bounds", () => {
    const s = emptySheet(2, 1);
    expect(resizeCol(s, 0, 10).cols[0].w).toBe(40);
    expect(resizeCol(s, 0, 99999).cols[0].w).toBe(1200);
    expect(resizeCol(s, 1, 200).cols[1].w).toBe(200);
    expect(resizeCol(s, 1, 120)).toBe(s);
  });

  it("pastes a block, growing the grid, and says when it clipped", () => {
    const s = emptySheet(2, 2);
    const { sheet: t, clipped } = pasteBlock(s, 1, 1, [["a", "b"], ["c", "d"]]);
    expect(clipped).toBe(false);
    expect(t.cols.length).toBe(3);
    expect(t.rows).toEqual([["", "", ""], ["", "a", "b"], ["", "c", "d"]]);
    const wide = pasteBlock(emptySheet(MAX_COLS, 1), 0, MAX_COLS - 1, [["x", "y"]]);
    expect(wide.clipped).toBe(true);
    expect(wide.sheet.cols.length).toBe(MAX_COLS);
    expect(wide.sheet.rows[0][MAX_COLS - 1]).toBe("x");
  });
});

describe("append and merge", () => {
  it("appends after the data, reusing the empty rows at the bottom", () => {
    const s = setCell(emptySheet(3, 20), 0, 0, "Date");
    const t = appendRows(s, [["2026-10-04", "a1f3"], ["2026-10-05", "b2c4", "398", "extra"]]);
    expect(t.rows.length).toBe(20);
    expect(t.rows[1]).toEqual(["2026-10-04", "a1f3", ""]);
    expect(t.rows[2]).toEqual(["2026-10-05", "b2c4", "398"]);
    expect(filledRows(t)).toBe(3);
    expect(appendRows(t, [])).toBe(t);
  });

  it("grows once the empty rows are used, and stops at the cap", () => {
    const s = sheet([["h"]]);
    expect(appendRows(s, [["1"], ["2"]]).rows).toEqual([["h"], ["1"], ["2"]]);
    const nearFull = setCell(emptySheet(1, MAX_ROWS), MAX_ROWS - 1, 0, "last");
    expect(appendRows(nearFull, [["x"]]).rows.length).toBe(MAX_ROWS);
  });

  it("merges an agent's appended rows onto the user's unsaved grid", () => {
    const base = sheet([["Date", "ms"], ["d1", "1"]]);
    // The user typed into row 3 (unsaved) and fixed a cell.
    const mine = setCell(setCell(insertRows(base, 2, 1), 2, 0, "d2"), 1, 1, "11");
    // Meanwhile the agent appended two rows after the base's data.
    const theirs = appendRows(base, [["a1", "9"], ["a2", "8"]]);
    const { sheet: merged, added } = mergeAppended(base, mine, theirs);
    expect(added).toEqual([["a1", "9"], ["a2", "8"]]);
    expect(merged.rows).toEqual([
      ["Date", "ms"],
      ["d1", "11"],
      ["d2", ""],
      ["a1", "9"],
      ["a2", "8"],
    ]);
  });

  it("adds nothing when the other write appended nothing", () => {
    const base = sheet([["a"], ["b"]]);
    const mine = setCell(base, 0, 0, "A");
    const { sheet: merged, added } = mergeAppended(base, mine, base);
    expect(added).toEqual([]);
    expect(merged).toBe(mine);
  });
});
