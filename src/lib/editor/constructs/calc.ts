import { Decoration, WidgetType } from "@codemirror/view";
import { calcField, type CalcItem } from "../calc";
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

export class CalcSpec implements TextSpec {
  scan(text: string, offset: number, cx: ScanContext, emit: Emit): void {
    const table = cx.state.field(calcField, false);
    if (!table || table.items.length === 0) return;
    const end = offset + text.length;
    for (const item of table.between(offset, end)) {
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
