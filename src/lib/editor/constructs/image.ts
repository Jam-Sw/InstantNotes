// Image construct: `![alt](attachments/<name>)` renders as the actual image
// through Tauri's asset protocol; caret contact brings the raw markdown back
// so it stays editable. Remote http(s) images stay as text: the CSP
// deliberately blocks remote loads, and the link layer opens them externally
// on click. The converter is injected so the spec stays testable without a
// Tauri runtime.

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
  // Let CM handle clicks: the caret lands at the image's position, which
  // reveals the raw markdown for editing.
  ignoreEvent(): boolean {
    return false;
  }
}

export class ImageSpec implements ConstructSpec {
  readonly nodes = ["Image"];

  constructor(private readonly convert: (path: string) => string) {}

  enter(node: SyntaxNodeRef, cx: ScanContext, emit: Emit): boolean {
    // Always descend so the URL child keeps its link mark (visible in edit
    // mode and whenever the image is revealed).
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
