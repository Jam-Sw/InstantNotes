import Complex from "complex.js";
import {
  CholeskyDecomposition,
  EigenvalueDecomposition,
  LuDecomposition,
  Matrix as MlMatrix,
  QrDecomposition,
  SingularValueDecomposition,
  determinant,
  pseudoInverse,
  solve as mlSolve,
} from "ml-matrix";
import {
  parseLineSpec,
  type Figures,
  type LineStyleSpec,
  type Series,
  type TraceSpec,
} from "./plot";

export interface Matrix {
  readonly rows: number;
  readonly cols: number;
  readonly data: Float64Array;
  readonly imag?: Float64Array;
}

export interface ComplexScalar {
  readonly kind: "complex";
  readonly re: number;
  readonly im: number;
}

export interface FnHandle {
  readonly kind: "fn";
  readonly params: readonly string[];
  readonly source: string;
  readonly call: (args: Value[], outer: Scope, nargout: number) => Value[];
}

export type Value = number | string | ComplexScalar | FnHandle | Matrix;

export class CalcError extends Error {}

export interface Scope {
  get(name: string): Value | undefined;
  set(name: string, value: Value): void;
  cells?(from: string, to: string): Value;
  column?(name: string): Value | undefined;
  draw?: Figures;
}

export type Precision = "short" | "long";

export interface Statement {
  readonly name: string | null;
  readonly names?: readonly string[];
  readonly suppressed: boolean;
  readonly format: Precision | null;
  readonly draw: boolean;
  readonly run: (scope: Scope) => Value;
}

type Fn = (scope: Scope) => Value;
type MultiFn = (scope: Scope, nargout: number) => Value[];
type Arg = Fn | ":";

function fail(message: string): never {
  throw new CalcError(message);
}

export const isComplex = (v: Value): v is ComplexScalar =>
  typeof v === "object" && v !== null && "kind" in v && v.kind === "complex";

export const isFnHandle = (v: Value): v is FnHandle =>
  typeof v === "object" && v !== null && "kind" in v && v.kind === "fn";

export const isMatrix = (v: Value): v is Matrix =>
  typeof v === "object" && v !== null && "rows" in v;

function complexScalar(re: number, im: number): number | ComplexScalar {
  return im === 0 || Object.is(im, -0) ? (re === 0 ? 0 : re) : { kind: "complex", re, im };
}

function shape(v: Value): string {
  return isMatrix(v) ? `${v.rows}×${v.cols}` : "1×1";
}

function cleanImag(imag?: Float64Array): Float64Array | undefined {
  if (!imag) return undefined;
  for (let i = 0; i < imag.length; i++) {
    if (imag[i] !== 0) return imag;
  }
  return undefined;
}

export function matrix(rows: number, cols: number, data?: Float64Array, imag?: Float64Array): Matrix {
  const clean = cleanImag(imag);
  const d = data ?? new Float64Array(rows * cols);
  return clean ? { rows, cols, data: d, imag: clean } : { rows, cols, data: d };
}

export function rowVector(values: ArrayLike<number>, imag?: ArrayLike<number>): Value {
  const im = imag ? cleanImag(Float64Array.from(imag)) : undefined;
  if (values.length === 1) return im ? complexScalar(values[0], im[0]) : values[0];
  return matrix(1, values.length, Float64Array.from(values), im);
}

export function colVector(values: ArrayLike<number>, imag?: ArrayLike<number>): Value {
  const im = imag ? cleanImag(Float64Array.from(imag)) : undefined;
  if (values.length === 1) return im ? complexScalar(values[0], im[0]) : values[0];
  return matrix(values.length, 1, Float64Array.from(values), im);
}

function numel(v: Value): number {
  if (typeof v === "string") return v.length;
  return isMatrix(v) ? v.data.length : 1;
}

function hasComplex(v: Value): boolean {
  return isComplex(v) || (isMatrix(v) && v.imag !== undefined);
}

function flat(v: Value): Float64Array {
  if (typeof v === "number") return Float64Array.of(v);
  if (isComplex(v)) fail("expected real numbers, got complex");
  if (typeof v === "string" || isFnHandle(v)) fail("expected numbers");
  if (v.imag) fail("expected real numbers, got complex");
  return v.data;
}

function flatParts(v: Value): { re: Float64Array; im: Float64Array | null } {
  if (typeof v === "number") return { re: Float64Array.of(v), im: null };
  if (isComplex(v)) return { re: Float64Array.of(v.re), im: Float64Array.of(v.im) };
  if (isMatrix(v)) return { re: v.data, im: v.imag ?? null };
  fail("expected numeric value");
}

function squeeze(m: Matrix): Value {
  if (m.rows === 1 && m.cols === 1) {
    return m.imag ? complexScalar(m.data[0], m.imag[0]) : m.data[0];
  }
  const clean = cleanImag(m.imag);
  return clean ? { rows: m.rows, cols: m.cols, data: m.data, imag: clean } : { rows: m.rows, cols: m.cols, data: m.data };
}

function scalar(v: Value, what: string): number {
  if (typeof v === "number") return v;
  if (isComplex(v)) {
    if (v.im === 0) return v.re;
    fail(`${what} needs a real number`);
  }
  if (isMatrix(v)) {
    if (v.data.length === 1) {
      if (v.imag && v.imag[0] !== 0) fail(`${what} needs a real number`);
      return v.data[0];
    }
    fail(`${what} needs a single number, got ${shape(v)}`);
  }
  fail(`${what} needs a single number`);
}

function stringArg(v: Value, what: string): string {
  if (typeof v === "string") return v;
  fail(`${what} needs text`);
}

function truthy(v: Value): boolean {
  if (typeof v === "number") return v !== 0;
  if (isComplex(v)) return v.re !== 0 || v.im !== 0;
  if (typeof v === "string") return v.length > 0;
  if (isFnHandle(v)) return true;
  if (v.data.length === 0) return false;
  for (let i = 0; i < v.data.length; i++) {
    const im = v.imag ? v.imag[i] : 0;
    if (v.data[i] === 0 && im === 0) return false;
  }
  return true;
}

const MAX_ELEMENTS = 1_000_000;

function guardSize(n: number): void {
  if (n > MAX_ELEMENTS) fail(`too large (${n} elements)`);
}

function toComplex(re: number, im = 0): Complex {
  return new Complex(re, im);
}

function fromComplex(x: Complex | number): { re: number; im: number } {
  if (typeof x === "number") return { re: x, im: 0 };
  return { re: x.re, im: x.im };
}

function toMlMatrix(v: Value, what: string): MlMatrix {
  if (hasComplex(v)) fail(`${what}: complex matrix isn't supported here`);
  if (typeof v === "number") return new MlMatrix([[v]]);
  if (!isMatrix(v)) fail(`${what} needs a matrix`);
  if (v.data.length === 0) fail(`${what}: matrix is empty`);
  const rows: number[][] = new Array(v.rows);
  for (let i = 0; i < v.rows; i++) {
    rows[i] = Array.from(v.data.subarray(i * v.cols, (i + 1) * v.cols));
  }
  return new MlMatrix(rows);
}

function fromMlMatrix(m: MlMatrix): Value {
  const r = m.rows;
  const c = m.columns;
  const d = new Float64Array(r * c);
  for (let i = 0; i < r; i++) {
    for (let j = 0; j < c; j++) d[i * c + j] = m.get(i, j);
  }
  return squeeze(matrix(r, c, d));
}

function toRealBlock(v: Value, what: string): MlMatrix {
  if (typeof v === "number") {
    return new MlMatrix([
      [v, 0],
      [0, v],
    ]);
  }
  if (isComplex(v)) {
    return new MlMatrix([
      [v.re, -v.im],
      [v.im, v.re],
    ]);
  }
  if (!isMatrix(v)) fail(`${what} needs a matrix`);
  const m = v.rows;
  const n = v.cols;
  const out = new MlMatrix(2 * m, 2 * n);
  for (let i = 0; i < m; i++) {
    for (let j = 0; j < n; j++) {
      const k = i * n + j;
      const re = v.data[k];
      const im = v.imag ? v.imag[k] : 0;
      out.set(i, j, re);
      out.set(i, n + j, -im);
      out.set(m + i, j, im);
      out.set(m + i, n + j, re);
    }
  }
  return out;
}

function toRealRhs(v: Matrix): MlMatrix {
  const m = v.rows;
  const n = v.cols;
  const out = new MlMatrix(2 * m, n);
  for (let i = 0; i < m; i++) {
    for (let j = 0; j < n; j++) {
      const k = i * n + j;
      out.set(i, j, v.data[k]);
      out.set(m + i, j, v.imag ? v.imag[k] : 0);
    }
  }
  return out;
}

function fromRealRhs(block: MlMatrix): Value {
  const m = block.rows >> 1;
  const n = block.columns;
  const re = new Float64Array(m * n);
  const im = new Float64Array(m * n);
  for (let i = 0; i < m; i++) {
    for (let j = 0; j < n; j++) {
      re[i * n + j] = block.get(i, j);
      im[i * n + j] = block.get(m + i, j);
    }
  }
  return squeeze(matrix(m, n, re, im));
}

function fromRealBlock(block: MlMatrix): Value {
  const m = block.rows >> 1;
  const n = block.columns >> 1;
  const re = new Float64Array(m * n);
  const im = new Float64Array(m * n);
  for (let i = 0; i < m; i++) {
    for (let j = 0; j < n; j++) {
      re[i * n + j] = block.get(i, j);
      im[i * n + j] = block.get(m + i, j);
    }
  }
  return squeeze(matrix(m, n, re, im));
}

function wrapMathError<T>(what: string, fn: () => T): T {
  try {
    return fn();
  } catch (e) {
    if (e instanceof CalcError) throw e;
    const msg = e instanceof Error ? e.message : String(e);
    if (/singular|invert/i.test(msg)) fail("matrix is singular");
    fail(`${what}: ${msg}`);
  }
}

function ewReal(a: Value, b: Value, f: (x: number, y: number) => number): Value {
  if (typeof a === "number") {
    if (typeof b === "number") return f(a, b);
    if (!isMatrix(b)) fail("expected numeric value");
    const d = new Float64Array(b.data.length);
    for (let i = 0; i < d.length; i++) d[i] = f(a, b.data[i]);
    return { rows: b.rows, cols: b.cols, data: d };
  }
  if (typeof b === "number") {
    if (!isMatrix(a)) fail("expected numeric value");
    const d = new Float64Array(a.data.length);
    for (let i = 0; i < d.length; i++) d[i] = f(a.data[i], b);
    return { rows: a.rows, cols: a.cols, data: d };
  }
  if (!isMatrix(a) || !isMatrix(b)) fail("expected numeric value");
  if (a.rows === b.rows && a.cols === b.cols) {
    const d = new Float64Array(a.data.length);
    for (let i = 0; i < d.length; i++) d[i] = f(a.data[i], b.data[i]);
    return { rows: a.rows, cols: a.cols, data: d };
  }
  if ((a.rows === 1 || b.rows === 1 || a.rows === b.rows) && (a.cols === 1 || b.cols === 1 || a.cols === b.cols)) {
    const r = Math.max(a.rows, b.rows);
    const c = Math.max(a.cols, b.cols);
    guardSize(r * c);
    const d = new Float64Array(r * c);
    for (let i = 0; i < r; i++) {
      const ia = a.rows === 1 ? 0 : i;
      const ib = b.rows === 1 ? 0 : i;
      for (let j = 0; j < c; j++) {
        const ja = a.cols === 1 ? 0 : j;
        const jb = b.cols === 1 ? 0 : j;
        d[i * c + j] = f(a.data[ia * a.cols + ja], b.data[ib * b.cols + jb]);
      }
    }
    return squeeze(matrix(r, c, d));
  }
  fail(`size mismatch ${shape(a)} and ${shape(b)}`);
}

function ew(
  a: Value,
  b: Value,
  realFn: (x: number, y: number) => number,
  complexFn?: (x: Complex, y: Complex) => Complex | number,
  forceComplex = false,
): Value {
  if (!forceComplex && !hasComplex(a) && !hasComplex(b)) {
    return ewReal(a, b, realFn);
  }
  if (!complexFn) fail("complex numbers aren't supported for this operator");
  const ar = isMatrix(a) ? a.rows : 1;
  const ac = isMatrix(a) ? a.cols : 1;
  const br = isMatrix(b) ? b.rows : 1;
  const bc = isMatrix(b) ? b.cols : 1;
  const pa = flatParts(a);
  const pb = flatParts(b);
  const scalarA = ar === 1 && ac === 1;
  const scalarB = br === 1 && bc === 1;
  if (!scalarA && !scalarB) {
    if (!((ar === 1 || br === 1 || ar === br) && (ac === 1 || bc === 1 || ac === bc))) {
      fail(`size mismatch ${shape(a)} and ${shape(b)}`);
    }
  }
  const r = scalarA ? br : scalarB ? ar : Math.max(ar, br);
  const c = scalarA ? bc : scalarB ? ac : Math.max(ac, bc);
  guardSize(r * c);
  const re = new Float64Array(r * c);
  const im = new Float64Array(r * c);
  for (let i = 0; i < r; i++) {
    const ia = ar === 1 ? 0 : i;
    const ib = br === 1 ? 0 : i;
    for (let j = 0; j < c; j++) {
      const ja = ac === 1 ? 0 : j;
      const jb = bc === 1 ? 0 : j;
      const ka = ia * ac + ja;
      const kb = ib * bc + jb;
      const xa = toComplex(pa.re[ka], pa.im ? pa.im[ka] : 0);
      const xb = toComplex(pb.re[kb], pb.im ? pb.im[kb] : 0);
      const res = fromComplex(complexFn(xa, xb));
      re[i * c + j] = res.re;
      im[i * c + j] = res.im;
    }
  }
  return squeeze(matrix(r, c, re, im));
}

function mapValue(
  v: Value,
  realFn: (x: number) => number,
  complexFn?: (x: Complex) => Complex | number,
  promoteComplex = false,
): Value {
  if (!hasComplex(v) && !promoteComplex) {
    if (typeof v === "number") return realFn(v);
    if (!isMatrix(v)) fail("expected numeric value");
    const d = new Float64Array(v.data.length);
    for (let i = 0; i < d.length; i++) d[i] = realFn(v.data[i]);
    return { rows: v.rows, cols: v.cols, data: d };
  }
  const fn = complexFn ?? ((x: Complex) => realFn(x.re));
  const r = isMatrix(v) ? v.rows : 1;
  const c = isMatrix(v) ? v.cols : 1;
  const p = flatParts(v);
  const re = new Float64Array(p.re.length);
  const im = new Float64Array(p.re.length);
  for (let i = 0; i < p.re.length; i++) {
    const out = fromComplex(fn(toComplex(p.re[i], p.im ? p.im[i] : 0)));
    re[i] = out.re;
    im[i] = out.im;
  }
  return squeeze(matrix(r, c, re, im));
}

function matmul(a: Matrix, b: Matrix): Value {
  if (a.cols !== b.rows) fail(`inner sizes differ ${shape(a)} * ${shape(b)}`);
  if (a.imag || b.imag) {
    const re = new Float64Array(a.rows * b.cols);
    const im = new Float64Array(a.rows * b.cols);
    for (let i = 0; i < a.rows; i++) {
      for (let k = 0; k < a.cols; k++) {
        const idxA = i * a.cols + k;
        const ar = a.data[idxA];
        const ai = a.imag ? a.imag[idxA] : 0;
        if (ar === 0 && ai === 0) continue;
        for (let j = 0; j < b.cols; j++) {
          const idxB = k * b.cols + j;
          const br = b.data[idxB];
          const bi = b.imag ? b.imag[idxB] : 0;
          const dst = i * b.cols + j;
          re[dst] += ar * br - ai * bi;
          im[dst] += ar * bi + ai * br;
        }
      }
    }
    return squeeze(matrix(a.rows, b.cols, re, im));
  }
  const out = matrix(a.rows, b.cols);
  for (let i = 0; i < a.rows; i++) {
    for (let k = 0; k < a.cols; k++) {
      const aik = a.data[i * a.cols + k];
      if (aik === 0) continue;
      for (let j = 0; j < b.cols; j++) {
        out.data[i * b.cols + j] += aik * b.data[k * b.cols + j];
      }
    }
  }
  return squeeze(out);
}

function mul(a: Value, b: Value): Value {
  if (!isMatrix(a) || !isMatrix(b)) {
    return ew(a, b, (x, y) => x * y, (x, y) => x.mul(y));
  }
  return matmul(a, b);
}

function transpose(v: Value, conjugate = false): Value {
  if (typeof v === "number" || typeof v === "string" || isFnHandle(v)) return v;
  if (isComplex(v)) return conjugate ? complexScalar(v.re, -v.im) : v;
  const re = new Float64Array(v.data.length);
  const im = v.imag ? new Float64Array(v.imag.length) : undefined;
  for (let i = 0; i < v.rows; i++) {
    for (let j = 0; j < v.cols; j++) {
      const src = i * v.cols + j;
      const dst = j * v.rows + i;
      re[dst] = v.data[src];
      if (im && v.imag) im[dst] = conjugate ? -v.imag[src] : v.imag[src];
    }
  }
  return matrix(v.cols, v.rows, re, im);
}

function mldivide(a: Value, b: Value): Value {
  if (!isMatrix(a)) {
    return ew(a, b, (x, y) => y / x, (x, y) => y.div(x));
  }
  const bm: Matrix = isMatrix(b)
    ? b
    : isComplex(b)
      ? matrix(1, 1, Float64Array.of(b.re), Float64Array.of(b.im))
      : matrix(1, 1, Float64Array.of(scalar(b, "\\")));
  if (a.rows !== bm.rows) {
    fail(`matrix dimensions must agree: ${shape(a)} \\ ${shape(bm)}`);
  }
  if (hasComplex(a) || hasComplex(bm)) {
    const mA = toRealBlock(a, "\\");
    const mB = toRealRhs(bm);
    if (a.rows === a.cols) {
      try {
        const lu = new LuDecomposition(mA);
        if (!lu.isSingular()) {
          return fromRealRhs(lu.solve(mB));
        }
      } catch {
      }
    }
    return wrapMathError("\\", () => fromRealRhs(mlSolve(mA, mB, true)));
  }
  const mA = toMlMatrix(a, "\\");
  const mB = toMlMatrix(bm, "\\");
  if (a.rows === a.cols) {
    try {
      const lu = new LuDecomposition(mA);
      if (!lu.isSingular()) {
        return fromMlMatrix(lu.solve(mB));
      }
    } catch {
    }
  }
  return wrapMathError("\\", () => fromMlMatrix(mlSolve(mA, mB, true)));
}

function mrdivide(a: Value, b: Value): Value {
  if (!isMatrix(b)) {
    return ew(a, b, (x, y) => x / y, (x, y) => x.div(y));
  }
  if (!isMatrix(a)) fail("use ./ to divide a scalar by each matrix element");
  return transpose(mldivide(transpose(b, true), transpose(a, true)), true);
}

function matPowInt(a: Matrix, expVal: number): Value {
  const n = a.rows;
  if (expVal === 0) {
    const eye = matrix(n, n);
    for (let i = 0; i < n; i++) eye.data[i * n + i] = 1;
    return squeeze(eye);
  }
  let base: Value = expVal < 0 ? BUILTINS.inv([a], { get: () => undefined, set: () => {} }, 1)[0] : a;
  let k = Math.abs(expVal);
  let acc: Value | null = null;
  while (k > 0) {
    if (k & 1) acc = acc === null ? base : mul(acc, base);
    k = Math.floor(k / 2);
    if (k > 0) base = mul(base, base);
  }
  return acc ?? 1;
}

function pow(a: Value, b: Value): Value {
  if (!isMatrix(a) && !isMatrix(b)) {
    if (!hasComplex(a) && !hasComplex(b)) {
      const x = a as number;
      const y = b as number;
      if (x < 0 && !Number.isInteger(y)) {
        const c = toComplex(x, 0).pow(y);
        return complexScalar(c.re, c.im);
      }
      return Math.pow(x, y);
    }
    const ca = isComplex(a) ? toComplex(a.re, a.im) : toComplex(a as number, 0);
    const cb = isComplex(b) ? toComplex(b.re, b.im) : toComplex(b as number, 0);
    const c = ca.pow(cb);
    return complexScalar(c.re, c.im);
  }
  if (!isMatrix(b) && isMatrix(a)) {
    if (a.rows !== a.cols) fail(`^ needs a square matrix, got ${shape(a)}`);
    const expVal = scalar(b, "^");
    if (expVal === -1) return BUILTINS.inv([a], { get: () => undefined, set: () => {} }, 1)[0];
    if (Number.isInteger(expVal)) {
      return matPowInt(a, expVal);
    }
    if (expVal === 0.5) {
      return BUILTINS.sqrtm([a], { get: () => undefined, set: () => {} }, 1)[0];
    }
    fail("matrix power needs an integer or 0.5");
  }
  fail("use .^ to raise each element");
}

function dotPow(a: Value, b: Value): Value {
  if (!hasComplex(a) && !hasComplex(b)) {
    const pa = flatParts(a).re;
    const pb = flatParts(b).re;
    let needComplex = false;
    for (let i = 0; i < pa.length; i++) {
      if (pa[i] < 0) {
        for (let j = 0; j < pb.length; j++) {
          if (!Number.isInteger(pb[j])) {
            needComplex = true;
            break;
          }
        }
        if (needComplex) break;
      }
    }
    if (needComplex) {
      return ew(a, b, Math.pow, (x, y) => x.pow(y), true);
    }
  }
  return ew(a, b, Math.pow, (x, y) => x.pow(y));
}

function range(start: number, step: number, end: number): Value {
  if (step === 0 || Number.isNaN(step)) fail("step can't be 0");
  const n = Math.floor((end - start) / step + 1e-10) + 1;
  if (n <= 0) return matrix(1, 0);
  guardSize(n);
  const d = new Float64Array(n);
  for (let i = 0; i < n; i++) d[i] = start + i * step;
  return squeeze({ rows: 1, cols: n, data: d });
}

function hcat(parts: Value[]): Value {
  if (parts.length === 0) return matrix(0, 0);
  if (parts.length === 1) return parts[0];
  if (parts.every((p) => typeof p === "string")) return parts.join("");
  let rows = -1;
  let cols = 0;
  const anyComplex = parts.some(hasComplex);
  for (const p of parts) {
    const r = isMatrix(p) ? p.rows : 1;
    const c = isMatrix(p) ? p.cols : 1;
    if (isMatrix(p) && p.data.length === 0) continue;
    if (rows === -1) rows = r;
    else if (rows !== r) fail("rows in a matrix must have the same height");
    cols += c;
  }
  if (rows === -1) return matrix(0, 0);
  guardSize(rows * cols);
  const re = new Float64Array(rows * cols);
  const im = anyComplex ? new Float64Array(rows * cols) : undefined;
  let at = 0;
  for (const p of parts) {
    if (isMatrix(p)) {
      if (p.data.length === 0) continue;
      for (let i = 0; i < rows; i++) {
        re.set(p.data.subarray(i * p.cols, (i + 1) * p.cols), i * cols + at);
        if (im && p.imag) im.set(p.imag.subarray(i * p.cols, (i + 1) * p.cols), i * cols + at);
      }
      at += p.cols;
    } else if (isComplex(p)) {
      re[at] = p.re;
      if (im) im[at] = p.im;
      at += 1;
    } else {
      re[at] = scalar(p, "matrix");
      at += 1;
    }
  }
  return squeeze(matrix(rows, cols, re, im));
}

