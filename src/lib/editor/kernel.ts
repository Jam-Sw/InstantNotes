import {
  EditorView,
  ViewPlugin,
  Decoration,
  type DecorationSet,
  type ViewUpdate,
} from "@codemirror/view";
import {
  StateEffect,
  StateField,
  RangeSet,
  type EditorState,
  type Extension,
} from "@codemirror/state";
import { ConstructScanner, type ConstructTable } from "./scanner";
import type { ConstructSpec, TextSpec } from "./types";

export const setPreviewMode = StateEffect.define<boolean>();

export const previewModeField = StateField.define<boolean>({
  create: () => false,
  update(val, tr) {
    for (const e of tr.effects) {
      if (e.is(setPreviewMode)) return e.value;
    }
    return val;
  },
});

export interface KernelConfig {
  specs: readonly ConstructSpec[];
  textSpecs?: readonly TextSpec[];
  rescanOn?: readonly StateField<any>[];
}

class PreviewKernel {
  table: ConstructTable;
  decorations: DecorationSet = Decoration.none;
  atomic: RangeSet<Decoration> = RangeSet.empty;

  constructor(
    view: EditorView,
    private readonly scanner: ConstructScanner,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    private readonly rescanOn: readonly StateField<any>[],
  ) {
    this.table = this.#scan(view);
    this.#derive(view.state);
  }

  update(u: ViewUpdate): void {
    const flip =
      u.startState.field(previewModeField) !== u.state.field(previewModeField);
    const prefsChanged = this.rescanOn.some(
      (f) => u.startState.field(f, false) !== u.state.field(f, false),
    );
    if (u.docChanged || u.viewportChanged || flip || prefsChanged) {
      this.table = this.#scan(u.view);
      this.#derive(u.state);
    } else if (u.selectionSet) {
      this.#derive(u.state);
    }
  }

  #scan(view: EditorView): ConstructTable {
    return this.scanner.scan(
      view.state,
      view.visibleRanges,
      view.state.field(previewModeField),
    );
  }

  #derive(state: EditorState): void {
    const sel = state.selection.ranges;
    this.decorations = this.table.decorations(sel);
    this.atomic = this.table.atomicRanges(sel);
  }
}

export interface Kernel {
  extension: Extension;
  plugin: ViewPlugin<PreviewKernel>;
}

export function previewKernel(config: KernelConfig): Kernel {
  const scanner = new ConstructScanner(config.specs, config.textSpecs ?? []);
  const plugin = ViewPlugin.define(
    (view) => new PreviewKernel(view, scanner, config.rescanOn ?? []),
    {
      decorations: (v) => v.decorations,
      provide: (p) =>
        EditorView.atomicRanges.of((view) => view.plugin(p)?.atomic ?? RangeSet.empty),
    },
  );
  return { extension: [previewModeField, plugin], plugin };
}
