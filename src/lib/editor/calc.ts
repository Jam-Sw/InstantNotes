import { StateField, type EditorState } from "@codemirror/state";
import { syntaxTree } from "@codemirror/language";
import type { SyntaxNode } from "@lezer/common";
import { CalcError, compileLine, type Precision, type Scope, type Value } from "$lib/calc/engine";
import { formatGrid, formatValue } from "$lib/calc/format";
import { evaluateGrid, isFormula } from "$lib/calc/table";

interface CalcPart {
  readonly text: string;
  readonly error: boolean;
  readonly grid: readonly (readonly string[])[] | null;
}

type CalcKind = "line" | "inline" | "cell";

export interface CalcItem {
  readonly kind: CalcKind;
  readonly from: number;
  readonly to: number;
  readonly innerFrom: number;
  readonly innerTo: number;
  readonly parts: readonly CalcPart[];
  readonly key: string;
}

const CALC_LANGS = new Set(["calc"]);

class Env implements Scope {
  readonly vars = new Map<string, Value>();
  precision: Precision = "short";
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
      if (!st.suppressed) parts.push(part(v, env.precision));
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
): CalcItem {
  return { kind, from, to, innerFrom, innerTo, parts, key: keyOf(parts) };
}

export class CalcTable {
  static readonly empty = new CalcTable([]);

  constructor(readonly items: readonly CalcItem[]) {}

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

export function scanCalc(state: EditorState): CalcTable {
  const items: CalcItem[] = [];
  const env = new Env();
  const doc = state.doc;
  syntaxTree(state).iterate({
    enter(ref) {
      switch (ref.name) {
        case "FencedCode": {
          const node = ref.node;
          const info = node.getChild("CodeInfo");
          if (!info || !CALC_LANGS.has(doc.sliceString(info.from, info.to).trim().toLowerCase())) {
            return false;
          }
          const text = node.getChild("CodeText");
          if (!text) return false;
          const first = doc.lineAt(text.from).number;
          const last = doc.lineAt(text.to).number;
          for (let ln = first; ln <= last; ln++) {
            const line = doc.line(ln);
            if (!line.text.trim()) continue;
            const parts = runLine(line.text, env);
            if (parts.length > 0) items.push(item("line", line.from, line.to, line.from, line.to, parts));
          }
          return false;
        }
        case "InlineCode": {
          const raw = doc.sliceString(ref.from, ref.to);
          const inner = stripBackticks(raw);
          if (!inner) return false;
          const content = raw.slice(inner.from, inner.to);
          if (!isFormula(content)) return false;
          const parts = runLine(content.slice(1), env);
          if (parts.length > 0) {
            items.push(item("inline", ref.from, ref.to, ref.from + inner.from, ref.from + inner.to, parts));
          }
          return false;
        }
        case "Table":
          scanTable(ref.node, state, env, items);
          return false;
        case "CodeBlock":
        case "HTMLBlock":
        case "Image":
        case "Link":
        case "Autolink":
          return false;
      }
    },
  });
  return items.length === 0 ? CalcTable.empty : new CalcTable(items);
}

export const calcField = StateField.define<CalcTable>({
  create: scanCalc,
  update(value, tr) {
    if (tr.docChanged || syntaxTree(tr.state) !== syntaxTree(tr.startState)) {
      return scanCalc(tr.state);
    }
    return value;
  },
});
