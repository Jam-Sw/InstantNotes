<script lang="ts">
  // Capture panel: the product promise. Bare textarea on the latency-critical
  // path — no editor framework here. ↵ saves & dismisses, ⇧↵ newline,
  // Esc dismisses preserving the draft (CAP-011).
  import { onMount } from "svelte";
  import { listen } from "@tauri-apps/api/event";
  import { getCurrentWindow } from "@tauri-apps/api/window";
  import {
    captureInputReady,
    createNote,
    deleteSetting,
    getSetting,
    hideCapture,
    openLibrary,
    setSetting,
  } from "$lib/api/client";
  import { debounce } from "$lib/debounce";
  import { modKey } from "$lib/platform";
  import { theme } from "$lib/stores/theme.svelte";

  const DRAFT_KEY = "capture.draft";
  // One visible beat of "Saved" before the panel hides, so success reads as more
  // than the window merely closing. Small on purpose so it adds no real latency.
  const SAVED_HINT_MS = 300;

  let text = $state("");
  let saving = $state(false);
  let saved = $state(false);
  let errorMsg = $state<string | null>(null);
  let textarea: HTMLTextAreaElement;
  // Set while we hide the panel ourselves so the blur that hiding triggers does
  // not fire a second dismiss; cleared when focus returns on the next reveal.
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
    const unlisten = listen("capture:shown", () => {
      // Re-read the theme: it may have changed in the library while hidden.
      void theme.init();
      void restoreDraft();
      textarea?.focus();
      // After the next paint the textarea is genuinely accepting input;
      // report it so the shell can close this reveal's latency sample.
      requestAnimationFrame(() => void captureInputReady());
    });
    // Dismiss on outside click like Spotlight/Raycast/Things: this panel is
    // always-on-top on every Space, so a click elsewhere would otherwise strand
    // a floating window. dismiss(false) persists the draft, making this safe.
    const unfocus = getCurrentWindow().onFocusChanged(({ payload: focused }) => {
      if (focused) {
        hiding = false;
        return;
      }
      // Never dismiss mid-save, nor react to the blur our own hide just caused.
      if (saving || hiding) return;
      void dismiss(false);
    });
    // Quit handshake: push a debounced draft write through before the process
    // exits, so the draft is not 300ms stale on the next launch. Only the
    // library window answers with quit_app.
    const unlistenQuit = listen("app:quit-requested", () => {
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
      // Draft restore is best-effort; capture must never block on it.
    }
    textarea?.focus();
  }

  function onInput() {
    errorMsg = null;
    persistDraft(text);
  }

  async function save(openLibraryAfter = false) {
    const body = text.trim();
    if (!body) {
      // Nothing to save; still honor the shortcut's intent to reveal the library.
      // Mark the hide first: the library stealing focus fires a blur that would
      // otherwise run a second, concurrent dismiss.
      hiding = true;
      if (openLibraryAfter) await openLibrary();
      await dismiss(true);
      return;
    }
    saving = true;
    try {
      await createNote({ body });
      text = "";
      persistDraft.cancel();
      void deleteSetting(DRAFT_KEY);
      // Hold "Saved" for one beat; the textarea stays disabled via `saving`.
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

  // Hide the panel ourselves, marking the hide so the blur it triggers is ignored.
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
      // Cmd/Ctrl+Enter also opens the library after saving (ctrl for win/linux parity).
      void save(e.metaKey || e.ctrlKey);
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
