import { Facet, StateField, type EditorState, type Extension } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { syntaxTree } from "@codemirror/language";
import type { SyntaxNode } from "@lezer/common";
import { runPlugin } from "$lib/plugin";
import {
  cellAt,
  claims,
  type Block,
  type Plugin,
  type PluginConfig,
  type Region,
  type Result,
  type View,
} from "$lib/plugin/types";

type ItemKind = "line" | "inline" | "cell" | "block";

export interface PluginItem {
  readonly kind: ItemKind;
  readonly from: number;
  readonly to: number;
  readonly innerFrom: number;
  readonly innerTo: number;
  readonly views: readonly View[];
  readonly blocks: readonly Block[];
  readonly plugin: Plugin;
  readonly key: string;
}

const NONE: PluginConfig = { plugins: [], prefs: {} };

export const pluginConfig = Facet.define<PluginConfig, PluginConfig>({
  combine: (values) => values[0] ?? NONE,
});

function keyOf(views: readonly View[]): string {
  let k = "";
  for (const v of views) k += (v.error ? "!" : "=") + v.text + "\u0001";
  return k;
}

function item(
  plugin: Plugin,
  kind: ItemKind,
  from: number,
  to: number,
  innerFrom: number,
  innerTo: number,
  views: readonly View[],
  blocks: readonly Block[] = [],
): PluginItem {
  return { kind, from, to, innerFrom, innerTo, views, blocks, plugin, key: keyOf(views) };
}

export class PluginTable {
  static readonly empty = new PluginTable([], [], [], [], NONE);

  constructor(
    readonly items: readonly PluginItem[],
    readonly owners: readonly number[],
    readonly sources: readonly string[],
    readonly starts: readonly number[],
    readonly config: PluginConfig,
  ) {}

