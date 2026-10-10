const SHEET_ENGINE = "grid";
export const MAX_COLS = 52;
export const MAX_ROWS = 5000;
export const MAX_CELL_CHARS = 10_000;
const DEFAULT_COLS = 3;
const DEFAULT_ROWS = 20;
const DEFAULT_COL_WIDTH = 120;
const MIN_COL_WIDTH = 40;
const MAX_COL_WIDTH = 1200;

interface Column {
  w: number;
}

export interface Sheet {
  cols: Column[];
  rows: string[][];
}

export interface Range {
  r0: number;
  c0: number;
  r1: number;
  c1: number;
}

export function emptySheet(cols = DEFAULT_COLS, rows = DEFAULT_ROWS): Sheet {
  return {
    cols: Array.from({ length: cols }, () => ({ w: DEFAULT_COL_WIDTH })),
    rows: Array.from({ length: rows }, () => emptyRow(cols)),
  };
}

function emptyRow(cols: number): string[] {
  return Array.from({ length: cols }, () => "");
}

export function columnName(c: number): string {
  const letter = (n: number) => String.fromCharCode(65 + (n % 26));
  return c < 26 ? letter(c) : `${letter(Math.floor(c / 26) - 1)}${letter(c)}`;
}

const isObject = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === "object" && !Array.isArray(v);

export function parseSheet(raw: string | null | undefined): Sheet {
  let parsed: unknown;
  try {
    parsed = raw ? JSON.parse(raw) : null;
  } catch {
    return emptySheet();
  }
  if (!isObject(parsed) || parsed.engine !== SHEET_ENGINE || !isObject(parsed.data)) {
    return emptySheet();
  }
  const { cols, rows } = parsed.data;
  if (!Array.isArray(cols) || !Array.isArray(rows)) return emptySheet();
  const width = Math.min(Math.max(cols.length, 1), MAX_COLS);
  return {
    cols: Array.from({ length: width }, (_, i) => ({
      w: clampWidth(isObject(cols[i]) && typeof cols[i].w === "number" ? cols[i].w : NaN),
    })),
    rows: rows.slice(0, MAX_ROWS).map((row) =>
      Array.from({ length: width }, (_, i) =>
        Array.isArray(row) && typeof row[i] === "string" ? clipCell(row[i]) : "",
      ),
    ),
  };
}

export function serializeSheet(sheet: Sheet): string {
  return JSON.stringify({
    v: 1,
    engine: SHEET_ENGINE,
    data: { cols: sheet.cols.map((c) => ({ w: Math.round(c.w) })), rows: sheet.rows },
  });
}

export function display(sheet: Sheet, r: number, c: number): string {
  return sheet.rows[r]?.[c] ?? "";
}

function rowIsEmpty(row: readonly string[]): boolean {
  return row.every((cell) => cell === "");
}

export function filledRows(sheet: Sheet): number {
  for (let r = sheet.rows.length - 1; r >= 0; r--) {
    if (!rowIsEmpty(sheet.rows[r])) return r + 1;
  }
  return 0;
}

function clipCell(value: string): string {
  return value.length > MAX_CELL_CHARS ? value.slice(0, MAX_CELL_CHARS) : value;
}

function clampWidth(w: number): number {
  if (!Number.isFinite(w)) return DEFAULT_COL_WIDTH;
  return Math.min(MAX_COL_WIDTH, Math.max(MIN_COL_WIDTH, Math.round(w)));
}

function withRow(sheet: Sheet, r: number, row: string[]): Sheet {
  const rows = sheet.rows.slice();
  rows[r] = row;
  return { cols: sheet.cols, rows };
}

export function setCell(sheet: Sheet, r: number, c: number, value: string): Sheet {
  const next = clipCell(value);
  if (sheet.rows[r]?.[c] === undefined || sheet.rows[r][c] === next) return sheet;
  const row = sheet.rows[r].slice();
  row[c] = next;
  return withRow(sheet, r, row);
}

export function clearCells(sheet: Sheet, range: Range): Sheet {
  let rows: string[][] | null = null;
  for (let r = range.r0; r <= range.r1; r++) {
    if (!sheet.rows[r]) continue;
    if (sheet.rows[r].slice(range.c0, range.c1 + 1).every((v) => v === "")) continue;
    const row = sheet.rows[r].slice();
    for (let c = range.c0; c <= Math.min(range.c1, row.length - 1); c++) row[c] = "";
    rows ??= sheet.rows.slice();
    rows[r] = row;
  }
  return rows ? { cols: sheet.cols, rows } : sheet;
}

