<script lang="ts">
  import { onMount } from "svelte";
  import { listen } from "@tauri-apps/api/event";
  import { getCurrentWindow } from "@tauri-apps/api/window";
  import { EVENTS } from "$lib/api/events";
  import {
    captureInputReady,
    createNote,
    deleteSetting,
    getNote,
    getSetting,
    hideCapture,
    listNotes,
    openLibrary,
    setSetting,
    updateNote,
  } from "$lib/api/client";
  import type { Note } from "$lib/api/types";
  import { debounce } from "$lib/debounce";
  import { modKey } from "$lib/platform";
  import { theme } from "$lib/stores/theme.svelte";
  import { agreements } from "$lib/agreements.svelte";
  import LicenseLocked from "$lib/components/LicenseLocked.svelte";

  const DRAFT_KEY = "capture.draft";
  const SAVED_HINT_MS = 300;
  const RECENT = 3;

  let text = $state("");
  let saving = $state(false);
  let saved = $state(false);
  let errorMsg = $state<string | null>(null);
  let recent = $state<Note[]>([]);
  let target = $state<Note | null>(null);
  let textarea = $state<HTMLTextAreaElement>();
  let hiding = false;

  const persistDraft = debounce((value: string) => {
    void setSetting(DRAFT_KEY, value);
  }, 300);

  const liveTags = $derived(
    [...text.matchAll(/(?:^|\s)#([\p{L}\p{N}_-]+)/gu)]
      .map((m) => m[1].toLowerCase())
      .filter((t, i, arr) => arr.indexOf(t) === i)
      .slice(0, 6),
  );

  onMount(() => {
    void theme.init();
    void restoreDraft();
    void loadRecent();
    const unlisten = listen(EVENTS.CAPTURE_SHOWN, () => {
      void theme.init();
      void restoreDraft();
      target = null;
      void loadRecent();
      textarea?.focus();
      requestAnimationFrame(() => void captureInputReady());
    });
    const unfocus = getCurrentWindow().onFocusChanged(({ payload: focused }) => {
      if (focused) {
        hiding = false;
        return;
      }
      if (saving || hiding) return;
      void dismiss(false);
    });
    const unlistenQuit = listen(EVENTS.APP_QUIT_REQUESTED, () => {
      persistDraft.flush();
    });
    textarea?.focus();
    return () => {
      void unlisten.then((fn) => fn());
      void unfocus.then((fn) => fn());
      void unlistenQuit.then((fn) => fn());
    };
  });

  async function restoreDraft() {
    try {
      const draft = await getSetting<string>(DRAFT_KEY);
      if (draft && !text) text = draft;
    } catch {
    }
    textarea?.focus();
  }

  async function loadRecent() {
    try {
      const notes = await listNotes({ sortBy: "lastOpenedAt", sortOrder: "desc", bodyChars: 0 });
      recent = notes.filter((n) => n.lastOpenedAt && n.contentKind === "document").slice(0, RECENT);
    } catch {
      recent = [];
    }
  }

  function pick(note: Note | null) {
    target = note;
    textarea?.focus();
  }

  function nextTarget() {
    const at = target ? recent.findIndex((n) => n.id === target?.id) : -1;
    pick(recent[at + 1] ?? null);
  }

  async function addTo(id: string, body: string) {
    const note = await getNote(id);
    await updateNote(id, {
      body: note.body.trim() ? `${note.body.trimEnd()}\n\n${body}` : body,
      expectedUpdatedAt: note.updatedAt,
    });
  }

  function onInput() {
    errorMsg = null;
    persistDraft(text);
  }

  async function save(openLibraryAfter = false) {
    const body = text.trim();
    if (!body) {
      hiding = true;
      if (openLibraryAfter) await openLibrary();
      await dismiss(true);
      return;
    }
    saving = true;
    try {
      if (target) await addTo(target.id, body);
      else await createNote({ body });
      text = "";
      target = null;
      persistDraft.cancel();
      void deleteSetting(DRAFT_KEY);
      saved = true;
      await new Promise<void>((resolve) => setTimeout(resolve, SAVED_HINT_MS));
      if (openLibraryAfter) await openLibrary();
      await hidePanel();
    } catch {
      errorMsg = "Couldn't save — your text is kept here.";
    } finally {
      saving = false;
      saved = false;
    }
  }

  async function hidePanel() {
    hiding = true;
    await hideCapture();
  }

  async function dismiss(clearDraft = false) {
    persistDraft.flush();
    if (clearDraft) {
      persistDraft.cancel();
      void deleteSetting(DRAFT_KEY);
      text = "";
    }
    await hidePanel();
  }

  function onKeydown(e: KeyboardEvent) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      void save(e.metaKey || e.ctrlKey);
    } else if (e.key === "Tab" && !e.shiftKey && recent.length > 0) {
      e.preventDefault();
      nextTarget();
    } else if (e.key === "Escape") {
      e.preventDefault();
      void dismiss(false);
    }
  }
