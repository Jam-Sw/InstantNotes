// The single syntax walk and the table it produces.
//
// ConstructScanner routes every syntax node to the spec that owns it and
// collects the emissions into a ConstructTable. The table is the one source
// of truth the whole kernel derives from: rendering (decorations), caret
// legality (atomic ranges), and pointer normalization (coverage queries) all
// read the same data, so they cannot disagree about what is hidden.
//
// Pure over EditorState: no view, no DOM, fully unit-testable.

import { Decoration, type DecorationSet } from "@codemirror/view";
import { RangeSet, type EditorState, type Range } from "@codemirror/state";
import { syntaxTree } from "@codemirror/language";
import { revealed, type SelRange } from "./reveal";
import type { ConstructSpec, Emit, RevealMode, ScanContext, TextSpec } from "./types";

/** A declared construct span. */
export interface ConstructSpan {
  readonly from: number;
  readonly to: number;
  readonly reveal: RevealMode;
}

/** A markup range replaced while its owning construct is folded. */
export interface HiddenRange {
  readonly owner: number;
  readonly from: number;
  readonly to: number;
  readonly deco: Decoration;
  /** True when the replacement renders a widget (visible object) rather than nothing. */
  readonly widget: boolean;
}

const HIDDEN = Decoration.replace({});

/**
 * The scan result. Immutable; every query takes the selection as input, so
 * one table serves every selection state between rescans.
 */
export class ConstructTable {
  constructor(
    private readonly spans: readonly ConstructSpan[],
    /** Sorted by (from, to). */
    private readonly hides: readonly HiddenRange[],
    private readonly always: readonly Range<Decoration>[],
  ) {}

  /** Hidden ranges whose owning construct is folded for `sel`. */
  foldedHides(sel: readonly SelRange[]): HiddenRange[] {
    const open = this.spans.map((s) => revealed(s.reveal, s.from, s.to, sel));
    return this.hides.filter((h) => !open[h.owner]);
  }

  /** Everything the view should draw for `sel`: styling plus active folds. */
  decorations(sel: readonly SelRange[]): DecorationSet {
    const ranges = [...this.always];
    for (const h of this.foldedHides(sel)) {
      ranges.push(h.deco.range(h.from, h.to));
    }
    return Decoration.set(ranges, true);
  }

  /**
   * The folded ranges as a RangeSet for EditorView.atomicRanges: cursor
   * motion and deletion treat them as single objects. Revealed constructs
   * drop out, so approaching markup opens it and then edits it char by char.
   */
  atomicRanges(sel: readonly SelRange[]): RangeSet<Decoration> {
    const folded = this.foldedHides(sel);
    if (folded.length === 0) return RangeSet.empty;
    return RangeSet.of(
      folded.map((h) => h.deco.range(h.from, h.to)),
      true,
    );
  }

  /**
   * True when every position in [from, to) is inside some folded hidden
   * range for `sel`: i.e. the span is entirely invisible (or replaced) on
   * screen. CaretGuard uses this to recognize clicks past the visible end
   * of a line.
   */
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

/**
 * Owns the one tree walk. Constructed once with the spec registry; `scan`
 * is called per update by the kernel plugin (and directly by tests).
 */
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