function vcat(rowsIn: Value[]): Value {
  if (rowsIn.length === 1) return rowsIn[0];
  let cols = -1;
  let rows = 0;
  const anyComplex = rowsIn.some(hasComplex);
  for (const p of rowsIn) {
    if (isMatrix(p) && p.data.length === 0) continue;
    const c = isMatrix(p) ? p.cols : 1;
    if (cols === -1) cols = c;
    else if (cols !== c) fail("rows in a matrix must have the same width");
    rows += isMatrix(p) ? p.rows : 1;
  }
  if (cols === -1) return matrix(0, 0);
  guardSize(rows * cols);
  const re = new Float64Array(rows * cols);
  const im = anyComplex ? new Float64Array(rows * cols) : undefined;
  let at = 0;
  for (const p of rowsIn) {
    if (isMatrix(p)) {
      if (p.data.length === 0) continue;
      re.set(p.data, at);
      if (im && p.imag) im.set(p.imag, at);
      at += p.data.length;
    } else if (isComplex(p)) {
      re[at] = p.re;
      if (im) im[at] = p.im;
      at++;
    } else {
      re[at++] = scalar(p, "matrix");
    }
  }
  return squeeze(matrix(rows, cols, re, im));
}

function colMajorRead(m: Matrix, k: number): { re: number; im: number } {
  const r = k % m.rows;
  const c = Math.floor(k / m.rows);
  const idx = r * m.cols + c;
  return { re: m.data[idx], im: m.imag ? m.imag[idx] : 0 };
}

const ENDS: number[] = [];

const MAX_CALL_DEPTH = 256;
const MAX_CALLS = 500_000;
let callDepth = 0;
let callCount = 0;
let callBudgetHeld = false;

function enterCall(): void {
  if (callDepth === 0 && !callBudgetHeld) callCount = 0;
  if (callDepth >= MAX_CALL_DEPTH) fail("too much recursion");
  if (++callCount > MAX_CALLS) fail(`call limit exceeded (${MAX_CALLS} calls)`);
  callDepth++;
}

export function errorText(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

function isMask(arg: Value, size: number): boolean {
  if (!isMatrix(arg) || arg.imag || arg.data.length !== size) return false;
  return arg.data.some((x) => x === 0) && arg.data.every((x) => x === 0 || x === 1);
}

function indexList(arg: Value, size: number, what: string): Int32Array {
  const src = flat(arg);
  let isMask = src.length === size && size > 0;
  let hasZero = false;
  if (isMask) {
    for (let i = 0; i < src.length; i++) {
      if (src[i] === 0) hasZero = true;
      else if (src[i] !== 1) {
        isMask = false;
        break;
      }
    }
  }
  if (isMask && hasZero) {
    const found: number[] = [];
    for (let i = 0; i < src.length; i++) if (src[i] !== 0) found.push(i);
    return Int32Array.from(found);
  }
  const out = new Int32Array(src.length);
  for (let i = 0; i < src.length; i++) {
    const k = src[i];
    if (!Number.isInteger(k)) fail(`${what} must be a whole number`);
    if (k < 1 || k > size) fail(`${what} ${k} is out of range (1..${size})`);
    out[i] = k - 1;
  }
  return out;
}

function indexValue(v: Value, args: Arg[], scope: Scope): Value {
  const rows = isMatrix(v) ? v.rows : 1;
  const cols = isMatrix(v) ? v.cols : 1;
  const total = rows * cols;
  if (args.length === 1) {
    const a = args[0];
    if (a === ":") {
      if (!isMatrix(v)) return v;
      const re = new Float64Array(total);
      const im = v.imag ? new Float64Array(total) : undefined;
      for (let k = 0; k < total; k++) {
        const c = colMajorRead(v, k);
        re[k] = c.re;
        if (im) im[k] = c.im;
      }
      return squeeze(matrix(total, 1, re, im));
    }
    ENDS.push(total);
    let idx: Value;
    try {
      idx = a(scope);
    } finally {
      ENDS.pop();
    }
    const list = indexList(idx, total, "index");
    const re = new Float64Array(list.length);
    const im = hasComplex(v) ? new Float64Array(list.length) : undefined;
    for (let i = 0; i < list.length; i++) {
      if (isMatrix(v)) {
        const c = colMajorRead(v, list[i]);
        re[i] = c.re;
        if (im) im[i] = c.im;
      } else if (isComplex(v)) {
        re[i] = v.re;
        if (im) im[i] = v.im;
      } else {
        re[i] = scalar(v, "index");
      }
    }
    if (list.length === 0) return matrix(1, 0);
    if (isMatrix(idx) && list.length === idx.data.length) {
      return squeeze(matrix(idx.rows, idx.cols, re, im));
    }
    if (list.length === 1) return im ? complexScalar(re[0], im[0]) : re[0];
    return squeeze(matrix(rows > 1 && cols === 1 ? list.length : 1, rows > 1 && cols === 1 ? 1 : list.length, re, im));
  }
  if (args.length !== 2) fail("an index takes one or two positions");
  const pick = (a: Arg, size: number, what: string): Int32Array => {
    if (a === ":") {
      const all = new Int32Array(size);
      for (let i = 0; i < size; i++) all[i] = i;
      return all;
    }
    ENDS.push(size);
    try {
      return indexList(a(scope), size, what);
    } finally {
      ENDS.pop();
    }
  };
  const ri = pick(args[0], rows, "row");
  const ci = pick(args[1], cols, "column");
  const p = flatParts(v);
  const re = new Float64Array(ri.length * ci.length);
  const im = p.im ? new Float64Array(ri.length * ci.length) : undefined;
  for (let i = 0; i < ri.length; i++) {
    for (let j = 0; j < ci.length; j++) {
      const src = ri[i] * cols + ci[j];
      re[i * ci.length + j] = p.re[src];
      if (im && p.im) im[i * ci.length + j] = p.im[src];
    }
  }
  return squeeze(matrix(ri.length, ci.length, re, im));
}

function assignIndexed(target: Value | undefined, args: Arg[], rhs: Value, scope: Scope): Value {
  const base: Matrix = isMatrix(target ?? 0)
    ? (target as Matrix)
    : target === undefined
      ? matrix(0, 0)
      : isComplex(target)
        ? matrix(1, 1, Float64Array.of(target.re), Float64Array.of(target.im))
        : matrix(1, 1, Float64Array.of(scalar(target, "assignment")));

  const rhsParts = flatParts(rhs);
  const rhsScalar = rhsParts.re.length === 1;
  const needComplex = Boolean(base.imag || rhsParts.im);

  if (args.length === 1) {
    const total = base.rows * base.cols;
    const list =
      args[0] === ":"
        ? Int32Array.from({ length: total }, (_, i) => i)
        : (() => {
            ENDS.push(total);
            try {
              const idx = args[0](scope);
              return indexList(idx, isMask(idx, total) ? total : Math.max(total, 1_000_000), "index");
            } finally {
              ENDS.pop();
            }
          })();
    if (!rhsScalar && rhsParts.re.length !== list.length) {
      fail(`assignment size mismatch (${list.length} vs ${rhsParts.re.length})`);
    }
    let maxIdx = total - 1;
    for (let i = 0; i < list.length; i++) if (list[i] > maxIdx) maxIdx = list[i];
    let rows = base.rows;
    let cols = base.cols;
    if (maxIdx >= total) {
      if (rows <= 1) {
        rows = 1;
        cols = maxIdx + 1;
      } else if (cols === 1) {
        rows = maxIdx + 1;
      } else {
        fail(`index ${maxIdx + 1} is out of range (1..${total})`);
      }
    }
    guardSize(rows * cols);
    const re = new Float64Array(rows * cols);
    const im = needComplex ? new Float64Array(rows * cols) : undefined;
    re.set(base.data);
    if (im && base.imag) im.set(base.imag);
    for (let i = 0; i < list.length; i++) {
      const k = list[i];
      const r = k % rows;
      const c = Math.floor(k / rows);
      const dst = r * cols + c;
      const src = rhsScalar ? 0 : i;
      re[dst] = rhsParts.re[src];
      if (im) im[dst] = rhsParts.im ? rhsParts.im[src] : 0;
    }
    return squeeze(matrix(rows, cols, re, im));
  }

  if (args.length !== 2) fail("an index takes one or two positions");
  const evalDim = (a: Arg, cur: number, what: string): Int32Array => {
    if (a === ":") return Int32Array.from({ length: cur }, (_, i) => i);
    ENDS.push(cur);
    try {
      const idx = a(scope);
      return indexList(idx, isMask(idx, cur) ? cur : Math.max(cur, 1_000_000), what);
    } finally {
      ENDS.pop();
    }
  };
  const ri = evalDim(args[0], base.rows, "row");
  const ci = evalDim(args[1], base.cols, "column");
  let newRows = base.rows;
  let newCols = base.cols;
  for (const r of ri) if (r + 1 > newRows) newRows = r + 1;
  for (const c of ci) if (c + 1 > newCols) newCols = c + 1;
  guardSize(newRows * newCols);
  if (!rhsScalar && rhsParts.re.length !== ri.length * ci.length) {
    fail(`assignment size mismatch (${ri.length}×${ci.length})`);
  }
  const re = new Float64Array(newRows * newCols);
  const im = needComplex ? new Float64Array(newRows * newCols) : undefined;
  for (let i = 0; i < base.rows; i++) {
    for (let j = 0; j < base.cols; j++) {
      re[i * newCols + j] = base.data[i * base.cols + j];
      if (im && base.imag) im[i * newCols + j] = base.imag[i * base.cols + j];
    }
  }
  for (let i = 0; i < ri.length; i++) {
    for (let j = 0; j < ci.length; j++) {
      const dst = ri[i] * newCols + ci[j];
      const src = rhsScalar ? 0 : i * ci.length + j;
      re[dst] = rhsParts.re[src];
      if (im) im[dst] = rhsParts.im ? rhsParts.im[src] : 0;
    }
  }
  return squeeze(matrix(newRows, newCols, re, im));
}

function reduce(v: Value, f: (col: Float64Array) => number, dim?: number): Value {
  const d = flat(v);
  if (!isMatrix(v)) return f(d);
  if (v.data.length === 0) return f(d);
  const axis = dim ?? (v.rows === 1 ? 2 : 1);
  if (axis === 1) {
    if (v.rows === 1 && dim === undefined) return f(d);
    const out = new Float64Array(v.cols);
    const col = new Float64Array(v.rows);
    for (let j = 0; j < v.cols; j++) {
      for (let i = 0; i < v.rows; i++) col[i] = v.data[i * v.cols + j];
      out[j] = f(col);
    }
    return squeeze(matrix(1, v.cols, out));
  }
  if (axis === 2) {
    const out = new Float64Array(v.rows);
    for (let i = 0; i < v.rows; i++) {
      out[i] = f(v.data.subarray(i * v.cols, (i + 1) * v.cols));
    }
    return squeeze(matrix(v.rows, 1, out));
  }
  fail("dimension must be 1 or 2");
}

function columnwise(v: Value, f: (col: Float64Array) => Float64Array): Value {
  if (!isMatrix(v)) return squeeze(matrix(1, 1, f(flat(v))));
  if (v.rows === 1 || v.cols === 1) {
    const d = f(v.data);
    return squeeze(matrix(v.rows === 1 ? 1 : d.length, v.rows === 1 ? d.length : 1, d));
  }
  const out = matrix(v.rows, v.cols);
  const col = new Float64Array(v.rows);
  for (let j = 0; j < v.cols; j++) {
    for (let i = 0; i < v.rows; i++) col[i] = v.data[i * v.cols + j];
    const d = f(col);
    for (let i = 0; i < v.rows; i++) out.data[i * v.cols + j] = d[i];
  }
  return out;
}

const sumArr = (d: Float64Array): number => {
  if (d.length === 0) return 0;
  let sum = 0;
  let c = 0;
  for (let i = 0; i < d.length; i++) {
    const x = d[i];
    if (Number.isNaN(x)) return NaN;
    const t = sum + x;
    if (Math.abs(sum) >= Math.abs(x)) c += sum - t + x;
    else c += x - t + sum;
    sum = t;
  }
  return sum + c;
};
const prodArr = (d: Float64Array): number => {
  let p = 1;
  for (let i = 0; i < d.length; i++) p *= d[i];
  return p;
};
const meanArr = (d: Float64Array): number => (d.length === 0 ? NaN : sumArr(d) / d.length);
const varArr = (d: Float64Array): number => {
  if (d.length < 2) return d.length === 1 ? 0 : NaN;
  const mean = meanArr(d);
  let acc = 0;
  for (let i = 0; i < d.length; i++) {
    const diff = d[i] - mean;
    acc += diff * diff;
  }
  return acc / (d.length - 1);
};
const medianArr = (d: Float64Array): number => {
  if (d.length === 0) return NaN;
  const s = Float64Array.from(d).sort();
  const mid = s.length >> 1;
  return s.length & 1 ? s[mid] : 0.5 * (s[mid - 1] + s[mid]);
};
const minOf = (d: Float64Array): number => {
  if (d.length === 0) fail("min of nothing");
  let m = Infinity;
  for (let i = 0; i < d.length; i++) if (d[i] < m) m = d[i];
  return m;
};
const maxOf = (d: Float64Array): number => {
  if (d.length === 0) fail("max of nothing");
  let m = -Infinity;
  for (let i = 0; i < d.length; i++) if (d[i] > m) m = d[i];
  return m;
};

const roundHalfAway = (x: number): number => Math.sign(x) * Math.round(Math.abs(x));
const fixNum = (x: number): number => (x < 0 ? Math.ceil(x) : Math.floor(x));
const modNum = (x: number, y: number): number => (y === 0 ? x : x - Math.floor(x / y) * y);
const remNum = (x: number, y: number): number => (y === 0 ? x : x - fixNum(x / y) * y);

const LANCZOS_P = [
  0.99999999999980993,
  676.5203681218851,
  -1259.1392167224028,
  771.32342877765313,
  -176.61502916214059,
  12.507343278686905,
  -0.13857109526572012,
  9.9843695780195716e-6,
  1.5056327351493116e-7,
];

function gammaNum(z: number): number {
  if (Number.isNaN(z)) return NaN;
  if (z === Infinity) return Infinity;
  if (z <= 0 && Number.isInteger(z)) return Infinity;
  if (Number.isInteger(z) && z >= 1 && z <= 22) {
    let f = 1;
    for (let i = 2; i < z; i++) f *= i;
    return f;
  }
  if (z < 0.5) {
    return Math.PI / (Math.sin(Math.PI * z) * gammaNum(1 - z));
  }
  const u = z - 1;
  let x = LANCZOS_P[0];
  for (let i = 1; i < LANCZOS_P.length; i++) x += LANCZOS_P[i] / (u + i);
  const t = u + 7.5;
  return Math.sqrt(2 * Math.PI) * Math.pow(t, u + 0.5) * Math.exp(-t) * x;
}

function gammalnNum(z: number): number {
  if (Number.isNaN(z)) return NaN;
  if (z <= 0 && Number.isInteger(z)) return Infinity;
  if (z < 0.5) {
    return Math.log(Math.PI / Math.abs(Math.sin(Math.PI * z))) - gammalnNum(1 - z);
  }
  const u = z - 1;
  let x = LANCZOS_P[0];
  for (let i = 1; i < LANCZOS_P.length; i++) x += LANCZOS_P[i] / (u + i);
  const t = u + 7.5;
  return 0.5 * Math.log(2 * Math.PI) + (u + 0.5) * Math.log(t) - t + Math.log(x);
}

function erfcPos(x: number): number {
  if (x >= 27) return 0;
  let f = 1e-30;
  let c = f;
  let d = 0;
  for (let k = 1; k <= 120; k++) {
    const a = k === 1 ? 1 : 0.5 * (k - 1);
    const b = k & 1 ? x : 1;
    d = b + a * d;
    if (Math.abs(d) < 1e-30) d = 1e-30;
    c = b + a / c;
    if (Math.abs(c) < 1e-30) c = 1e-30;
    d = 1 / d;
    const delta = c * d;
    f *= delta;
    if (Math.abs(delta - 1) < 1e-16) break;
  }
  return (Math.exp(-x * x) / Math.sqrt(Math.PI)) * f;
}

function erfNum(x: number): number {
  if (Number.isNaN(x)) return NaN;
  if (x === 0) return 0;
  if (!Number.isFinite(x)) return x > 0 ? 1 : -1;
  const ax = Math.abs(x);
  if (ax < 2.5) {
    const x2 = ax * ax;
    let term = ax;
    let sum = ax;
    for (let n = 1; n < 80; n++) {
      term *= (2 * x2) / (2 * n + 1);
      sum += term;
      if (term < sum * 1e-16) break;
    }
    const val = (2 / Math.sqrt(Math.PI)) * Math.exp(-x2) * sum;
    return x < 0 ? -val : val;
  }
  const val = 1 - erfcPos(ax);
  return x < 0 ? -val : val;
}

function erfcNum(x: number): number {
  if (Number.isNaN(x)) return NaN;
  if (!Number.isFinite(x)) return x > 0 ? 0 : 2;
  if (x >= 2.5) return erfcPos(x);
  if (x <= -2.5) return 2 - erfcPos(-x);
  return 1 - erfNum(x);
}

function factorialNum(n: number): number {
  if (!Number.isInteger(n) || n < 0) fail("factorial needs a whole number");
  if (n > 170) return Infinity;
  let f = 1;
  for (let i = 2; i <= n; i++) f *= i;
  return f;
}

function nchoosekNum(n: number, k: number): number {
  if (!Number.isInteger(n) || !Number.isInteger(k) || k < 0 || n < k) {
    fail("nchoosek needs whole numbers with n ≥ k");
  }
  const m = Math.min(k, n - k);
  let res = 1;
  for (let i = 1; i <= m; i++) res = (res * (n - m + i)) / i;
  return Math.round(res);
}

function gcdNum(a: number, b: number): number {
  if (!Number.isInteger(a) || !Number.isInteger(b)) fail("gcd needs integers");
  let x = Math.abs(a);
  let y = Math.abs(b);
  while (y !== 0) {
    const r = x % y;
    x = y;
    y = r;
  }
  return x;
}

function lcmNum(a: number, b: number): number {
  if (!Number.isInteger(a) || !Number.isInteger(b)) fail("lcm needs integers");
  if (a === 0 || b === 0) return 0;
  return Math.abs((a / gcdNum(a, b)) * b);
}

function expmMl(m: MlMatrix): MlMatrix {
  const n = m.rows;
  let infNorm = 0;
  for (let i = 0; i < n; i++) {
    let rowSum = 0;
    for (let j = 0; j < n; j++) rowSum += Math.abs(m.get(i, j));
    if (rowSum > infNorm) infNorm = rowSum;
  }
  const s = Math.max(0, Math.ceil(Math.log2(Math.max(infNorm / 0.5, 1))));
  const B = s > 0 ? MlMatrix.div(m, 2 ** s) : m.clone();
  const I = MlMatrix.eye(n);
  const B2 = B.mmul(B);
  const B4 = B2.mmul(B2);
  const B6 = B2.mmul(B4);
  const c = [1, 1 / 2, 5 / 44, 1 / 66, 1 / 792, 1 / 15840, 1 / 665280];
  const V = MlMatrix.mul(I, c[0])
    .add(MlMatrix.mul(B2, c[2]))
    .add(MlMatrix.mul(B4, c[4]))
    .add(MlMatrix.mul(B6, c[6]));
  const U = B.mmul(
    MlMatrix.mul(I, c[1])
      .add(MlMatrix.mul(B2, c[3]))
      .add(MlMatrix.mul(B4, c[5])),
  );
  let R = mlSolve(MlMatrix.sub(V, U), MlMatrix.add(V, U));
  for (let k = 0; k < s; k++) R = R.mmul(R);
  return R;
}

function sqrtmValue(v: Value): Value {
  if (!isMatrix(v)) {
    return BUILTINS.sqrt([v], { get: () => undefined, set: () => {} }, 1)[0];
  }
  if (v.rows !== v.cols) fail(`sqrtm needs a square matrix, got ${shape(v)}`);
  const isCplx = hasComplex(v);
  if (!isCplx) {
    const mA = toMlMatrix(v, "sqrtm");
    const evd = new EigenvalueDecomposition(mA);
    const hasNegReal = evd.realEigenvalues.some((r, idx) => r < -1e-14 && Math.abs(evd.imaginaryEigenvalues[idx]) < 1e-14);
    if (!hasNegReal) {
      let Y = mA.clone();
      let Z = MlMatrix.eye(v.rows);
      for (let it = 0; it < 40; it++) {
        const invZ = new LuDecomposition(Z).solve(MlMatrix.eye(v.rows));
        const invY = new LuDecomposition(Y).solve(MlMatrix.eye(v.rows));
        const nextY = MlMatrix.mul(MlMatrix.add(Y, invZ), 0.5);
        const nextZ = MlMatrix.mul(MlMatrix.add(Z, invY), 0.5);
        let diff = 0;
        for (let i = 0; i < v.rows; i++) {
          for (let j = 0; j < v.rows; j++) diff = Math.max(diff, Math.abs(nextY.get(i, j) - Y.get(i, j)));
        }
        Y = nextY;
        Z = nextZ;
        if (diff < 1e-13) break;
      }
      return fromMlMatrix(Y);
    }
    const [V, D] = BUILTINS.eig([v], { get: () => undefined, set: () => {} }, 2);
    const dummy: Scope = { get: () => undefined, set: () => {} };
    const sqrtD = BUILTINS.diag([BUILTINS.sqrt([BUILTINS.diag([D], dummy, 1)[0]], dummy, 1)[0]], dummy, 1)[0];
    return mrdivide(mul(V, sqrtD), V);
  }
  const mA = toRealBlock(v, "sqrtm");
  const n2 = mA.rows;
  let Y = mA.clone();
  let Z = MlMatrix.eye(n2);
  for (let it = 0; it < 40; it++) {
    const invZ = new LuDecomposition(Z).solve(MlMatrix.eye(n2));
    const invY = new LuDecomposition(Y).solve(MlMatrix.eye(n2));
    const nextY = MlMatrix.mul(MlMatrix.add(Y, invZ), 0.5);
    const nextZ = MlMatrix.mul(MlMatrix.add(Z, invY), 0.5);
    let diff = 0;
    for (let i = 0; i < n2; i++) {
      for (let j = 0; j < n2; j++) diff = Math.max(diff, Math.abs(nextY.get(i, j) - Y.get(i, j)));
    }
    Y = nextY;
    Z = nextZ;
    if (diff < 1e-13) break;
  }
  return fromRealBlock(Y);
}

function toComplexGrid(v: Matrix): Complex[][] {
  const grid: Complex[][] = new Array(v.rows);
  for (let i = 0; i < v.rows; i++) {
    const row = new Array<Complex>(v.cols);
    for (let j = 0; j < v.cols; j++) {
      const k = i * v.cols + j;
      row[j] = toComplex(v.data[k], v.imag ? v.imag[k] : 0);
    }
    grid[i] = row;
  }
  return grid;
}

function fromComplexGrid(grid: Complex[][]): Value {
  const rows = grid.length;
  const cols = rows === 0 ? 0 : grid[0].length;
  const re = new Float64Array(rows * cols);
  const im = new Float64Array(rows * cols);
  for (let i = 0; i < rows; i++) {
    for (let j = 0; j < cols; j++) {
      re[i * cols + j] = grid[i][j].re;
      im[i * cols + j] = grid[i][j].im;
    }
  }
  return squeeze(matrix(rows, cols, re, im));
}

function complexLuDecomp(v: Matrix): { L: Value; U: Value; piv: number[]; det: Complex } {
  const n = v.rows;
  if (n !== v.cols) fail(`lu needs a square matrix, got ${shape(v)}`);
  const A = toComplexGrid(v);
  const L: Complex[][] = Array.from({ length: n }, (_, i) =>
    Array.from({ length: n }, (__, j) => (i === j ? Complex.ONE : Complex.ZERO)),
  );
  const piv = Array.from({ length: n }, (_, i) => i);
  let sign = 1;
  for (let k = 0; k < n; k++) {
    let p = k;
    let maxAbs = A[k][k].abs();
    for (let i = k + 1; i < n; i++) {
      const a = A[i][k].abs();
      if (a > maxAbs) {
        maxAbs = a;
        p = i;
      }
    }
    if (p !== k) {
      [A[k], A[p]] = [A[p], A[k]];
      [piv[k], piv[p]] = [piv[p], piv[k]];
      for (let j = 0; j < k; j++) [L[k][j], L[p][j]] = [L[p][j], L[k][j]];
      sign = -sign;
    }
    const akk = A[k][k];
    if (akk.abs() === 0) continue;
    for (let i = k + 1; i < n; i++) {
      const factor = A[i][k].div(akk);
      L[i][k] = factor;
      A[i][k] = Complex.ZERO;
      for (let j = k + 1; j < n; j++) {
        A[i][j] = A[i][j].sub(factor.mul(A[k][j]));
      }
    }
  }
  let det = toComplex(sign, 0);
  for (let i = 0; i < n; i++) det = det.mul(A[i][i]);
  return { L: fromComplexGrid(L), U: fromComplexGrid(A), piv, det };
}

function complexQrDecomp(v: Matrix): { Q: Value; R: Value } {
  const m = v.rows;
  const n = v.cols;
  const R = toComplexGrid(v);
  const Q: Complex[][] = Array.from({ length: m }, (_, i) =>
    Array.from({ length: m }, (__, j) => (i === j ? Complex.ONE : Complex.ZERO)),
  );
  const steps = Math.min(m, n);
  for (let k = 0; k < steps; k++) {
    let normSq = 0;
    for (let i = k; i < m; i++) {
      const a = R[i][k].abs();
      normSq += a * a;
    }
    const norm = Math.sqrt(normSq);
    if (norm === 0) continue;
    const x0 = R[k][k];
    const x0Abs = x0.abs();
    const phase = x0Abs === 0 ? Complex.ONE : x0.div(x0Abs);
    const u0 = x0.add(phase.mul(norm));
    const u: Complex[] = new Array(m - k);
    u[0] = u0;
    let uNormSq = u0.abs() ** 2;
    for (let i = k + 1; i < m; i++) {
      u[i - k] = R[i][k];
      uNormSq += R[i][k].abs() ** 2;
    }
    if (uNormSq === 0) continue;
    const beta = 2 / uNormSq;
    for (let j = k; j < n; j++) {
      let dot = Complex.ZERO;
      for (let i = k; i < m; i++) dot = dot.add(u[i - k].conjugate().mul(R[i][j]));
      const scale = dot.mul(beta);
      for (let i = k; i < m; i++) R[i][j] = R[i][j].sub(u[i - k].mul(scale));
    }
    for (let i = 0; i < m; i++) {
      let dot = Complex.ZERO;
      for (let j = k; j < m; j++) dot = dot.add(Q[i][j].mul(u[j - k]));
      const scale = dot.mul(beta);
      for (let j = k; j < m; j++) Q[i][j] = Q[i][j].sub(scale.mul(u[j - k].conjugate()));
    }
  }
  return { Q: fromComplexGrid(Q), R: fromComplexGrid(R) };
}

function complexEigDecomp(v: Matrix, nargout: number): Value[] {
  const n = v.rows;
  if (n !== v.cols) fail(`eig needs a square matrix, got ${shape(v)}`);
  let H = toComplexGrid(v);
  let Q: Complex[][] = Array.from({ length: n }, (_, i) =>
    Array.from({ length: n }, (__, j) => (i === j ? Complex.ONE : Complex.ZERO)),
  );
  for (let it = 0; it < 120 * n; it++) {
    let offDiag = 0;
    for (let i = 1; i < n; i++) offDiag += H[i][i - 1].abs();
    if (offDiag < 1e-13) break;
    const shift = H[n - 1][n - 1];
    for (let i = 0; i < n; i++) H[i][i] = H[i][i].sub(shift);
    const qr = complexQrDecomp(fromComplexGrid(H) as Matrix);
    const qMat = isMatrix(qr.Q) ? qr.Q : matrix(1, 1, Float64Array.of(typeof qr.Q === "number" ? qr.Q : (qr.Q as ComplexScalar).re), isComplex(qr.Q) ? Float64Array.of(qr.Q.im) : undefined);
    const rMat = isMatrix(qr.R) ? qr.R : matrix(1, 1, Float64Array.of(typeof qr.R === "number" ? qr.R : (qr.R as ComplexScalar).re), isComplex(qr.R) ? Float64Array.of(qr.R.im) : undefined);
    const rMulQ = mul(rMat, qMat);
    H = toComplexGrid(isMatrix(rMulQ) ? rMulQ : matrix(1, 1, Float64Array.of(typeof rMulQ === "number" ? rMulQ : (rMulQ as ComplexScalar).re), isComplex(rMulQ) ? Float64Array.of(rMulQ.im) : undefined));
    for (let i = 0; i < n; i++) H[i][i] = H[i][i].add(shift);
    if (nargout >= 2) {
      const qNext = mul(fromComplexGrid(Q), qMat);
      Q = toComplexGrid(isMatrix(qNext) ? qNext : matrix(1, 1, Float64Array.of(1)));
    }
  }
  const re = new Float64Array(n);
  const im = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    re[i] = H[i][i].re;
    im[i] = H[i][i].im;
  }
  if (nargout < 2) return [colVector(re, im)];
  const Uvecs: Complex[][] = Array.from({ length: n }, () => Array.from({ length: n }, () => Complex.ZERO));
  for (let j = 0; j < n; j++) {
    Uvecs[j][j] = Complex.ONE;
    const lambda = H[j][j];
    for (let i = j - 1; i >= 0; i--) {
      let sum = Complex.ZERO;
      for (let k = i + 1; k <= j; k++) sum = sum.add(H[i][k].mul(Uvecs[k][j]));
      const denom = H[i][i].sub(lambda);
      Uvecs[i][j] = denom.abs() < 1e-14 ? Complex.ZERO : sum.neg().div(denom);
    }
  }
  const Vraw = mul(fromComplexGrid(Q), fromComplexGrid(Uvecs));
  const Vmat = isMatrix(Vraw) ? Vraw : matrix(1, 1, Float64Array.of(1));
  const Vgrid = toComplexGrid(Vmat);
  for (let j = 0; j < n; j++) {
    let colNorm = 0;
    for (let i = 0; i < n; i++) colNorm += Vgrid[i][j].abs() ** 2;
    colNorm = Math.sqrt(colNorm);
    if (colNorm > 0) for (let i = 0; i < n; i++) Vgrid[i][j] = Vgrid[i][j].div(colNorm);
  }
  const D = BUILTINS.diag([colVector(re, im)], { get: () => undefined, set: () => {} }, 1)[0];
  return [fromComplexGrid(Vgrid), D];
}

