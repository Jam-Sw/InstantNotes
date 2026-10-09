import { describe, expect, it } from "vitest";
import {
  clampSelection,
  coversFullCols,
  coversFullRows,
  inRange,
  isSingle,
  jumpEdge,
  moveBy,
  moveTo,
  rangeOf,
  selectAll,
  single,
  tabMove,
} from "./selection";
import type { Sheet } from "./model";

function sheet(rows: string[][]): Sheet {
  return { cols: rows[0].map(() => ({ w: 1 })), rows };
}

describe("ranges", () => {
  it("normalizes anchor and active into a block", () => {
    const sel = { anchor: { r: 3, c: 2 }, active: { r: 1, c: 4 } };
    expect(rangeOf(sel)).toEqual({ r0: 1, c0: 2, r1: 3, c1: 4 });
    expect(isSingle(sel)).toBe(false);
    expect(isSingle(single(2, 2))).toBe(true);
    expect(inRange(rangeOf(sel), 2, 3)).toBe(true);
    expect(inRange(rangeOf(sel), 0, 3)).toBe(false);
  });

  it("knows full rows and full columns", () => {
    const all = rangeOf(selectAll(5, 3));
    expect(coversFullRows(all, 3)).toBe(true);
    expect(coversFullCols(all, 5)).toBe(true);
    expect(coversFullRows({ r0: 0, c0: 0, r1: 0, c1: 1 }, 3)).toBe(false);
  });

  it("clamps a selection into a grid that shrank", () => {
    const sel = { anchor: { r: 9, c: 9 }, active: { r: 0, c: 0 } };
    expect(clampSelection(sel, 3, 2)).toEqual({ anchor: { r: 2, c: 1 }, active: { r: 0, c: 0 } });
  });
});

describe("moves", () => {
  it("steps and stops at the edges; shift extends from the anchor", () => {
    const start = single(0, 0);
    expect(moveBy(start, -1, 0, 5, 5, false)).toEqual(single(0, 0));
    expect(moveBy(start, 1, 1, 5, 5, false)).toEqual(single(1, 1));
    const ext = moveBy(start, 2, 0, 5, 5, true);
    expect(ext).toEqual({ anchor: { r: 0, c: 0 }, active: { r: 2, c: 0 } });
    expect(moveTo(ext, 9, 9, 5, 5, true).active).toEqual({ r: 4, c: 4 });
  });

  it("tab wraps to the next row and stays at the very end", () => {
    expect(tabMove(single(0, 2), false, 3, 3)).toEqual(single(1, 0));
    expect(tabMove(single(1, 0), true, 3, 3)).toEqual(single(0, 2));
    expect(tabMove(single(2, 2), false, 3, 3)).toEqual(single(2, 2));
    expect(tabMove(single(0, 0), true, 3, 3)).toEqual(single(0, 0));
    expect(tabMove({ anchor: { r: 0, c: 0 }, active: { r: 2, c: 0 } }, false, 3, 3)).toEqual(single(2, 1));
  });

  it("jumps to the end of a run of data, then to the next data, then to the edge", () => {
    const s = sheet([
      ["a", "b", "", "", "e", ""],
    ]);
    expect(jumpEdge(s, single(0, 0), 0, 1, false).active.c).toBe(1);
    expect(jumpEdge(s, single(0, 1), 0, 1, false).active.c).toBe(4);
    expect(jumpEdge(s, single(0, 4), 0, 1, false).active.c).toBe(5);
    expect(jumpEdge(s, single(0, 5), 0, 1, false).active.c).toBe(5);
    expect(jumpEdge(s, single(0, 5), 0, -1, false).active.c).toBe(4);
    const ext = jumpEdge(s, single(0, 0), 0, 1, true);
    expect(ext.anchor).toEqual({ r: 0, c: 0 });
    expect(ext.active).toEqual({ r: 0, c: 1 });
  });
});