</script>

<div class="panel" data-tauri-drag-region>
  {#if !agreements.done}
    <LicenseLocked />
  {:else}
  <textarea
    bind:this={textarea}
    bind:value={text}
    oninput={onInput}
    onkeydown={onKeydown}
    placeholder={target ? `Add to “${target.title || "Untitled"}”` : "What's on your mind?"}
    aria-label="Quick capture"
    spellcheck="true"
    disabled={saving}
  ></textarea>
  {#if recent.length > 0}
    <div class="targets" role="group" aria-label="Add to a note you had open">
      {#each recent as note (note.id)}
        <button
          class="target"
          aria-pressed={target?.id === note.id}
          onclick={() => pick(target?.id === note.id ? null : note)}
        >
          ↳ {note.title || "Untitled"}
        </button>
      {/each}
      <span class="target-hint"><kbd>tab</kbd></span>
    </div>
  {/if}
  <div class="footer" data-tauri-drag-region>
    <div class="tags">
      {#each liveTags as tag (tag)}
        <span class="chip">#{tag}</span>
      {/each}
    </div>
    <div class="hint">
      {#if errorMsg}
        <span class="error">{errorMsg}</span>
      {:else if saved}
        <span class="saved">Saved</span>
      {:else}
        <span><kbd>↵</kbd> save</span>
        <span><kbd>{modKey}↵</kbd> library</span>
        <span><kbd>⇧↵</kbd> newline</span>
        <span><kbd>esc</kbd> close</span>
      {/if}
    </div>
  </div>
  {/if}
</div>

<style>
  :global(html),
  :global(body) {
    background: transparent;
    overflow: hidden;
  }

  .panel {
    display: flex;
    flex-direction: column;
    height: 100vh;
    background: var(--bg);
    border: 1px solid var(--border);
    border-radius: 12px;
    box-shadow: var(--shadow-lg);
    overflow: hidden;
  }

  textarea {
    flex: 1;
    resize: none;
    border: none;
    outline: none;
    background: transparent;
    padding: 14px 16px 6px;
    font-family: var(--font-body);
    font-size: 15px;
    line-height: 1.45;
    color: var(--text);
    caret-color: var(--accent-text);
  }
  textarea::placeholder {
    color: var(--text-tertiary);
  }

  .targets {
    display: flex;
    align-items: center;
    gap: 5px;
    padding: 0 12px;
    overflow: hidden;
  }
  .target {
    max-width: 160px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    border: 1px dashed var(--border);
    border-radius: 99px;
    padding: 1px 8px;
    font-size: 11px;
    color: var(--text-secondary);
  }
  .target[aria-pressed="true"] {
    border-style: solid;
    border-color: var(--accent);
    background: var(--accent-soft);
    color: var(--text);
  }
  .target-hint {
    flex-shrink: 0;
    color: var(--text-tertiary);
  }
  .footer {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 6px 12px 9px;
    min-height: 28px;
  }

  .tags {
    display: flex;
    gap: 5px;
    overflow: hidden;
  }
  .chip {
    background: var(--accent-soft);
    color: var(--tag);
    border-radius: 99px;
    padding: 1px 8px;
    font-size: 11px;
    font-weight: 500;
    white-space: nowrap;
  }

  .hint {
    display: flex;
    gap: 10px;
    color: var(--text-tertiary);
    font-size: 11px;
    flex-shrink: 0;
    font-family: var(--font-meta);
  }
  kbd {
    background: var(--bg-sidebar);
    border: 1px solid var(--border);
    border-radius: 4px;
    padding: 0 4px;
    font-family: var(--font-meta);
    font-size: 10px;
  }
  .saved {
    color: var(--accent-text);
    font-weight: 500;
  }
  .error {
    color: var(--danger);
  }
</style>