function fftRadix2(re: Float64Array, im: Float64Array, inverseFft: boolean): void {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      const tr = re[i];
      re[i] = re[j];
      re[j] = tr;
      const ti = im[i];
      im[i] = im[j];
      im[j] = ti;
    }
  }
  const sign = inverseFft ? 1 : -1;
  for (let len = 2; len <= n; len <<= 1) {
    const ang = (sign * 2 * Math.PI) / len;
    const wlenRe = Math.cos(ang);
    const wlenIm = Math.sin(ang);
    const half = len >> 1;
    for (let i = 0; i < n; i += len) {
      let wRe = 1;
      let wIm = 0;
      for (let j = 0; j < half; j++) {
        const uRe = re[i + j];
        const uIm = im[i + j];
        const vRe = re[i + j + half] * wRe - im[i + j + half] * wIm;
        const vIm = re[i + j + half] * wIm + im[i + j + half] * wRe;
        re[i + j] = uRe + vRe;
        im[i + j] = uIm + vIm;
        re[i + j + half] = uRe - vRe;
        im[i + j + half] = uIm - vIm;
        const nextWRe = wRe * wlenRe - wIm * wlenIm;
        wIm = wRe * wlenIm + wIm * wlenRe;
        wRe = nextWRe;
      }
    }
  }
  if (inverseFft) {
    for (let i = 0; i < n; i++) {
      re[i] /= n;
      im[i] /= n;
    }
  }
}

function fft1d(inRe: Float64Array, inIm: Float64Array | null, inverseFft: boolean): { re: Float64Array; im: Float64Array } {
  const n = inRe.length;
  if (n === 0) return { re: new Float64Array(0), im: new Float64Array(0) };
  const re = Float64Array.from(inRe);
  const im = inIm ? Float64Array.from(inIm) : new Float64Array(n);
  if (n === 1) return { re, im };
  if ((n & (n - 1)) === 0) {
    fftRadix2(re, im, inverseFft);
    return { re, im };
  }
  let m = 1;
  while (m < 2 * n - 1) m <<= 1;
  const sign = inverseFft ? 1 : -1;
  const chirpRe = new Float64Array(n);
  const chirpIm = new Float64Array(n);
  for (let k = 0; k < n; k++) {
    const k2 = (k * k) % (2 * n);
    const ang = (sign * Math.PI * k2) / n;
    chirpRe[k] = Math.cos(ang);
    chirpIm[k] = Math.sin(ang);
  }
  const aRe = new Float64Array(m);
  const aIm = new Float64Array(m);
  const bRe = new Float64Array(m);
  const bIm = new Float64Array(m);
  for (let k = 0; k < n; k++) {
    aRe[k] = re[k] * chirpRe[k] - im[k] * chirpIm[k];
    aIm[k] = re[k] * chirpIm[k] + im[k] * chirpRe[k];
  }
  bRe[0] = chirpRe[0];
  bIm[0] = -chirpIm[0];
  for (let k = 1; k < n; k++) {
    bRe[k] = chirpRe[k];
    bIm[k] = -chirpIm[k];
    bRe[m - k] = chirpRe[k];
    bIm[m - k] = -chirpIm[k];
  }
  fftRadix2(aRe, aIm, false);
  fftRadix2(bRe, bIm, false);
  for (let k = 0; k < m; k++) {
    const pr = aRe[k] * bRe[k] - aIm[k] * bIm[k];
    const pi = aRe[k] * bIm[k] + aIm[k] * bRe[k];
    aRe[k] = pr;
    aIm[k] = pi;
  }
  fftRadix2(aRe, aIm, true);
  const outRe = new Float64Array(n);
  const outIm = new Float64Array(n);
  const scale = inverseFft ? 1 / n : 1;
  for (let k = 0; k < n; k++) {
    outRe[k] = (aRe[k] * chirpRe[k] - aIm[k] * chirpIm[k]) * scale;
    outIm[k] = (aRe[k] * chirpIm[k] + aIm[k] * chirpRe[k]) * scale;
  }
  return { re: outRe, im: outIm };
}

type Builtin = (args: Value[], scope: Scope, nargout: number) => Value[];

function arity(name: string, args: Value[], min: number, max = min): void {
  if (args.length < min || args.length > max) {
    fail(
      min === max
        ? `${name} takes ${min} argument${min === 1 ? "" : "s"}`
        : `${name} takes ${min} to ${max} arguments`,
    );
  }
}

const single = (fn: (args: Value[], scope: Scope) => Value): Builtin => (args, scope) => [fn(args, scope)];

const unary = (
  name: string,
  realFn: (x: number) => number,
  complexFn?: (x: Complex) => Complex | number,
  promoteWhen?: (x: number) => boolean,
): Builtin =>
  single((args) => {
    arity(name, args, 1);
    const v = args[0];
    let promote = false;
    if (!hasComplex(v) && promoteWhen && complexFn) {
      const d = flat(v);
      for (let i = 0; i < d.length; i++) {
        if (promoteWhen(d[i])) {
          promote = true;
          break;
        }
      }
    }
    return mapValue(v, realFn, complexFn, promote);
  });

const binary = (
  name: string,
  realFn: (x: number, y: number) => number,
  complexFn?: (x: Complex, y: Complex) => Complex | number,
): Builtin =>
  single((args) => {
    arity(name, args, 2);
    return ew(args[0], args[1], realFn, complexFn);
  });

const reduction = (name: string, f: (d: Float64Array) => number): Builtin =>
  single((args) => {
    arity(name, args, 1, 2);
    const dim = args.length === 2 ? scalar(args[1], name) : undefined;
    return reduce(args[0], f, dim);
  });

const dimsArg = (name: string, args: Value[]): [number, number] => {
  arity(name, args, 1, 2);
  if (args.length === 1 && isMatrix(args[0]) && args[0].data.length === 2) {
    const r = args[0].data[0];
    const c = args[0].data[1];
    if (!Number.isInteger(r) || !Number.isInteger(c) || r < 0 || c < 0) fail(`${name} needs whole sizes`);
    guardSize(r * c);
    return [r, c];
  }
  const r = scalar(args[0], name);
  const c = args.length === 2 ? scalar(args[1], name) : r;
  if (!Number.isInteger(r) || !Number.isInteger(c) || r < 0 || c < 0) fail(`${name} needs whole sizes`);
  guardSize(r * c);
  return [r, c];
};

function drawer(scope: Scope, name: string): Figures {
  return scope.draw ?? fail(`${name} needs a calc block`);
}

function vec(v: Value, what: string): Float64Array {
  if (isMatrix(v) && v.rows !== 1 && v.cols !== 1 && v.data.length > 0) {
    fail(`${what}: expected a vector, got ${shape(v)}`);
  }
  return flat(v);
}

function column(m: Matrix, j: number): Float64Array {
  const out = new Float64Array(m.rows);
  for (let i = 0; i < m.rows; i++) out[i] = m.data[i * m.cols + j];
  return out;
}

function isVec(v: Value): boolean {
  return typeof v === "number" || (isMatrix(v) && (v.rows === 1 || v.cols === 1));
}

function columns(v: Value): Float64Array[] {
  if (typeof v === "number") return [Float64Array.of(v)];
  if (!isMatrix(v)) fail("expected numeric data");
  if (isVec(v)) return [flat(v)];
  const out: Float64Array[] = [];
  for (let j = 0; j < v.cols; j++) out.push(column(v, j));
  return out;
}

function buildSeriesGroup(what: string, group: Value[]): Series[] {
  const names = what === "plot3" ? ["x", "y", "z"] : ["x", "y"];
  if (group.length === 1) {
    const ys = columns(group[0]);
    return ys.map((y) => ({ x: Float64Array.from(y, (_, i) => i + 1), y, z: null }));
  }
  if (group.every(isVec)) {
    const [x, y, z] = group.map((g) => vec(g, what));
    if (x.length !== y.length || (z && z.length !== x.length)) {
      fail(`${what}: ${names.join(", ")} differ in length`);
    }
    return [{ x, y, z: z ?? null }];
  }
  let big = group.find((g): g is Matrix => !isVec(g)) as Matrix;
  if (group.some((g) => isVec(g) && numel(g) === big.cols && numel(g) !== big.rows)) {
    group = group.map((g) => (isVec(g) ? g : transpose(g)));
    big = transpose(big) as Matrix;
  }
  const cols = group.map((g) => {
    if (isVec(g) ? numel(g) !== big.rows : (g as Matrix).rows !== big.rows || (g as Matrix).cols !== big.cols) {
      fail(`${what}: ${names.join(", ")} differ in size`);
    }
    return columns(g);
  });
  const out: Series[] = [];
  for (let j = 0; j < big.cols; j++) {
    const pick = (k: number): Float64Array => cols[k][cols[k].length === 1 ? 0 : j];
    out.push({ x: pick(0), y: pick(1), z: group.length === 3 ? pick(2) : null });
  }
  return out;
}

const STYLE_KEYS = new Set(["linewidth", "markersize", "color", "displayname", "linestyle", "marker"]);

function consumeTrailingProps(args: Value[]): { rest: Value[]; props: LineStyleSpec } {
  const props: LineStyleSpec = {};
  let end = args.length;
  while (end >= 2 && typeof args[end - 2] === "string" && STYLE_KEYS.has((args[end - 2] as string).toLowerCase())) {
    const key = (args[end - 2] as string).toLowerCase();
    const val = args[end - 1];
    if (key === "linewidth") props.lineWidth = scalar(val, "LineWidth");
    else if (key === "markersize") props.markerSize = scalar(val, "MarkerSize");
    else if (key === "displayname") props.name = stringArg(val, "DisplayName");
    else if (key === "color") {
      if (typeof val === "string") props.color = parseLineSpec(val)?.color ?? val;
      else if (isMatrix(val) && val.data.length === 3) {
        const [r, g, b] = [val.data[0], val.data[1], val.data[2]].map((c) => Math.round(Math.max(0, Math.min(1, c)) * 255));
        props.color = `rgb(${r},${g},${b})`;
      }
    } else if (key === "linestyle" && typeof val === "string") {
      props.dash = val === "none" ? "none" : parseLineSpec(val)?.dash;
    } else if (key === "marker" && typeof val === "string") {
      props.marker = val === "none" ? undefined : parseLineSpec(val)?.marker;
    }
    end -= 2;
  }
  return { rest: args.slice(0, end), props };
}

function drawPlotArgs(what: string, rawArgs: Value[], per: 2 | 3): { series: Series[]; styles: (LineStyleSpec | undefined)[] } {
  if (rawArgs.length === 0) fail(`${what} needs data`);
  const { rest, props } = consumeTrailingProps(rawArgs);
  if (rest.length === 0) fail(`${what} needs data`);
  const seriesOut: Series[] = [];
  const stylesOut: (LineStyleSpec | undefined)[] = [];
  const mergeStyle = (spec?: LineStyleSpec): LineStyleSpec | undefined => {
    const merged = { ...spec, ...props };
    return Object.keys(merged).length > 0 ? merged : undefined;
  };

  if (per === 2 && (rest.length === 1 || (rest.length === 2 && typeof rest[1] === "string"))) {
    const spec = rest.length === 2 ? (parseLineSpec(rest[1] as string) ?? fail(`${what}: invalid line spec "${rest[1]}"`)) : undefined;
    const built = buildSeriesGroup(what, [rest[0]]);
    for (const s of built) {
      seriesOut.push(s);
      stylesOut.push(mergeStyle(spec));
    }
    return { series: seriesOut, styles: stylesOut };
  }

  let i = 0;
  while (i < rest.length) {
    if (i + per > rest.length) {
      fail(per === 2 ? `${what}: arguments come in x, y pairs` : `${what}: arguments come in x, y, z triples`);
    }
    const dataGroup = rest.slice(i, i + per);
    if (dataGroup.some((v) => typeof v === "string")) {
      fail(per === 2 ? `${what}: arguments come in x, y pairs` : `${what}: arguments come in x, y, z triples`);
    }
    i += per;
    let spec: LineStyleSpec | undefined;
    if (i < rest.length && typeof rest[i] === "string") {
      spec = parseLineSpec(rest[i] as string) ?? fail(`${what}: invalid line spec "${rest[i]}"`);
      i++;
    }
    const built = buildSeriesGroup(what, dataGroup);
    for (const s of built) {
      seriesOut.push(s);
      stylesOut.push(mergeStyle(spec));
    }
  }
  return { series: seriesOut, styles: stylesOut };
}

function surfaceArgs(what: string, args: Value[]): { x?: Float64Array; y?: Float64Array; z: { rows: number; cols: number; data: Float64Array } } {
  const { rest } = consumeTrailingProps(args);
  if (rest.length === 1) {
    const Z = rest[0];
    if (!isMatrix(Z) || Z.rows < 2 || Z.cols < 2) fail(`${what} needs a 2D matrix`);
    return { z: { rows: Z.rows, cols: Z.cols, data: flat(Z) } };
  }
  if (rest.length >= 3) {
    const [X, Y, Z] = rest;
    if (!isMatrix(Z) || Z.rows < 2 || Z.cols < 2) fail(`${what} needs a 2D Z matrix`);
    const xv = isVec(X) ? flat(X) : rowFromMeshgrid(X as Matrix);
    const yv = isVec(Y) ? flat(Y) : colFromMeshgrid(Y as Matrix);
    return { x: xv, y: yv, z: { rows: Z.rows, cols: Z.cols, data: flat(Z) } };
  }
  fail(`${what} takes (Z) or (X, Y, Z)`);
}

function rowFromMeshgrid(m: Matrix): Float64Array {
  return Float64Array.from(m.data.subarray(0, m.cols));
}

function colFromMeshgrid(m: Matrix): Float64Array {
  return column(m, 0);
}

const DRAWING = new Set([
  "plot",
  "plot3",
  "semilogx",
  "semilogy",
  "loglog",
  "fplot",
  "scatter",
  "scatter3",
  "bar",
  "barh",
  "histogram",
  "hist",
  "stairs",
  "stem",
  "area",
  "errorbar",
  "quiver",
  "polarplot",
  "pie",
  "contour",
  "contourf",
  "imagesc",
  "heatmap",
  "pcolor",
  "surf",
  "surfc",
  "mesh",
  "figure",
  "clf",
  "subplot",
  "hold",
  "title",
  "xlabel",
  "ylabel",
  "zlabel",
  "legend",
  "grid",
  "box",
  "xlim",
  "ylim",
  "zlim",
  "axis",
  "colormap",
  "colorbar",
  "view",
]);