  between(from: number, to: number): readonly PluginItem[] {
    const items = this.items;
    let lo = 0;
    let hi = items.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (items[mid].to < from) lo = mid + 1;
      else hi = mid;
    }
    const out: PluginItem[] = [];
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

interface Source {
  readonly node: SyntaxNode;
  readonly text: string;
  readonly plugin: Plugin;
  readonly lang: string;
}

function sourcesOf(state: EditorState, plugs: readonly Plugin[]): Source[] {
  const doc = state.doc;
  const out: Source[] = [];
  syntaxTree(state).iterate({
    enter(ref) {
      switch (ref.name) {
        case "FencedCode": {
          const info = ref.node.getChild("CodeInfo");
          if (info) {
            const lang = doc.sliceString(info.from, info.to).trim().toLowerCase();
            const plugin = plugs.find((p) => p.fences?.includes(lang));
            if (plugin) out.push({ node: ref.node, text: doc.sliceString(ref.from, ref.to), plugin, lang });
          }
          return false;
        }
        case "InlineCode": {
          const raw = doc.sliceString(ref.from, ref.to);
          const inner = stripBackticks(raw);
          if (inner) {
            const text = raw.slice(inner.from, inner.to);
            const plugin = plugs.find((p) => claims(p.inline, text));
            if (plugin) out.push({ node: ref.node, text: raw, plugin, lang: "" });
          }
          return false;
        }
        case "Table": {
          const raw = doc.sliceString(ref.from, ref.to);
          const plugin = plugs.find((p) => p.cells !== undefined && raw.includes(p.cells.prefix));
          if (plugin) out.push({ node: ref.node, text: raw, plugin, lang: "" });
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

interface Span {
  readonly from: number;
  readonly to: number;
}

interface Cell extends Span {
  readonly r: number;
  readonly c: number;
}

interface Prepared {
  readonly region: Region;
  readonly spans: readonly Span[];
  readonly cells: readonly Cell[];
}

function prepareTable(src: Source, state: EditorState): Prepared | null {
  const grid: string[][] = [];
  const cells: Cell[] = [];
  let r = 0;
  for (let row = src.node.firstChild; row; row = row.nextSibling) {
    if (row.name !== "TableHeader" && row.name !== "TableRow") continue;
    const cols: (SyntaxNode | null)[] = [];
    let pending: SyntaxNode | null = null;
    let first = true;
    for (let cell = row.firstChild; cell; cell = cell.nextSibling) {
      if (cell.name === "TableCell") pending = cell;
      else if (cell.name === "TableDelimiter") {
        if (!first || pending) cols.push(pending);
        pending = null;
      } else continue;
      first = false;
    }
    if (pending) cols.push(pending);
    const texts = cols.map((cell) => (cell ? state.doc.sliceString(cell.from, cell.to) : ""));
    texts.forEach((text, c) => {
      const cell = cols[c];
      if (cell && claims(src.plugin.cells, text)) cells.push({ r, c, from: cell.from, to: cell.to });
    });
    grid.push(texts);
    r++;
  }
  if (cells.length === 0) return null;
  return { region: { kind: "table", rows: grid, header: true }, spans: [], cells };
}

function prepare(src: Source, state: EditorState): Prepared | null {
  const doc = state.doc;
  const node = src.node;
  switch (node.name) {
    case "FencedCode": {
      const text = node.getChild("CodeText");
      if (!text) return null;
      const first = doc.lineAt(text.from).number;
      const last = doc.lineAt(text.to).number;
      const lines: string[] = [];
      const spans: Span[] = [];
      for (let ln = first; ln <= last; ln++) {
        const line = doc.line(ln);
        lines.push(line.text);
        spans.push({ from: line.from, to: line.to });
      }
      return { region: { kind: "fence", lang: src.lang, lines }, spans, cells: [] };
    }
    case "InlineCode": {
      const inner = stripBackticks(src.text) as Span;
      return {
        region: { kind: "inline", text: src.text.slice(inner.from, inner.to) },
        spans: [{ from: node.from + inner.from, to: node.from + inner.to }],
        cells: [],
      };
    }
    case "Table":
      return prepareTable(src, state);
  }
  return null;
}

function place(src: Source, prep: Prepared, res: Result, items: PluginItem[]): void {
  const node = src.node;
  const plugin = src.plugin;
  switch (prep.region.kind) {
    case "fence": {
      for (const o of [...res.out].sort((a, b) => a.at - b.at)) {
        const span = prep.spans[o.at];
        if (o.views.length > 0 && span) {
          items.push(item(plugin, "line", span.from, span.to, span.from, span.to, o.views));
        }
      }
      if (plugin.block && res.blocks && res.blocks.length > 0) {
        items.push(item(plugin, "block", node.to, node.to, node.to, node.to, [], res.blocks));
      }
      return;
    }
    case "inline": {
      const views = res.out[0]?.views ?? [];
      const inner = prep.spans[0];
      if (views.length > 0) items.push(item(plugin, "inline", node.from, node.to, inner.from, inner.to, views));
      return;
    }
    case "table": {
      const byCell = new Map<number, readonly View[]>();
      for (const o of res.out) byCell.set(o.at, o.views);
      for (const cell of prep.cells) {
        const views = byCell.get(cellAt(cell.r, cell.c));
        if (views && views.length > 0) {
          items.push(item(plugin, "cell", cell.from, cell.to, cell.from, cell.to, views));
        }
      }
    }
  }
}

function sameSources(prev: PluginTable, sources: readonly Source[], config: PluginConfig): boolean {
  if (prev.config !== config || prev.sources.length !== sources.length) return false;
  for (let i = 0; i < sources.length; i++) if (prev.sources[i] !== sources[i].text) return false;
  return true;
}

function rebase(prev: PluginTable, starts: readonly number[]): PluginTable {
  if (starts.every((at, i) => at === prev.starts[i])) return prev;
  const items = prev.items.map((it, i) => {
    const d = starts[prev.owners[i]] - prev.starts[prev.owners[i]];
    return d === 0
      ? it
      : { ...it, from: it.from + d, to: it.to + d, innerFrom: it.innerFrom + d, innerTo: it.innerTo + d };
  });
  return new PluginTable(items, prev.owners, prev.sources, starts, prev.config);
}

export function scanPlugins(state: EditorState, prev?: PluginTable): PluginTable {
  const config = state.facet(pluginConfig);
  if (config.plugins.length === 0) return PluginTable.empty;
  const sources = sourcesOf(state, config.plugins);
  const starts = sources.map((src) => src.node.from);
  if (prev && sameSources(prev, sources, config)) return rebase(prev, starts);
  if (sources.length === 0) return PluginTable.empty;
  const prepared = sources.map((src) => prepare(src, state));
  const results = new Map<Plugin, readonly Result[]>();
  const taken = new Map<Plugin, number>();
  for (const plugin of config.plugins) {
    const regions: Region[] = [];
    sources.forEach((src, i) => {
      const prep = prepared[i];
      if (src.plugin === plugin && prep) regions.push(prep.region);
    });
    if (regions.length > 0) results.set(plugin, runPlugin(plugin, regions, config.prefs[plugin.id] ?? {}));
  }
  const items: PluginItem[] = [];
  const owners: number[] = [];
  sources.forEach((src, i) => {
    const prep = prepared[i];
    if (!prep) return;
    const n = taken.get(src.plugin) ?? 0;
    taken.set(src.plugin, n + 1);
    const res = results.get(src.plugin)?.[n];
    if (res) place(src, prep, res, items);
    while (owners.length < items.length) owners.push(i);
  });
  return new PluginTable(items, owners, sources.map((src) => src.text), starts, config);
}

export const pluginField = StateField.define<PluginTable>({
  create: (state) => scanPlugins(state),
  update(value, tr) {
    if (
      tr.docChanged ||
      syntaxTree(tr.state) !== syntaxTree(tr.startState) ||
      tr.state.facet(pluginConfig) !== tr.startState.facet(pluginConfig)
    ) {
      return scanPlugins(tr.state, value);
    }
    return value;
  },
});

const themes = new WeakMap<Plugin, Extension>();

function themeOf(plugin: Plugin): Extension {
  if (!plugin.theme) return [];
  let ext = themes.get(plugin);
  if (!ext) {
    ext = EditorView.baseTheme(plugin.theme);
    themes.set(plugin, ext);
  }
  return ext;
}

export function pluginExtension(config: PluginConfig): Extension {
  if (config.plugins.length === 0) return [];
  return [pluginField, pluginConfig.of(config), config.plugins.map(themeOf)];
}
