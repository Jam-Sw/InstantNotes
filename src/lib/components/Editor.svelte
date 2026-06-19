<script lang="ts">
  // CodeMirror 6 wrapper. CM6 owns its DOM — Svelte never renders inside the
  // container. One-way discipline: external `value` changes dispatch into CM6
  // (guarded against feedback); user edits flow out through `onchange`.
  import { onMount } from "svelte";
  import {
    EditorView,
    keymap,
    placeholder as cmPlaceholder,
    ViewPlugin,
    Decoration,
    type DecorationSet,
    type ViewUpdate,
  } from "@codemirror/view";
  import { EditorState, RangeSetBuilder } from "@codemirror/state";
  import { history, defaultKeymap, historyKeymap } from "@codemirror/commands";
  import { markdown, markdownLanguage } from "@codemirror/lang-markdown";
  import { syntaxHighlighting } from "@codemirror/language";
  import { markdownHighlight } from "$lib/markdown-highlight";
  import { formatEdit, type FormatKind, type Sel } from "$lib/markdown-format";
  import { activeMarks, type ActiveMarks } from "$lib/markdown-active";
  import { wysiwygExtension, wysiwygTheme, setPreviewMode } from "$lib/wysiwyg";
  import { listIndentChanges } from "$lib/list-indent";

  let {
    value = "",
    placeholder = "",
    previewMode = false,
    onchange,
    onactive,
  }: {
    value?: string;
    placeholder?: string;
    previewMode?: boolean;
    onchange?: (v: string) => void;
    onactive?: (marks: ActiveMarks) => void;
  } = $props();

  let container: HTMLDivElement;
  let view: EditorView | undefined;
  let applyingExternal = false;

  const tagMark = Decoration.mark({ class: "cm-tag" });
  const TAG_RE = /(^|\s)(#[\p{L}\p{N}_-]+)/gu;

  function buildTagDecorations(v: EditorView): DecorationSet {
    const builder = new RangeSetBuilder<Decoration>();
    for (const { from, to } of v.visibleRanges) {
      const text = v.state.doc.sliceString(from, to);
      TAG_RE.lastIndex = 0;
      let m: RegExpExecArray | null;
      while ((m = TAG_RE.exec(text))) {
        const start = from + m.index + m[1].length;
        builder.add(start, start + m[2].length, tagMark);
      }
    }
    return builder.finish();
  }

  const tagHighlighter = ViewPlugin.fromClass(
    class {
      decorations: DecorationSet;
      constructor(v: EditorView) {
        this.decorations = buildTagDecorations(v);
      }
      update(u: ViewUpdate) {
        if (u.docChanged || u.viewportChanged) {
          this.decorations = buildTagDecorations(u.view);
        }
      }
    },
    { decorations: (v) => v.decorations },
  );

  onMount(() => {
    view = new EditorView({
      state: EditorState.create({
        doc: value,
        extensions: [
          history(),
          // Formatting shortcuts take precedence over the defaults. Cmd-K is the
          // command palette (handled at the window level), so link uses Cmd-Shift-K.
          keymap.of([
            { key: "Mod-b", run: () => { applyFormat("bold"); return true; } },
            { key: "Mod-i", run: () => { applyFormat("italic"); return true; } },
            { key: "Mod-e", run: () => { applyFormat("code"); return true; } },
            { key: "Mod-Shift-k", run: () => { applyFormat("link"); return true; } },
          ]),
          // Tab nests a list item (and Shift-Tab un-nests it). On a non-list line
          // both return false so the default Tab handling is untouched.
          keymap.of([
            { key: "Tab", run: (v) => applyListIndent(v, false) },
            { key: "Shift-Tab", run: (v) => applyListIndent(v, true) },
          ]),
          keymap.of([...defaultKeymap, ...historyKeymap]),
          // GFM base so ~~strikethrough~~ parses (the highlight + active-state
          // detection both rely on Strikethrough nodes existing).
          markdown({ base: markdownLanguage }),
          syntaxHighlighting(markdownHighlight),
          EditorView.lineWrapping,
          cmPlaceholder(placeholder),
          tagHighlighter,
          ...wysiwygExtension(),
          wysiwygTheme,
          EditorView.updateListener.of((u) => {
            if (u.docChanged && !applyingExternal) {
              onchange?.(u.state.doc.toString());
            }
            // Keep the toolbar's active states in sync with what the caret or
            // selection sits inside.
            if (u.docChanged || u.selectionSet) {
              onactive?.(activeMarks(u.state));
            }
          }),
        ],
      }),
      parent: container,
    });
    // Seed the toolbar before the first edit or selection change.
    onactive?.(activeMarks(view.state));
    return () => view?.destroy();
  });

  $effect(() => {
    // Sync external value changes (note switching) into the editor.
    const next = value;
    if (view && next !== view.state.doc.toString()) {
      applyingExternal = true;
      view.dispatch({
        changes: { from: 0, to: view.state.doc.length, insert: next },
      });
      applyingExternal = false;
    }
  });

  $effect(() => {
    // Sync preview mode into CM6 whenever the Aa toolbar toggles.
    const mode = previewMode;
    if (view) {
      view.dispatch({ effects: setPreviewMode.of(mode) });
    }
  });

  export function focus() {
    view?.focus();
  }

  // Apply a formatting action to the current selection. Flows out through
  // onchange like any user edit, so it stays undoable and auto-saved.
  export function applyFormat(kind: FormatKind) {
    if (!view) return;
    const main = view.state.selection.main;
    const sel: Sel = { from: main.from, to: main.to };
    const edit = formatEdit(view.state.doc.toString(), sel, kind);
    view.dispatch({
      changes: { from: 0, to: view.state.doc.length, insert: edit.text },
      selection: { anchor: edit.selection.from, head: edit.selection.to },
    });
    view.focus();
  }

  // Nest (outdent = false) or un-nest (outdent = true) the list lines the
  // selection touches. Returns false when nothing is an indentable list line so
  // CodeMirror falls back to its default Tab handling. CM remaps the selection
  // through the line-anchored changes, so the caret stays with its text.
  function applyListIndent(v: EditorView, outdent: boolean): boolean {
    const { from, to } = v.state.selection.main;
    const changes = listIndentChanges(v.state.doc.toString(), from, to, outdent);
    if (changes.length === 0) return false;
    v.dispatch({ changes, scrollIntoView: true });
    return true;
  }
</script>

<div class="editor-container" bind:this={container}></div>

<style>
  .editor-container {
    height: 100%;
    overflow: auto;
  }
</style>