const COMMAND_WORDS = new Set([
  "hold",
  "grid",
  "box",
  "axis",
  "legend",
  "colormap",
  "colorbar",
  "clf",
  "title",
  "xlabel",
  "ylabel",
  "zlabel",
]);

const BUILTINS: Record<string, Builtin> = {
  abs: single((args) => {
    arity("abs", args, 1);
    const v = args[0];
    if (typeof v === "string") return rowVector(Array.from(v, (c) => c.charCodeAt(0)));
    if (!hasComplex(v)) return mapValue(v, Math.abs);
    const p = flatParts(v);
    const r = isMatrix(v) ? v.rows : 1;
    const c = isMatrix(v) ? v.cols : 1;
    const out = new Float64Array(p.re.length);
    for (let i = 0; i < p.re.length; i++) out[i] = Math.hypot(p.re[i], p.im ? p.im[i] : 0);
    return squeeze(matrix(r, c, out));
  }),
  angle: single((args) => {
    arity("angle", args, 1);
    const v = args[0];
    const p = flatParts(v);
    const r = isMatrix(v) ? v.rows : 1;
    const c = isMatrix(v) ? v.cols : 1;
    const out = new Float64Array(p.re.length);
    for (let i = 0; i < p.re.length; i++) out[i] = Math.atan2(p.im ? p.im[i] : 0, p.re[i]);
    return squeeze(matrix(r, c, out));
  }),
  real: single((args) => {
    arity("real", args, 1);
    const v = args[0];
    if (typeof v === "number") return v;
    if (isComplex(v)) return v.re;
    if (isMatrix(v)) return matrix(v.rows, v.cols, Float64Array.from(v.data));
    fail("real needs numbers");
  }),
  imag: single((args) => {
    arity("imag", args, 1);
    const v = args[0];
    if (typeof v === "number") return 0;
    if (isComplex(v)) return v.im;
    if (isMatrix(v)) {
      return matrix(v.rows, v.cols, v.imag ? Float64Array.from(v.imag) : new Float64Array(v.data.length));
    }
    fail("imag needs numbers");
  }),
  conj: single((args) => {
    arity("conj", args, 1);
    const v = args[0];
    if (typeof v === "number") return v;
    if (isComplex(v)) return complexScalar(v.re, -v.im);
    if (isMatrix(v)) {
      if (!v.imag) return v;
      const im = new Float64Array(v.imag.length);
      for (let i = 0; i < im.length; i++) im[i] = -v.imag[i];
      return matrix(v.rows, v.cols, Float64Array.from(v.data), im);
    }
    fail("conj needs numbers");
  }),
  complex: single((args) => {
    arity("complex", args, 1, 2);
    if (args.length === 1) return args[0];
    return ew(args[0], args[1], (a) => a, (a, b) => a.add(b.mul(Complex.I)), true);
  }),
  sign: unary("sign", Math.sign, (x) => x.sign()),
  sqrt: unary("sqrt", Math.sqrt, (x) => x.sqrt(), (x) => x < 0),
  cbrt: unary("cbrt", Math.cbrt, (x) => x.pow(1 / 3)),
  exp: unary("exp", Math.exp, (x) => x.exp()),
  expm1: unary("expm1", Math.expm1, (x) => x.expm1()),
  log: unary("log", Math.log, (x) => x.log(), (x) => x < 0),
  ln: unary("ln", Math.log, (x) => x.log(), (x) => x < 0),
  log1p: unary("log1p", Math.log1p, (x) => x.add(1).log(), (x) => x < -1),
  log2: unary("log2", Math.log2, (x) => x.log().div(Math.LN2), (x) => x < 0),
  log10: unary("log10", Math.log10, (x) => x.log().div(Math.LN10), (x) => x < 0),
  sin: unary("sin", Math.sin, (x) => x.sin()),
  cos: unary("cos", Math.cos, (x) => x.cos()),
  tan: unary("tan", Math.tan, (x) => x.tan()),
  sec: unary("sec", (x) => 1 / Math.cos(x), (x) => x.sec()),
  csc: unary("csc", (x) => 1 / Math.sin(x), (x) => x.csc()),
  cot: unary("cot", (x) => 1 / Math.tan(x), (x) => x.cot()),
  asin: unary("asin", Math.asin, (x) => x.asin(), (x) => Math.abs(x) > 1),
  acos: unary("acos", Math.acos, (x) => x.acos(), (x) => Math.abs(x) > 1),
  atan: unary("atan", Math.atan, (x) => x.atan()),
  asec: unary("asec", (x) => Math.acos(1 / x), (x) => x.asec(), (x) => Math.abs(x) < 1),
  acsc: unary("acsc", (x) => Math.asin(1 / x), (x) => x.acsc(), (x) => Math.abs(x) < 1),
  acot: unary("acot", (x) => Math.atan(1 / x), (x) => x.acot()),
  sinh: unary("sinh", Math.sinh, (x) => x.sinh()),
  cosh: unary("cosh", Math.cosh, (x) => x.cosh()),
  tanh: unary("tanh", Math.tanh, (x) => x.tanh()),
  sech: unary("sech", (x) => 1 / Math.cosh(x), (x) => x.sech()),
  csch: unary("csch", (x) => 1 / Math.sinh(x), (x) => x.csch()),
  coth: unary("coth", (x) => 1 / Math.tanh(x), (x) => x.coth()),
  asinh: unary("asinh", Math.asinh, (x) => x.asinh()),
  acosh: unary("acosh", Math.acosh, (x) => x.acosh(), (x) => x < 1),
  atanh: unary("atanh", Math.atanh, (x) => x.atanh(), (x) => Math.abs(x) > 1),
  sind: unary("sind", (x) => Math.sin((x * Math.PI) / 180)),
  cosd: unary("cosd", (x) => Math.cos((x * Math.PI) / 180)),
  tand: unary("tand", (x) => Math.tan((x * Math.PI) / 180)),
  asind: unary("asind", (x) => (Math.asin(x) * 180) / Math.PI),
  acosd: unary("acosd", (x) => (Math.acos(x) * 180) / Math.PI),
  atand: unary("atand", (x) => (Math.atan(x) * 180) / Math.PI),
  atan2d: binary("atan2d", (y, x) => (Math.atan2(y, x) * 180) / Math.PI),
  deg2rad: unary("deg2rad", (x) => (x * Math.PI) / 180),
  rad2deg: unary("rad2deg", (x) => (x * 180) / Math.PI),
  floor: unary("floor", Math.floor, (x) => x.floor(0)),
  ceil: unary("ceil", Math.ceil, (x) => x.ceil(0)),
  fix: unary("fix", fixNum, (x) => toComplex(fixNum(x.re), fixNum(x.im))),
  gamma: unary("gamma", gammaNum),
  gammaln: unary("gammaln", gammalnNum),
  erf: unary("erf", erfNum),
  erfc: unary("erfc", erfcNum),
  factorial: unary("factorial", factorialNum),
  isnan: unary("isnan", (x) => (Number.isNaN(x) ? 1 : 0), (x) => (Number.isNaN(x.re) || Number.isNaN(x.im) ? 1 : 0)),
  isinf: unary("isinf", (x) => (!Number.isFinite(x) && !Number.isNaN(x) ? 1 : 0)),
  isfinite: unary("isfinite", (x) => (Number.isFinite(x) ? 1 : 0)),
  isreal: single((args) => {
    arity("isreal", args, 1);
    return hasComplex(args[0]) ? 0 : 1;
  }),
  isempty: single((args) => {
    arity("isempty", args, 1);
    return numel(args[0]) === 0 ? 1 : 0;
  }),
  isscalar: single((args) => {
    arity("isscalar", args, 1);
    return numel(args[0]) === 1 ? 1 : 0;
  }),
  isvector: single((args) => {
    arity("isvector", args, 1);
    return isVec(args[0]) ? 1 : 0;
  }),
  ismatrix: single((args) => {
    arity("ismatrix", args, 1);
    return typeof args[0] === "number" || isComplex(args[0]) || isMatrix(args[0]) ? 1 : 0;
  }),
  logical: unary("logical", (x) => (x !== 0 ? 1 : 0)),
  round: single((args) => {
    arity("round", args, 1, 2);
    if (args.length === 1) {
      return mapValue(args[0], roundHalfAway, (x) => toComplex(roundHalfAway(x.re), roundHalfAway(x.im)));
    }
    const digits = scalar(args[1], "round");
    const scale = 10 ** digits;
    return mapValue(
      args[0],
      (x) => roundHalfAway(x * scale) / scale,
      (x) => toComplex(roundHalfAway(x.re * scale) / scale, roundHalfAway(x.im * scale) / scale),
    );
  }),
  atan2: binary("atan2", Math.atan2),
  hypot: binary("hypot", Math.hypot),
  mod: binary("mod", modNum),
  rem: binary("rem", remNum),
  power: single((args) => {
    arity("power", args, 2);
    return dotPow(args[0], args[1]);
  }),
  nthroot: binary("nthroot", (x, n) => {
    if (n === 0) fail("nthroot: n must be nonzero");
    if (x < 0) {
      if (!Number.isInteger(n) || Math.abs(n % 2) !== 1) {
        fail("nthroot: if x is negative, n must be an odd integer");
      }
      return -Math.pow(-x, 1 / n);
    }
    return Math.pow(x, 1 / n);
  }),
  nchoosek: binary("nchoosek", nchoosekNum),
  gcd: binary("gcd", gcdNum),
  lcm: binary("lcm", lcmNum),

  sum: reduction("sum", sumArr),
  prod: reduction("prod", prodArr),
  mean: reduction("mean", meanArr),
  avg: reduction("avg", meanArr),
  median: reduction("median", medianArr),
  var: reduction("var", varArr),
  std: reduction("std", (d) => Math.sqrt(varArr(d))),
  count: reduction("count", (d) => d.length),
  any: reduction("any", (d) => (d.some((x) => x !== 0) ? 1 : 0)),
  all: reduction("all", (d) => (d.every((x) => x !== 0) ? 1 : 0)),
  find: single((args) => {
    arity("find", args, 1, 2);
    const v = args[0];
    const limit = args.length === 2 ? scalar(args[1], "find") : Infinity;
    const total = numel(v);
    const found: number[] = [];
    for (let k = 0; k < total && found.length < limit; k++) {
      if (isMatrix(v)) {
        const c = colMajorRead(v, k);
        if (c.re !== 0 || c.im !== 0) found.push(k + 1);
      } else if (truthy(v)) {
        found.push(1);
      }
    }
    if (found.length === 0) return matrix(1, 0);
    return isMatrix(v) && v.rows > 1 ? colVector(found) : rowVector(found);
  }),
  min: (args, _scope, nargout) => {
    arity("min", args, 1, 2);
    if (args.length === 2) return [ew(args[0], args[1], Math.min)];
    if (nargout >= 2) {
      const d = flat(args[0]);
      if (d.length === 0) fail("min of nothing");
      let best = Infinity;
      let idx = 1;
      for (let i = 0; i < d.length; i++) {
        if (d[i] < best) {
          best = d[i];
          idx = i + 1;
        }
      }
      return [best, idx];
    }
    return [reduce(args[0], minOf)];
  },
  max: (args, _scope, nargout) => {
    arity("max", args, 1, 2);
    if (args.length === 2) return [ew(args[0], args[1], Math.max)];
    if (nargout >= 2) {
      const d = flat(args[0]);
      if (d.length === 0) fail("max of nothing");
      let best = -Infinity;
      let idx = 1;
      for (let i = 0; i < d.length; i++) {
        if (d[i] > best) {
          best = d[i];
          idx = i + 1;
        }
      }
      return [best, idx];
    }
    return [reduce(args[0], maxOf)];
  },
  cumsum: single((args) => {
    arity("cumsum", args, 1);
    return columnwise(args[0], (d) => {
      const out = new Float64Array(d.length);
      let s = 0;
      for (let i = 0; i < d.length; i++) out[i] = s += d[i];
      return out;
    });
  }),
  cumprod: single((args) => {
    arity("cumprod", args, 1);
    return columnwise(args[0], (d) => {
      const out = new Float64Array(d.length);
      let s = 1;
      for (let i = 0; i < d.length; i++) out[i] = s *= d[i];
      return out;
    });
  }),
  sort: (args, _scope, nargout) => {
    arity("sort", args, 1, 2);
    const desc = args.length === 2 && typeof args[1] === "string" && args[1].toLowerCase() === "descend";
    if (nargout >= 2 && isVec(args[0])) {
      const d = flat(args[0]);
      const order = Array.from({ length: d.length }, (_, i) => i).sort((a, b) => (desc ? d[b] - d[a] : d[a] - d[b]));
      const vals = order.map((i) => d[i]);
      const idx = order.map((i) => i + 1);
      const col = isMatrix(args[0]) && args[0].cols === 1;
      return [col ? colVector(vals) : rowVector(vals), col ? colVector(idx) : rowVector(idx)];
    }
    return [
      columnwise(args[0], (d) => {
        const s = Float64Array.from(d).sort();
        return desc ? s.reverse() : s;
      }),
    ];
  },
  diff: single((args) => {
    arity("diff", args, 1, 2);
    const times = args.length === 2 ? scalar(args[1], "diff") : 1;
    let cur = flat(args[0]);
    for (let t = 0; t < times; t++) {
      const next = new Float64Array(Math.max(cur.length - 1, 0));
      for (let i = 0; i < next.length; i++) next[i] = cur[i + 1] - cur[i];
      cur = next;
    }
    return isMatrix(args[0]) && args[0].cols === 1 ? colVector(cur) : rowVector(cur);
  }),
  gradient: single((args) => {
    arity("gradient", args, 1, 2);
    const y = flat(args[0]);
    const h = args.length === 2 ? scalar(args[1], "gradient") : 1;
    if (y.length <= 1) return 0;
    const out = new Float64Array(y.length);
    out[0] = (y[1] - y[0]) / h;
    out[y.length - 1] = (y[y.length - 1] - y[y.length - 2]) / h;
    for (let i = 1; i < y.length - 1; i++) out[i] = (y[i + 1] - y[i - 1]) / (2 * h);
    return isMatrix(args[0]) && args[0].cols === 1 ? colVector(out) : rowVector(out);
  }),
  trapz: single((args) => {
    arity("trapz", args, 1, 2);
    const x = args.length === 2 ? flat(args[0]) : null;
    const y = flat(args.length === 2 ? args[1] : args[0]);
    if (x && x.length !== y.length) fail("trapz: x and y must have the same length");
    let s = 0;
    for (let i = 0; i < y.length - 1; i++) {
      const dx = x ? x[i + 1] - x[i] : 1;
      s += 0.5 * (y[i] + y[i + 1]) * dx;
    }
    return s;
  }),
  cumtrapz: single((args) => {
    arity("cumtrapz", args, 1, 2);
    const x = args.length === 2 ? flat(args[0]) : null;
    const y = flat(args.length === 2 ? args[1] : args[0]);
    if (x && x.length !== y.length) fail("cumtrapz: x and y must have the same length");
    const out = new Float64Array(y.length);
    let s = 0;
    for (let i = 0; i < y.length - 1; i++) {
      s += 0.5 * (y[i] + y[i + 1]) * (x ? x[i + 1] - x[i] : 1);
      out[i + 1] = s;
    }
    return rowVector(out);
  }),
  interp1: single((args) => {
    arity("interp1", args, 3);
    const x = flat(args[0]);
    const y = flat(args[1]);
    const xq = flat(args[2]);
    if (x.length !== y.length || x.length < 2) fail("interp1 needs matching x and y vectors of length ≥ 2");
    const order = Array.from({ length: x.length }, (_, i) => i).sort((a, b) => x[a] - x[b]);
    const xs = order.map((i) => x[i]);
    const ys = order.map((i) => y[i]);
    const out = new Float64Array(xq.length);
    for (let q = 0; q < xq.length; q++) {
      const t = xq[q];
      if (t < xs[0] || t > xs[xs.length - 1]) {
        out[q] = NaN;
        continue;
      }
      let lo = 0;
      let hi = xs.length - 2;
      while (lo < hi) {
        const mid = (lo + hi + 1) >> 1;
        if (xs[mid] <= t) lo = mid;
        else hi = mid - 1;
      }
      const span = xs[lo + 1] - xs[lo];
      out[q] = span === 0 ? ys[lo] : ys[lo] + ((t - xs[lo]) / span) * (ys[lo + 1] - ys[lo]);
    }
    return isMatrix(args[2]) ? squeeze(matrix(args[2].rows, args[2].cols, out)) : out[0];
  }),

  numel: single((args) => {
    arity("numel", args, 1);
    return numel(args[0]);
  }),
  length: single((args) => {
    arity("length", args, 1);
    const v = args[0];
    if (typeof v === "string") return v.length;
    return isMatrix(v) ? (v.data.length === 0 ? 0 : Math.max(v.rows, v.cols)) : 1;
  }),
  size: (args, _scope, nargout) => {
    arity("size", args, 1, 2);
    const v = args[0];
    const r = isMatrix(v) ? v.rows : 1;
    const c = isMatrix(v) ? v.cols : typeof v === "string" ? v.length : 1;
    if (args.length === 2) {
      const d = scalar(args[1], "size");
      return [d === 1 ? r : d === 2 ? c : fail("size dimension is 1 or 2")];
    }
    if (nargout >= 2) return [r, c];
    return [matrix(1, 2, Float64Array.of(r, c))];
  },
  zeros: single((args) => {
    const [r, c] = dimsArg("zeros", args);
    return squeeze(matrix(r, c));
  }),
  ones: single((args) => {
    const [r, c] = dimsArg("ones", args);
    return squeeze(matrix(r, c, new Float64Array(r * c).fill(1)));
  }),
  eye: single((args) => {
    const [r, c] = args.length === 0 ? [1, 1] : dimsArg("eye", args);
    const m = matrix(r, c);
    for (let i = 0; i < Math.min(r, c); i++) m.data[i * c + i] = 1;
    return squeeze(m);
  }),
  rand: single((args) => {
    const [r, c] = args.length === 0 ? [1, 1] : dimsArg("rand", args);
    const d = new Float64Array(r * c);
    for (let i = 0; i < d.length; i++) d[i] = Math.random();
    return squeeze(matrix(r, c, d));
  }),
  randn: single((args) => {
    const [r, c] = args.length === 0 ? [1, 1] : dimsArg("randn", args);
    const d = new Float64Array(r * c);
    for (let i = 0; i < d.length; i += 2) {
      const u1 = Math.max(1e-15, Math.random());
      const u2 = Math.random();
      const mag = Math.sqrt(-2 * Math.log(u1));
      d[i] = mag * Math.cos(2 * Math.PI * u2);
      if (i + 1 < d.length) d[i + 1] = mag * Math.sin(2 * Math.PI * u2);
    }
    return squeeze(matrix(r, c, d));
  }),
  randi: single((args) => {
    arity("randi", args, 1, 3);
    const imax = scalar(args[0], "randi");
    if (!Number.isInteger(imax) || imax < 1) fail("randi needs a positive integer max");
    const [r, c] = args.length === 1 ? [1, 1] : dimsArg("randi", args.slice(1));
    const d = new Float64Array(r * c);
    for (let i = 0; i < d.length; i++) d[i] = Math.floor(Math.random() * imax) + 1;
    return squeeze(matrix(r, c, d));
  }),
  linspace: single((args) => {
    arity("linspace", args, 2, 3);
    const a = scalar(args[0], "linspace");
    const b = scalar(args[1], "linspace");
    const count = args.length === 3 ? scalar(args[2], "linspace") : 100;
    if (Number.isNaN(count)) fail("linspace needs a count");
    const n = Math.max(0, Math.floor(count));
    guardSize(n);
    const d = new Float64Array(n);
    for (let i = 0; i < n; i++) d[i] = i === n - 1 ? b : a + ((b - a) * i) / (n - 1);
    return squeeze({ rows: 1, cols: n, data: d });
  }),
  logspace: single((args) => {
    arity("logspace", args, 2, 3);
    const a = scalar(args[0], "logspace");
    const b = scalar(args[1], "logspace");
    const count = args.length === 3 ? scalar(args[2], "logspace") : 50;
    const n = Math.max(0, Math.floor(count));
    guardSize(n);
    const d = new Float64Array(n);
    for (let i = 0; i < n; i++) d[i] = 10 ** (i === n - 1 ? b : a + ((b - a) * i) / (n - 1));
    return squeeze({ rows: 1, cols: n, data: d });
  }),
  meshgrid: (args, _scope, nargout) => {
    arity("meshgrid", args, 1, 2);
    const x = flat(args[0]);
    const y = args.length === 2 ? flat(args[1]) : x;
    guardSize(x.length * y.length);
    const X = matrix(y.length, x.length);
    const Y = matrix(y.length, x.length);
    for (let i = 0; i < y.length; i++) {
      for (let j = 0; j < x.length; j++) {
        X.data[i * x.length + j] = x[j];
        Y.data[i * x.length + j] = y[i];
      }
    }
    return nargout >= 2 ? [squeeze(X), squeeze(Y)] : [squeeze(X)];
  },
  peaks: (args, _scope, nargout) => {
    arity("peaks", args, 0, 1);
    const n = args.length === 1 ? Math.max(2, Math.floor(scalar(args[0], "peaks"))) : 49;
    guardSize(n * n);
    const xs = new Float64Array(n);
    for (let i = 0; i < n; i++) xs[i] = -3 + (6 * i) / (n - 1);
    const X = matrix(n, n);
    const Y = matrix(n, n);
    const Z = matrix(n, n);
    for (let i = 0; i < n; i++) {
      const y = xs[i];
      for (let j = 0; j < n; j++) {
        const x = xs[j];
        X.data[i * n + j] = x;
        Y.data[i * n + j] = y;
        Z.data[i * n + j] =
          3 * (1 - x) ** 2 * Math.exp(-(x ** 2) - (y + 1) ** 2) -
          10 * (x / 5 - x ** 3 - y ** 5) * Math.exp(-(x ** 2) - y ** 2) -
          (1 / 3) * Math.exp(-((x + 1) ** 2) - y ** 2);
      }
    }
    return nargout >= 3 ? [X, Y, Z] : [Z];
  },
  reshape: single((args) => {
    arity("reshape", args, 2, 3);
    const [r, c] =
      args.length === 2 && isMatrix(args[1]) && args[1].data.length === 2
        ? [args[1].data[0], args[1].data[1]]
        : [scalar(args[1], "reshape"), scalar(args[2], "reshape")];
    const p = flatParts(args[0]);
    if (r * c !== p.re.length) fail(`reshape: ${p.re.length} elements don't fit ${r}×${c}`);
    const src = isMatrix(args[0]) ? transpose(args[0]) : args[0];
    const colMajor = flatParts(src);
    const re = new Float64Array(r * c);
    const im = colMajor.im ? new Float64Array(r * c) : undefined;
    for (let j = 0; j < c; j++) {
      for (let i = 0; i < r; i++) {
        re[i * c + j] = colMajor.re[j * r + i];
        if (im && colMajor.im) im[i * c + j] = colMajor.im[j * r + i];
      }
    }
    return squeeze(matrix(r, c, re, im));
  }),
  repmat: single((args) => {
    arity("repmat", args, 2, 3);
    const [mr, mc] = dimsArg("repmat", args.slice(1));
    const v = args[0];
    const r0 = isMatrix(v) ? v.rows : 1;
    const c0 = isMatrix(v) ? v.cols : 1;
    const p = flatParts(v);
    guardSize(r0 * mr * c0 * mc);
    const re = new Float64Array(r0 * mr * c0 * mc);
    const im = p.im ? new Float64Array(r0 * mr * c0 * mc) : undefined;
    const cols = c0 * mc;
    for (let br = 0; br < mr; br++) {
      for (let bc = 0; bc < mc; bc++) {
        for (let i = 0; i < r0; i++) {
          for (let j = 0; j < c0; j++) {
            const dst = (br * r0 + i) * cols + (bc * c0 + j);
            const src = i * c0 + j;
            re[dst] = p.re[src];
            if (im && p.im) im[dst] = p.im[src];
          }
        }
      }
    }
    return squeeze(matrix(r0 * mr, cols, re, im));
  }),
  diag: single((args) => {
    arity("diag", args, 1, 2);
    const k = args.length === 2 ? Math.trunc(scalar(args[1], "diag")) : 0;
    const v = args[0];
    if (isVec(v)) {
      const p = flatParts(v);
      const n = p.re.length + Math.abs(k);
      guardSize(n * n);
      const re = new Float64Array(n * n);
      const im = p.im ? new Float64Array(n * n) : undefined;
      for (let i = 0; i < p.re.length; i++) {
        const r = k >= 0 ? i : i - k;
        const c = k >= 0 ? i + k : i;
        re[r * n + c] = p.re[i];
        if (im && p.im) im[r * n + c] = p.im[i];
      }
      return squeeze(matrix(n, n, re, im));
    }
    if (!isMatrix(v)) return v;
    const re: number[] = [];
    const im: number[] = [];
    for (let i = 0; i < v.rows; i++) {
      const j = i + k;
      if (j >= 0 && j < v.cols) {
        re.push(v.data[i * v.cols + j]);
        if (v.imag) im.push(v.imag[i * v.cols + j]);
      }
    }
    return re.length === 0 ? matrix(0, 1) : colVector(re, v.imag ? im : undefined);
  }),
  tril: single((args) => {
    arity("tril", args, 1, 2);
    const k = args.length === 2 ? Math.trunc(scalar(args[1], "tril")) : 0;
    const v = args[0];
    if (!isMatrix(v)) return k < 0 ? 0 : v;
    const re = Float64Array.from(v.data);
    const im = v.imag ? Float64Array.from(v.imag) : undefined;
    for (let i = 0; i < v.rows; i++) {
      for (let j = i + k + 1; j < v.cols; j++) {
        if (j >= 0) {
          re[i * v.cols + j] = 0;
          if (im) im[i * v.cols + j] = 0;
        }
      }
    }
    return matrix(v.rows, v.cols, re, im);
  }),
  triu: single((args) => {
    arity("triu", args, 1, 2);
    const k = args.length === 2 ? Math.trunc(scalar(args[1], "triu")) : 0;
    const v = args[0];
    if (!isMatrix(v)) return k > 0 ? 0 : v;
    const re = Float64Array.from(v.data);
    const im = v.imag ? Float64Array.from(v.imag) : undefined;
    for (let i = 0; i < v.rows; i++) {
      for (let j = 0; j < Math.min(v.cols, i + k); j++) {
        re[i * v.cols + j] = 0;
        if (im) im[i * v.cols + j] = 0;
      }
    }
    return matrix(v.rows, v.cols, re, im);
  }),
  fliplr: single((args) => {
    arity("fliplr", args, 1);
    const v = args[0];
    if (!isMatrix(v)) return v;
    const re = new Float64Array(v.data.length);
    const im = v.imag ? new Float64Array(v.imag.length) : undefined;
    for (let i = 0; i < v.rows; i++) {
      for (let j = 0; j < v.cols; j++) {
        re[i * v.cols + (v.cols - 1 - j)] = v.data[i * v.cols + j];
        if (im && v.imag) im[i * v.cols + (v.cols - 1 - j)] = v.imag[i * v.cols + j];
      }
    }
    return matrix(v.rows, v.cols, re, im);
  }),
  flipud: single((args) => {
    arity("flipud", args, 1);
    const v = args[0];
    if (!isMatrix(v)) return v;
    const re = new Float64Array(v.data.length);
    const im = v.imag ? new Float64Array(v.imag.length) : undefined;
    for (let i = 0; i < v.rows; i++) {
      const dst = (v.rows - 1 - i) * v.cols;
      const src = i * v.cols;
      re.set(v.data.subarray(src, src + v.cols), dst);
      if (im && v.imag) im.set(v.imag.subarray(src, src + v.cols), dst);
    }
    return matrix(v.rows, v.cols, re, im);
  }),
  flip: single((args) => {
    arity("flip", args, 1);
    const v = args[0];
    if (!isMatrix(v)) return v;
    return v.rows === 1 ? BUILTINS.fliplr(args, { get: () => undefined, set: () => {} }, 1)[0] : BUILTINS.flipud(args, { get: () => undefined, set: () => {} }, 1)[0];
  }),
  rot90: single((args) => {
    arity("rot90", args, 1, 2);
    let cur = args[0];
    const k = (((args.length === 2 ? Math.trunc(scalar(args[1], "rot90")) : 1) % 4) + 4) % 4;
    const dummy: Scope = { get: () => undefined, set: () => {} };
    for (let t = 0; t < k; t++) cur = BUILTINS.flipud([transpose(cur)], dummy, 1)[0];
    return cur;
  }),
  horzcat: single((args) => hcat(args)),
  vertcat: single((args) => vcat(args)),
  cat: single((args) => {
    if (args.length < 2) fail("cat takes a dimension and arrays");
    const dim = scalar(args[0], "cat");
    return dim === 1 ? vcat(args.slice(1)) : dim === 2 ? hcat(args.slice(1)) : fail("cat dimension is 1 or 2");
  }),
  squeeze: single((args) => {
    arity("squeeze", args, 1);
    return isMatrix(args[0]) ? squeeze(args[0]) : args[0];
  }),

  transpose: single((args) => {
    arity("transpose", args, 1);
    return transpose(args[0], false);
  }),
  ctranspose: single((args) => {
    arity("ctranspose", args, 1);
    return transpose(args[0], true);
  }),
  dot: single((args) => {
    arity("dot", args, 2);
    const a = flatParts(args[0]);
    const b = flatParts(args[1]);
    if (a.re.length !== b.re.length) fail("dot needs vectors of the same length");
    if (!a.im && !b.im) {
      let s = 0;
      for (let i = 0; i < a.re.length; i++) s += a.re[i] * b.re[i];
      return s;
    }
    let re = 0;
    let im = 0;
    for (let i = 0; i < a.re.length; i++) {
      const ar = a.re[i];
      const ai = -(a.im ? a.im[i] : 0);
      const br = b.re[i];
      const bi = b.im ? b.im[i] : 0;
      re += ar * br - ai * bi;
      im += ar * bi + ai * br;
    }
    return complexScalar(re, im);
  }),
  cross: single((args) => {
    arity("cross", args, 2);
    const a = flatParts(args[0]);
    const b = flatParts(args[1]);
    if (a.re.length !== 3 || b.re.length !== 3) fail("cross needs 3-element vectors");
    const col = isMatrix(args[0]) && args[0].cols === 1;
    if (!a.im && !b.im) {
      const res = [
        a.re[1] * b.re[2] - a.re[2] * b.re[1],
        a.re[2] * b.re[0] - a.re[0] * b.re[2],
        a.re[0] * b.re[1] - a.re[1] * b.re[0],
      ];
      return col ? colVector(res) : rowVector(res);
    }
    const ca = Array.from({ length: 3 }, (_, i) => toComplex(a.re[i], a.im ? a.im[i] : 0));
    const cb = Array.from({ length: 3 }, (_, i) => toComplex(b.re[i], b.im ? b.im[i] : 0));
    const c = [
      ca[1].mul(cb[2]).sub(ca[2].mul(cb[1])),
      ca[2].mul(cb[0]).sub(ca[0].mul(cb[2])),
      ca[0].mul(cb[1]).sub(ca[1].mul(cb[0])),
    ];
    const re = c.map((z) => z.re);
    const im = c.map((z) => z.im);
    return col ? colVector(re, im) : rowVector(re, im);
  }),
  kron: single((args) => {
    arity("kron", args, 2);
    const a = args[0];
    const b = args[1];
    const ar = isMatrix(a) ? a.rows : 1;
    const ac = isMatrix(a) ? a.cols : 1;
    const br = isMatrix(b) ? b.rows : 1;
    const bc = isMatrix(b) ? b.cols : 1;
    guardSize(ar * br * ac * bc);
    const pa = flatParts(a);
    const pb = flatParts(b);
    const rows = ar * br;
    const cols = ac * bc;
    const re = new Float64Array(rows * cols);
    const im = pa.im || pb.im ? new Float64Array(rows * cols) : undefined;
    for (let ia = 0; ia < ar; ia++) {
      for (let ja = 0; ja < ac; ja++) {
        const ka = ia * ac + ja;
        const are = pa.re[ka];
        const aim = pa.im ? pa.im[ka] : 0;
        for (let ib = 0; ib < br; ib++) {
          for (let jb = 0; jb < bc; jb++) {
            const kb = ib * bc + jb;
            const bre = pb.re[kb];
            const bim = pb.im ? pb.im[kb] : 0;
            const dst = (ia * br + ib) * cols + (ja * bc + jb);
            re[dst] = are * bre - aim * bim;
            if (im) im[dst] = are * bim + aim * bre;
          }
        }
      }
    }
    return squeeze(matrix(rows, cols, re, im));
  }),
  norm: single((args) => {
    arity("norm", args, 1, 2);
    const v = args[0];
    if (isVec(v)) {
      const pArg = args.length === 2 ? args[1] : 2;
      const p = flatParts(v);
      const mags = Float64Array.from(p.re, (r, i) => Math.hypot(r, p.im ? p.im[i] : 0));
      if (typeof pArg === "string" && pArg.toLowerCase() === "inf") return maxOf(mags);
      const pv = scalar(pArg, "norm");
      if (pv === Infinity) return maxOf(mags);
      if (pv === -Infinity) return minOf(mags);
      if (pv === 2) {
        let s = 0;
        for (let i = 0; i < mags.length; i++) s += mags[i] * mags[i];
        return Math.sqrt(s);
      }
      let s = 0;
      for (let i = 0; i < mags.length; i++) s += mags[i] ** pv;
      return s ** (1 / pv);
    }
    if (args.length === 2 && typeof args[1] === "string" && args[1].toLowerCase() === "fro") {
      const p = flatParts(v);
      let s = 0;
      for (let i = 0; i < p.re.length; i++) s += p.re[i] ** 2 + (p.im ? p.im[i] ** 2 : 0);
      return Math.sqrt(s);
    }
    const m = hasComplex(v) ? toRealBlock(v, "norm") : toMlMatrix(v, "norm");
    const svd = new SingularValueDecomposition(m);
    return svd.diagonal.length > 0 ? Math.max(...svd.diagonal) : 0;
  }),
  det: single((args) => {
    arity("det", args, 1);
    const v = args[0];
    if (!isMatrix(v)) return v;
    if (v.rows !== v.cols) fail(`det needs a square matrix, got ${shape(v)}`);
    if (!hasComplex(v)) return wrapMathError("det", () => determinant(toMlMatrix(v, "det")));
    const { det } = complexLuDecomp(v);
    return complexScalar(det.re, det.im);
  }),
  inv: single((args) => {
    arity("inv", args, 1);
    const v = args[0];
    if (!isMatrix(v)) return mrdivide(1, v);
    if (v.rows !== v.cols) fail(`inv needs a square matrix, got ${shape(v)}`);
    if (!hasComplex(v)) {
      const mA = toMlMatrix(v, "inv");
      const lu = new LuDecomposition(mA);
      if (lu.isSingular()) fail("matrix is singular");
      return fromMlMatrix(lu.solve(MlMatrix.eye(v.rows)));
    }
    const mA = toRealBlock(v, "inv");
    const lu = new LuDecomposition(mA);
    if (lu.isSingular()) fail("matrix is singular");
    return fromRealBlock(lu.solve(MlMatrix.eye(mA.rows)));
  }),
  pinv: single((args) => {
    arity("pinv", args, 1);
    if (!hasComplex(args[0])) return fromMlMatrix(pseudoInverse(toMlMatrix(args[0], "pinv")));
    return fromRealBlock(pseudoInverse(toRealBlock(args[0], "pinv")));
  }),
  expm: single((args) => {
    arity("expm", args, 1);
    const v = args[0];
    if (!isMatrix(v)) return BUILTINS.exp([v], { get: () => undefined, set: () => {} }, 1)[0];
    if (v.rows !== v.cols) fail(`expm needs a square matrix, got ${shape(v)}`);
    if (!hasComplex(v)) return wrapMathError("expm", () => fromMlMatrix(expmMl(toMlMatrix(v, "expm"))));
    return wrapMathError("expm", () => fromRealBlock(expmMl(toRealBlock(v, "expm"))));
  }),
  sqrtm: single((args) => {
    arity("sqrtm", args, 1);
    return wrapMathError("sqrtm", () => sqrtmValue(args[0]));
  }),
  trace: single((args) => {
    arity("trace", args, 1);
    const v = args[0];
    if (!isMatrix(v)) return v;
    if (v.rows !== v.cols) fail(`trace needs a square matrix, got ${shape(v)}`);
    let re = 0;
    let im = 0;
    for (let i = 0; i < v.rows; i++) {
      re += v.data[i * v.cols + i];
      if (v.imag) im += v.imag[i * v.cols + i];
    }
    return complexScalar(re, im);
  }),
  rank: single((args) => {
    arity("rank", args, 1, 2);
    const svd = new SingularValueDecomposition(toMlMatrix(args[0], "rank"));
    const s = svd.diagonal;
    if (s.length === 0) return 0;
    const m = toMlMatrix(args[0], "rank");
    const tol = args.length === 2 ? scalar(args[1], "rank") : Math.max(m.rows, m.columns) * Math.max(...s) * Number.EPSILON;
    return s.filter((v) => v > tol).length;
  }),
  cond: single((args) => {
    arity("cond", args, 1);
    const svd = new SingularValueDecomposition(toMlMatrix(args[0], "cond"));
    const s = svd.diagonal;
    if (s.length === 0) return 0;
    const minS = Math.min(...s);
    const maxS = Math.max(...s);
    return minS === 0 ? Infinity : maxS / minS;
  }),
  null: single((args) => {
    arity("null", args, 1);
    const m = toMlMatrix(args[0], "null");
    const svd = new SingularValueDecomposition(m);
    const V = svd.rightSingularVectors;
    const s = svd.diagonal;
    const tol = Math.max(m.rows, m.columns) * (s.length ? Math.max(...s) : 0) * Number.EPSILON;
    const r = s.filter((v) => v > tol).length;
    if (r >= m.columns) return matrix(m.columns, 0);
    return fromMlMatrix(V.subMatrix(0, m.columns - 1, r, m.columns - 1));
  }),
  orth: single((args) => {
    arity("orth", args, 1);
    const m = toMlMatrix(args[0], "orth");
    const svd = new SingularValueDecomposition(m);
    const U = svd.leftSingularVectors;
    const s = svd.diagonal;
    const tol = Math.max(m.rows, m.columns) * (s.length ? Math.max(...s) : 0) * Number.EPSILON;
    const r = s.filter((v) => v > tol).length;
    if (r === 0) return matrix(m.rows, 0);
    return fromMlMatrix(U.subMatrix(0, m.rows - 1, 0, r - 1));
  }),
  rref: single((args) => {
    arity("rref", args, 1);
    const m = toMlMatrix(args[0], "rref").clone();
    const rows = m.rows;
    const cols = m.columns;
    const tol = Math.max(rows, cols) * Number.EPSILON * (m.max() || 1) * 10;
    let lead = 0;
    for (let r = 0; r < rows && lead < cols; r++) {
      let i = r;
      while (i < rows && Math.abs(m.get(i, lead)) <= tol) i++;
      if (i === rows) {
        lead++;
        r--;
        continue;
      }
      m.swapRows(i, r);
      const lv = m.get(r, lead);
      for (let j = 0; j < cols; j++) m.set(r, j, m.get(r, j) / lv);
      for (let k = 0; k < rows; k++) {
        if (k === r) continue;
        const f = m.get(k, lead);
        if (Math.abs(f) <= tol) continue;
        for (let j = 0; j < cols; j++) m.set(k, j, m.get(k, j) - f * m.get(r, j));
      }
      lead++;
    }
    return fromMlMatrix(m);
  }),
  eig: (args, _scope, nargout) => {
    arity("eig", args, 1);
    const v = args[0];
    if (hasComplex(v)) {
      if (!isMatrix(v)) return nargout >= 2 ? [1, v] : [v];
      return complexEigDecomp(v, nargout);
    }
    const m = toMlMatrix(v, "eig");
    if (m.rows !== m.columns) fail(`eig needs a square matrix, got ${shape(v)}`);
    const evd = new EigenvalueDecomposition(m);
    const re = Float64Array.from(evd.realEigenvalues);
    const im = Float64Array.from(evd.imaginaryEigenvalues);
    if (nargout < 2) return [colVector(re, im)];
    const n = m.rows;
    const Vm = evd.eigenvectorMatrix;
    const vre = new Float64Array(n * n);
    const vim = new Float64Array(n * n);
    for (let j = 0; j < n; j++) {
      if (im[j] > 0 && j + 1 < n && Math.abs(im[j] + im[j + 1]) < 1e-12) {
        for (let i = 0; i < n; i++) {
          vre[i * n + j] = Vm.get(i, j);
          vim[i * n + j] = Vm.get(i, j + 1);
          vre[i * n + (j + 1)] = Vm.get(i, j);
          vim[i * n + (j + 1)] = -Vm.get(i, j + 1);
        }
        j++;
      } else {
        for (let i = 0; i < n; i++) vre[i * n + j] = Vm.get(i, j);
      }
    }
    const dre = new Float64Array(n * n);
    const dim = new Float64Array(n * n);
    for (let i = 0; i < n; i++) {
      dre[i * n + i] = re[i];
      dim[i * n + i] = im[i];
    }
    return [squeeze(matrix(n, n, vre, vim)), squeeze(matrix(n, n, dre, dim))];
  },
  eigs: (args, scope, nargout) => BUILTINS.eig(args, scope, nargout),
  svd: (args, _scope, nargout) => {
    arity("svd", args, 1);
    const m = toMlMatrix(args[0], "svd");
    const svd = new SingularValueDecomposition(m);
    if (nargout < 2) return [colVector(svd.diagonal)];
    const U = fromMlMatrix(svd.leftSingularVectors);
    const S = fromMlMatrix(svd.diagonalMatrix);
    const V = fromMlMatrix(svd.rightSingularVectors);
    return [U, S, V];
  },
  qr: (args, _scope, nargout) => {
    arity("qr", args, 1);
    if (hasComplex(args[0])) {
      if (!isMatrix(args[0])) return nargout >= 2 ? [1, args[0]] : [args[0]];
      const res = complexQrDecomp(args[0]);
      return nargout >= 2 ? [res.Q, res.R] : [res.R];
    }
    const qr = new QrDecomposition(toMlMatrix(args[0], "qr"));
    const Q = fromMlMatrix(qr.orthogonalMatrix);
    const R = fromMlMatrix(qr.upperTriangularMatrix);
    return nargout >= 2 ? [Q, R] : [R];
  },
  lu: (args, _scope, nargout) => {
    arity("lu", args, 1);
    const v = args[0];
    if (!isMatrix(v)) return nargout >= 3 ? [1, v, 1] : nargout === 2 ? [1, v] : [v];
    let L: Value;
    let U: Value;
    let pArr: number[];
    if (hasComplex(v)) {
      const res = complexLuDecomp(v);
      L = res.L;
      U = res.U;
      pArr = res.piv;
    } else {
      const m = toMlMatrix(v, "lu");
      if (m.rows !== m.columns) fail(`lu needs a square matrix, got ${shape(v)}`);
      const res = new LuDecomposition(m);
      L = fromMlMatrix(res.lowerTriangularMatrix);
      U = fromMlMatrix(res.upperTriangularMatrix);
      pArr = res.pivotPermutationVector;
    }
    const n = pArr.length;
    const P = matrix(n, n);
    for (let i = 0; i < n; i++) P.data[i * n + pArr[i]] = 1;
    if (nargout >= 3) return [L, U, squeeze(P)];
    if (nargout === 2) return [mul(transpose(P), L), U];
    return [U];
  },
  chol: single((args) => {
    arity("chol", args, 1);
    const m = toMlMatrix(args[0], "chol");
    const cho = new CholeskyDecomposition(m);
    if (!cho.isPositiveDefinite()) fail("chol: matrix must be symmetric positive definite");
    return transpose(fromMlMatrix(cho.lowerTriangularMatrix));
  }),
  linsolve: single((args) => {
    arity("linsolve", args, 2);
    return mldivide(args[0], args[1]);
  }),
  mldivide: single((args) => {
    arity("mldivide", args, 2);
    return mldivide(args[0], args[1]);
  }),
  mrdivide: single((args) => {
    arity("mrdivide", args, 2);
    return mrdivide(args[0], args[1]);
  }),

  fft: single((args) => {
    arity("fft", args, 1);
    const v = args[0];
    const p = flatParts(v);
    const { re, im } = fft1d(p.re, p.im, false);
    const rows = isMatrix(v) && v.cols === 1 ? re.length : 1;
    const cols = isMatrix(v) && v.cols === 1 ? 1 : re.length;
    return squeeze(matrix(rows, cols, re, im));
  }),
  ifft: single((args) => {
    arity("ifft", args, 1);
    const v = args[0];
    const p = flatParts(v);
    const { re, im } = fft1d(p.re, p.im, true);
    const rows = isMatrix(v) && v.cols === 1 ? re.length : 1;
    const cols = isMatrix(v) && v.cols === 1 ? 1 : re.length;
    return squeeze(matrix(rows, cols, re, im));
  }),
  fftshift: single((args) => {
    arity("fftshift", args, 1);
    const v = args[0];
    const p = flatParts(v);
    const n = p.re.length;
    const k = Math.floor(n / 2);
    const re = new Float64Array(n);
    const im = p.im ? new Float64Array(n) : undefined;
    for (let i = 0; i < n; i++) {
      const src = (i + n - k) % n;
      re[i] = p.re[src];
      if (im && p.im) im[i] = p.im[src];
    }
    return isMatrix(v) ? squeeze(matrix(v.rows, v.cols, re, im)) : re[0];
  }),
  conv: single((args) => {
    arity("conv", args, 2);
    const u = flatParts(args[0]);
    const v = flatParts(args[1]);
    const n = u.re.length + v.re.length - 1;
    if (n <= 0) return matrix(1, 0);
    const re = new Float64Array(n);
    const im = u.im || v.im ? new Float64Array(n) : undefined;
    for (let i = 0; i < u.re.length; i++) {
      for (let j = 0; j < v.re.length; j++) {
        const ur = u.re[i];
        const ui = u.im ? u.im[i] : 0;
        const vr = v.re[j];
        const vi = v.im ? v.im[j] : 0;
        re[i + j] += ur * vr - ui * vi;
        if (im) im[i + j] += ur * vi + ui * vr;
      }
    }
    return squeeze(matrix(1, n, re, im));
  }),

  polyval: single((args) => {
    arity("polyval", args, 2);
    const p = flatParts(args[0]);
    const x = args[1];
    if (p.re.length === 0) return mapValue(x, () => 0);
    let acc: Value = p.im ? complexScalar(p.re[0], p.im[0]) : p.re[0];
    for (let i = 1; i < p.re.length; i++) {
      const coeff: Value = p.im ? complexScalar(p.re[i], p.im[i]) : p.re[i];
      acc = ew(
        ew(acc, x, (a, b) => a * b, (a, b) => a.mul(b)),
        coeff,
        (a, b) => a + b,
        (a, b) => a.add(b),
      );
    }
    return acc;
  }),
  polyfit: single((args) => {
    arity("polyfit", args, 3);
    const x = flat(args[0]);
    const y = flat(args[1]);
    const deg = Math.trunc(scalar(args[2], "polyfit"));
    if (x.length !== y.length || deg < 0) fail("polyfit needs equal-length x, y and non-negative degree");
    const cols = deg + 1;
    const V = new MlMatrix(x.length, cols);
    for (let i = 0; i < x.length; i++) {
      for (let j = 0; j < cols; j++) V.set(i, j, x[i] ** (deg - j));
    }
    const solved = mlSolve(V, MlMatrix.columnVector(Array.from(y)), true);
    return rowVector(solved.getColumn(0));
  }),
  roots: single((args) => {
    arity("roots", args, 1);
    const c = flat(args[0]);
    let start = 0;
    while (start < c.length && c[start] === 0) start++;
    const p = c.subarray(start);
    if (p.length <= 1) return matrix(0, 1);
    const n = p.length - 1;
    const comp = new MlMatrix(n, n);
    for (let j = 0; j < n; j++) comp.set(0, j, -p[j + 1] / p[0]);
    for (let i = 1; i < n; i++) comp.set(i, i - 1, 1);
    const evd = new EigenvalueDecomposition(comp);
    return colVector(evd.realEigenvalues, evd.imaginaryEigenvalues);
  }),
  poly: single((args) => {
    arity("poly", args, 1);
    const r = isMatrix(args[0]) && args[0].rows > 1 && args[0].cols > 1
      ? BUILTINS.eig([args[0]], { get: () => undefined, set: () => {} }, 1)[0]
      : args[0];
    const p = flatParts(r);
    let coeffs: Value = 1;
    const dummy: Scope = { get: () => undefined, set: () => {} };
    for (let i = 0; i < p.re.length; i++) {
      const root = p.im ? complexScalar(-p.re[i], -p.im[i]) : -p.re[i];
      coeffs = BUILTINS.conv([coeffs, hcat([1, root])], dummy, 1)[0];
    }
    return coeffs;
  }),
  polyder: single((args) => {
    arity("polyder", args, 1);
    const p = flat(args[0]);
    if (p.length <= 1) return 0;
    const out = new Float64Array(p.length - 1);
    const deg = p.length - 1;
    for (let i = 0; i < out.length; i++) out[i] = p[i] * (deg - i);
    return rowVector(out);
  }),
  polyint: single((args) => {
    arity("polyint", args, 1, 2);
    const p = flat(args[0]);
    const k = args.length === 2 ? scalar(args[1], "polyint") : 0;
    const out = new Float64Array(p.length + 1);
    const n = p.length;
    for (let i = 0; i < n; i++) out[i] = p[i] / (n - i);
    out[n] = k;
    return rowVector(out);
  }),

  fzero: single((args, scope) => {
    arity("fzero", args, 2);
    const f = args[0];
    if (!isFnHandle(f)) fail("fzero needs a function handle @(x) ...");
    const evalAt = (x: number): number => scalar(f.call([x], scope, 1)[0], "fzero");
    if (isMatrix(args[1]) && args[1].data.length === 2) {
      let [a, b] = [args[1].data[0], args[1].data[1]];
      let fa = evalAt(a);
      let fb = evalAt(b);
      if (fa === 0) return a;
      if (fb === 0) return b;
      if (fa * fb > 0) fail("fzero: function values at interval endpoints must differ in sign");
      for (let it = 0; it < 100; it++) {
        const m = 0.5 * (a + b);
        const fm = evalAt(m);
        if (Math.abs(fm) < 1e-13 || Math.abs(b - a) < 1e-13) return m;
        if (fa * fm <= 0) {
          b = m;
          fb = fm;
        } else {
          a = m;
          fa = fm;
        }
      }
      return 0.5 * (a + b);
    }
    let x0 = scalar(args[1], "fzero");
    let x1 = x0 === 0 ? 1e-4 : x0 * 1.001;
    let f0 = evalAt(x0);
    let f1 = evalAt(x1);
    for (let it = 0; it < 80; it++) {
      if (Math.abs(f1) < 1e-13) return x1;
      const denom = f1 - f0;
      if (denom === 0) break;
      const x2 = x1 - (f1 * (x1 - x0)) / denom;
      if (Math.abs(x2 - x1) < 1e-13) return x2;
      x0 = x1;
      f0 = f1;
      x1 = x2;
      f1 = evalAt(x1);
    }
    return x1;
  }),
  integral: single((args, scope) => {
    arity("integral", args, 3);
    const f = args[0];
    if (!isFnHandle(f)) fail("integral needs a function handle @(x) ...");
    const a = scalar(args[1], "integral");
    const b = scalar(args[2], "integral");
    const evalAt = (x: number): number => scalar(f.call([x], scope, 1)[0], "integral");
    const simpson = (l: number, r: number, fl: number, fm: number, fr: number, whole: number, depth: number): number => {
      const m = 0.5 * (l + r);
      const lm = 0.5 * (l + m);
      const rm = 0.5 * (m + r);
      const flm = evalAt(lm);
      const frm = evalAt(rm);
      const left = ((m - l) / 6) * (fl + 4 * flm + fm);
      const right = ((r - m) / 6) * (fm + 4 * frm + fr);
      if (depth <= 0 || Math.abs(left + right - whole) <= 15 * 1e-10) {
        return left + right + (left + right - whole) / 15;
      }
      return simpson(l, m, fl, flm, fm, left, depth - 1) + simpson(m, r, fm, frm, fr, right, depth - 1);
    };
    const fa = evalAt(a);
    const fb = evalAt(b);
    const fm = evalAt(0.5 * (a + b));
    const whole = ((b - a) / 6) * (fa + 4 * fm + fb);
    return simpson(a, b, fa, fm, fb, whole, 14);
  }),

  figure: single((args, scope) => {
    arity("figure", args, 0, 1);
    drawer(scope, "figure").figure(args.length ? scalar(args[0], "figure") : undefined);
    return 0;
  }),
  clf: single((args, scope) => {
    arity("clf", args, 0);
    drawer(scope, "clf").clf();
    return 0;
  }),
  subplot: single((args, scope) => {
    arity("subplot", args, 1, 3);
    if (args.length === 1) {
      const code = scalar(args[0], "subplot");
      const m = Math.floor(code / 100);
      const n = Math.floor((code % 100) / 10);
      const p = code % 10;
      drawer(scope, "subplot").subplot(m, n, p);
      return 0;
    }
    arity("subplot", args, 3);
    drawer(scope, "subplot").subplot(scalar(args[0], "subplot"), scalar(args[1], "subplot"), scalar(args[2], "subplot"));
    return 0;
  }),
  hold: single((args, scope) => {
    arity("hold", args, 0, 1);
    if (args.length === 0) {
      drawer(scope, "hold").hold();
      return 0;
    }
    const w = stringArg(args[0], "hold").toLowerCase();
    if (w === "on" || w === "all") drawer(scope, "hold").hold(true);
    else if (w === "off") drawer(scope, "hold").hold(false);
    else fail(`hold: expected "on" or "off"`);
    return 0;
  }),
  plot: single((args, scope) => {
    const target = drawer(scope, "plot");
    const { series, styles } = drawPlotArgs("plot", args, 2);
    target.plot(series, styles);
    return 0;
  }),
  plot3: single((args, scope) => {
    const target = drawer(scope, "plot3");
    const { series, styles } = drawPlotArgs("plot3", args, 3);
    target.plot(series, styles);
    return 0;
  }),
  semilogx: single((args, scope) => {
    const target = drawer(scope, "semilogx");
    const { series, styles } = drawPlotArgs("semilogx", args, 2);
    target.addTraces(
      series.map((s, i) => ({ kind: "line2d", x: s.x, y: s.y, style: styles[i] })),
      { xscale: "log" },
    );
    return 0;
  }),
  semilogy: single((args, scope) => {
    const target = drawer(scope, "semilogy");
    const { series, styles } = drawPlotArgs("semilogy", args, 2);
    target.addTraces(
      series.map((s, i) => ({ kind: "line2d", x: s.x, y: s.y, style: styles[i] })),
      { yscale: "log" },
    );
    return 0;
  }),
  loglog: single((args, scope) => {
    const target = drawer(scope, "loglog");
    const { series, styles } = drawPlotArgs("loglog", args, 2);
    target.addTraces(
      series.map((s, i) => ({ kind: "line2d", x: s.x, y: s.y, style: styles[i] })),
      { xscale: "log", yscale: "log" },
    );
    return 0;
  }),
  fplot: single((args, scope) => {
    const target = drawer(scope, "fplot");
    const { rest, props } = consumeTrailingProps(args);
    if (rest.length < 1 || !isFnHandle(rest[0])) fail("fplot needs a function handle @(x) ...");
    const fn = rest[0];
    let a = -5;
    let b = 5;
    let spec: LineStyleSpec | undefined;
    for (let i = 1; i < rest.length; i++) {
      if (typeof rest[i] === "string") spec = parseLineSpec(rest[i] as string) ?? undefined;
      else if (isMatrix(rest[i]) && (rest[i] as Matrix).data.length === 2) {
        a = (rest[i] as Matrix).data[0];
        b = (rest[i] as Matrix).data[1];
      }
    }
    const n = 250;
    const x = new Float64Array(n);
    const y = new Float64Array(n);
    for (let i = 0; i < n; i++) {
      x[i] = a + ((b - a) * i) / (n - 1);
      const out = fn.call([x[i]], scope, 1)[0];
      y[i] = typeof out === "number" ? out : isMatrix(out) && out.data.length === 1 ? out.data[0] : NaN;
    }
    target.addTraces([{ kind: "line2d", x, y, style: { ...spec, ...props } }]);
    return 0;
  }),
  scatter: single((args, scope) => {
    const target = drawer(scope, "scatter");
    const { rest, props } = consumeTrailingProps(args);
    if (rest.length < 2) fail("scatter takes (x, y) and optional size/color");
    const x = vec(rest[0], "scatter");
    const y = vec(rest[1], "scatter");
    if (x.length !== y.length) fail("scatter: x, y differ in length");
    let sz: number | Float64Array | undefined;
    let cdata: Float64Array | undefined;
    let spec: LineStyleSpec | undefined;
    if (rest.length >= 3 && typeof rest[2] !== "string") {
      sz = typeof rest[2] === "number" ? rest[2] : vec(rest[2], "scatter");
    } else if (typeof rest[2] === "string") {
      spec = parseLineSpec(rest[2]) ?? undefined;
    }
    if (rest.length >= 4) {
      if (typeof rest[3] === "string") spec = parseLineSpec(rest[3]) ?? undefined;
      else cdata = vec(rest[3], "scatter");
    }
    target.addTraces([{ kind: "scatter2d", x, y, size: sz, cdata, style: { marker: "circle", ...spec, ...props } }]);
    return 0;
  }),
  scatter3: single((args, scope) => {
    const target = drawer(scope, "scatter3");
    const { rest, props } = consumeTrailingProps(args);
    if (rest.length < 3) fail("scatter3 takes (x, y, z)");
    const x = vec(rest[0], "scatter3");
    const y = vec(rest[1], "scatter3");
    const z = vec(rest[2], "scatter3");
    if (x.length !== y.length || z.length !== x.length) fail("scatter3: x, y, z differ in length");
    const sz = rest.length >= 4 && typeof rest[3] !== "string" ? (typeof rest[3] === "number" ? rest[3] : vec(rest[3], "scatter3")) : undefined;
    const cdata = rest.length >= 5 && typeof rest[4] !== "string" ? vec(rest[4], "scatter3") : undefined;
    target.addTraces([{ kind: "scatter3d", x, y, z, size: sz, cdata, style: { marker: "circle", ...props } }]);
    return 0;
  }),
  bar: single((args, scope) => {
    const target = drawer(scope, "bar");
    const { rest, props } = consumeTrailingProps(args);
    if (rest.length === 0) fail("bar needs data");
    const [x, y] =
      rest.length >= 2 && typeof rest[1] !== "string"
        ? [vec(rest[0], "bar"), columns(rest[1])]
        : [null, columns(rest[0])];
    const traces: TraceSpec[] = y.map((col) => ({
      kind: "bar",
      x: x ?? Float64Array.from(col, (_, i) => i + 1),
      y: col,
      style: props,
    }));
    target.addTraces(traces);
    return 0;
  }),
  barh: single((args, scope) => {
    const target = drawer(scope, "barh");
    const { rest, props } = consumeTrailingProps(args);
    if (rest.length === 0) fail("barh needs data");
    const [x, y] =
      rest.length >= 2 && typeof rest[1] !== "string"
        ? [vec(rest[0], "barh"), columns(rest[1])]
        : [null, columns(rest[0])];
    target.addTraces(
      y.map((col) => ({
        kind: "barh",
        x: x ?? Float64Array.from(col, (_, i) => i + 1),
        y: col,
        style: props,
      })),
    );
    return 0;
  }),
  histogram: single((args, scope) => {
    const target = drawer(scope, "histogram");
    const { rest, props } = consumeTrailingProps(args);
    if (rest.length < 1) fail("histogram needs data");
    const x = flat(rest[0]);
    const nbins = rest.length >= 2 && typeof rest[1] === "number" ? Math.max(1, Math.trunc(rest[1])) : undefined;
    target.addTraces([{ kind: "histogram", x, nbins, style: props }]);
    return 0;
  }),
  hist: (args, scope, nargout) => BUILTINS.histogram(args, scope, nargout),
  stairs: single((args, scope) => {
    const target = drawer(scope, "stairs");
    const { series, styles } = drawPlotArgs("stairs", args, 2);
    target.addTraces(series.map((s, i) => ({ kind: "stairs", x: s.x, y: s.y, style: styles[i] })));
    return 0;
  }),
  stem: single((args, scope) => {
    const target = drawer(scope, "stem");
    const { series, styles } = drawPlotArgs("stem", args, 2);
    target.addTraces(series.map((s, i) => ({ kind: "stem", x: s.x, y: s.y, style: styles[i] })));
    return 0;
  }),
  area: single((args, scope) => {
    const target = drawer(scope, "area");
    const { series, styles } = drawPlotArgs("area", args, 2);
    target.addTraces(series.map((s, i) => ({ kind: "area", x: s.x, y: s.y, style: styles[i] })));
    return 0;
  }),
  errorbar: single((args, scope) => {
    const target = drawer(scope, "errorbar");
    const { rest, props } = consumeTrailingProps(args);
    if (rest.length < 2) fail("errorbar needs (y, err) or (x, y, err)");
    const [x, y, err] =
      rest.length === 2
        ? [Float64Array.from(vec(rest[0], "errorbar"), (_, i) => i + 1), vec(rest[0], "errorbar"), vec(rest[1], "errorbar")]
        : [vec(rest[0], "errorbar"), vec(rest[1], "errorbar"), vec(rest[2], "errorbar")];
    if (x.length !== y.length || y.length !== err.length) fail("errorbar: x, y, err differ in length");
    target.addTraces([{ kind: "errorbar", x, y, err, style: props }]);
    return 0;
  }),
  quiver: single((args, scope) => {
    const target = drawer(scope, "quiver");
    const { rest, props } = consumeTrailingProps(args);
    if (rest.length < 4) fail("quiver takes (x, y, u, v)");
    const [x, y, u, v] = [flat(rest[0]), flat(rest[1]), flat(rest[2]), flat(rest[3])];
    if (x.length !== y.length || x.length !== u.length || x.length !== v.length) {
      fail("quiver: x, y, u, v must have the same number of elements");
    }
    target.addTraces([{ kind: "quiver", x, y, u, v, style: props }]);
    return 0;
  }),
  polarplot: single((args, scope) => {
    const target = drawer(scope, "polarplot");
    const { series, styles } = drawPlotArgs("polarplot", args, 2);
    target.addTraces(series.map((s, i) => ({ kind: "polar", x: s.x, y: s.y, style: styles[i] })));
    return 0;
  }),
  pie: single((args, scope) => {
    const target = drawer(scope, "pie");
    arity("pie", args, 1, 2);
    const x = vec(args[0], "pie");
    const labels =
      args.length === 2 && typeof args[1] === "string"
        ? args[1].split(",").map((s) => s.trim())
        : undefined;
    target.addTraces([{ kind: "pie", x, labels }]);
    return 0;
  }),
  contour: single((args, scope) => {
    const target = drawer(scope, "contour");
    const { x, y, z } = surfaceArgs("contour", args);
    const nlevels = args.length === 2 || args.length === 4 ? Math.trunc(scalar(args[args.length - 1], "contour")) : undefined;
    target.addTraces([{ kind: "contour", x, y, matrix: z, nlevels }]);
    return 0;
  }),
  contourf: single((args, scope) => {
    const target = drawer(scope, "contourf");
    const { x, y, z } = surfaceArgs("contourf", args);
    const nlevels = args.length === 2 || args.length === 4 ? Math.trunc(scalar(args[args.length - 1], "contourf")) : undefined;
    target.addTraces([{ kind: "contourf", x, y, matrix: z, nlevels }]);
    return 0;
  }),
  imagesc: single((args, scope) => {
    const target = drawer(scope, "imagesc");
    const { x, y, z } = surfaceArgs("imagesc", args);
    target.addTraces([{ kind: "heatmap", x, y, matrix: z }]);
    return 0;
  }),
  heatmap: single((args, scope) => {
    const target = drawer(scope, "heatmap");
    const { x, y, z } = surfaceArgs("heatmap", args);
    target.addTraces([{ kind: "heatmap", x, y, matrix: z }]);
    return 0;
  }),
  pcolor: single((args, scope) => {
    const target = drawer(scope, "pcolor");
    const { x, y, z } = surfaceArgs("pcolor", args);
    target.addTraces([{ kind: "heatmap", x, y, matrix: z }]);
    return 0;
  }),
  surf: single((args, scope) => {
    const target = drawer(scope, "surf");
    const { x, y, z } = surfaceArgs("surf", args);
    target.addTraces([{ kind: "surf", x, y, matrix: z }]);
    return 0;
  }),
  surfc: single((args, scope) => {
    const target = drawer(scope, "surfc");
    const { x, y, z } = surfaceArgs("surfc", args);
    target.addTraces([{ kind: "surfc", x, y, matrix: z }]);
    return 0;
  }),
  mesh: single((args, scope) => {
    const target = drawer(scope, "mesh");
    const { x, y, z } = surfaceArgs("mesh", args);
    target.addTraces([{ kind: "mesh", x, y, matrix: z }]);
    return 0;
  }),
  title: single((args, scope) => {
    arity("title", args, 1);
    const text = stringArg(args[0], "title");
    drawer(scope, "title").mutateAxes((ax) => {
      ax.title = text;
    });
    return 0;
  }),
  xlabel: single((args, scope) => {
    arity("xlabel", args, 1);
    const text = stringArg(args[0], "xlabel");
    drawer(scope, "xlabel").mutateAxes((ax) => {
      ax.xlabel = text;
    });
    return 0;
  }),
  ylabel: single((args, scope) => {
    arity("ylabel", args, 1);
    const text = stringArg(args[0], "ylabel");
    drawer(scope, "ylabel").mutateAxes((ax) => {
      ax.ylabel = text;
    });
    return 0;
  }),
  zlabel: single((args, scope) => {
    arity("zlabel", args, 1);
    const text = stringArg(args[0], "zlabel");
    drawer(scope, "zlabel").mutateAxes((ax) => {
      ax.zlabel = text;
    });
    return 0;
  }),
  legend: single((args, scope) => {
    if (args.length === 0) {
      drawer(scope, "legend").mutateAxes((ax) => {
        ax.legend = true;
      });
      return 0;
    }
    if (args.length === 1 && typeof args[0] === "string") {
      const w = args[0].toLowerCase();
      if (w === "off" || w === "hide") {
        drawer(scope, "legend").mutateAxes((ax) => {
          ax.legend = false;
        });
        return 0;
      }
      if (w === "on" || w === "show") {
        drawer(scope, "legend").mutateAxes((ax) => {
          ax.legend = true;
        });
        return 0;
      }
    }
    const labels = args.map((a) => stringArg(a, "legend"));
    drawer(scope, "legend").mutateAxes((ax) => {
      ax.legend = labels;
    });
    return 0;
  }),
  grid: single((args, scope) => {
    arity("grid", args, 0, 1);
    drawer(scope, "grid").mutateAxes((ax) => {
      if (args.length === 0) ax.grid = !(ax.grid ?? false);
      else {
        const w = stringArg(args[0], "grid").toLowerCase();
        ax.grid = w !== "off";
      }
    });
    return 0;
  }),
  box: single((args, scope) => {
    arity("box", args, 0, 1);
    drawer(scope, "box").mutateAxes((ax) => {
      if (args.length === 0) ax.box = !(ax.box ?? true);
      else ax.box = stringArg(args[0], "box").toLowerCase() !== "off";
    });
    return 0;
  }),
  xlim: single((args, scope) => {
    arity("xlim", args, 1);
    if (typeof args[0] === "string" && args[0].toLowerCase() === "auto") {
      drawer(scope, "xlim").mutateAxes((ax) => {
        ax.xlim = null;
      });
      return 0;
    }
    const v = vec(args[0], "xlim");
    if (v.length !== 2) fail("xlim needs [min max]");
    drawer(scope, "xlim").mutateAxes((ax) => {
      ax.xlim = [v[0], v[1]];
    });
    return 0;
  }),
  ylim: single((args, scope) => {
    arity("ylim", args, 1);
    if (typeof args[0] === "string" && args[0].toLowerCase() === "auto") {
      drawer(scope, "ylim").mutateAxes((ax) => {
        ax.ylim = null;
      });
      return 0;
    }
    const v = vec(args[0], "ylim");
    if (v.length !== 2) fail("ylim needs [min max]");
    drawer(scope, "ylim").mutateAxes((ax) => {
      ax.ylim = [v[0], v[1]];
    });
    return 0;
  }),
  zlim: single((args, scope) => {
    arity("zlim", args, 1);
    if (typeof args[0] === "string" && args[0].toLowerCase() === "auto") {
      drawer(scope, "zlim").mutateAxes((ax) => {
        ax.zlim = null;
      });
      return 0;
    }
    const v = vec(args[0], "zlim");
    if (v.length !== 2) fail("zlim needs [min max]");
    drawer(scope, "zlim").mutateAxes((ax) => {
      ax.zlim = [v[0], v[1]];
    });
    return 0;
  }),
  axis: single((args, scope) => {
    arity("axis", args, 1);
    if (typeof args[0] === "string") {
      const mode = args[0].toLowerCase();
      drawer(scope, "axis").mutateAxes((ax) => {
        if (mode === "equal") ax.aspectEqual = true;
        else if (mode === "normal") ax.aspectEqual = false;
        else if (mode === "tight") ax.axisTight = true;
        else if (mode === "off") ax.axisVisible = false;
        else if (mode === "on") ax.axisVisible = true;
        else if (mode === "auto") {
          ax.xlim = null;
          ax.ylim = null;
          ax.zlim = null;
        }
      });
      return 0;
    }
    const v = vec(args[0], "axis");
    if (v.length !== 4 && v.length !== 6) fail("axis needs [xmin xmax ymin ymax] or 6 values");
    drawer(scope, "axis").mutateAxes((ax) => {
      ax.xlim = [v[0], v[1]];
      ax.ylim = [v[2], v[3]];
      if (v.length === 6) ax.zlim = [v[4], v[5]];
    });
    return 0;
  }),
  colormap: single((args, scope) => {
    arity("colormap", args, 1);
    const cmap = stringArg(args[0], "colormap").toLowerCase();
    drawer(scope, "colormap").mutateAxes((ax) => {
      ax.colormap = cmap;
    });
    return 0;
  }),
  colorbar: single((args, scope) => {
    arity("colorbar", args, 0, 1);
    drawer(scope, "colorbar").mutateAxes((ax) => {
      if (args.length === 1 && typeof args[0] === "string" && args[0].toLowerCase() === "off") {
        ax.colorbar = false;
      } else {
        ax.colorbar = true;
      }
    });
    return 0;
  }),
  view: single((args, scope) => {
    arity("view", args, 1, 2);
    drawer(scope, "view").mutateAxes((ax) => {
      if (args.length === 1) {
        if (isMatrix(args[0]) && args[0].data.length === 2) {
          ax.view = [args[0].data[0], args[0].data[1]];
        } else {
          const d = scalar(args[0], "view");
          ax.view = d === 2 ? [0, 90] : [-37.5, 30];
        }
      } else {
        ax.view = [scalar(args[0], "view"), scalar(args[1], "view")];
      }
    });
    return 0;
  }),
};

