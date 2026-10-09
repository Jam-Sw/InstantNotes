import { Decoration, WidgetType } from "@codemirror/view";
import type { SyntaxNodeRef } from "@lezer/common";
import { imageSrc, attachmentsBaseField } from "../images";
import type { ConstructSpec, Emit, ScanContext } from "../types";

class ImageWidget extends WidgetType {
  constructor(
    readonly src: string,
    readonly alt: string,
  ) {
    super();
  }
  eq(o: ImageWidget): boolean {
    return o.src === this.src && o.alt === this.alt;
  }
  toDOM(): HTMLElement {
    const img = document.createElement("img");
    img.className = "cm-image-preview";
    img.src = this.src;
    img.alt = this.alt;
    img.draggable = false;
    return img;
  }
  ignoreEvent(): boolean {
    return false;
  }
}

export class ImageSpec implements ConstructSpec {
  readonly nodes = ["Image"];

  constructor(private readonly convert: (path: string) => string) {}

  enter(node: SyntaxNodeRef, cx: ScanContext, emit: Emit): boolean {
    if (!cx.preview) return true;
    const url = node.node.getChild("URL");
    if (!url) return true;
    const src = imageSrc(
      cx.state.doc.sliceString(url.from, url.to),
      cx.state.field(attachmentsBaseField),
      this.convert,
    );
    if (!src) return true;
    const alt =
      cx.state.doc.sliceString(node.from, node.to).match(/^!\[([^\]]*)\]/)?.[1] ?? "";
    const owner = emit.construct(node.from, node.to, "span");
    emit.hide(
      owner,
      node.from,
      node.to,
      Decoration.replace({ widget: new ImageWidget(src, alt) }),
    );
    return true;
  }
}
