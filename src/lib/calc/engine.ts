export interface Matrix {
  readonly rows: number;
  readonly cols: number;
  readonly data: Float64Array;
}

export type Value = number | Matrix;

export class CalcError extends Error {}

export interface Scope {
  get(name: string): Value | undefined;
  set(name: string, value: Value): void;
  cells?(from: string, to: string): Value;
  column?(name: string): Value | undefined;
}

export type Precision = "short" | "long";

export interface Statement {
  readonly name: string | null;
  readonly suppressed: boolean;
  readonly format: Precision | null;
  readonly run: (scope: Scope) => Value;
}

type Fn = (scope: Scope) => Value;
type Arg = Fn | ":";

function fail(message: string): never {
  throw new CalcError(message);
}

export const isMatrix = (v: Value): v is Matrix => typeof v !== "number";

function shape(v: Value): string {
  return isMatrix(v) ? `${v.rows}×${v.cols}` : "1×1";
}

export function matrix(rows: number, cols: number, data?: Float64Array): Matrix {
  return { rows, cols, data: data ?? new Float64Array(rows * cols) };
}

export function rowVector(values: ArrayLike<number>): Value {
  return values.length === 1 ? values[0] : matrix(1, values.length, Float64Array.from(values));
}

export function colVector(values: ArrayLike<number>): Value {
  return values.length === 1 ? values[0] : matrix(values.length, 1, Float64Array.from(values));
}

function numel(v: Value): number {
  return isMatrix(v) ? v.data.length : 1;
}

function flat(v: Value): Float64Array {
  return isMatrix(v) ? v.data : Float64Array.of(v);
}

function squeeze(m: Matrix): Value {
  return m.rows === 1 && m.cols === 1 ? m.data[0] : m;
}

function scalar(v: Value, what: string): number {
  if (isMatrix(v)) {
    if (v.data.length === 1) return v.data[0];
    fail(`${what} needs a single number, got ${shape(v)}`);
  }
  return v as number;
}

function truthy(v: Value): boolean {
  if (isMatrix(v)) {
    if (v.data.length === 0) return false;
    for (let i = 0; i < v.data.length; i++) if (v.data[i] === 0) return false;
    return true;
  }
  return v !== 0;
}

const MAX_ELEMENTS = 1_000_000;

function guardSize(n: number): void {
  if (n > MAX_ELEMENTS) fail(`too large (${n} elements)`);
}

function ew(a: Value, b: Value, f: (x: number, y: number) => number): Value {
  if (typeof a === "number") {
    if (typeof b === "number") return f(a, b);
    const d = new Float64Array(b.data.length);
    for (let i = 0; i < d.length; i++) d[i] = f(a, b.data[i]);
    return { rows: b.rows, cols: b.cols, data: d };
  }
  if (typeof b === "number") {
    const d = new Float64Array(a.data.length);
    for (let i = 0; i < d.length; i++) d[i] = f(a.data[i], b);
    return { rows: a.rows, cols: a.cols, data: d };
  }
  if (a.rows !== b.rows || a.cols !== b.cols) {
    fail(`size mismatch ${shape(a)} and ${shape(b)}`);
  }
  const d = new Float64Array(a.data.length);
  for (let i = 0; i < d.length; i++) d[i] = f(a.data[i], b.data[i]);
  return { rows: a.rows, cols: a.cols, data: d };
}

function map(v: Value, f: (x: number) => number): Value {
  if (typeof v === "number") return f(v);
  const d = new Float64Array(v.data.length);
  for (let i = 0; i < d.length; i++) d[i] = f(v.data[i]);
  return { rows: v.rows, cols: v.cols, data: d };
}

function matmul(a: Matrix, b: Matrix): Value {
  if (a.cols !== b.rows) fail(`inner sizes differ ${shape(a)} * ${shape(b)}`);
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
  if (typeof a === "number" || typeof b === "number") return ew(a, b, (x, y) => x * y);
  return matmul(a, b);
}