const CONSTANTS: Record<string, Value> = {
  pi: Math.PI,
  e: Math.E,
  i: complexScalar(0, 1),
  j: complexScalar(0, 1),
  Inf: Infinity,
  inf: Infinity,
  NaN: NaN,
  nan: NaN,
  true: 1,
  false: 0,
  eps: Number.EPSILON,
};

export const CELL_REF = /^[A-Z]{1,2}[0-9]+$/;

type Tok =
  | { k: "num"; v: number; imag?: boolean; s: number }
  | { k: "str"; v: string; s: number }
  | { k: "id"; v: string; s: number }
  | { k: "op"; v: string; s: number }
  | { k: "sep"; s: number }
  | { k: "end"; s: number };

const OPS2 = new Set([".*", "./", ".\\", ".^", ".'", "==", "~=", "!=", "<=", ">=", "&&", "||"]);
const OPS1 = new Set("+-*/\\^'()[],;:=<>&|~!@");

const isDigit = (c: number): boolean => c >= 48 && c <= 57;
const isIdStart = (c: number): boolean =>
  (c >= 65 && c <= 90) || (c >= 97 && c <= 122) || c === 95;
const isIdChar = (c: number): boolean => isIdStart(c) || isDigit(c);
const isSpace = (c: number): boolean => c === 32 || c === 9 || c === 13;

