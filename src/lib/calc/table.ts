import {
  CalcError,
  CELL_REF,
  colVector,
  evaluate,
  isMatrix,
  matrix,
  rowVector,
  type Precision,
  type Scope,
  type Value,
} from "./engine";
import { formatValue } from "./format";

export interface CellOut {
  readonly text: string;
  readonly error: boolean;
  readonly value: Value | null;
}

const FORMULA_RE = /^=\s*[\w(\[\-+.]/;

export const isFormula = (text: string): boolean => FORMULA_RE.test(text);

export const cellKey = (r: number, c: number): number => r * 4096 + c;

const NUMBER_RE = /^[-+]?(\d+\.?\d*|\.\d+)(e[-+]?\d+)?$/i;

export function parseNumber(text: string): number | null {
  let t = text.trim();
  if (!t) return null;
  const pct = t.endsWith("%");
  if (pct) t = t.slice(0, -1);
  t = t.replace(/[$€£¥,\s]/g, "");
  if (!NUMBER_RE.test(t)) return null;
  const x = Number(t);
  return pct ? x / 100 : x;
}

const normalizeName = (s: string): string => s.toLowerCase().replace(/[^a-z0-9]/g, "");

function columnLabel(c: number): string {
  return c < 26
    ? String.fromCharCode(65 + c)
    : String.fromCharCode(64 + Math.floor(c / 26)) + String.fromCharCode(65 + (c % 26));
}

function parseRef(name: string): { r: number; c: number } | null {
  const m = CELL_REF.exec(name);
  if (!m) return null;
  let c = 0;
  let i = 0;
  while (i < name.length && name.charCodeAt(i) > 57) c = c * 26 + (name.charCodeAt(i++) - 64);
  const r = Number(name.slice(i)) - 1;
  return r < 0 ? null : { r, c: c - 1 };
}

function fail(message: string): never {
  throw new CalcError(message);
}

export function evaluateGrid(
  grid: readonly (readonly string[])[],
  header: boolean,
  outer: Scope | null = null,
  precision: Precision = "short",
): Map<number, CellOut> {
  const out = new Map<number, CellOut>();
  const state = new Map<number, 1 | 2>();
  const first = header ? 1 : 0;
  const rows = grid.length;
  let cols = 0;
  for (const row of grid) if (row.length > cols) cols = row.length;

  const headers = new Map<string, number>();
  if (header && rows > 0) {
    grid[0].forEach((h, c) => {
      const k = normalizeName(h);
      if (k && !headers.has(k)) headers.set(k, c);
    });
  }

  const text = (r: number, c: number): string => grid[r]?.[c] ?? "";
  const refName = (r: number, c: number): string => `${columnLabel(c)}${r + 1}`;

  function compute(r: number, c: number): CellOut {
    const k = cellKey(r, c);
    const hit = out.get(k);
    if (hit) return hit;
    if (state.get(k) === 1) fail("circular reference");
    state.set(k, 1);
    let result: CellOut;
    try {
      const v = evaluate(text(r, c).slice(1), scopeFor(r, c));
      result = { text: formatValue(v, precision), error: false, value: v };
    } catch (e) {
      if (!(e instanceof CalcError)) throw e;
      result = { text: e.message, error: true, value: null };
    }
    out.set(k, result);
    state.set(k, 2);
    return result;
  }

  function formulaValue(r: number, c: number): Value {
    const o = compute(r, c);
    if (o.error) fail(`${refName(r, c)}: ${o.text}`);
    return o.value as Value;
  }

  function cellValue(r: number, c: number, ref: string): Value {
    if (r >= rows || c >= cols) fail(`${ref} is outside the table`);
    const t = text(r, c);
    if (isFormula(t)) return formulaValue(r, c);
    const x = parseNumber(t);
    if (x === null) {
      if (!t.trim()) return 0;
      fail(`${ref} isn't a number`);
    }
    return x;
  }

  function numberAt(r: number, c: number): number | null {
    const t = text(r, c);
    if (isFormula(t)) {
      const v = formulaValue(r, c);
      if (isMatrix(v)) {
        if (v.data.length === 1 && !v.imag) return v.data[0];
        fail(`${refName(r, c)} is a ${v.rows}×${v.cols} matrix`);
      }
      if (typeof v !== "number") fail(`${refName(r, c)} isn't a real number`);
      return v;
    }
    return parseNumber(t);
  }

  function columnValues(c: number, from: number, to: number, skip: number): Value {
    const values: number[] = [];
    for (let r = from; r < to; r++) {
      if (r === skip) continue;
      const x = numberAt(r, c);
      if (x !== null) values.push(x);
    }
    return values.length === 0 ? matrix(0, 0) : colVector(values);
  }

  function cells(from: string, to: string): Value {
    const a = parseRef(from);
    const b = parseRef(to);
    if (!a || !b) fail(`bad range ${from}:${to}`);
    const r0 = Math.min(a.r, b.r);
    const r1 = Math.max(a.r, b.r);
    const c0 = Math.min(a.c, b.c);
    const c1 = Math.max(a.c, b.c);
    if (r1 >= rows || c1 >= cols) fail(`${from}:${to} is outside the table`);
    if (c0 === c1) return columnValues(c0, r0, r1 + 1, -1);
    const values: number[] = [];
    for (let r = r0; r <= r1; r++) {
      for (let c = c0; c <= c1; c++) {
        const x = numberAt(r, c);
        if (x !== null) values.push(x);
      }
    }
    if (values.length === 0) return matrix(0, 0);
    return r0 === r1 ? rowVector(values) : colVector(values);
  }

  function scopeFor(r: number, c: number): Scope {
    return {
      get(name) {
        const ref = parseRef(name);
        if (ref) return cellValue(ref.r, ref.c, name);
        if (name === "above") return columnValues(c, first, r, -1);
        const col = headers.get(normalizeName(name));
        if (col !== undefined) return cellValue(r, col, name);
        return outer?.get(name);
      },
      set(name) {
        if (name !== "ans") fail("a table cell can't assign a variable");
      },
      cells,
      column(name) {
        const col = headers.get(normalizeName(name));
        return col === undefined ? undefined : columnValues(col, first, rows, r);
      },
    };
  }

  for (let r = first; r < rows; r++) {
    const row = grid[r];
    for (let c = 0; c < row.length; c++) {
      if (row[c].charCodeAt(0) === 61 && isFormula(row[c])) compute(r, c);
    }
  }
  return out;
}
