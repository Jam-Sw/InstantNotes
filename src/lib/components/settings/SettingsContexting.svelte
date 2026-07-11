<script lang="ts">
  import { onMount } from "svelte";
  import { modKey } from "$lib/platform";
  import { contexting } from "$lib/stores/contexting.svelte";
  import { renderTemplate, TEMPLATE_VARS } from "$lib/contexting-format";
  import { library } from "$lib/stores/library.svelte";
  import type { Note, Tag } from "$lib/api/types";

  onMount(() => void contexting.init());

  // Live preview for the copy template, using the open note or a sample stand-in.
  const SAMPLE_NOTE: Pick<Note, "title" | "body" | "updatedAt"> = {
    title: "Sample note",
    body: "The quick brown fox.",
    updatedAt: new Date().toISOString(),
  };
  const SAMPLE_TAGS: Pick<Tag, "name">[] = [{ name: "example" }];

  const preview = $derived.by(() => {
    const note = library.selected;
    const tags = note ? library.selectedTags : SAMPLE_TAGS;
    return renderTemplate(contexting.copyTemplate, note ?? SAMPLE_NOTE, tags);
  });
</script>

<div class="contexting-pane">
  <h2>Contexting</h2>
  <p class="section-hint">
    The template behind "Copy note as context" in the {modKey}K palette. Wrap the note
    however a tool or model expects; this is the seed for InstantNotes' AI features.
  </p>

  <label class="field-label" for="ctx-template">Template</label>
  <textarea
    id="ctx-template"
    class="ctx-textarea"
    spellcheck="false"
    value={contexting.copyTemplate}
    oninput={(e) => contexting.setTemplate(e.currentTarget.value)}
  ></textarea>

  <div class="ctx-vars">
    {#each TEMPLATE_VARS as v}
      <code class="ctx-var">{v}</code>
    {/each}
  </div>

  <span class="field-label">Preview</span>
  <pre class="ctx-preview">{preview}</pre>
</div>

<style>
  .contexting-pane {
    max-width: 560px;
  }
  .contexting-pane h2 {
    font-size: 18px;
    font-weight: 600;
    color: var(--text);
    margin: 0 0 4px;
  }
  .section-hint {
    color: var(--text-secondary);
    font-size: 13px;
    margin: 0 0 20px;
  }
  .field-label {
    display: block;
    margin: 16px 0 6px;
    font-size: 11px;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.4px;
    color: var(--text-tertiary);
    font-family: var(--font-meta);
  }
  .ctx-textarea {
    width: 100%;
    min-height: 120px;
    resize: vertical;
    padding: 10px 12px;
    border: 1px solid var(--border);
    border-radius: var(--radius);
    background: var(--bg-input);
    color: var(--text);
    font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
    font-size: 13px;
    line-height: 1.5;
  }
  .ctx-textarea:focus {
    outline: none;
    border-color: var(--accent);
  }
  .ctx-vars {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
    margin-top: 8px;
  }
  .ctx-var {
    padding: 2px 6px;
    border-radius: 4px;
    background: var(--bg-active);
    color: var(--text-secondary);
    font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
    font-size: 11px;
  }
  .ctx-preview {
    margin: 0;
    max-height: 200px;
    overflow: auto;
    padding: 10px 12px;
    border: 1px solid var(--border);
    border-radius: var(--radius);
    background: var(--bg-sidebar);
    color: var(--text-secondary);
    white-space: pre-wrap;
    word-break: break-word;
    font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
    font-size: 12px;
    line-height: 1.5;
  }
</style>