function operandEnd(t: Tok | undefined): boolean {
  if (!t) return false;
  if (t.k === "num" || t.k === "id" || t.k === "str") return true;
  return t.k === "op" && (t.v === ")" || t.v === "]" || t.v === "'" || t.v === ".'");
}

function lex(src: string): Tok[] {
  const toks: Tok[] = [];
  const brackets: string[] = [];
  let i = 0;
  const n = src.length;
  while (i < n) {
    const c = src.charCodeAt(i);
    if (isSpace(c)) {
      const start = i;
      while (i < n && isSpace(src.charCodeAt(i))) i++;
      if (
        brackets.length > 0 &&
        brackets[brackets.length - 1] === "[" &&
        operandEnd(toks[toks.length - 1]) &&
        i < n
      ) {
        const d = src.charCodeAt(i);
        const d2 = src.charCodeAt(i + 1);
        const starts =
          isDigit(d) ||
          isIdStart(d) ||
          d === 40 ||
          d === 91 ||
          d === 126 ||
          d === 33 ||
          d === 39 ||
          d === 34 ||
          d === 64 ||
          (d === 46 && isDigit(d2)) ||
          ((d === 43 || d === 45) && !isSpace(d2) && d2 !== 61 && i + 1 < n);
        if (starts) toks.push({ k: "sep", s: start });
      }
      continue;
    }
    if (c === 37 || c === 35) break;
    if (isDigit(c) || (c === 46 && isDigit(src.charCodeAt(i + 1)))) {
      const start = i;
      while (i < n && isDigit(src.charCodeAt(i))) i++;
      if (
        src.charCodeAt(i) === 46 &&
        !(
          src.charCodeAt(i + 1) === 42 ||
          src.charCodeAt(i + 1) === 47 ||
          src.charCodeAt(i + 1) === 92 ||
          src.charCodeAt(i + 1) === 94 ||
          src.charCodeAt(i + 1) === 39
        )
      ) {
        i++;
        while (i < n && isDigit(src.charCodeAt(i))) i++;
      }
      if ((src.charCodeAt(i) === 101 || src.charCodeAt(i) === 69) && i + 1 < n) {
        let j = i + 1;
        if (src.charCodeAt(j) === 43 || src.charCodeAt(j) === 45) j++;
        if (isDigit(src.charCodeAt(j))) {
          while (j < n && isDigit(src.charCodeAt(j))) j++;
          i = j;
        }
      }
      const numVal = Number(src.slice(start, i));
      if ((src.charCodeAt(i) === 105 || src.charCodeAt(i) === 106) && !isIdChar(src.charCodeAt(i + 1))) {
        i++;
        toks.push({ k: "num", v: numVal, imag: true, s: start });
      } else {
        toks.push({ k: "num", v: numVal, s: start });
      }
      continue;
    }
    if (isIdStart(c)) {
      const start = i;
      while (i < n && isIdChar(src.charCodeAt(i))) i++;
      toks.push({ k: "id", v: src.slice(start, i), s: start });
      continue;
    }
    if (c === 34) {
      const start = i++;
      let out = "";
      while (i < n) {
        if (src.charCodeAt(i) === 34) {
          if (src.charCodeAt(i + 1) === 34) {
            out += '"';
            i += 2;
            continue;
          }
          i++;
          break;
        }
        out += src[i++];
      }
      toks.push({ k: "str", v: out, s: start });
      continue;
    }
    const two = src.slice(i, i + 2);
    if (OPS2.has(two)) {
      toks.push({ k: "op", v: two, s: i });
      i += 2;
      continue;
    }
    const one = src[i];
    if (one === "'") {
      if (operandEnd(toks[toks.length - 1]) && !(i > 0 && isSpace(src.charCodeAt(i - 1)))) {
        toks.push({ k: "op", v: "'", s: i });
        i++;
        continue;
      }
      const start = i++;
      let out = "";
      let closed = false;
      while (i < n) {
        if (src.charCodeAt(i) === 39) {
          if (src.charCodeAt(i + 1) === 39) {
            out += "'";
            i += 2;
            continue;
          }
          i++;
          closed = true;
          break;
        }
        out += src[i++];
      }
      if (!closed) fail("unterminated string");
      toks.push({ k: "str", v: out, s: start });
      continue;
    }
    if (OPS1.has(one)) {
      if (one === "[" || one === "(") brackets.push(one);
      else if (one === "]" || one === ")") brackets.pop();
      toks.push({ k: "op", v: one, s: i });
      i++;
      continue;
    }
    fail(`unexpected "${one}"`);
  }
  toks.push({ k: "end", s: n });
  return toks;
}

