// Pure selection-formatting helpers for the editor toolbar and shortcuts. They
// transform (document, selection) into a new document + selection, so they are
// testable without a live CodeMirror view. The Editor wires them to commands.

export interface Sel {
  from: number;
  to: number;
}
export interface Edit {
  text: string;
  selection: Sel;
}

export type FormatKind = "bold" | "italic" | "strike" | "code" | "quote" | "list" | "link";

/** Map a toolbar/shortcut action to the corresponding document edit. */
export function formatEdit(doc: string, sel: Sel, kind: FormatKind): Edit {
  switch (kind) {
    case "bold":
      return toggleWrap(doc, sel, "**");
    case "italic":
      return toggleWrap(doc, sel, "*");
    case "strike":
      return toggleWrap(doc, sel, "~~");
    case "code":
      return toggleWrap(doc, sel, "`");
    case "quote":
      return toggleLinePrefix(doc, sel, "> ");
    case "list":
      return toggleLinePrefix(doc, sel, "- ");
    case "link":
      return insertLink(doc, sel);
  }
}

/**
 * Wrap the selection in `marker` (e.g. "**"), or unwrap it when it is already
 * wrapped - whether the markers are inside the selection or just outside it.
 * With an empty selection, insert an empty pair and place the cursor between.
 */
export function toggleWrap(doc: string, sel: Sel, marker: string): Edit {
  const { from, to } = sel;
  const ml = marker.length;

  if (from === to) {
    const text = doc.slice(0, from) + marker + marker + doc.slice(from);
    return { text, selection: { from: from + ml, to: from + ml } };
  }

  const selected = doc.slice(from, to);

  // Markers inside the selection.
  if (selected.length >= 2 * ml && selected.startsWith(marker) && selected.endsWith(marker)) {
    const inner = selected.slice(ml, selected.length - ml);
    const text = doc.slice(0, from) + inner + doc.slice(to);
    return { text, selection: { from, to: from + inner.length } };
  }

  // Markers immediately around the selection.
  if (from >= ml && doc.slice(from - ml, from) === marker && doc.slice(to, to + ml) === marker) {
    const text = doc.slice(0, from - ml) + selected + doc.slice(to + ml);
    return { text, selection: { from: from - ml, to: to - ml } };
  }

  const text = doc.slice(0, from) + marker + selected + marker + doc.slice(to);
  return { text, selection: { from: from + ml, to: to + ml } };
}

/**
 * Add `prefix` (e.g. "- " or "> ") to every line touched by the selection, or
 * remove it when every touched line already has it.
 */
export function toggleLinePrefix(doc: string, sel: Sel, prefix: string): Edit {
  const blockStart = doc.lastIndexOf("\n", sel.from - 1) + 1;
  const nextNl = doc.indexOf("\n", sel.to);
  const blockEnd = nextNl === -1 ? doc.length : nextNl;

  const lines = doc.slice(blockStart, blockEnd).split("\n");
  const allPrefixed = lines.every((l) => l.startsWith(prefix));
  const newLines = allPrefixed
    ? lines.map((l) => l.slice(prefix.length))
    : lines.map((l) => prefix + l);
  const newBlock = newLines.join("\n");

  const text = doc.slice(0, blockStart) + newBlock + doc.slice(blockEnd);
  return { text, selection: { from: blockStart, to: blockStart + newBlock.length } };
}

/**
 * Turn the selection into a markdown link `[selection](url)` and select the
 * `url` placeholder so the user can type it. With no selection, insert a
 * `[text](url)` template and select `text`.
 */
export function insertLink(doc: string, sel: Sel): Edit {
  const { from, to } = sel;
  const selected = doc.slice(from, to);

  if (selected) {
    const inserted = `[${selected}](url)`;
    const text = doc.slice(0, from) + inserted + doc.slice(to);
    const urlStart = from + selected.length + 3; // "[" + selected + "](" = len + 3
    return { text, selection: { from: urlStart, to: urlStart + 3 } };
  }

  const inserted = "[text](url)";
  const text = doc.slice(0, from) + inserted + doc.slice(from);
  return { text, selection: { from: from + 1, to: from + 5 } };
}