export function rangeBlock(sheet: Sheet, range: Range): string[][] {
  const out: string[][] = [];
  for (let r = range.r0; r <= range.r1; r++) {
    out.push(sheet.rows[r]?.slice(range.c0, range.c1 + 1) ?? []);
  }
  return out;
}

export function pasteBlock(
  sheet: Sheet,
  r: number,
  c: number,
  block: string[][],
): { sheet: Sheet; clipped: boolean } {
  const blockWidth = Math.max(0, ...block.map((row) => row.length));
  const wantRows = r + block.length;
  const wantCols = c + blockWidth;
  const rowsAfter = Math.min(Math.max(sheet.rows.length, wantRows), MAX_ROWS);
  const colsAfter = Math.min(Math.max(sheet.cols.length, wantCols), MAX_COLS);
  let out = sheet;
  if (colsAfter > sheet.cols.length) out = insertCols(out, sheet.cols.length, colsAfter - sheet.cols.length);
  if (rowsAfter > sheet.rows.length) out = insertRows(out, sheet.rows.length, rowsAfter - sheet.rows.length);
  let rows: string[][] | null = null;
  for (let i = 0; i < block.length && r + i < rowsAfter; i++) {
    let row = out.rows[r + i];
    let copied = false;
    for (let j = 0; j < block[i].length && c + j < colsAfter; j++) {
      const next = clipCell(block[i][j]);
      if (row[c + j] === undefined || row[c + j] === next) continue;
      if (!copied) {
        row = row.slice();
        copied = true;
      }
      row[c + j] = next;
    }
    if (copied) {
      rows ??= out.rows.slice();
      rows[r + i] = row;
    }
  }
  if (rows) out = { cols: out.cols, rows };
  return { sheet: out, clipped: wantRows > rowsAfter || wantCols > colsAfter };
}

export function insertRows(sheet: Sheet, at: number, n: number): Sheet {
  const room = Math.max(0, Math.min(n, MAX_ROWS - sheet.rows.length));
  if (room === 0) return sheet;
  const rows = sheet.rows.slice();
  rows.splice(at, 0, ...Array.from({ length: room }, () => emptyRow(sheet.cols.length)));
  return { cols: sheet.cols, rows };
}

export function deleteRows(sheet: Sheet, from: number, count: number): Sheet {
  const n = Math.min(count, sheet.rows.length - 1, sheet.rows.length - from);
  if (n <= 0) return sheet;
  const rows = sheet.rows.slice();
  rows.splice(from, n);
  return { cols: sheet.cols, rows };
}

export function insertCols(sheet: Sheet, at: number, n: number): Sheet {
  const room = Math.max(0, Math.min(n, MAX_COLS - sheet.cols.length));
  if (room === 0) return sheet;
  const cols = sheet.cols.slice();
  cols.splice(at, 0, ...Array.from({ length: room }, () => ({ w: DEFAULT_COL_WIDTH })));
  const blank = emptyRow(room);
  return {
    cols,
    rows: sheet.rows.map((row) => [...row.slice(0, at), ...blank, ...row.slice(at)]),
  };
}

export function deleteCols(sheet: Sheet, from: number, count: number): Sheet {
  const n = Math.min(count, sheet.cols.length - 1, sheet.cols.length - from);
  if (n <= 0) return sheet;
  const cols = sheet.cols.slice();
  cols.splice(from, n);
  return {
    cols,
    rows: sheet.rows.map((row) => [...row.slice(0, from), ...row.slice(from + n)]),
  };
}

export function resizeCol(sheet: Sheet, c: number, w: number): Sheet {
  const width = clampWidth(w);
  if (!sheet.cols[c] || sheet.cols[c].w === width) return sheet;
  const cols = sheet.cols.slice();
  cols[c] = { w: width };
  return { cols, rows: sheet.rows };
}

export function appendRows(sheet: Sheet, rows: readonly (readonly string[])[]): Sheet {
  if (rows.length === 0) return sheet;
  const width = sheet.cols.length;
  const start = filledRows(sheet);
  const end = Math.min(start + rows.length, MAX_ROWS);
  const next = sheet.rows.slice();
  while (next.length < end) next.push(emptyRow(width));
  for (let k = 0; start + k < end; k++) {
    next[start + k] = Array.from({ length: width }, (_, c) => clipCell(rows[k][c] ?? ""));
  }
  return { cols: sheet.cols, rows: next };
}

export function mergeAppended(
  base: Sheet,
  mine: Sheet,
  theirs: Sheet,
): { sheet: Sheet; added: string[][] } {
  const added = theirs.rows
    .slice(filledRows(base), filledRows(theirs))
    .filter((row) => !rowIsEmpty(row));
  return { sheet: appendRows(mine, added), added };
}