interface Node {
  readonly fn: Fn;
  readonly multi?: MultiFn;
  readonly ref?: string;
  readonly draw?: boolean;
}

const BINARY: Record<string, { prec: number; apply: (a: Value, b: Value) => Value }> = {
  "||": { prec: 1, apply: () => 0 },
  "&&": { prec: 2, apply: () => 0 },
  "|": { prec: 3, apply: (a, b) => ew(a, b, (x, y) => (x !== 0 || y !== 0 ? 1 : 0)) },
  "&": { prec: 4, apply: (a, b) => ew(a, b, (x, y) => (x !== 0 && y !== 0 ? 1 : 0)) },
  "<": { prec: 5, apply: (a, b) => ew(a, b, (x, y) => (x < y ? 1 : 0)) },
  "<=": { prec: 5, apply: (a, b) => ew(a, b, (x, y) => (x <= y ? 1 : 0)) },
  ">": { prec: 5, apply: (a, b) => ew(a, b, (x, y) => (x > y ? 1 : 0)) },
  ">=": { prec: 5, apply: (a, b) => ew(a, b, (x, y) => (x >= y ? 1 : 0)) },
  "==": {
    prec: 5,
    apply: (a, b) => {
      if (typeof a === "string" || typeof b === "string") return a === b ? 1 : 0;
      return ew(
        a,
        b,
        (x, y) => (x === y ? 1 : 0),
        (x, y) => (x.re === y.re && x.im === y.im ? 1 : 0),
      );
    },
  },
  "~=": {
    prec: 5,
    apply: (a, b) => {
      if (typeof a === "string" || typeof b === "string") return a !== b ? 1 : 0;
      return ew(
        a,
        b,
        (x, y) => (x !== y ? 1 : 0),
        (x, y) => (x.re !== y.re || x.im !== y.im ? 1 : 0),
      );
    },
  },
  "!=": { prec: 5, apply: (a, b) => ew(a, b, (x, y) => (x !== y ? 1 : 0)) },
  ":": { prec: 6, apply: () => 0 },
  "+": { prec: 7, apply: (a, b) => ew(a, b, (x, y) => x + y, (x, y) => x.add(y)) },
  "-": { prec: 7, apply: (a, b) => ew(a, b, (x, y) => x - y, (x, y) => x.sub(y)) },
  "*": { prec: 8, apply: mul },
  "/": { prec: 8, apply: mrdivide },
  "\\": { prec: 8, apply: mldivide },
  ".*": { prec: 8, apply: (a, b) => ew(a, b, (x, y) => x * y, (x, y) => x.mul(y)) },
  "./": { prec: 8, apply: (a, b) => ew(a, b, (x, y) => x / y, (x, y) => x.div(y)) },
  ".\\": { prec: 8, apply: (a, b) => ew(a, b, (x, y) => y / x, (x, y) => y.div(x)) },
  "^": { prec: 10, apply: pow },
  ".^": { prec: 10, apply: dotPow },
};

const UNARY_PREC = 9;

class Parser {
  #toks: Tok[];
  #src: string;
  #i = 0;

  constructor(src: string) {
    this.#src = src;
    this.#toks = lex(src);
  }

  get done(): boolean {
    return this.#peek().k === "end";
  }

  #peek(): Tok {
    return this.#toks[this.#i];
  }

  #peekAt(offset: number): Tok {
    return this.#toks[Math.min(this.#i + offset, this.#toks.length - 1)];
  }

  #next(): Tok {
    return this.#toks[this.#i++];
  }

  #isOp(v: string, offset = 0): boolean {
    const t = this.#peekAt(offset);
    return t.k === "op" && t.v === v;
  }

  #expect(v: string): void {
    const t = this.#next();
    if (t.k !== "op" || t.v !== v) fail(`expected "${v}"`);
  }

  #skipSeps(): void {
    while (this.#peek().k === "sep") this.#i++;
  }

  #multiAssignTargets(): string[] | null {
    if (!this.#isOp("[")) return null;
    let j = this.#i + 1;
    const names: string[] = [];
    while (j < this.#toks.length) {
      const tok = this.#toks[j];
      if (tok.k === "sep") {
        j++;
        continue;
      }
      if (tok.k === "op" && tok.v === ",") {
        j++;
        continue;
      }
      if (tok.k === "op" && tok.v === "]") {
        const eq = this.#toks[j + 1];
        if (eq && eq.k === "op" && eq.v === "=" && names.length > 0) {
          this.#i = j + 2;
          return names;
        }
        return null;
      }
      if (tok.k === "id" || (tok.k === "op" && tok.v === "~")) {
        names.push(tok.v);
        j++;
        continue;
      }
      return null;
    }
    return null;
  }

  #indexedAssignTarget(): { name: string; args: Arg[] } | null {
    const t = this.#peek();
    if (t.k !== "id" || !this.#isOp("(", 1)) return null;
    const saved = this.#i;
    try {
      this.#i += 2;
      const args = this.#args();
      if (this.#isOp("=") && !this.#isOp("==")) {
        this.#i++;
        return { name: t.v, args };
      }
    } catch {
    }
    this.#i = saved;
    return null;
  }

  statement(): Statement {
    const t = this.#peek();
    if (t.k === "id" && t.v === "format") {
      const a = this.#peekAt(1);
      if (a.k === "end" || (a.k === "op" && (a.v === ";" || a.v === ","))) {
        this.#i++;
        if (a.k === "op") this.#i++;
        return { name: null, suppressed: true, format: "short", draw: false, run: () => 0 };
      }
      if (a.k === "id" && (a.v === "short" || a.v === "long") && this.#commandEnd(2)) {
        const end = this.#peekAt(2);
        this.#i += 2;
        if (end.k === "op") this.#i++;
        return { name: null, suppressed: true, format: a.v, draw: false, run: () => 0 };
      }
    }

    if (t.k === "id" && COMMAND_WORDS.has(t.v)) {
      const a = this.#peekAt(1);
      const bare = this.#commandEnd(1);
      const word = (a.k === "id" || a.k === "str") && this.#commandEnd(2);
      if (bare || word) {
        const cmd = t.v;
        const argVal = word ? a.v : undefined;
        const end = this.#peekAt(word ? 2 : 1);
        this.#i += word ? 2 : 1;
        if (end.k === "op") this.#i++;
        const fn = BUILTINS[cmd];
        return {
          name: null,
          suppressed: true,
          format: null,
          draw: true,
          run: (s) => fn(argVal !== undefined ? [argVal] : [], s, 1)[0],
        };
      }
    }

    const multiNames = this.#multiAssignTargets();
    if (multiNames) {
      const rhs = this.expr(0);
      const suppressed = this.#finishStatement();
      return {
        name: multiNames[0],
        names: multiNames,
        suppressed,
        format: null,
        draw: false,
        run: (s) => {
          const outs = rhs.multi ? rhs.multi(s, multiNames.length) : [rhs.fn(s)];
          let first: Value | undefined;
          multiNames.forEach((nm, idx) => {
            const v = outs[idx] ?? 0;
            if (nm !== "~") {
              s.set(nm, v);
              if (first === undefined) first = v;
            }
          });
          return first ?? 0;
        },
      };
    }

    const indexed = this.#indexedAssignTarget();
    if (indexed) {
      const rhs = this.expr(0).fn;
      const suppressed = this.#finishStatement();
      return {
        name: indexed.name,
        suppressed,
        format: null,
        draw: false,
        run: (s) => {
          const updated = assignIndexed(s.get(indexed.name), indexed.args, rhs(s), s);
          s.set(indexed.name, updated);
          return updated;
        },
      };
    }

    let name: string | null = null;
    if (t.k === "id" && this.#isOp("=", 1)) {
      name = t.v;
      this.#i += 2;
    }
    const node =
      name === null && t.k === "id" && t.v === "figure" && this.#commandEnd(1)
        ? this.#bareFigure()
        : this.expr(0);
    const expr = node.fn;
    const suppressed = this.#finishStatement();
    const assigned = name;
    const isDraw = name === null && node.draw === true;
    const run: Fn = assigned
      ? (s) => {
          const v = expr(s);
          s.set(assigned, v);
          return v;
        }
      : (s) => {
          const v = expr(s);
          if (!isDraw) s.set("ans", v);
          return v;
        };
    return { name, suppressed, format: null, draw: isDraw, run };
  }

  #finishStatement(): boolean {
    let suppressed = false;
    if (this.#isOp(";")) {
      suppressed = true;
      this.#i++;
    } else if (this.#isOp(",")) {
      this.#i++;
    } else if (!this.done) {
      const bad = this.#next();
      fail(`unexpected "${"v" in bad ? bad.v : " "}"`);
    }
    return suppressed;
  }

  #commandEnd(offset: number): boolean {
    const t = this.#peekAt(offset);
    return t.k === "end" || (t.k === "op" && (t.v === ";" || t.v === ","));
  }

  #bareFigure(): Node {
    this.#i++;
    return { fn: (s) => BUILTINS.figure([], s, 1)[0], draw: true };
  }

  expr(minPrec: number): Node {
    let left = this.#prefix();
    for (;;) {
      const t = this.#peek();
      if (t.k !== "op") break;
      const op = BINARY[t.v];
      if (!op || op.prec < minPrec) break;
      this.#i++;
      if (t.v === ":") {
        const right = this.expr(op.prec + 1);
        if (this.#isOp(":")) {
          this.#i++;
          const last = this.expr(op.prec + 1);
          const [a, b, c] = [left.fn, right.fn, last.fn];
          left = { fn: (s) => range(scalar(a(s), "range"), scalar(b(s), "range"), scalar(c(s), "range")) };
        } else if (left.ref && right.ref) {
          const [from, to] = [left.ref, right.ref];
          left = {
            fn: (s) => (s.cells ? s.cells(from, to) : fail(`${from}:${to} only works in a table`)),
          };
        } else {
          const [a, b] = [left.fn, right.fn];
          left = { fn: (s) => range(scalar(a(s), "range"), 1, scalar(b(s), "range")) };
        }
        continue;
      }
      const right = this.expr(op.prec + 1);
      const [a, b] = [left.fn, right.fn];
      if (t.v === "&&") {
        left = { fn: (s) => (truthy(a(s)) && truthy(b(s)) ? 1 : 0) };
      } else if (t.v === "||") {
        left = { fn: (s) => (truthy(a(s)) || truthy(b(s)) ? 1 : 0) };
      } else {
        const apply = op.apply;
        left = { fn: (s) => apply(a(s), b(s)) };
      }
    }
    return left;
  }

  #prefix(): Node {
    const t = this.#next();
    if (t.k === "num") {
      const v: Value = t.imag ? complexScalar(0, t.v) : t.v;
      return this.#postfix({ fn: () => v });
    }
    if (t.k === "str") {
      const v = t.v;
      return this.#postfix({ fn: () => v });
    }
    if (t.k === "id") return this.#postfix(this.#identifier(t.v));
    if (t.k === "op") {
      if (t.v === "(") {
        const inner = this.expr(0);
        this.#expect(")");
        return this.#postfix({ fn: inner.fn });
      }
      if (t.v === "[") return this.#postfix(this.#matrix());
      if (t.v === "@") return this.#fnHandle();
      if (t.v === "-") {
        const operand = this.expr(UNARY_PREC).fn;
        return { fn: (s) => mapValue(operand(s), (x) => -x, (x) => x.neg()) };
      }
      if (t.v === "+") {
        return { fn: this.expr(UNARY_PREC).fn };
      }
      if (t.v === "~" || t.v === "!") {
        const operand = this.expr(UNARY_PREC).fn;
        return {
          fn: (s) => {
            const val = operand(s);
            return mapValue(val, (x) => (x === 0 ? 1 : 0), (x) => (x.re === 0 && x.im === 0 ? 1 : 0));
          },
        };
      }
      fail(`unexpected "${t.v}"`);
    }
    fail(t.k === "end" ? "unexpected end" : "unexpected space");
  }

  #fnHandle(): Node {
    const startPos = this.#toks[this.#i - 1].s;
    if (this.#isOp("(")) {
      this.#i++;
      const params: string[] = [];
      if (!this.#isOp(")")) {
        for (;;) {
          const p = this.#next();
          if (p.k !== "id") fail("expected parameter name in @( ... )");
          params.push(p.v);
          if (this.#isOp(",")) {
            this.#i++;
            continue;
          }
          break;
        }
      }
      this.#expect(")");
      const body = this.expr(0);
      const endPos = this.#peek().s;
      const source = this.#src.slice(startPos, endPos).trim();
      return {
        fn: (capturedScope) => {
          const captured = new Map<string, Value>();
          const handle: FnHandle = {
            kind: "fn",
            params,
            source,
            call: (callArgs, callerScope, nargout) => {
              if (callArgs.length !== params.length) {
                fail(`function handle expects ${params.length} argument${params.length === 1 ? "" : "s"}`);
              }
              const locals = new Map<string, Value>(captured);
              params.forEach((nm, idx) => locals.set(nm, callArgs[idx]));
              const inner: Scope = {
                draw: callerScope.draw ?? capturedScope.draw,
                get: (nm) => (locals.has(nm) ? locals.get(nm) : (capturedScope.get(nm) ?? callerScope.get(nm))),
                set: (nm, val) => locals.set(nm, val),
              };
              enterCall();
              try {
                return body.multi ? body.multi(inner, nargout) : [body.fn(inner)];
              } finally {
                callDepth--;
              }
            },
          };
          return handle;
        },
      };
    }
    const target = this.#next();
    if (target.k !== "id") fail("expected function name after @");
    const name = target.v;
    const builtin = BUILTINS[name];
    return {
      fn: () => ({
        kind: "fn",
        params: ["x"],
        source: `@${name}`,
        call: (callArgs, callerScope, nargout) => {
          const v = callerScope.get(name);
          if (v && isFnHandle(v)) return v.call(callArgs, callerScope, nargout);
          if (!builtin) fail(`undefined: ${name}`);
          return wrapMathError(name, () => builtin(callArgs, callerScope, nargout));
        },
      }),
    };
  }

  #postfix(node: Node): Node {
    for (;;) {
      if (this.#isOp("'")) {
        this.#i++;
        const inner = node.fn;
        node = { fn: (s) => transpose(inner(s), true) };
        continue;
      }
      if (this.#isOp(".'")) {
        this.#i++;
        const inner = node.fn;
        node = { fn: (s) => transpose(inner(s), false) };
        continue;
      }
      return node;
    }
  }

  #args(): Arg[] {
    const args: Arg[] = [];
    if (this.#isOp(")")) {
      this.#i++;
      return args;
    }
    for (;;) {
      if (this.#isOp(":") && (this.#isOp(",", 1) || this.#isOp(")", 1))) {
        this.#i++;
        args.push(":");
      } else {
        args.push(this.expr(0).fn);
      }
      if (this.#isOp(",")) {
        this.#i++;
        continue;
      }
      this.#expect(")");
      return args;
    }
  }

  #identifier(name: string): Node {
    if (name === "end") {
      return {
        fn: () => (ENDS.length ? ENDS[ENDS.length - 1] : fail('"end" only works inside an index')),
      };
    }
    if (this.#isOp("(")) {
      this.#i++;
      const args = this.#args();
      const builtin = BUILTINS[name];
      const allColon = args.length === 1 && args[0] === ":";
      const invokeMulti: MultiFn = (s, nargout) => {
        if (allColon && s.column) {
          const col = s.column(name);
          if (col !== undefined) return [col];
        }
        const v = s.get(name);
        if (v !== undefined) {
          if (isFnHandle(v)) {
            const values = args.map((a) => (a === ":" ? fail(`${name} doesn't take ":"`) : a(s)));
            return v.call(values, s, nargout);
          }
          return [indexValue(v, args, s)];
        }
        if (!builtin) fail(`undefined: ${name}`);
        const values = new Array<Value>(args.length);
        for (let i = 0; i < args.length; i++) {
          const a = args[i];
          if (a === ":") fail(`${name} doesn't take ":"`);
          values[i] = a(s);
        }
        return wrapMathError(name, () => builtin(values, s, nargout));
      };
      return {
        draw: DRAWING.has(name) && builtin !== undefined,
        multi: invokeMulti,
        fn: (s) => invokeMulti(s, 1)[0],
      };
    }
    const constant = CONSTANTS[name];
    return {
      ref: CELL_REF.test(name) ? name : undefined,
      fn: (s) => {
        const v = s.get(name);
        if (v !== undefined) return v;
        if (constant !== undefined) return constant;
        fail(`undefined: ${name}`);
      },
    };
  }

  #matrix(): Node {
    const rows: Fn[][] = [];
    let row: Fn[] = [];
    this.#skipSeps();
    while (!this.#isOp("]")) {
      if (this.#peek().k === "end") fail('missing "]"');
      row.push(this.expr(0).fn);
      const spaced = this.#peek().k === "sep";
      this.#skipSeps();
      if (this.#isOp(",")) {
        this.#i++;
        this.#skipSeps();
      } else if (this.#isOp(";")) {
        this.#i++;
        this.#skipSeps();
        rows.push(row);
        row = [];
      } else if (!this.#isOp("]") && !spaced) {
        fail('expected "," or "]"');
      }
    }
    this.#i++;
    if (row.length > 0 || rows.length === 0) rows.push(row);
    const plan = rows;
    return {
      fn: (s) => {
        const built = new Array<Value>(plan.length);
        for (let r = 0; r < plan.length; r++) {
          const parts = new Array<Value>(plan[r].length);
          for (let c = 0; c < parts.length; c++) parts[c] = plan[r][c](s);
          built[r] = hcat(parts);
        }
        return vcat(built);
      },
    };
  }
}

