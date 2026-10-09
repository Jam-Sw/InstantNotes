import type { Range, Sheet } from "./model";

export interface Cell {
  r: number;
  c: number;
}

export interface Selection {
  active: Cell;
  anchor: Cell;
}

export function single(r: number, c: number): Selection {
  return { active: { r, c }, anchor: { r, c } };
}

export function isSingle(sel: Selection): boolean {
  return sel.active.r === sel.anchor.r && sel.active.c === sel.anchor.c;
}

export function rangeOf(sel: Selection): Range {
  return {
    r0: Math.min(sel.active.r, sel.anchor.r),
    c0: Math.min(sel.active.c, sel.anchor.c),
    r1: Math.max(sel.active.r, sel.anchor.r),
    c1: Math.max(sel.active.c, sel.anchor.c),
  };
}

export function inRange(range: Range, r: number, c: number): boolean {
  return r >= range.r0 && r <= range.r1 && c >= range.c0 && c <= range.c1;
}

export function selectAll(rows: number, cols: number): Selection {
  return { anchor: { r: 0, c: 0 }, active: { r: rows - 1, c: cols - 1 } };
}

export function coversFullRows(range: Range, cols: number): boolean {
  return range.c0 === 0 && range.c1 === cols - 1;
}

export function coversFullCols(range: Range, rows: number): boolean {
  return range.r0 === 0 && range.r1 === rows - 1;
}

function clampCell(cell: Cell, rows: number, cols: number): Cell {
  return {
    r: Math.min(Math.max(cell.r, 0), Math.max(rows - 1, 0)),
    c: Math.min(Math.max(cell.c, 0), Math.max(cols - 1, 0)),
  };
}

export function clampSelection(sel: Selection, rows: number, cols: number): Selection {
  return { active: clampCell(sel.active, rows, cols), anchor: clampCell(sel.anchor, rows, cols) };
}

export function moveTo(sel: Selection, r: number, c: number, rows: number, cols: number, extend: boolean): Selection {
  const active = clampCell({ r, c }, rows, cols);
  return { active, anchor: extend ? sel.anchor : active };
}

export function moveBy(sel: Selection, dr: number, dc: number, rows: number, cols: number, extend: boolean): Selection {
  return moveTo(sel, sel.active.r + dr, sel.active.c + dc, rows, cols, extend);
}

export function tabMove(sel: Selection, back: boolean, rows: number, cols: number): Selection {
  let { r, c } = sel.active;
  if (back) {
    if (c > 0) c--;
    else if (r > 0) (r--, (c = cols - 1));
  } else if (c < cols - 1) c++;
  else if (r < rows - 1) (r++, (c = 0));
  return moveTo(sel, r, c, rows, cols, false);
}

export function jumpEdge(sheet: Sheet, sel: Selection, dr: number, dc: number, extend: boolean): Selection {
  const rows = sheet.rows.length;
  const cols = sheet.cols.length;
  const filled = (r: number, c: number) => (sheet.rows[r]?.[c] ?? "") !== "";
  const inside = (r: number, c: number) => r >= 0 && r < rows && c >= 0 && c < cols;
  let { r, c } = sel.active;
  if (!inside(r + dr, c + dc)) return moveTo(sel, r, c, rows, cols, extend);
  if (filled(r, c) && filled(r + dr, c + dc)) {
    while (inside(r + dr, c + dc) && filled(r + dr, c + dc)) (r += dr), (c += dc);
  } else {
    (r += dr), (c += dc);
    while (inside(r + dr, c + dc) && !filled(r, c)) (r += dr), (c += dc);
  }
  return moveTo(sel, r, c, rows, cols, extend);
}
