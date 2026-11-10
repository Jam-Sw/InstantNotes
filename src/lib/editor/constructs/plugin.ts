import { Decoration, WidgetType } from "@codemirror/view";
import { pluginField, typingField, type PluginItem } from "../plugins";
import type { Block, BlockHandle, Plugin } from "$lib/plugin/types";
import type { Emit, ScanContext, TextSpec } from "../types";

class ViewWidget extends WidgetType {
  constructor(
    readonly item: PluginItem,
    readonly attached: boolean,
  ) {
    super();
  }

  eq(o: ViewWidget): boolean {
    return o.item.key === this.item.key && o.attached === this.attached;
  }

  toDOM(): HTMLElement {
    const el = document.createElement("span");
    el.className = this.attached ? "cm-plugin cm-plugin-attached" : "cm-plugin";
    for (const view of this.item.views) {
      const span = document.createElement("span");
      span.className = view.error ? "cm-plugin-error" : view.hint ? "cm-plugin-hint" : "cm-plugin-value";
      if (view.grid) {
        const table = document.createElement("table");
        table.className = "cm-plugin-grid";
        for (const row of view.grid) {
          const tr = table.insertRow();
          for (const cell of row) tr.insertCell().textContent = cell;
        }
        span.appendChild(table);
      } else {
        span.textContent = view.text;
      }
      el.appendChild(span);
    }
    return el;
  }

  ignoreEvent(): boolean {
    return false;
  }
}

const styleMark = Decoration.mark({ class: "cm-plugin-mark cm-plugin-mark-style" });
const spellingMark = Decoration.mark({ class: "cm-plugin-mark cm-plugin-mark-spelling" });

const mounted = new WeakMap<HTMLElement, Map<number, BlockHandle>>();

class BlockWidget extends WidgetType {
  constructor(
    readonly plugin: Plugin,
    readonly blocks: readonly Block[],
  ) {
    super();
  }

  eq(o: BlockWidget): boolean {
    const same = this.plugin.block?.same;
    return (
      o.plugin === this.plugin &&
      same !== undefined &&
      o.blocks.length === this.blocks.length &&
      o.blocks.every((b, i) => same(b.data, this.blocks[i].data))
    );
  }

  #fill(el: HTMLElement, handles: Map<number, BlockHandle>): void {
    const mount = this.plugin.block?.mount;
    if (!mount) return;
    const keep = new Set(this.blocks.map((b) => b.id));
    for (const [id, h] of handles) {
      if (keep.has(id)) continue;
      h.destroy();
      h.el.remove();
      handles.delete(id);
    }
    for (const b of this.blocks) {
      const h = handles.get(b.id);
      if (h) h.update(b.data);
      else handles.set(b.id, mount(b.data));
    }
    el.replaceChildren(...this.blocks.map((b) => (handles.get(b.id) as BlockHandle).el));
  }

  toDOM(): HTMLElement {
    const el = document.createElement("div");
    el.className = "cm-plugin-blocks";
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
    const handles = new Map<number, BlockHandle>();
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

export class PluginSpec implements TextSpec {
  scan(text: string, offset: number, cx: ScanContext, emit: Emit): void {
    const table = cx.state.field(pluginField, false);
    if (!table || table.items.length === 0) return;
    const end = offset + text.length;
    const typing = cx.state.field(typingField, false) ?? -1;
    for (const item of table.between(offset, end)) {
      if (item.kind === "block") {
        if (item.to < offset || item.to > end) continue;
        emit.at(item.to, Decoration.widget({ widget: new BlockWidget(item.plugin, item.blocks), side: 2 }));
        continue;
      }
      if (item.kind === "mark") {
        if (item.mark?.kind === "spelling" && typing === item.to) continue;
        emit.mark(
          Math.max(item.from, offset),
          Math.min(item.to, end),
          item.mark?.kind === "spelling" ? spellingMark : styleMark,
        );
        continue;
      }
      if (item.kind !== "line" && cx.preview) {
        const owner = emit.construct(item.from, item.to, "span");
        emit.hide(owner, item.innerFrom, item.innerTo, Decoration.replace({ widget: new ViewWidget(item, false) }));
        continue;
      }
      if (item.to < offset || item.to > end) continue;
      emit.at(item.to, Decoration.widget({ widget: new ViewWidget(item, true), side: 1 }));
    }
  }
}
