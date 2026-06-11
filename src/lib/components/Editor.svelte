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

  let {
    value = "",
    placeholder = "",
    onchange,
  }: {
    value?: string;
    placeholder?: string;
    onchange?: (v: string) => void;
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
          keymap.of([...defaultKeymap, ...historyKeymap]),
          EditorView.lineWrapping,
          cmPlaceholder(placeholder),
          tagHighlighter,
          EditorView.updateListener.of((u) => {
            if (u.docChanged && !applyingExternal) {
              onchange?.(u.state.doc.toString());
            }
          }),
        ],
      }),
      parent: container,
    });
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

  export function focus() {
    view?.focus();
  }
</script>

<div class="editor-container" bind:this={container}></div>

<style>
  .editor-container {
    height: 100%;
    overflow: auto;
  }
</style>
