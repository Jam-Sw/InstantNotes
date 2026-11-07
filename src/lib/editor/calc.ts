import { Facet, StateField, type EditorState } from "@codemirror/state";
import { syntaxTree } from "@codemirror/language";
import type { SyntaxNode } from "@lezer/common";
import { CalcError, compileLine, runBlock, type Precision, type Scope, type Value } from "$lib/calc/engine";
import { formatGrid, formatValue } from "$lib/calc/format";
import { evaluateGrid, isFormula } from "$lib/calc/table";
import { Figures, type Figure } from "$lib/calc/plot";

interface CalcPart {
  readonly text: string;
  readonly error: boolean;
  readonly grid: readonly (readonly string[])[] | null;
}

type CalcKind = "line" | "inline" | "cell" | "figure";

export interface CalcItem {
  readonly kind: CalcKind;
  readonly from: number;
  readonly to: number;
  readonly innerFrom: number;
  readonly innerTo: number;
  readonly parts: readonly CalcPart[];
  readonly figures: readonly Figure[];
  readonly key: string;
}

export const calcPrecision = Facet.define<Precision, Precision>({
  combine: (values) => values[0] ?? "short",
});

const CALC_LANGS = new Set(["calc", "matlab", "m"]);

class Env implements Scope {
  readonly vars = new Map<string, Value>();
  precision: Precision = "short";
  draw?: Figures;
  get(name: string): Value | undefined {
    return this.vars.get(name);
  }
  set(name: string, value: Value): void {
    this.vars.set(name, value);
  }
}

function part(value: Value, precision: Precision): CalcPart {
  return { text: formatValue(value, precision), error: false, grid: formatGrid(value, precision) };
}

function errorPart(e: unknown): CalcPart {
  if (!(e instanceof CalcError)) throw e;
  return { text: e.message, error: true, grid: null };
}

function runLine(src: string, env: Env): CalcPart[] {
  const parts: CalcPart[] = [];
  try {
    for (const st of compileLine(src)) {
      if (st.format) {
        env.precision = st.format;
        continue;
      }
      const v = st.run(env);
      if (!st.suppressed && !st.draw) parts.push(part(v, env.precision));
    }
  } catch (e) {
    parts.push(errorPart(e));
  }
  return parts;
}

function keyOf(parts: readonly CalcPart[]): string {
  let k = "";
  for (const p of parts) k += (p.error ? "!" : "=") + p.text + "\u0001";
  return k;
}

function item(
  kind: CalcKind,
  from: number,
  to: number,
  innerFrom: number,
  innerTo: number,
  parts: CalcPart[],
  figures: readonly Figure[] = [],
): CalcItem {
  return { kind, from, to, innerFrom, innerTo, parts, figures, key: keyOf(parts) };
}

export class CalcTable {
  static readonly empty = new CalcTable([], [], [], [], "short");

  constructor(
    readonly items: readonly CalcItem[],
    readonly owners: readonly number[],
    readonly sources: readonly string[],
    readonly starts: readonly number[],
    readonly precision: Precision,
  ) {}

  between(from: number, to: number): readonly CalcItem[] {
    const items = this.items;
    let lo = 0;
    let hi = items.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (items[mid].to < from) lo = mid + 1;
      else hi = mid;
    }
    const out: CalcItem[] = [];
    for (let i = lo; i < items.length && items[i].from <= to; i++) out.push(items[i]);
    return out;
  }
}

function stripBackticks(text: string): { from: number; to: number } | null {
  let a = 0;
  while (a < text.length && text.charCodeAt(a) === 96) a++;
  let b = text.length;
  while (b > a && text.charCodeAt(b - 1) === 96) b--;
  return b > a ? { from: a, to: b } : null;
}

function scanTable(node: SyntaxNode, state: EditorState, env: Env, items: CalcItem[]): void {
  const grid: string[][] = [];
  const cells: { r: number; c: number; from: number; to: number }[] = [];
  let r = 0;
  for (let row = node.firstChild; row; row = row.nextSibling) {
    if (row.name !== "TableHeader" && row.name !== "TableRow") continue;
    const texts: string[] = [];
    for (let cell = row.firstChild; cell; cell = cell.nextSibling) {
      if (cell.name !== "TableCell") continue;
      const text = state.doc.sliceString(cell.from, cell.to);
      if (isFormula(text)) cells.push({ r, c: texts.length, from: cell.from, to: cell.to });
      texts.push(text);
    }
    grid.push(texts);
    r++;
  }
  if (cells.length === 0) return;
  const results = evaluateGrid(grid, true, env, env.precision);
  for (const cell of cells) {
    const out = results.get(cell.r * 4096 + cell.c);
    if (!out) continue;
    const parts = out.error
      ? [{ text: out.text, error: true, grid: null }]
      : [part(out.value as Value, env.precision)];
    items.push(item("cell", cell.from, cell.to, cell.from, cell.to, parts));
  }
}

interface Source {
  readonly node: SyntaxNode;
  readonly text: string;
}

