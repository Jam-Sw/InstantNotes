import { isMatrix, type Precision, type Value } from "./engine";

export function formatNumber(x: number, precision: Precision = "short"): string {
  if (Number.isNaN(x)) return "NaN";
  if (x === Infinity) return "Inf";
  if (x === -Infinity) return "-Inf";
  if (x === 0) return "0";
  if (Number.isInteger(x) && Math.abs(x) < 1e15) return String(x);
  const s = x.toPrecision(precision === "long" ? 15 : 5);
  const e = s.indexOf("e");
  let mantissa = e >= 0 ? s.slice(0, e) : s;
  if (mantissa.includes(".")) mantissa = mantissa.replace(/\.?0+$/, "");
  if (e < 0) return mantissa;
  return mantissa + s.slice(e).replace("e+", "e");
}

const MAX_SHOWN = 400;

export function formatValue(v: Value, precision: Precision = "short"): string {
  if (!isMatrix(v)) return formatNumber(v, precision);
  if (v.data.length === 0) return "[]";
  if (v.data.length > MAX_SHOWN) return `${v.rows}×${v.cols} matrix`;
  const rows: string[] = [];
  for (let i = 0; i < v.rows; i++) {
    const cells: string[] = [];
    for (let j = 0; j < v.cols; j++) cells.push(formatNumber(v.data[i * v.cols + j], precision));
    rows.push(cells.join(" "));
  }
  return `[${rows.join("; ")}]`;
}

export function formatGrid(v: Value, precision: Precision = "short"): string[][] | null {
  if (!isMatrix(v) || v.rows < 2 || v.cols < 1 || v.data.length > MAX_SHOWN) return null;
  const grid: string[][] = [];
  for (let i = 0; i < v.rows; i++) {
    const row: string[] = [];
    for (let j = 0; j < v.cols; j++) row.push(formatNumber(v.data[i * v.cols + j], precision));
    grid.push(row);
  }
  return grid;
}
