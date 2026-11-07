import { Decoration, WidgetType } from "@codemirror/view";
import { calcField, type CalcItem } from "../calc";
import { sameFigure, type Figure } from "$lib/calc/plot";
import { mountFigure, type FigureHandle } from "$lib/graphics/figure-view";
import type { Emit, ScanContext, TextSpec } from "../types";

class CalcWidget extends WidgetType {
  constructor(
    readonly item: CalcItem,
    readonly attached: boolean,
  ) {
    super();
  }

  eq(o: CalcWidget): boolean {
    return o.item.key === this.item.key && o.attached === this.attached;
  }

  toDOM(): HTMLElement {
    const el = document.createElement("span");
    el.className = this.attached ? "cm-calc cm-calc-attached" : "cm-calc";
    for (const part of this.item.parts) {
      const span = document.createElement("span");
      span.className = part.error ? "cm-calc-error" : "cm-calc-value";
      if (part.grid) {
        const table = document.createElement("table");
        table.className = "cm-calc-matrix";
        for (const row of part.grid) {
          const tr = table.insertRow();
          for (const cell of row) tr.insertCell().textContent = cell;
        }
        span.appendChild(table);
      } else {
        span.textContent = part.text;
      }
      el.appendChild(span);
    }
    return el;
  }

  ignoreEvent(): boolean {
    return false;
  }
}

const mounted = new WeakMap<HTMLElement, Map<number, FigureHandle>>();

class FigureWidget extends WidgetType {
  constructor(readonly figures: readonly Figure[]) {
    super();
  }

  eq(o: FigureWidget): boolean {
    return (
      o.figures.length === this.figures.length &&
      o.figures.every((f, i) => sameFigure(f, this.figures[i]))
    );
  }

  #fill(el: HTMLElement, handles: Map<number, FigureHandle>): void {
    const keep = new Set(this.figures.map((f) => f.id));
    for (const [id, h] of handles) {
      if (keep.has(id)) continue;
      h.destroy();
      h.el.remove();
      handles.delete(id);
    }
    for (const f of this.figures) {
      const h = handles.get(f.id);
      if (h) h.update(f);
      else handles.set(f.id, mountFigure(f));
    }
    el.replaceChildren(...this.figures.map((f) => (handles.get(f.id) as FigureHandle).el));
  }

  toDOM(): HTMLElement {
    const el = document.createElement("div");
    el.className = "cm-figures";
    el.contentEditable = "false";
    const stop = (e: Event) => e.stopPropagation();
    const block = (e: Event) => {
      e.preventDefault();
      e.stopPropagation();
    };
    for (const ev of ["mousedown", "pointerdown", "touchstart", "click", "dblclick", "contextmenu"]) {
      el.addEventListener(ev, stop);
    }
    for (const ev of ["dragstart", "selectstart"]) {
      el.addEventListener(ev, block);
    }
    const handles = new Map<number, FigureHandle>();
    mounted.set(el, handles);
    this.#fill(el, handles);
    return el;
  }

  updateDOM(dom: HTMLElement): boolean {
    const handles = mounted.get(dom);
    if (!handles) return false;
    this.#fill(dom, handles);
    return true;
  }

  destroy(dom: HTMLElement): void {
    for (const h of mounted.get(dom)?.values() ?? []) h.destroy();
    mounted.delete(dom);
  }

  ignoreEvent(): boolean {
    return true;
  }
}

export class CalcSpec implements TextSpec {
  scan(text: string, offset: number, cx: ScanContext, emit: Emit): void {
    const table = cx.state.field(calcField, false);
    if (!table || table.items.length === 0) return;
    const end = offset + text.length;
    for (const item of table.between(offset, end)) {
      if (item.kind === "figure") {
        if (item.to < offset || item.to > end) continue;
        emit.at(item.to, Decoration.widget({ widget: new FigureWidget(item.figures), side: 2 }));
        continue;
      }
      if (item.kind !== "line" && cx.preview) {
        const owner = emit.construct(item.from, item.to, "span");
        emit.hide(
          owner,
          item.innerFrom,
          item.innerTo,
          Decoration.replace({ widget: new CalcWidget(item, false) }),
        );
        continue;
      }
      if (item.to < offset || item.to > end) continue;
      emit.at(item.to, Decoration.widget({ widget: new CalcWidget(item, true), side: 1 }));
    }
  }
}
