<script lang="ts">
  import { onMount } from "svelte";
  import { EditorView, keymap, placeholder as cmPlaceholder } from "@codemirror/view";
  import { EditorState, type Extension, type StateEffect } from "@codemirror/state";
  import { history, defaultKeymap, historyKeymap } from "@codemirror/commands";
  import { markdown, markdownLanguage } from "@codemirror/lang-markdown";
  import { languages } from "@codemirror/language-data";
  import { syntaxHighlighting } from "@codemirror/language";
  import { highlightExtension } from "$lib/markdown-extensions";
  import { markdownHighlight } from "$lib/markdown-highlight";
  import { formatEdit, type FormatKind, type Sel } from "$lib/markdown-format";
  import { activeMarks, type ActiveMarks } from "$lib/markdown-active";
  import {
    editorKernel,
    setPreviewMode,
    setLinkPrefs,
    setAttachmentsBase,
    linkedImagePaths,
  } from "$lib/editor";
  import { linkPrefs } from "$lib/stores/links.svelte";
  import { listIndentChanges } from "$lib/list-indent";
  import {
    getAttachmentsDir,
    openUrl,
    saveAttachment,
    allowImageFile,
  } from "$lib/api/client";
  import { toasts } from "$lib/stores/toasts.svelte";
  import { applyExternalEdit, externalEdit, minimalChange } from "$lib/external-edit";

  let {
    value = "",
    docKey,
    placeholder = "",
    previewMode = false,
    onchange,
    onactive,
  }: {
    value?: string;
    docKey?: string;
    placeholder?: string;
    previewMode?: boolean;
    onchange?: (v: string) => void;
    onactive?: (marks: ActiveMarks) => void;
  } = $props();

  let container: HTMLDivElement;
  let view: EditorView | undefined;
  let applyingExternal = false;
  let loadedKey: string | undefined;
  let extensions: Extension[] = [];
  let attachmentsBase: string | null = null;

  onMount(() => {
    extensions = [
          history(),
          externalEdit,
          keymap.of([
            { key: "Mod-b", run: () => { applyFormat("bold"); return true; } },
            { key: "Mod-i", run: () => { applyFormat("italic"); return true; } },
            { key: "Mod-e", run: () => { applyFormat("code"); return true; } },
            { key: "Mod-Shift-k", run: () => { applyFormat("link"); return true; } },
          ]),
          keymap.of([
            { key: "Tab", run: (v) => applyListIndent(v, false) },
            { key: "Shift-Tab", run: (v) => applyListIndent(v, true) },
          ]),
          editorKernel({
            openUrl: (url) => void openUrl(url),
            saveImage: saveAttachment,
            onImageError: (m) => toasts.show(`Couldn't save image. ${m}`),
          }),
          keymap.of([...defaultKeymap, ...historyKeymap]),
          markdown({
            base: markdownLanguage,
            codeLanguages: languages,
            extensions: [highlightExtension],
          }),
          syntaxHighlighting(markdownHighlight),
          EditorView.lineWrapping,
          cmPlaceholder(placeholder),
          EditorView.updateListener.of((u) => {
            if (u.docChanged && !applyingExternal) {
              onchange?.(u.state.doc.toString());
            }
            if (u.docChanged || u.selectionSet) {
              onactive?.(activeMarks(u.state));
            }
          }),
    ];
    view = new EditorView({
      state: EditorState.create({ doc: value, selection: { anchor: 0 }, extensions }),
      parent: container,
    });
    loadedKey = docKey;
    onactive?.(activeMarks(view.state));
    void getAttachmentsDir()
      .then((dir) => {
        attachmentsBase = dir;
        view?.dispatch({ effects: setAttachmentsBase.of(dir) });
      })
      .catch(() => {});
    return () => view?.destroy();
  });

  function seedEffects(): StateEffect<unknown>[] {
    const effects: StateEffect<unknown>[] = [
      setPreviewMode.of(previewMode),
      setLinkPrefs.of(linkPrefs.snapshot()),
    ];
    if (attachmentsBase !== null) {
      effects.push(setAttachmentsBase.of(attachmentsBase));
    }
    return effects;
  }

  async function loadDoc(next: string, key: string | undefined): Promise<void> {
    applyingExternal = true;
    try {
      const linked = linkedImagePaths(next);
      if (linked.length > 0) {
        await Promise.all(linked.map((p) => allowImageFile(p).catch(() => {})));
        if (value !== next) return;
      }
      if (!view) return;
      view.setState(
        EditorState.create({ doc: next, selection: { anchor: 0 }, extensions }),
      );
      loadedKey = key;
      view.dispatch({ effects: seedEffects() });
      onactive?.(activeMarks(view.state));
    } finally {
      applyingExternal = false;
    }
  }

  $effect(() => {
    const next = value;
    const key = docKey;
    if (!view) return;
    const changed = next !== view.state.doc.toString();
    if (key !== undefined && key === loadedKey) {
      if (!changed) return;
      applyingExternal = true;
      try {
        applyExternalEdit(view, next);
      } finally {
        applyingExternal = false;
      }
    } else if (changed || key !== loadedKey) {
      void loadDoc(next, key);
    }
  });

  $effect(() => {
    const mode = previewMode;
    if (view) {
      view.dispatch({ effects: setPreviewMode.of(mode) });
    }
  });

  $effect(() => {
    const snap = linkPrefs.snapshot();
    if (view) {
      view.dispatch({ effects: setLinkPrefs.of(snap) });
    }
  });

  export function focus() {
    view?.focus();
  }

  export function insertText(text: string) {
    if (!view) return;
    const { from, to } = view.state.selection.main;
    view.dispatch({
      changes: { from, to, insert: text },
      selection: { anchor: from + text.length },
    });
    view.focus();
  }

  export function applyFormat(kind: FormatKind) {
    if (!view) return;
    const main = view.state.selection.main;
    const sel: Sel = { from: main.from, to: main.to };
    const before = view.state.doc.toString();
    const edit = formatEdit(before, sel, kind);
    view.dispatch({
      changes: minimalChange(before, edit.text) ?? [],
      selection: { anchor: edit.selection.from, head: edit.selection.to },
    });
    view.focus();
  }

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
