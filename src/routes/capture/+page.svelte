<script lang="ts">
  // Capture panel: the product promise. Bare textarea on the latency-critical
  // path — no editor framework here. ↵ saves & dismisses, ⇧↵ newline,
  // Esc dismisses preserving the draft (CAP-011).
  import { onMount } from "svelte";
  import { listen } from "@tauri-apps/api/event";
  import {
    createNote,
    deleteSetting,
    getSetting,
    hideCapture,
    setSetting,
  } from "$lib/api/client";
  import { debounce } from "$lib/debounce";
  import { theme } from "$lib/stores/theme.svelte";

  const DRAFT_KEY = "capture.draft";

  let text = $state("");
  let saving = $state(false);
  let errorMsg = $state<string | null>(null);
  let textarea: HTMLTextAreaElement;

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
    const unlisten = listen("capture:shown", () => {
      // Re-read the theme: it may have changed in the library while hidden.
      void theme.init();
      void restoreDraft();
      textarea?.focus();
    });
    textarea?.focus();
    return () => {
      void unlisten.then((fn) => fn());
    };
  });

  async function restoreDraft() {
    try {
      const draft = await getSetting<string>(DRAFT_KEY);
      if (draft && !text) text = draft;
    } catch {
      // Draft restore is best-effort; capture must never block on it.
    }
    textarea?.focus();
  }

  function onInput() {
    errorMsg = null;
    persistDraft(text);
  }

  async function save() {
    const body = text.trim();
    if (!body) {
      await dismiss(true);
      return;
    }
    saving = true;
    try {
      await createNote({ body });
      text = "";
      persistDraft.cancel();
      void deleteSetting(DRAFT_KEY);
      await hideCapture();
    } catch {
      errorMsg = "Couldn't save — your text is kept here.";
    } finally {
      saving = false;
    }
  }

  async function dismiss(clearDraft = false) {
    persistDraft.flush();
    if (clearDraft) {
      persistDraft.cancel();
      void deleteSetting(DRAFT_KEY);
      text = "";
    }
    await hideCapture();
  }

  function onKeydown(e: KeyboardEvent) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      void save();
    } else if (e.key === "Escape") {
      e.preventDefault();
      void dismiss(false);
    }
  }
</script>

<div class="panel" data-tauri-drag-region>
  <textarea
    bind:this={textarea}
    bind:value={text}
    oninput={onInput}
    onkeydown={onKeydown}
    placeholder="What's on your mind?"
    aria-label="Quick capture"
    spellcheck="true"
    disabled={saving}
  ></textarea>
  <div class="footer" data-tauri-drag-region>
    <div class="tags">
      {#each liveTags as tag (tag)}
        <span class="chip">#{tag}</span>
      {/each}
    </div>
    <div class="hint">
      {#if errorMsg}
        <span class="error">{errorMsg}</span>
      {:else}
        <span><kbd>↵</kbd> save</span>
        <span><kbd>⇧↵</kbd> newline</span>
        <span><kbd>esc</kbd> close</span>
      {/if}
    </div>
  </div>
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
    box-shadow: 0 18px 50px rgba(0, 0, 0, 0.3);
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
  .error {
    color: var(--danger);
  }
</style>
