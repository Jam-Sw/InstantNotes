// Tag construct: #tag spans get the cm-tag treatment (styled in app.css) in
// both modes. Text-driven, not tree-driven: tags are an InstantNotes notion,
// not markdown. `#tag` (no space) never collides with `# Heading` (space
// required by CommonMark).

import { Decoration } from "@codemirror/view";
import type { Emit, ScanContext, TextSpec } from "../types";

const tagMark = Decoration.mark({ class: "cm-tag" });

const TAG_RE = /(^|\s)(#[\p{L}\p{N}_-]+)/gu;

export class TagSpec implements TextSpec {
  scan(text: string, offset: number, _cx: ScanContext, emit: Emit): void {
    TAG_RE.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = TAG_RE.exec(text))) {
      const start = offset + m.index + m[1].length;
      emit.mark(start, start + m[2].length, tagMark);
    }
  }
}