function sourcesOf(state: EditorState): Source[] {
  const doc = state.doc;
  const out: Source[] = [];
  syntaxTree(state).iterate({
    enter(ref) {
      switch (ref.name) {
        case "FencedCode": {
          const info = ref.node.getChild("CodeInfo");
          if (info && CALC_LANGS.has(doc.sliceString(info.from, info.to).trim().toLowerCase())) {
            out.push({ node: ref.node, text: doc.sliceString(ref.from, ref.to) });
          }
          return false;
        }
        case "InlineCode": {
          const raw = doc.sliceString(ref.from, ref.to);
          const inner = stripBackticks(raw);
          if (inner && isFormula(raw.slice(inner.from, inner.to))) out.push({ node: ref.node, text: raw });
          return false;
        }
        case "Table": {
          const raw = doc.sliceString(ref.from, ref.to);
          if (raw.includes("=")) out.push({ node: ref.node, text: raw });
          return false;
        }
        case "CodeBlock":
        case "HTMLBlock":
        case "Image":
        case "Link":
        case "Autolink":
          return false;
      }
    },
  });
  return out;
}

function evaluateSource(src: Source, state: EditorState, env: Env, items: CalcItem[]): void {
  const doc = state.doc;
  const node = src.node;
  switch (node.name) {
    case "FencedCode": {
      const text = node.getChild("CodeText");
      if (!text) return;
      const first = doc.lineAt(text.from).number;
      const last = doc.lineAt(text.to).number;
      const lines: string[] = [];
      const spans: { from: number; to: number }[] = [];
      for (let ln = first; ln <= last; ln++) {
        const line = doc.line(ln);
        lines.push(line.text);
        spans.push({ from: line.from, to: line.to });
      }
      env.draw = new Figures();
      const res = runBlock(lines, env, env.precision);
      env.precision = res.precision;
      const byLine = new Map<number, CalcPart[]>();
      for (const out of res.outcomes) {
        const arr = byLine.get(out.line) ?? [];
        if (out.error !== undefined) {
          arr.push({ text: out.error, error: true, grid: null });
        } else if (out.value !== undefined) {
          arr.push(part(out.value, out.precision));
        }
        byLine.set(out.line, arr);
      }
      const orderedLines = [...byLine.keys()].sort((a, b) => a - b);
      for (const idx of orderedLines) {
        const parts = byLine.get(idx);
        const span = spans[idx];
        if (parts && parts.length > 0 && span) {
          items.push(item("line", span.from, span.to, span.from, span.to, parts));
        }
      }
      const figures = env.draw.list();
      env.draw = undefined;
      if (figures.length > 0) items.push(item("figure", node.to, node.to, node.to, node.to, [], figures));
      return;
    }
    case "InlineCode": {
      const inner = stripBackticks(src.text) as { from: number; to: number };
      const parts = runLine(src.text.slice(inner.from + 1, inner.to), env);
      if (parts.length > 0) {
        items.push(item("inline", node.from, node.to, node.from + inner.from, node.from + inner.to, parts));
      }
      return;
    }
    case "Table":
      scanTable(node, state, env, items);
  }
}

function sameSources(prev: CalcTable, sources: readonly Source[], precision: Precision): boolean {
  if (prev.precision !== precision || prev.sources.length !== sources.length) return false;
  for (let i = 0; i < sources.length; i++) if (prev.sources[i] !== sources[i].text) return false;
  return true;
}

function rebase(prev: CalcTable, starts: readonly number[]): CalcTable {
  if (starts.every((at, i) => at === prev.starts[i])) return prev;
  const items = prev.items.map((it, i) => {
    const d = starts[prev.owners[i]] - prev.starts[prev.owners[i]];
    return d === 0
      ? it
      : { ...it, from: it.from + d, to: it.to + d, innerFrom: it.innerFrom + d, innerTo: it.innerTo + d };
  });
  return new CalcTable(items, prev.owners, prev.sources, starts, prev.precision);
}

export function scanCalc(state: EditorState, prev?: CalcTable): CalcTable {
  const precision = state.facet(calcPrecision);
  const sources = sourcesOf(state);
  const starts = sources.map((src) => src.node.from);
  if (prev && sameSources(prev, sources, precision)) return rebase(prev, starts);
  if (sources.length === 0) return CalcTable.empty;
  const items: CalcItem[] = [];
  const owners: number[] = [];
  const env = new Env();
  env.precision = precision;
  sources.forEach((src, i) => {
    evaluateSource(src, state, env, items);
    while (owners.length < items.length) owners.push(i);
  });
  return new CalcTable(items, owners, sources.map((src) => src.text), starts, precision);
}

export const calcField = StateField.define<CalcTable>({
  create: (state) => scanCalc(state),
  update(value, tr) {
    if (
      tr.docChanged ||
      syntaxTree(tr.state) !== syntaxTree(tr.startState) ||
      tr.state.facet(calcPrecision) !== tr.startState.facet(calcPrecision)
    ) {
      return scanCalc(tr.state, value);
    }
    return value;
  },
});
