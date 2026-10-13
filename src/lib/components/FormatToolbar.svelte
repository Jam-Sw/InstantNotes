<script lang="ts">
  import Icon from "$lib/components/Icon.svelte";
  import { editorPrefs } from "$lib/stores/editor.svelte";
  import { modKey, shiftKey } from "$lib/platform";
  import type { FormatKind } from "$lib/markdown-format";
  import type { ActiveMarks } from "$lib/markdown-active";

  let {
    active,
    history = { undo: false, redo: false },
    sourceMode = false,
    onFormat,
    onUndo,
    onRedo,
    onImage,
    onToggleSource,
  }: {
    active: ActiveMarks;
    history?: { undo: boolean; redo: boolean };
    sourceMode?: boolean;
    onFormat: (k: FormatKind) => void;
    onUndo?: () => void;
    onRedo?: () => void;
    onImage?: () => void;
    onToggleSource?: () => void;
  } = $props();

  const headingTitle = $derived(
    active.heading === 0
      ? "Heading"
      : active.heading >= 3
        ? "Heading 3 (click for plain text)"
        : `Heading ${active.heading} (click for heading ${active.heading + 1})`,
  );
</script>

<div class="format-bar" role="toolbar" aria-label="Formatting">
  <div class="fmt-group">
    <button
      class="fmt"
      title={`Undo (${modKey}Z)`}
      aria-label="Undo"
      disabled={!history.undo}
      onclick={() => onUndo?.()}
    >
      <Icon name="undo" />
    </button>
    <button
      class="fmt"
      title={`Redo (${modKey}${shiftKey}Z)`}
      aria-label="Redo"
      disabled={!history.redo}
      onclick={() => onRedo?.()}
    >
      <Icon name="redo" />
    </button>
  </div>
  <div class="fmt-group">
    <button
      class="fmt"
      title={headingTitle}
      aria-label="Heading"
      aria-pressed={active.heading > 0}
      onclick={() => onFormat("heading")}
    >
      <Icon name="heading" />
    </button>
    <button
      class="fmt"
      title={`Bold (${modKey}B)`}
      aria-label="Bold"
      aria-pressed={active.bold}
      onclick={() => onFormat("bold")}
    >
      <Icon name="bold" />
    </button>
    <button
      class="fmt"
      title={`Italic (${modKey}I)`}
      aria-label="Italic"
      aria-pressed={active.italic}
      onclick={() => onFormat("italic")}
    >
      <Icon name="italic" />
    </button>
    <button
      class="fmt"
      title="Strikethrough"
      aria-label="Strikethrough"
      aria-pressed={active.strike}
      onclick={() => onFormat("strike")}
    >
      <Icon name="strike" />
    </button>
    <button
      class="fmt"
      title={`Code (${modKey}E)`}
      aria-label="Code"
      aria-pressed={active.code}
      onclick={() => onFormat("code")}
    >
      <Icon name="code" />
    </button>
  </div>
  <div class="fmt-group">
    <button
      class="fmt"
      title="Blockquote"
      aria-label="Blockquote"
      aria-pressed={active.quote}
      onclick={() => onFormat("quote")}
    >
      <Icon name="quote" />
    </button>
    <button
      class="fmt"
      title="Bulleted list"
      aria-label="Bulleted list"
      aria-pressed={active.list}
      onclick={() => onFormat("list")}
    >
      <Icon name="list" />
    </button>
    <button
      class="fmt"
      title="Task list"
      aria-label="Task list"
      aria-pressed={active.task}
      onclick={() => onFormat("task")}
    >
      <Icon name="task" />
    </button>
    <button
      class="fmt"
      title={`Link (${modKey}${shiftKey}K)`}
      aria-label="Link"
      onclick={() => onFormat("link")}
    >
      <Icon name="link" />
    </button>
    {#if onImage}
      <button class="fmt" title="Insert image from a file" aria-label="Insert image" onclick={() => onImage?.()}>
        <Icon name="image" />
      </button>
    {/if}
  </div>
  {#if onToggleSource}
    <div class="fmt-group">
      <button
        class="fmt"
        title={sourceMode ? "Hide Markdown source" : "Show Markdown source"}
        aria-label="Markdown source"
        aria-pressed={sourceMode}
        onclick={() => onToggleSource?.()}
      >
        <Icon name="markdown" />
      </button>
    </div>
  {/if}
  <div class="fmt-group zoom-group">
    <button class="fmt zoom-step" title={`Zoom out (${modKey}−)`} aria-label="Zoom out" onclick={() => editorPrefs.zoomOut()}>A−</button>
    <button class="fmt zoom-reset" title={`Reset zoom (${modKey}0)`} aria-label="Reset zoom" onclick={() => editorPrefs.resetZoom()}>
      {Math.round(editorPrefs.zoom * 100)}%
    </button>
    <button class="fmt zoom-step" title={`Zoom in (${modKey}+)`} aria-label="Zoom in" onclick={() => editorPrefs.zoomIn()}>A+</button>
  </div>
</div>

<style>
  .format-bar {
    display: flex;
    align-items: center;
    gap: 2px;
    height: 36px;
    padding: 0 12px;
    background: var(--bg);
    border-bottom: 1px solid var(--border);
    font-family: var(--font-ui);
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
  .fmt-group.zoom-group {
    margin-left: auto;
    padding-left: 0;
    border-left: none;
  }
  .fmt {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 28px;
    height: 28px;
    border-radius: 6px;
    color: var(--text-secondary);
    font-size: 13px;
  }
  .fmt:hover:not(:disabled) {
    background: var(--bg-hover);
    color: var(--text);
  }
  .fmt:disabled {
    opacity: 0.35;
    cursor: default;
  }
  .fmt[aria-pressed="true"] {
    background: var(--accent);
    color: var(--bg);
  }
  .fmt.zoom-step {
    font-size: 13px;
  }
  .fmt.zoom-reset {
    width: auto;
    min-width: 44px;
    padding: 0 6px;
    font-family: var(--font-meta);
    font-size: 11.5px;
    color: var(--text-tertiary);
  }
</style>