function div(a: Value, b: Value): Value {
  if (typeof b === "number") return ew(a, b, (x, y) => x / y);
  if (typeof a === "number") fail("use ./ to divide by each element");
  fail("matrix division isn't supported; use ./");
}

function transpose(v: Value): Value {
  if (typeof v === "number") return v;
  const out = matrix(v.cols, v.rows);
  for (let i = 0; i < v.rows; i++) {
    for (let j = 0; j < v.cols; j++) out.data[j * v.rows + i] = v.data[i * v.cols + j];
  }
  return out;
}

function identity(n: number): Matrix {
  const m = matrix(n, n);
  for (let i = 0; i < n; i++) m.data[i * n + i] = 1;
  return m;
}

function pow(a: Value, b: Value): Value {
  if (typeof a === "number" && typeof b === "number") return Math.pow(a, b);
  if (typeof b === "number" && isMatrix(a)) {
    if (a.rows !== a.cols) fail(`^ needs a square matrix, got ${shape(a)}`);
    if (!Number.isInteger(b) || b < 0) fail("matrix power needs a whole number");
    let result: Value = identity(a.rows);
    let base: Value = a;
    let e = b;
    while (e > 0) {
      if (e & 1) result = mul(result, base);
      e >>= 1;
      if (e > 0) base = mul(base, base);
    }
    return result;
  }
  fail("use .^ to raise each element");
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
  let rows = -1;
  let cols = 0;
  for (const p of parts) {
    const r = isMatrix(p) ? p.rows : 1;
    const c = isMatrix(p) ? p.cols : 1;
    if (isMatrix(p) && p.data.length === 0) continue;
    if (rows === -1) rows = r;
    else if (rows !== r) fail("rows in a matrix must have the same height");
    cols += c;
  }
  if (rows === -1) return matrix(0, 0);
  const out = matrix(rows, cols);
  let at = 0;
  for (const p of parts) {
    if (isMatrix(p)) {
      if (p.data.length === 0) continue;
      for (let i = 0; i < rows; i++) {
        out.data.set(p.data.subarray(i * p.cols, (i + 1) * p.cols), i * cols + at);
      }
      at += p.cols;
    } else {
      out.data[at] = p;
      at += 1;
    }
  }
  return out;
}

function vcat(rowsIn: Value[]): Value {
  if (rowsIn.length === 1) return rowsIn[0];
  let cols = -1;
  let rows = 0;
  for (const p of rowsIn) {
    if (isMatrix(p) && p.data.length === 0) continue;
    const c = isMatrix(p) ? p.cols : 1;
    if (cols === -1) cols = c;
    else if (cols !== c) fail("rows in a matrix must have the same width");
    rows += isMatrix(p) ? p.rows : 1;
  }
  if (cols === -1) return matrix(0, 0);
  const out = matrix(rows, cols);
  let at = 0;
  for (const p of rowsIn) {
    if (isMatrix(p)) {
      if (p.data.length === 0) continue;
      out.data.set(p.data, at);
      at += p.data.length;
    } else {
      out.data[at++] = p;
    }
  }
  return squeeze(out);
}

const ENDS: number[] = [];

function indexList(arg: Value, size: number, what: string): Int32Array {
  const src = flat(arg);
  const out = new Int32Array(src.length);
  for (let i = 0; i < src.length; i++) {
    const k = src[i];
    if (!Number.isInteger(k)) fail(`${what} must be a whole number`);
    if (k < 1 || k > size) fail(`${what} ${k} is out of range (1..${size})`);
    out[i] = k - 1;
  }
  return out;
}

