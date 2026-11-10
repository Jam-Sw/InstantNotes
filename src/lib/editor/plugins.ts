import { Facet, StateField, type EditorState, type Extension } from "@codemirror/state";
import { EditorView, hoverTooltip, showTooltip, type Tooltip } from "@codemirror/view";
import { syntaxTree } from "@codemirror/language";
import type { SyntaxNode } from "@lezer/common";
import { runPlugin } from "$lib/plugin";
import {
  MASK,
  OPENING,
  cellAt,
  claims,
  type Block,
  type Mark,
  type Plugin,
  type PluginConfig,
  type Region,
  type Result,
  type View,
} from "$lib/plugin/types";

type ItemKind = "line" | "inline" | "cell" | "block" | "mark";

export interface PluginItem {
  readonly kind: ItemKind;
  readonly from: number;
  readonly to: number;
  readonly innerFrom: number;
  readonly innerTo: number;
  readonly views: readonly View[];
  readonly blocks: readonly Block[];
  readonly mark: Mark | null;
  readonly plugin: Plugin;
  readonly key: string;
}

const NONE: PluginConfig = { plugins: [], prefs: {} };

export const pluginConfig = Facet.define<PluginConfig, PluginConfig>({
  combine: (values) => values[0] ?? NONE,
});

function keyOf(views: readonly View[]): string {
  let k = "";
  for (const v of views) k += (v.error ? "!" : v.hint ? "?" : "=") + v.text + "\u0001";
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
  mark: Mark | null = null,
): PluginItem {
  return {
    kind,
    from,
    to,
    innerFrom,
    innerTo,
    views,
    blocks,
    mark,
    plugin,
    key: keyOf(views),
  };
}

interface Group {
  readonly plugin: Plugin;
  readonly sources: readonly string[];
  readonly starts: readonly number[];
  readonly items: readonly PluginItem[];
  readonly owners: readonly number[];
  readonly results: ReadonlyMap<string, Result>;
}

export class PluginTable {
  static readonly empty = new PluginTable([], [], NONE);