const CACHE_LIMIT = 4096;
const lineCache = new Map<string, Statement[] | CalcError>();

export function compileLine(src: string): Statement[] {
  let hit = lineCache.get(src);
  if (hit === undefined) {
    try {
      const parser = new Parser(src);
      const out: Statement[] = [];
      while (!parser.done) out.push(parser.statement());
      hit = out;
    } catch (e) {
      if (!(e instanceof CalcError)) throw e;
      hit = e;
    }
    if (lineCache.size >= CACHE_LIMIT) lineCache.clear();
    lineCache.set(src, hit);
  }
  if (hit instanceof CalcError) throw hit;
  return hit;
}

export function evaluate(src: string, scope: Scope): Value {
  const statements = compileLine(src);
  if (statements.length === 0) fail("nothing to compute");
  let last: Value = 0;
  for (const st of statements) last = st.run(scope);
  return last;
}

export interface BlockLineOutcome {
  readonly line: number;
  readonly value?: Value;
  readonly precision: Precision;
  readonly error?: string;
}

const BLOCK_TRIGGER_RE =
  /(?:^|[;,\s])\b(?:for|while|if|elseif|else|switch|case|otherwise|function|end|endfor|endwhile|endif|endswitch|endfunction|break|continue|return)\b|\.\.\./;

function stripComment(line: string): string {
  let i = 0;
  const n = line.length;
  let prevOperand = false;
  while (i < n) {
    const c = line.charCodeAt(i);
    if (isSpace(c)) {
      i++;
      continue;
    }
    if (c === 37 || c === 35) return line.slice(0, i);
    if (c === 34) {
      prevOperand = true;
      i++;
      while (i < n) {
        if (line.charCodeAt(i) === 34) {
          if (line.charCodeAt(i + 1) === 34) {
            i += 2;
            continue;
          }
          i++;
          break;
        }
        i++;
      }
      continue;
    }
    if (c === 39) {
      if (prevOperand && !(i > 0 && isSpace(line.charCodeAt(i - 1)))) {
        i++;
        continue;
      }
      prevOperand = true;
      i++;
      while (i < n) {
        if (line.charCodeAt(i) === 39) {
          if (line.charCodeAt(i + 1) === 39) {
            i += 2;
            continue;
          }
          i++;
          break;
        }
        i++;
      }
      continue;
    }
    prevOperand =
      isDigit(c) || isIdChar(c) || c === 41 || c === 93;
    i++;
  }
  return line;
}

interface RawClause {
  readonly text: string;
  readonly line: number;
}

function splitTopLevelClauses(lines: readonly string[]): RawClause[] {
  const joined: { text: string; line: number }[] = [];
  let acc = "";
  for (let idx = 0; idx < lines.length; idx++) {
    const noComment = stripComment(lines[idx]).trimEnd();
    if (noComment.endsWith("...")) {
      acc += noComment.slice(0, -3) + " ";
      continue;
    }
    const full = acc + noComment;
    acc = "";
    if (full.trim()) joined.push({ text: full, line: idx });
  }
  if (acc.trim()) joined.push({ text: acc, line: lines.length - 1 });

  const clauses: RawClause[] = [];
  const pushClause = (raw: string, ln: number): void => {
    const trimmed = raw.trim();
    if (!trimmed) return;
    const m = /^(else|otherwise)\s+(.+)$/.exec(trimmed);
    if (m) {
      clauses.push({ text: m[1], line: ln });
      pushClause(m[2], ln);
      return;
    }
    clauses.push({ text: trimmed, line: ln });
  };

  for (const { text, line } of joined) {
    let depth = 0;
    let start = 0;
    let prevOperand = false;
    let i = 0;
    const n = text.length;
    while (i < n) {
      const c = text.charCodeAt(i);
      if (isSpace(c)) {
        i++;
        continue;
      }
      if (c === 34) {
        prevOperand = true;
        i++;
        while (i < n) {
          if (text.charCodeAt(i) === 34) {
            if (text.charCodeAt(i + 1) === 34) {
              i += 2;
              continue;
            }
            i++;
            break;
          }
          i++;
        }
        continue;
      }
      if (c === 39) {
        if (prevOperand && !(i > 0 && isSpace(text.charCodeAt(i - 1)))) {
          i++;
          continue;
        }
        prevOperand = true;
        i++;
        while (i < n) {
          if (text.charCodeAt(i) === 39) {
            if (text.charCodeAt(i + 1) === 39) {
              i += 2;
              continue;
            }
            i++;
            break;
          }
          i++;
        }
        continue;
      }
      if (c === 40 || c === 91) {
        depth++;
        prevOperand = false;
        i++;
        continue;
      }
      if (c === 41 || c === 93) {
        depth = Math.max(0, depth - 1);
        prevOperand = true;
        i++;
        continue;
      }
      if (depth === 0 && (c === 59 || c === 44)) {
        const chunk = c === 59 ? text.slice(start, i + 1) : text.slice(start, i);
        pushClause(chunk, line);
        start = i + 1;
        prevOperand = false;
        i++;
        continue;
      }
      prevOperand = isDigit(c) || isIdChar(c);
      i++;
    }
    if (start < n) pushClause(text.slice(start), line);
  }
  return clauses;
}

type BlockNode =
  | { kind: "simple"; id: number; line: number; src: string }
  | { kind: "break"; line: number }
  | { kind: "continue"; line: number }
  | { kind: "return"; line: number }
  | { kind: "for"; line: number; varName: string; iterExpr: string; body: BlockNode[] }
  | { kind: "while"; line: number; condExpr: string; body: BlockNode[] }
  | { kind: "if"; line: number; branches: { condExpr: string | null; body: BlockNode[] }[] }
  | { kind: "switch"; line: number; expr: string; cases: { caseExpr: string | null; body: BlockNode[] }[] }
  | { kind: "function"; line: number; name: string; params: string[]; outputs: string[]; body: BlockNode[] };

const END_WORDS = new Set(["end", "endfor", "endwhile", "endif", "endswitch", "endfunction"]);

function stripTrailingSep(s: string): string {
  return s.replace(/[;,]\s*$/, "").trim();
}

function parseBlockAst(clauses: readonly RawClause[]): BlockNode[] {
  let pos = 0;
  let nextSimpleId = 1;

  function parseList(stopWords: ReadonlySet<string>): BlockNode[] {
    const nodes: BlockNode[] = [];
    while (pos < clauses.length) {
      const cur = clauses[pos];
      const clean = stripTrailingSep(cur.text);
      const kwMatch = /^([A-Za-z_]\w*)\b/.exec(clean);
      const kw = kwMatch ? kwMatch[1] : "";
      if (stopWords.has(kw) && (kw !== "end" || clean === "end") && (clean === kw || kw === "elseif" || kw === "case")) {
        break;
      }
      if (END_WORDS.has(clean)) {
        fail(`unexpected "${clean}"`);
      }
      pos++;
      if (clean === "break") {
        nodes.push({ kind: "break", line: cur.line });
        continue;
      }
      if (clean === "continue") {
        nodes.push({ kind: "continue", line: cur.line });
        continue;
      }
      if (clean === "return") {
        nodes.push({ kind: "return", line: cur.line });
        continue;
      }
      const forMatch = /^for\s+([A-Za-z_]\w*)\s*=\s*(.+)$/.exec(clean);
      if (forMatch) {
        const body = parseList(END_WORDS);
        if (pos >= clauses.length || !END_WORDS.has(stripTrailingSep(clauses[pos].text))) {
          fail('missing "end" for "for"');
        }
        pos++;
        nodes.push({ kind: "for", line: cur.line, varName: forMatch[1], iterExpr: forMatch[2], body });
        continue;
      }
      const whileMatch = /^while\s+(.+)$/.exec(clean);
      if (whileMatch) {
        const body = parseList(END_WORDS);
        if (pos >= clauses.length || !END_WORDS.has(stripTrailingSep(clauses[pos].text))) {
          fail('missing "end" for "while"');
        }
        pos++;
        nodes.push({ kind: "while", line: cur.line, condExpr: whileMatch[1], body });
        continue;
      }
      const ifMatch = /^if\s+(.+)$/.exec(clean);
      if (ifMatch) {
        const branches: { condExpr: string | null; body: BlockNode[] }[] = [];
        const stopIf = new Set([...END_WORDS, "elseif", "else"]);
        branches.push({ condExpr: ifMatch[1], body: parseList(stopIf) });
        while (pos < clauses.length) {
          const nextClean = stripTrailingSep(clauses[pos].text);
          const elif = /^elseif\s+(.+)$/.exec(nextClean);
          if (elif) {
            pos++;
            branches.push({ condExpr: elif[1], body: parseList(stopIf) });
            continue;
          }
          if (nextClean === "else") {
            pos++;
            branches.push({ condExpr: null, body: parseList(END_WORDS) });
            break;
          }
          break;
        }
        if (pos >= clauses.length || !END_WORDS.has(stripTrailingSep(clauses[pos].text))) {
          fail('missing "end" for "if"');
        }
        pos++;
        nodes.push({ kind: "if", line: cur.line, branches });
        continue;
      }
      const switchMatch = /^switch\s+(.+)$/.exec(clean);
      if (switchMatch) {
        const stopSwitch = new Set([...END_WORDS, "case", "otherwise"]);
        while (pos < clauses.length) {
          const nc = stripTrailingSep(clauses[pos].text);
          if (nc.startsWith("case ") || nc === "otherwise" || END_WORDS.has(nc)) break;
          pos++;
        }
        const cases: { caseExpr: string | null; body: BlockNode[] }[] = [];
        while (pos < clauses.length) {
          const nc = stripTrailingSep(clauses[pos].text);
          const cm = /^case\s+(.+)$/.exec(nc);
          if (cm) {
            pos++;
            cases.push({ caseExpr: cm[1], body: parseList(stopSwitch) });
            continue;
          }
          if (nc === "otherwise") {
            pos++;
            cases.push({ caseExpr: null, body: parseList(END_WORDS) });
            break;
          }
          break;
        }
        if (pos >= clauses.length || !END_WORDS.has(stripTrailingSep(clauses[pos].text))) {
          fail('missing "end" for "switch"');
        }
        pos++;
        nodes.push({ kind: "switch", line: cur.line, expr: switchMatch[1], cases });
        continue;
      }
      const fnMatch =
        /^function\s+(?:\[([^\]]*)\]\s*=\s*|([A-Za-z_]\w*)\s*=\s*)?([A-Za-z_]\w*)\s*(?:\(([^)]*)\))?$/.exec(clean);
      if (fnMatch) {
        const outputs = fnMatch[1]
          ? fnMatch[1].split(/[,\s]+/).map((s) => s.trim()).filter(Boolean)
          : fnMatch[2]
            ? [fnMatch[2].trim()]
            : [];
        const fnName = fnMatch[3];
        const params = fnMatch[4]
          ? fnMatch[4].split(",").map((s) => s.trim()).filter(Boolean)
          : [];
        const body = parseList(END_WORDS);
        if (pos >= clauses.length || !END_WORDS.has(stripTrailingSep(clauses[pos].text))) {
          fail(`missing "end" for function "${fnName}"`);
        }
        pos++;
        nodes.push({ kind: "function", line: cur.line, name: fnName, params, outputs, body });
        continue;
      }
      nodes.push({ kind: "simple", id: nextSimpleId++, line: cur.line, src: cur.text });
    }
    return nodes;
  }

  return parseList(new Set());
}

class ControlSignal {
  constructor(readonly kind: "break" | "continue" | "return") {}
}

function forColumns(val: Value): Value[] {
  if (typeof val === "number" || isComplex(val) || typeof val === "string" || isFnHandle(val)) {
    return [val];
  }
  if (val.rows === 0 || val.cols === 0) return [];
  if (val.rows === 1) {
    const out: Value[] = new Array(val.cols);
    for (let j = 0; j < val.cols; j++) {
      out[j] = val.imag ? complexScalar(val.data[j], val.imag[j]) : val.data[j];
    }
    return out;
  }
  const out: Value[] = new Array(val.cols);
  for (let j = 0; j < val.cols; j++) {
    const colRe = new Float64Array(val.rows);
    const colIm = val.imag ? new Float64Array(val.rows) : undefined;
    for (let i = 0; i < val.rows; i++) {
      colRe[i] = val.data[i * val.cols + j];
      if (colIm && val.imag) colIm[i] = val.imag[i * val.cols + j];
    }
    out[j] = squeeze(matrix(val.rows, 1, colRe, colIm));
  }
  return out;
}

const MAX_LOOP_ITERATIONS = 100_000;

export function runBlock(
  lines: readonly string[],
  scope: Scope,
  initialPrecision: Precision = "short",
): { precision: Precision; outcomes: BlockLineOutcome[] } {
  callCount = 0;
  callBudgetHeld = true;
  try {
    return runLines(lines, scope, initialPrecision);
  } finally {
    callBudgetHeld = false;
  }
}

function runLines(
  lines: readonly string[],
  scope: Scope,
  initialPrecision: Precision,
): { precision: Precision; outcomes: BlockLineOutcome[] } {
  let precision = initialPrecision;
  const needsStructured = lines.some((ln) => BLOCK_TRIGGER_RE.test(stripComment(ln)));
  if (!needsStructured) {
    const outcomes: BlockLineOutcome[] = [];
    for (let i = 0; i < lines.length; i++) {
      const text = lines[i];
      if (!text.trim()) continue;
      try {
        for (const st of compileLine(text)) {
          if (st.format) {
            precision = st.format;
            continue;
          }
          const v = st.run(scope);
          if (!st.suppressed && !st.draw) {
            outcomes.push({ line: i, value: v, precision });
          }
        }
      } catch (e) {
        outcomes.push({ line: i, precision, error: errorText(e) });
      }
    }
    return { precision, outcomes };
  }

  const outcomes: BlockLineOutcome[] = [];
  const loopSlots = new Map<string, number>();
  let loopDepth = 0;
  let fnCallDepth = 0;
  let totalIterations = 0;

  let ast: BlockNode[];
  try {
    const clauses = splitTopLevelClauses(lines);
    ast = parseBlockAst(clauses);
  } catch (e) {
    const errLine = Math.max(
      0,
      lines.findIndex((l) => l.trim().length > 0),
    );
    outcomes.push({ line: errLine, precision, error: errorText(e) });
    return { precision, outcomes };
  }

  const execNodes = (nodes: readonly BlockNode[], curScope: Scope): void => {
    for (const node of nodes) {
      switch (node.kind) {
        case "break":
          if (loopDepth === 0) fail('"break" outside of loop');
          throw new ControlSignal("break");
        case "continue":
          if (loopDepth === 0) fail('"continue" outside of loop');
          throw new ControlSignal("continue");
        case "return":
          throw new ControlSignal("return");
        case "simple": {
          const stmts = compileLine(node.src);
          for (let sIdx = 0; sIdx < stmts.length; sIdx++) {
            const st = stmts[sIdx];
            if (st.format) {
              precision = st.format;
              continue;
            }
            const v = st.run(curScope);
            if (!st.suppressed && !st.draw && fnCallDepth === 0) {
              if (loopDepth > 0) {
                const slotKey = `${node.id}:${sIdx}`;
                const existing = loopSlots.get(slotKey);
                const entry: BlockLineOutcome = { line: node.line, value: v, precision };
                if (existing !== undefined) outcomes[existing] = entry;
                else {
                  loopSlots.set(slotKey, outcomes.length);
                  outcomes.push(entry);
                }
              } else {
                outcomes.push({ line: node.line, value: v, precision });
              }
            }
          }
          break;
        }
        case "for": {
          const iterVal = evaluate(node.iterExpr, curScope);
          const cols = forColumns(iterVal);
          loopDepth++;
          try {
            for (const item of cols) {
              if (++totalIterations > MAX_LOOP_ITERATIONS) {
                fail(`loop limit exceeded (${MAX_LOOP_ITERATIONS} iterations)`);
              }
              curScope.set(node.varName, item);
              try {
                execNodes(node.body, curScope);
              } catch (sig) {
                if (sig instanceof ControlSignal) {
                  if (sig.kind === "break") break;
                  if (sig.kind === "continue") continue;
                }
                throw sig;
              }
            }
          } finally {
            loopDepth--;
          }
          break;
        }
        case "while": {
          loopDepth++;
          try {
            while (truthy(evaluate(node.condExpr, curScope))) {
              if (++totalIterations > MAX_LOOP_ITERATIONS) {
                fail(`loop limit exceeded (${MAX_LOOP_ITERATIONS} iterations)`);
              }
              try {
                execNodes(node.body, curScope);
              } catch (sig) {
                if (sig instanceof ControlSignal) {
                  if (sig.kind === "break") break;
                  if (sig.kind === "continue") continue;
                }
                throw sig;
              }
            }
          } finally {
            loopDepth--;
          }
          break;
        }
        case "if": {
          for (const br of node.branches) {
            if (br.condExpr === null || truthy(evaluate(br.condExpr, curScope))) {
              execNodes(br.body, curScope);
              break;
            }
          }
          break;
        }
        case "switch": {
          const target = evaluate(node.expr, curScope);
          for (const cs of node.cases) {
            if (cs.caseExpr === null) {
              execNodes(cs.body, curScope);
              break;
            }
            const candidate = evaluate(cs.caseExpr, curScope);
            if (truthy(BINARY["=="].apply(target, candidate))) {
              execNodes(cs.body, curScope);
              break;
            }
          }
          break;
        }
        case "function": {
          const handle: FnHandle = {
            kind: "fn",
            params: node.params,
            source: `function ${node.name}(${node.params.join(", ")})`,
            call: (callArgs, callerScope) => {
              if (callArgs.length !== node.params.length) {
                fail(
                  `${node.name} takes ${node.params.length} argument${node.params.length === 1 ? "" : "s"}`,
                );
              }
              const locals = new Map<string, Value>();
              node.params.forEach((p, idx) => locals.set(p, callArgs[idx]));
              const fnScope: Scope = {
                draw: callerScope.draw ?? curScope.draw,
                get: (nm) => {
                  if (locals.has(nm)) return locals.get(nm);
                  const outerVal = curScope.get(nm) ?? callerScope.get(nm);
                  return outerVal && isFnHandle(outerVal) ? outerVal : undefined;
                },
                set: (nm, val) => locals.set(nm, val),
              };
              enterCall();
              fnCallDepth++;
              const outerLoops = loopDepth;
              loopDepth = 0;
              try {
                execNodes(node.body, fnScope);
              } catch (sig) {
                if (!(sig instanceof ControlSignal && sig.kind === "return")) throw sig;
              } finally {
                loopDepth = outerLoops;
                fnCallDepth--;
                callDepth--;
              }
              if (node.outputs.length === 0) return [locals.get("ans") ?? 0];
              return node.outputs.map((outName) => locals.get(outName) ?? 0);
            },
          };
          curScope.set(node.name, handle);
          break;
        }
      }
    }
  };

  for (const node of ast) {
    try {
      execNodes([node], scope);
    } catch (e) {
      if (e instanceof ControlSignal && e.kind === "return") break;
      outcomes.push({ line: node.line, precision, error: errorText(e) });
    }
  }

  return { precision, outcomes };
}