function index(v: Value, args: Arg[], scope: Scope): Value {
  const rows = isMatrix(v) ? v.rows : 1;
  const cols = isMatrix(v) ? v.cols : 1;
  const data = flat(v);
  if (args.length === 1) {
    const a = args[0];
    if (a === ":") return colVector(data);
    ENDS.push(data.length);
    let idx: Value;
    try {
      idx = a(scope);
    } finally {
      ENDS.pop();
    }
    const list = indexList(idx, data.length, "index");
    const out = new Float64Array(list.length);
    for (let i = 0; i < list.length; i++) out[i] = data[list[i]];
    if (isMatrix(idx)) return squeeze({ rows: idx.rows, cols: idx.cols, data: out });
    return out[0];
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
  const out = matrix(ri.length, ci.length);
  for (let i = 0; i < ri.length; i++) {
    for (let j = 0; j < ci.length; j++) out.data[i * ci.length + j] = data[ri[i] * cols + ci[j]];
  }
  return squeeze(out);
}

function reduce(v: Value, f: (col: Float64Array) => number): Value {
  if (typeof v === "number") return f(Float64Array.of(v));
  if (v.rows === 1 || v.cols === 1 || v.data.length === 0) return f(v.data);
  const out = new Float64Array(v.cols);
  const col = new Float64Array(v.rows);
  for (let j = 0; j < v.cols; j++) {
    for (let i = 0; i < v.rows; i++) col[i] = v.data[i * v.cols + j];
    out[j] = f(col);
  }
  return squeeze({ rows: 1, cols: v.cols, data: out });
}

function columnwise(v: Value, f: (col: Float64Array) => Float64Array): Value {
  if (typeof v === "number") return squeeze({ rows: 1, cols: 1, data: f(Float64Array.of(v)) });
  if (v.rows === 1 || v.cols === 1) {
    const d = f(v.data);
    return squeeze({ rows: v.rows === 1 ? 1 : d.length, cols: v.rows === 1 ? d.length : 1, data: d });
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

const sum = (d: Float64Array): number => {
  let s = 0;
  for (let i = 0; i < d.length; i++) s += d[i];
  return s;
};
const prod = (d: Float64Array): number => {
  let s = 1;
  for (let i = 0; i < d.length; i++) s *= d[i];
  return s;
};
const mean = (d: Float64Array): number => (d.length === 0 ? NaN : sum(d) / d.length);
const variance = (d: Float64Array): number => {
  if (d.length < 2) return d.length === 1 ? 0 : NaN;
  const m = mean(d);
  let s = 0;
  for (let i = 0; i < d.length; i++) s += (d[i] - m) ** 2;
  return s / (d.length - 1);
};
const median = (d: Float64Array): number => {
  if (d.length === 0) return NaN;
  const s = Float64Array.from(d).sort();
  const mid = s.length >> 1;
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
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

function det(v: Value): number {
  if (typeof v === "number") return v;
  if (v.rows !== v.cols) fail(`det needs a square matrix, got ${shape(v)}`);
  const n = v.rows;
  const a = Float64Array.from(v.data);
  let d = 1;
  for (let c = 0; c < n; c++) {
    let p = c;
    for (let r = c + 1; r < n; r++) if (Math.abs(a[r * n + c]) > Math.abs(a[p * n + c])) p = r;
    if (a[p * n + c] === 0) return 0;
    if (p !== c) {
      for (let k = 0; k < n; k++) {
        const t = a[c * n + k];
        a[c * n + k] = a[p * n + k];
        a[p * n + k] = t;
      }
      d = -d;
    }
    const pivot = a[c * n + c];
    d *= pivot;
    for (let r = c + 1; r < n; r++) {
      const f = a[r * n + c] / pivot;
      if (f === 0) continue;
      for (let k = c; k < n; k++) a[r * n + k] -= f * a[c * n + k];
    }
  }
  return d;
}

function inv(v: Value): Value {
  if (typeof v === "number") return 1 / v;
  if (v.rows !== v.cols) fail(`inv needs a square matrix, got ${shape(v)}`);
  const n = v.rows;
  const a = Float64Array.from(v.data);
  const b = identity(n).data;
  for (let c = 0; c < n; c++) {
    let p = c;
    for (let r = c + 1; r < n; r++) if (Math.abs(a[r * n + c]) > Math.abs(a[p * n + c])) p = r;
    if (a[p * n + c] === 0) fail("matrix is singular");
    if (p !== c) {
      for (let k = 0; k < n; k++) {
        let t = a[c * n + k];
        a[c * n + k] = a[p * n + k];
        a[p * n + k] = t;
        t = b[c * n + k];
        b[c * n + k] = b[p * n + k];
        b[p * n + k] = t;
      }
    }
    const pivot = a[c * n + c];
    for (let k = 0; k < n; k++) {
      a[c * n + k] /= pivot;
      b[c * n + k] /= pivot;
    }
    for (let r = 0; r < n; r++) {
      if (r === c) continue;
      const f = a[r * n + c];
      if (f === 0) continue;
      for (let k = 0; k < n; k++) {
        a[r * n + k] -= f * a[c * n + k];
        b[r * n + k] -= f * b[c * n + k];
      }
    }
  }
  return squeeze({ rows: n, cols: n, data: b });
}

const roundHalfAway = (x: number): number => Math.sign(x) * Math.round(Math.abs(x));
const fix = (x: number): number => (x < 0 ? Math.ceil(x) : Math.floor(x));
const mod = (x: number, y: number): number => (y === 0 ? x : x - Math.floor(x / y) * y);
const rem = (x: number, y: number): number => (y === 0 ? x : x - fix(x / y) * y);
const factorial = (n: number): number => {
  if (!Number.isInteger(n) || n < 0) fail("factorial needs a whole number");
  let f = 1;
  for (let i = 2; i <= n; i++) f *= i;
  return f;
};

type Builtin = (args: Value[], scope: Scope) => Value;

function arity(name: string, args: Value[], min: number, max = min): void {
  if (args.length < min || args.length > max) {
    fail(
      min === max
        ? `${name} takes ${min} argument${min === 1 ? "" : "s"}`
        : `${name} takes ${min} to ${max} arguments`,
    );
  }
}

const unary = (name: string, f: (x: number) => number): Builtin => (args) => {
  arity(name, args, 1);
  return map(args[0], f);
};

const binary = (name: string, f: (x: number, y: number) => number): Builtin => (args) => {
  arity(name, args, 2);
  return ew(args[0], args[1], f);
};

const reduction = (name: string, f: (d: Float64Array) => number): Builtin => (args) => {
  arity(name, args, 1);
  return reduce(args[0], f);
};

const dims = (name: string, args: Value[]): [number, number] => {
  arity(name, args, 1, 2);
  const r = scalar(args[0], name);
  const c = args.length === 2 ? scalar(args[1], name) : r;
  if (!Number.isInteger(r) || !Number.isInteger(c) || r < 0 || c < 0) fail(`${name} needs whole sizes`);
  guardSize(r * c);
  return [r, c];
};

const BUILTINS: Record<string, Builtin> = {
  abs: unary("abs", Math.abs),
  sign: unary("sign", Math.sign),
  sqrt: unary("sqrt", Math.sqrt),
  cbrt: unary("cbrt", Math.cbrt),
  exp: unary("exp", Math.exp),
  log: unary("log", Math.log),
  ln: unary("ln", Math.log),
  log2: unary("log2", Math.log2),
  log10: unary("log10", Math.log10),
  sin: unary("sin", Math.sin),
  cos: unary("cos", Math.cos),
  tan: unary("tan", Math.tan),
  asin: unary("asin", Math.asin),
  acos: unary("acos", Math.acos),
  atan: unary("atan", Math.atan),
  sinh: unary("sinh", Math.sinh),
  cosh: unary("cosh", Math.cosh),
  tanh: unary("tanh", Math.tanh),
  floor: unary("floor", Math.floor),
  ceil: unary("ceil", Math.ceil),
  fix: unary("fix", fix),
  factorial: unary("factorial", factorial),
  deg2rad: unary("deg2rad", (x) => (x * Math.PI) / 180),
  rad2deg: unary("rad2deg", (x) => (x * 180) / Math.PI),
  isnan: unary("isnan", (x) => (Number.isNaN(x) ? 1 : 0)),
  round: (args) => {
    arity("round", args, 1, 2);
    if (args.length === 1) return map(args[0], roundHalfAway);
    const digits = scalar(args[1], "round");
    const scale = 10 ** digits;
    return map(args[0], (x) => roundHalfAway(x * scale) / scale);
  },
  atan2: binary("atan2", Math.atan2),
  hypot: binary("hypot", Math.hypot),
  mod: binary("mod", mod),
  rem: binary("rem", rem),
  power: binary("power", Math.pow),
  nthroot: binary("nthroot", (x, n) => (x < 0 && n % 2 === 1 ? -Math.pow(-x, 1 / n) : Math.pow(x, 1 / n))),
  nchoosek: binary("nchoosek", (n, k) => {
    if (!Number.isInteger(n) || !Number.isInteger(k) || k < 0 || n < k) fail("nchoosek needs whole numbers with n ≥ k");
    let r = 1;
    for (let i = 1; i <= k; i++) r = (r * (n - k + i)) / i;
    return Math.round(r);
  }),
  gcd: binary("gcd", (a, b) => {
    a = Math.abs(a);
    b = Math.abs(b);
    while (b) [a, b] = [b, a % b];
    return a;
  }),
  lcm: binary("lcm", (a, b) => {
    let x = Math.abs(a);
    let y = Math.abs(b);
    while (y) [x, y] = [y, x % y];
    return x === 0 ? 0 : Math.abs(a * b) / x;
  }),
  sum: reduction("sum", sum),
  prod: reduction("prod", prod),
  mean: reduction("mean", mean),
  avg: reduction("avg", mean),
  median: reduction("median", median),
  var: reduction("var", variance),
  std: reduction("std", (d) => Math.sqrt(variance(d))),
  count: reduction("count", (d) => d.length),
  any: reduction("any", (d) => (d.some((x) => x !== 0) ? 1 : 0)),
  all: reduction("all", (d) => (d.every((x) => x !== 0) ? 1 : 0)),
  norm: (args) => {
    arity("norm", args, 1);
    const d = flat(args[0]);
    let s = 0;
    for (let i = 0; i < d.length; i++) s += d[i] * d[i];
    return Math.sqrt(s);
  },
  min: (args) => {
    arity("min", args, 1, 2);
    return args.length === 1 ? reduce(args[0], minOf) : ew(args[0], args[1], Math.min);
  },
  max: (args) => {
    arity("max", args, 1, 2);
    return args.length === 1 ? reduce(args[0], maxOf) : ew(args[0], args[1], Math.max);
  },
  cumsum: (args) => {
    arity("cumsum", args, 1);
    return columnwise(args[0], (d) => {
      const out = new Float64Array(d.length);
      let s = 0;
      for (let i = 0; i < d.length; i++) out[i] = s += d[i];
      return out;
    });
  },
  cumprod: (args) => {
    arity("cumprod", args, 1);
    return columnwise(args[0], (d) => {
      const out = new Float64Array(d.length);
      let s = 1;
      for (let i = 0; i < d.length; i++) out[i] = s *= d[i];
      return out;
    });
  },
  sort: (args) => {
    arity("sort", args, 1);
    return columnwise(args[0], (d) => Float64Array.from(d).sort());
  },
  diff: (args) => {
    arity("diff", args, 1);
    const d = flat(args[0]);
    const out = new Float64Array(Math.max(d.length - 1, 0));
    for (let i = 0; i < out.length; i++) out[i] = d[i + 1] - d[i];
    return isMatrix(args[0]) && args[0].cols === 1 ? colVector(out) : rowVector(out);
  },
  dot: (args) => {
    arity("dot", args, 2);
    const a = flat(args[0]);
    const b = flat(args[1]);
    if (a.length !== b.length) fail("dot needs vectors of the same length");
    let s = 0;
    for (let i = 0; i < a.length; i++) s += a[i] * b[i];
    return s;
  },
  numel: (args) => {
    arity("numel", args, 1);
    return numel(args[0]);
  },
  length: (args) => {
    arity("length", args, 1);
    const v = args[0];
    return isMatrix(v) ? (v.data.length === 0 ? 0 : Math.max(v.rows, v.cols)) : 1;
  },
  size: (args) => {
    arity("size", args, 1, 2);
    const v = args[0];
    const r = isMatrix(v) ? v.rows : 1;
    const c = isMatrix(v) ? v.cols : 1;
    if (args.length === 2) {
      const d = scalar(args[1], "size");
      return d === 1 ? r : d === 2 ? c : fail("size dimension is 1 or 2");
    }
    return matrix(1, 2, Float64Array.of(r, c));
  },
  zeros: (args) => {
    const [r, c] = dims("zeros", args);
    return squeeze(matrix(r, c));
  },
  ones: (args) => {
    const [r, c] = dims("ones", args);
    return squeeze(matrix(r, c, new Float64Array(r * c).fill(1)));
  },
  eye: (args) => {
    const [r, c] = dims("eye", args);
    const m = matrix(r, c);
    for (let i = 0; i < Math.min(r, c); i++) m.data[i * c + i] = 1;
    return squeeze(m);
  },
  linspace: (args) => {
    arity("linspace", args, 2, 3);
    const a = scalar(args[0], "linspace");
    const b = scalar(args[1], "linspace");
    const n = args.length === 3 ? scalar(args[2], "linspace") : 100;
    if (!Number.isInteger(n) || n < 0) fail("linspace needs a whole count");
    guardSize(n);
    const d = new Float64Array(n);
    for (let i = 0; i < n; i++) d[i] = n === 1 ? b : a + ((b - a) * i) / (n - 1);
    return squeeze({ rows: 1, cols: n, data: d });
  },
  reshape: (args) => {
    arity("reshape", args, 3);
    const r = scalar(args[1], "reshape");
    const c = scalar(args[2], "reshape");
    const d = flat(args[0]);
    if (r * c !== d.length) fail(`reshape: ${d.length} elements don't fit ${r}×${c}`);
    const out = matrix(r, c);
    const src = isMatrix(args[0]) ? transpose(args[0]) : args[0];
    const colMajor = flat(src);
    for (let j = 0; j < c; j++) for (let i = 0; i < r; i++) out.data[i * c + j] = colMajor[j * r + i];
    return squeeze(out);
  },
  transpose: (args) => {
    arity("transpose", args, 1);
    return transpose(args[0]);
  },
  det: (args) => {
    arity("det", args, 1);
    return det(args[0]);
  },
  inv: (args) => {
    arity("inv", args, 1);
    return inv(args[0]);
  },
  trace: (args) => {
    arity("trace", args, 1);
    const v = args[0];
    if (!isMatrix(v)) return v;
    if (v.rows !== v.cols) fail(`trace needs a square matrix, got ${shape(v)}`);
    let s = 0;
    for (let i = 0; i < v.rows; i++) s += v.data[i * v.cols + i];
    return s;
  },
};

const CONSTANTS: Record<string, number> = {
  pi: Math.PI,
  e: Math.E,
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
  | { k: "num"; v: number; s: number }
  | { k: "id"; v: string; s: number }
  | { k: "op"; v: string; s: number }
  | { k: "sep"; s: number }
  | { k: "end"; s: number };

const OPS2 = new Set([".*", "./", ".^", ".'", "==", "~=", "!=", "<=", ">=", "&&", "||"]);
const OPS1 = new Set("+-*/^'()[],;:=<>&|~!");

const isDigit = (c: number): boolean => c >= 48 && c <= 57;
const isIdStart = (c: number): boolean =>
  (c >= 65 && c <= 90) || (c >= 97 && c <= 122) || c === 95;
const isIdChar = (c: number): boolean => isIdStart(c) || isDigit(c);
const isSpace = (c: number): boolean => c === 32 || c === 9 || c === 13;

function operandEnd(t: Tok | undefined): boolean {
  if (!t) return false;
  if (t.k === "num" || t.k === "id") return true;
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
      if (src.charCodeAt(i) === 46 && !(src.charCodeAt(i + 1) === 42 || src.charCodeAt(i + 1) === 47 || src.charCodeAt(i + 1) === 94 || src.charCodeAt(i + 1) === 39)) {
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
      toks.push({ k: "num", v: Number(src.slice(start, i)), s: start });
      continue;
    }
    if (isIdStart(c)) {
      const start = i;
      while (i < n && isIdChar(src.charCodeAt(i))) i++;
      toks.push({ k: "id", v: src.slice(start, i), s: start });
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
      if (!operandEnd(toks[toks.length - 1]) || (i > 0 && isSpace(src.charCodeAt(i - 1)))) {
        fail("text isn't supported here");
      }
      toks.push({ k: "op", v: "'", s: i });
      i++;
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
  readonly ref?: string;
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
  "==": { prec: 5, apply: (a, b) => ew(a, b, (x, y) => (x === y ? 1 : 0)) },
  "~=": { prec: 5, apply: (a, b) => ew(a, b, (x, y) => (x !== y ? 1 : 0)) },
  "!=": { prec: 5, apply: (a, b) => ew(a, b, (x, y) => (x !== y ? 1 : 0)) },
  ":": { prec: 6, apply: () => 0 },
  "+": { prec: 7, apply: (a, b) => ew(a, b, (x, y) => x + y) },
  "-": { prec: 7, apply: (a, b) => ew(a, b, (x, y) => x - y) },
  "*": { prec: 8, apply: mul },
  "/": { prec: 8, apply: div },
  ".*": { prec: 8, apply: (a, b) => ew(a, b, (x, y) => x * y) },
  "./": { prec: 8, apply: (a, b) => ew(a, b, (x, y) => x / y) },
  "^": { prec: 10, apply: pow },
  ".^": { prec: 10, apply: (a, b) => ew(a, b, Math.pow) },
};

const UNARY_PREC = 9;

class Parser {
  #toks: Tok[];
  #i = 0;

  constructor(src: string) {
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

  statement(): Statement {
    const t = this.#peek();
    if (t.k === "id" && t.v === "format") {
      const a = this.#peekAt(1);
      if (a.k === "end" || (a.k === "op" && (a.v === ";" || a.v === ","))) {
        this.#i++;
        return { name: null, suppressed: true, format: "short", run: () => 0 };
      }
      if (a.k === "id" && (a.v === "short" || a.v === "long")) {
        this.#i += 2;
        return { name: null, suppressed: true, format: a.v, run: () => 0 };
      }
    }
    let name: string | null = null;
    if (t.k === "id" && this.#isOp("=", 1)) {
      name = t.v;
      this.#i += 2;
    }
    const expr = this.expr(0).fn;
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
    const assigned = name;
    const run: Fn = assigned
      ? (s) => {
          const v = expr(s);
          s.set(assigned, v);
          return v;
        }
      : (s) => {
          const v = expr(s);
          s.set("ans", v);
          return v;
        };
    return { name, suppressed, format: null, run };
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
      if (t.v === "-") {
        const operand = this.expr(UNARY_PREC).fn;
        return { fn: (s) => map(operand(s), (x) => -x) };
      }
      if (t.v === "+") {
        return { fn: this.expr(UNARY_PREC).fn };
      }
      if (t.v === "~" || t.v === "!") {
        const operand = this.expr(UNARY_PREC).fn;
        return { fn: (s) => map(operand(s), (x) => (x === 0 ? 1 : 0)) };
      }
      fail(`unexpected "${t.v}"`);
    }
    fail(t.k === "end" ? "unexpected end" : "unexpected space");
  }

  #postfix(node: Node): Node {
    for (;;) {
      if (this.#isOp("'") || this.#isOp(".'")) {
        this.#i++;
        const inner = node.fn;
        node = { fn: (s) => transpose(inner(s)) };
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
      return {
        fn: (s) => {
          if (allColon && s.column) {
            const col = s.column(name);
            if (col !== undefined) return col;
          }
          const v = s.get(name);
          if (v !== undefined) return index(v, args, s);
          if (!builtin) fail(`undefined: ${name}`);
          const values = new Array<Value>(args.length);
          for (let i = 0; i < args.length; i++) {
            const a = args[i];
            if (a === ":") fail(`${name} doesn't take ":"`);
            values[i] = a(s);
          }
          return builtin(values, s);
        },
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
