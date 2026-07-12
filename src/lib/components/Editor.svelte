<script lang="ts">
  // CodeMirror 6 wrapper. CM6 owns its DOM — Svelte never renders inside the
  // container. One-way discipline: external `value` changes dispatch into CM6
  // (guarded against feedback); user edits flow out through `onchange`.
  //
  // All markdown preview/interaction behavior lives in the editor kernel
  // (src/lib/editor, see its ARCHITECTURE.md). This component only wires the
  // kernel to the app: Rust APIs in, settings effects in, edits out.
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
  // Built once and reused for every note load, so each note gets a fresh state
  // (clean selection, its own undo history) with identical behavior.
  let extensions: Extension[] = [];
  // Absolute attachments dir, cached once it arrives from Rust so each note
  // load can re-seed it after setState resets the field.
  let attachmentsBase: string | null = null;

  onMount(() => {
    extensions = [
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
          // The kernel sits ABOVE defaultKeymap on purpose: it owns Backspace
          // (block markers delete as whole objects) and Enter (lists, quotes,
          // and tasks continue onto the next line).
          editorKernel({
            // Opening goes through Rust (open_url) since the webview has no
            // opener capability of its own.
            openUrl: (url) => void openUrl(url),
            // Paste/drop an image → stored attachment + markdown reference;
            // rendered inline in preview once the base dir arrives below.
            saveImage: saveAttachment,
            onImageError: (m) => toasts.show(`Couldn't save image. ${m}`),
          }),
          keymap.of([...defaultKeymap, ...historyKeymap]),
          // GFM base so ~~strikethrough~~ parses (the highlight + active-state
          // detection both rely on Strikethrough nodes existing). Fenced code
          // gets per-language highlighting; ==highlight== is our own inline
          // extension.
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
            // Keep the toolbar's active states in sync with what the caret or
            // selection sits inside.
            if (u.docChanged || u.selectionSet) {
              onactive?.(activeMarks(u.state));
            }
          }),
    ];
    view = new EditorView({
      state: EditorState.create({ doc: value, selection: { anchor: 0 }, extensions }),
      parent: container,
    });
    // Seed the toolbar before the first edit or selection change.
    onactive?.(activeMarks(view.state));
    // Attachment images can only resolve once Rust reports where they live;
    // until then they render as markdown text, then swap in. Cache the dir so
    // each later note load can re-seed it after setState resets the field.
    void getAttachmentsDir()
      .then((dir) => {
        attachmentsBase = dir;
        view?.dispatch({ effects: setAttachmentsBase.of(dir) });
      })
      .catch(() => {});
    return () => view?.destroy();
  });

  // setState resets every state field to its default, so re-apply the dynamic
  // ones (preview mode, link prefs, attachments base) whenever a note loads.
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

  // Load a note's body with a CLEAN state: a fresh selection at the top and its
  // own undo history. This is the fix for the stray caret that used to linger
  // in notes being switched between, and it stops an undo from reaching back
  // into the previously open note. Linked (absolute-path) images are permitted
  // into the asset scope before the state renders so they load on first paint.
  async function loadDoc(next: string): Promise<void> {
    // Guard edit echoes to the OUTGOING note across the (possible) async gap
    // while linked images are permitted, and across the state swap itself.
    applyingExternal = true;
    try {
      const linked = linkedImagePaths(next);
      if (linked.length > 0) {
        await Promise.all(linked.map((p) => allowImageFile(p).catch(() => {})));
        // A newer note may have been requested while we awaited; let its own
        // effect run apply it instead of clobbering with a stale body.
        if (value !== next) return;
      }
      if (!view) return;
      view.setState(
        EditorState.create({ doc: next, selection: { anchor: 0 }, extensions }),
      );
      view.dispatch({ effects: seedEffects() });
      onactive?.(activeMarks(view.state));
    } finally {
      applyingExternal = false;
    }
  }

  $effect(() => {
    // Sync external value changes (note switching) into the editor by loading
    // a clean state for the new body.
    const next = value;
    if (view && next !== view.state.doc.toString()) {
      void loadDoc(next);
    }
  });

  $effect(() => {
    // Sync preview mode into CM6 whenever the Aa toolbar toggles.
    const mode = previewMode;
    if (view) {
      view.dispatch({ effects: setPreviewMode.of(mode) });
    }
  });

  $effect(() => {
    // Sync link preferences into CM6; reading the snapshot registers all four
    // fields as dependencies so Settings changes apply to open notes live.
    const snap = linkPrefs.snapshot();
    if (view) {
      view.dispatch({ effects: setLinkPrefs.of(snap) });
    }
  });

  export function focus() {
    view?.focus();
  }

  // Insert text at the current selection (replacing it), then focus. Flows out
  // through onchange like any edit, so it auto-saves and is undoable. Used by
  // the "Insert image..." action for a dialog-picked file.
  export function insertText(text: string) {
    if (!view) return;
    const { from, to } = view.state.selection.main;
    view.dispatch({
      changes: { from, to, insert: text },
      selection: { anchor: from + text.length },
    });
    view.focus();
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
