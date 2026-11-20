import { isComplex, isFnHandle, isMatrix, type Precision, type Value } from "./engine";

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

export function formatComplex(re: number, im: number, precision: Precision = "short"): string {
  if (im === 0) return formatNumber(re, precision);
  const absIm = Math.abs(im);
  const imPart = absIm === 1 ? "i" : `${formatNumber(absIm, precision)}i`;
  if (re === 0) return im < 0 ? `-${imPart}` : imPart;
  const sign = im < 0 ? " - " : " + ";
  return `${formatNumber(re, precision)}${sign}${imPart}`;
}

const MAX_SHOWN = 400;

export function formatValue(v: Value, precision: Precision = "short"): string {
  if (typeof v === "number") return formatNumber(v, precision);
  if (typeof v === "string") return v;
  if (isFnHandle(v)) return v.source;
  if (isComplex(v)) return formatComplex(v.re, v.im, precision);
  if (!isMatrix(v)) return String(v);
  if (v.data.length === 0) return "[]";
  if (v.data.length > MAX_SHOWN) return `${v.rows}×${v.cols} matrix`;
  const rows: string[] = [];
  for (let i = 0; i < v.rows; i++) {
    const cells: string[] = [];
    for (let j = 0; j < v.cols; j++) {
      const k = i * v.cols + j;
      const re = v.data[k];
      const im = v.imag ? v.imag[k] : 0;
      cells.push(im === 0 ? formatNumber(re, precision) : formatComplex(re, im, precision));
    }
    rows.push(cells.join(" "));
  }
  return `[${rows.join("; ")}]`;
}

export function formatGrid(v: Value, precision: Precision = "short"): string[][] | null {
  if (!isMatrix(v) || v.rows < 2 || v.cols < 1 || v.data.length > MAX_SHOWN) return null;
  const grid: string[][] = [];
  for (let i = 0; i < v.rows; i++) {
    const row: string[] = [];
    for (let j = 0; j < v.cols; j++) {
      const k = i * v.cols + j;
      const re = v.data[k];
      const im = v.imag ? v.imag[k] : 0;
      row.push(im === 0 ? formatNumber(re, precision) : formatComplex(re, im, precision));
    }
    grid.push(row);
  }
  return grid;
}
