<script lang="ts">
  import { editorPrefs } from "$lib/stores/editor.svelte";
  import type { FormatKind } from "$lib/markdown-format";
  import type { ActiveMarks } from "$lib/markdown-active";

  let { active, onFormat }: { active: ActiveMarks; onFormat: (k: FormatKind) => void } =
    $props();
</script>

<div class="format-bar">
  <div class="fmt-group">
    <button
      class="fmt"
      title="Bold (⌘B)"
      aria-label="Bold"
      aria-pressed={active.bold}
      onclick={() => onFormat("bold")}
    ><span class="fmt-b">B</span></button>
    <button
      class="fmt"
      title="Italic (⌘I)"
      aria-label="Italic"
      aria-pressed={active.italic}
      onclick={() => onFormat("italic")}
    ><span class="fmt-i">I</span></button>
    <button
      class="fmt"
      title="Strikethrough"
      aria-label="Strikethrough"
      aria-pressed={active.strike}
      onclick={() => onFormat("strike")}
    ><span class="fmt-s">S</span></button>
  </div>
  <div class="fmt-group">
    <button
      class="fmt"
      title="Code (⌘E)"
      aria-label="Code"
      aria-pressed={active.code}
      onclick={() => onFormat("code")}
    >
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 8l-4 4 4 4" /><path d="M15 8l4 4-4 4" /></svg>
    </button>
    <button
      class="fmt"
      title="Blockquote"
      aria-label="Blockquote"
      aria-pressed={active.quote}
      onclick={() => onFormat("quote")}
    >
      <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M7 7h4v5c0 2.2-1.4 3.6-3.6 4l-.4-1.2c1.2-.3 1.9-1 2-2H7V7zm7 0h4v5c0 2.2-1.4 3.6-3.6 4l-.4-1.2c1.2-.3 1.9-1 2-2H14V7z" /></svg>
    </button>
    <button
      class="fmt"
      title="Bulleted list"
      aria-label="Bulleted list"
      aria-pressed={active.list}
      onclick={() => onFormat("list")}
    >
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="5" cy="7" r="1.4" fill="currentColor" stroke="none" /><circle cx="5" cy="13" r="1.4" fill="currentColor" stroke="none" /><path d="M10 7h9" /><path d="M10 13h9" /></svg>
    </button>
    <button
      class="fmt"
      title="Link (⌘⇧K)"
      aria-label="Link"
      onclick={() => onFormat("link")}
    >
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9.5 13.5a3.5 3.5 0 0 0 5 0l2.5-2.5a3.5 3.5 0 0 0-5-5l-1 1" /><path d="M14.5 10.5a3.5 3.5 0 0 0-5 0L7 13a3.5 3.5 0 0 0 5 5l1-1" /></svg>
    </button>
  </div>
  <div class="fmt-group zoom-group">
    <button class="fmt zoom-step" title="Zoom out (⌘−)" onclick={() => editorPrefs.zoomOut()}>A−</button>
    <button class="fmt zoom-reset" title="Reset zoom (⌘0)" onclick={() => editorPrefs.resetZoom()}>
      {Math.round(editorPrefs.zoom * 100)}%
    </button>
    <button class="fmt zoom-step" title="Zoom in (⌘+)" onclick={() => editorPrefs.zoomIn()}>A+</button>
  </div>
</div>

<style>
  /* format toolbar (toggled by the Aa action) - grouped: text styles ·
     blocks & insert · zoom. Monochrome icons inherit the button color, so the
     accent only shows on the active (applied) mark. */
  .format-bar {
    display: flex;
    align-items: center;
    gap: 2px;
    padding: 7px 16px;
    background: var(--bg-sidebar);
    border-bottom: 1px solid var(--border);
  }
  .fmt-group {
    display: flex;
    align-items: center;
    gap: 2px;
  }
  .fmt-group + .fmt-group {
    margin-left: 6px;
    padding-left: 6px;
    border-left: 1px solid var(--border);
  }
  /* Zoom sits at the far right; the auto margin replaces a divider. */
  .fmt-group.zoom-group {
    margin-left: auto;
    padding-left: 0;
    border-left: none;
  }
  .fmt {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 30px;
    height: 26px;
    border-radius: 7px;
    border: 1px solid transparent;
    color: var(--text-secondary);
    font-size: 13px;
  }
  .fmt:hover {
    background: var(--bg-hover);
    color: var(--text);
  }
  /* Active = the mark under the caret is applied. */
  .fmt[aria-pressed="true"] {
    background: var(--accent-soft);
    color: var(--accent-text);
    border-color: var(--accent);
  }
  .fmt-b {
    font-weight: 700;
  }
  .fmt-i {
    font-style: italic;
    font-weight: 600;
  }
  .fmt-s {
    text-decoration: line-through;
    font-weight: 600;
  }
  .fmt.zoom-step {
    font-size: 14px;
  }
  .fmt.zoom-reset {
    width: auto;
    min-width: 46px;
    padding: 0 8px;
    font-family: var(--font-meta);
    font-size: 11.5px;
    color: var(--text-tertiary);
  }
</style>