  constructor(
    readonly items: readonly PluginItem[],
    readonly groups: readonly Group[],
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

function fenceOwner(plugs: readonly Plugin[], lang: string): Plugin | undefined {
  return plugs.find((p) => Array.isArray(p.fences) && p.fences.includes(lang)) ?? plugs.find((p) => p.fences === "*");
}

function sourcesOf(state: EditorState, plugs: readonly Plugin[]): Source[] {
  const doc = state.doc;
  const out: Source[] = [];
  const prose = plugs.find((p) => p.prose);
  syntaxTree(state).iterate({
    enter(ref) {
      switch (ref.name) {
        case "FencedCode": {
          const info = ref.node.getChild("CodeInfo");
          if (info) {
            const lang = doc.sliceString(info.from, info.to).trim().toLowerCase();
            const plugin = fenceOwner(plugs, lang);
            if (plugin)
              out.push({
                node: ref.node,
                text: doc.sliceString(ref.from, ref.to),
                plugin,
                lang,
              });
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
        case "Paragraph":
          if (prose)
            out.push({
              node: ref.node,
              text: doc.sliceString(ref.from, ref.to),
              plugin: prose,
              lang: "",
            });
          return;
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
  return {
    region: { kind: "table", rows: grid, header: true },
    spans: [],
    cells,
  };
}

const MASKED = new Set(["InlineCode", "URL", "Autolink", "Image", "HTMLTag", "QuoteMark", "LinkLabel"]);

function maskedProse(src: Source): string {
  const base = src.node.from;
  let text = src.text;
  src.node.cursor().iterate((ref) => {
    if (!MASKED.has(ref.name)) return;
    const a = ref.from - base;
    const b = ref.to - base;
    text = text.slice(0, a) + MASK.repeat(b - a) + text.slice(b);
    return false;
  });
  return text;
}

function prepare(src: Source, state: EditorState): Prepared | null {
  const doc = state.doc;
  const node = src.node;
  switch (node.name) {
    case "FencedCode": {
      const text = node.getChild("CodeText");
      if (!text && src.plugin.fences !== "*") return null;
      const lines: string[] = [];
      const spans: Span[] = [];
      if (text) {
        const first = doc.lineAt(text.from).number;
        const last = doc.lineAt(text.to).number;
        for (let ln = first; ln <= last; ln++) {
          const line = doc.line(ln);
          lines.push(line.text);
          spans.push({ from: line.from, to: line.to });
        }
      }
      return {
        region: { kind: "fence", lang: src.lang, lines },
        spans,
        cells: [],
      };
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
    case "Paragraph":
      return {
        region: { kind: "prose", text: maskedProse(src) },
        spans: [],
        cells: [],
      };
  }
  return null;
}

function placeMarks(src: Source, res: Result, items: PluginItem[]): void {
  const base = src.node.from;
  const size = src.node.to - base;
  for (const m of [...(res.marks ?? [])].sort((a, b) => a.from - b.from)) {
    if (m.from < 0 || m.to > size || m.to <= m.from) continue;
    items.push(item(src.plugin, "mark", base + m.from, base + m.to, base + m.from, base + m.to, [], [], m));
  }
}

function place(src: Source, prep: Prepared, res: Result, state: EditorState, items: PluginItem[]): void {
  const node = src.node;
  const plugin = src.plugin;
  switch (prep.region.kind) {
    case "fence": {
      const opening = state.doc.lineAt(node.from);
      for (const o of [...res.out].sort((a, b) => a.at - b.at)) {
        const span = o.at === OPENING ? opening : prep.spans[o.at];
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
      return;
    }
    case "prose":
      placeMarks(src, res, items);
  }
}

function sameTexts(prev: Group, sources: readonly Source[]): boolean {
  if (prev.sources.length !== sources.length) return false;
  for (let i = 0; i < sources.length; i++) if (prev.sources[i] !== sources[i].text) return false;
  return true;
}

function rebase(prev: Group, starts: readonly number[]): Group {
  if (starts.every((at, i) => at === prev.starts[i])) return prev;
  const items = prev.items.map((it, i) => {
    const d = starts[prev.owners[i]] - prev.starts[prev.owners[i]];
    return d === 0
      ? it
      : {
          ...it,
          from: it.from + d,
          to: it.to + d,
          innerFrom: it.innerFrom + d,
          innerTo: it.innerTo + d,
        };
  });
  return { ...prev, starts, items };
}

const resultKey = (src: Source): string => `${src.node.name}\u0001${src.lang}\u0001${src.text}`;

function evaluate(
  plugin: Plugin,
  sources: readonly Source[],
  state: EditorState,
  config: PluginConfig,
  prev: Group | undefined,
): Group {
  const prepared = sources.map((src) => prepare(src, state));
  const results = new Map<string, Result>();
  const byIndex: (Result | undefined)[] = new Array(sources.length);
  const regions: Region[] = [];
  const asked: number[] = [];
  sources.forEach((src, i) => {
    const prep = prepared[i];
    if (!prep) return;
    const hit = plugin.isolated ? prev?.results.get(resultKey(src)) : undefined;
    if (hit) {
      byIndex[i] = hit;
      results.set(resultKey(src), hit);
      return;
    }
    regions.push(prep.region);
    asked.push(i);
  });
  if (regions.length > 0) {
    const fresh = runPlugin(plugin, regions, config.prefs[plugin.id] ?? {}, config.context);
    asked.forEach((i, n) => {
      const res = fresh[n];
      if (!res) return;
      byIndex[i] = res;
      if (plugin.isolated) results.set(resultKey(sources[i]), res);
    });
  }
  const items: PluginItem[] = [];
  const owners: number[] = [];
  sources.forEach((src, i) => {
    const prep = prepared[i];
    const res = byIndex[i];
    if (prep && res) place(src, prep, res, state, items);
    while (owners.length < items.length) owners.push(i);
  });
  return {
    plugin,
    sources: sources.map((src) => src.text),
    starts: sources.map((src) => src.node.from),
    items,
    owners,
    results,
  };
}

export function scanPlugins(state: EditorState, prev?: PluginTable): PluginTable {
  const config = state.facet(pluginConfig);
  if (config.plugins.length === 0) return PluginTable.empty;
  const sources = sourcesOf(state, config.plugins);
  if (sources.length === 0) return PluginTable.empty;
  const old = prev && prev.config === config ? prev.groups : [];
  const groups: Group[] = [];
  for (const plugin of config.plugins) {
    const mine = sources.filter((src) => src.plugin === plugin);
    if (mine.length === 0) continue;
    const before = old.find((g) => g.plugin === plugin);
    groups.push(
      before && sameTexts(before, mine)
        ? rebase(
            before,
            mine.map((src) => src.node.from),
          )
        : evaluate(plugin, mine, state, config, before),
    );
  }
  if (prev && groups.length === old.length && groups.every((g, i) => g === old[i])) return prev;
  const items =
    groups.length === 1
      ? groups[0].items
      : groups.flatMap((g) => g.items).sort((a, b) => a.from - b.from || a.to - b.to);
  return new PluginTable(items, groups, config);
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

function markAt(state: EditorState, pos: number, inside: boolean): PluginItem | undefined {
  return state
    .field(pluginField, false)
    ?.between(pos, pos)
    .find((it) => it.mark && (inside ? it.from < pos && pos < it.to : it.from <= pos && pos <= it.to));
}

function caretMark(state: EditorState): PluginItem | undefined {
  const sel = state.selection.main;
  return sel.empty ? markAt(state, sel.head, true) : undefined;
}

const tips = new WeakMap<PluginItem, Tooltip>();

function tipFor(hit: PluginItem, mark: Mark): Tooltip {
  const known = tips.get(hit);
  if (known) return known;
  const tip: Tooltip = {
    pos: hit.from,
    end: hit.to,
    above: true,
    create(view) {
      const dom = document.createElement("div");
      dom.className = "cm-plugin-tip";
      const label = document.createElement("span");
      label.textContent = mark.message;
      dom.appendChild(label);
      const fixes = typeof mark.fixes === "function" ? mark.fixes() : (mark.fixes ?? []);
      for (const fix of fixes) {
        const button = document.createElement("button");
        button.type = "button";
        button.textContent = fix || "Remove";
        button.addEventListener("mousedown", (e) => {
          e.preventDefault();
          view.dispatch({
            changes: { from: hit.from, to: hit.to, insert: fix },
            userEvent: "input.assist",
          });
        });
        dom.appendChild(button);
      }
      return { dom };
    },
  };
  tips.set(hit, tip);
  return tip;
}

const hoverTip = hoverTooltip(
  (view, pos) => {
    const hit = markAt(view.state, pos, false);
    if (!hit?.mark || hit === caretMark(view.state)) return null;
    return tipFor(hit, hit.mark);
  },
  { hideOnChange: true },
);

const caretTip = showTooltip.compute(["selection", pluginField], (state) => {
  const hit = caretMark(state);
  return hit?.mark ? tipFor(hit, hit.mark) : null;
});

function typingAt(state: EditorState): number {
  const sel = state.selection.main;
  if (!sel.empty) return -1;
  const hit = state
    .field(pluginField, false)
    ?.between(sel.head, sel.head)
    .find((it) => it.mark?.kind === "spelling" && it.to === sel.head);
  return hit ? hit.to : -1;
}

export const typingField = StateField.define<number>({
  create: typingAt,
  update: (_value, tr) => typingAt(tr.state),
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
  return [pluginField, typingField, pluginConfig.of(config), hoverTip, caretTip, config.plugins.map(themeOf)];
}
