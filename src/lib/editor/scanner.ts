import { Decoration, type DecorationSet } from "@codemirror/view";
import { RangeSet, type EditorState, type Range } from "@codemirror/state";
import { syntaxTree } from "@codemirror/language";
import { revealed, type SelRange } from "./reveal";
import type { ConstructSpec, Emit, RevealMode, ScanContext, TextSpec } from "./types";

export interface ConstructSpan {
  readonly from: number;
  readonly to: number;
  readonly reveal: RevealMode;
}

export interface HiddenRange {
  readonly owner: number;
  readonly from: number;
  readonly to: number;
  readonly deco: Decoration;
  readonly widget: boolean;
}

const HIDDEN = Decoration.replace({});

export class ConstructTable {
  constructor(
    private readonly spans: readonly ConstructSpan[],
    private readonly hides: readonly HiddenRange[],
    private readonly always: readonly Range<Decoration>[],
  ) {}

  foldedHides(sel: readonly SelRange[]): HiddenRange[] {
    const open = this.spans.map((s) => revealed(s.reveal, s.from, s.to, sel));
    return this.hides.filter((h) => !open[h.owner]);
  }

  decorations(sel: readonly SelRange[]): DecorationSet {
    const ranges = [...this.always];
    for (const h of this.foldedHides(sel)) {
      ranges.push(h.deco.range(h.from, h.to));
    }
    return Decoration.set(ranges, true);
  }

  atomicRanges(sel: readonly SelRange[]): RangeSet<Decoration> {
    const folded = this.foldedHides(sel);
    if (folded.length === 0) return RangeSet.empty;
    return RangeSet.of(
      folded.map((h) => h.deco.range(h.from, h.to)),
      true,
    );
  }

  allHiddenBetween(from: number, to: number, sel: readonly SelRange[]): boolean {
    if (from >= to) return true;
    let cover = from;
    for (const h of this.foldedHides(sel)) {
      if (h.to <= cover) continue;
      if (h.from > cover) return false;
      cover = h.to;
      if (cover >= to) return true;
    }
    return cover >= to;
  }
}

export class ConstructScanner {
  readonly #byName = new Map<string, ConstructSpec>();
  readonly #textSpecs: readonly TextSpec[];

  constructor(specs: readonly ConstructSpec[], textSpecs: readonly TextSpec[] = []) {
    for (const spec of specs) {
      for (const name of spec.nodes) {
        if (this.#byName.has(name)) {
          throw new Error(`Two construct specs claim syntax node "${name}"`);
        }
        this.#byName.set(name, spec);
      }
    }
    this.#textSpecs = textSpecs;
  }

  scan(
    state: EditorState,
    ranges: readonly SelRange[],
    preview: boolean,
  ): ConstructTable {
    const spans: ConstructSpan[] = [];
    const spanIds = new Map<string, number>();
    const hides: HiddenRange[] = [];
    const hideSeen = new Set<string>();
    const always: Range<Decoration>[] = [];
    const lineSeen = new Set<number>();

    const emit: Emit = {
      construct(from, to, reveal) {
        const key = `${from}:${to}:${reveal}`;
        let id = spanIds.get(key);
        if (id === undefined) {
          id = spans.length;
          spans.push({ from, to, reveal });
          spanIds.set(key, id);
        }
        return id;
      },
      hide(owner, from, to, deco) {
        if (!preview || to <= from) return;
        const key = `${owner}:${from}:${to}`;
        if (hideSeen.has(key)) return;
        hideSeen.add(key);
        hides.push({
          owner,
          from,
          to,
          deco: deco ?? HIDDEN,
          widget: deco?.spec.widget != null,
        });
      },
      mark(from, to, deco) {
        if (to > from) always.push(deco.range(from, to));
      },
      line(lineFrom, deco) {
        if (lineSeen.has(lineFrom)) return;
        lineSeen.add(lineFrom);
        always.push(deco.range(lineFrom));
      },
    };

    const cx: ScanContext = { state, preview };
    const tree = syntaxTree(state);
    for (const { from, to } of ranges) {
      tree.iterate({
        from,
        to,
        enter: (node) => {
          const spec = this.#byName.get(node.name);
          if (!spec) return;
          return spec.enter(node, cx, emit);
        },
      });
      for (const ts of this.#textSpecs) {
        ts.scan(state.doc.sliceString(from, to), from, cx, emit);
      }
    }

    hides.sort((a, b) => a.from - b.from || a.to - b.to);
    return new ConstructTable(spans, hides, always);
  }
}
