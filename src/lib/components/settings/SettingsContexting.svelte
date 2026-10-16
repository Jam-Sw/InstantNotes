<script lang="ts">
  import { onMount } from "svelte";
  import { modKey } from "$lib/platform";
  import { contexting } from "$lib/stores/contexting.svelte";
  import { renderContext, type ContextImageMode } from "$lib/contexting-format";
  import { library } from "$lib/stores/library.svelte";
  import { shell } from "$lib/stores/shell.svelte";
  import type { Note, Tag } from "$lib/api/types";
  import SegmentedRow from "$lib/components/settings/SegmentedRow.svelte";
  import ToggleRow from "$lib/components/settings/ToggleRow.svelte";

  onMount(() => void contexting.init());

  const IMAGE_MODE_OPTIONS: { value: ContextImageMode; label: string }[] = [
    { value: "absolute", label: "Absolute path" },
    { value: "keep", label: "Keep reference" },
    { value: "strip", label: "Remove" },
  ];

  const VAR_HELP: { code: string; meaning: string }[] = [
    { code: "{title}", meaning: "the note's title" },
    { code: "{tags}", meaning: "its tags as hashtags" },
    { code: "{date}", meaning: "the date it was last edited" },
    { code: "{content}", meaning: "the note body" },
    { code: "{id}", meaning: "the note's id" },
    { code: "{copied}", meaning: "the time you copy it" },
  ];

  const SAMPLE_NOTE: Pick<Note, "id" | "title" | "body" | "updatedAt"> = {
    id: "sample-note-id",
    title: "Sample note",
    body: "The quick brown fox.\n![diagram](attachments/example.png)",
    updatedAt: new Date().toISOString(),
  };
  const SAMPLE_TAGS: Pick<Tag, "name">[] = [{ name: "example" }];

  const previewNote = $derived(library.selected ?? SAMPLE_NOTE);
  const previewLabel = $derived(
    library.selected ? `Preview: ${library.selected.title || "Untitled"}` : "Preview: sample note",
  );
  const preview = $derived(
    renderContext(
      contexting.copyTemplate,
      previewNote,
      library.selected ? library.selectedTags : SAMPLE_TAGS,
      {
        imageMode: contexting.imageMode,
        attachmentsDir: contexting.attachmentsDir,
        addSourceLine: contexting.addSourceLine,
      },
    ),
  );
</script>

<div class="contexting-pane">
  <h2>Contexting</h2>
  <p class="section-hint">
    The template behind "Copy note as context" in the {modKey}K palette and "Copy context" in
    the note list's right-click menu, which works on several selected notes at once. Wrap the
    note however a tool or model expects; this is the seed for InstantNotes' AI features.
  </p>

  <label class="field-label" for="ctx-template">Template</label>
  <textarea
    id="ctx-template"
    class="ctx-textarea"
    spellcheck="false"
    value={contexting.copyTemplate}
    oninput={(e) => contexting.setTemplate(e.currentTarget.value)}
  ></textarea>

  <dl class="ctx-vars">
    {#each VAR_HELP as v (v.code)}
      <div class="ctx-var-row">
        <dt><code class="ctx-var">{v.code}</code></dt>
        <dd>{v.meaning}</dd>
      </div>
    {/each}
  </dl>

  <span class="field-label">Source</span>
  <ToggleRow
    label="Add source line"
    sub="Appends &quot;From InstantNotes&quot;, the copy time and the note id after each copied note."
    checked={contexting.addSourceLine}
    onchange={(v) => contexting.setAddSourceLine(v)}
  />
  <p class="ctx-agent-note">
    An agent connected over MCP can fetch the full note by that id with get_note.
    <button type="button" class="ctx-link" onclick={() => shell.openSettings("agents")}>
      Agents settings
    </button>
  </p>

  <span class="field-label">Images</span>
  <SegmentedRow
    label="When copying, images become"
    sub="What happens to an image in the note. Absolute path lets a tool or agent that reads files find the image; keep leaves the note's own reference; remove drops it for text-only context."
    options={IMAGE_MODE_OPTIONS}
    value={contexting.imageMode}
    onchange={(v) => contexting.setImageMode(v)}
  />

  <span class="field-label">{previewLabel}</span>
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
    display: grid;
    grid-template-columns: max-content 1fr;
    gap: 4px 12px;
    margin: 8px 0 0;
  }
  .ctx-var-row {
    display: contents;
  }
  .ctx-vars dt,
  .ctx-vars dd {
    margin: 0;
  }
  .ctx-vars dd {
    font-size: 12.5px;
    color: var(--text-secondary);
  }
  .ctx-agent-note {
    margin: 6px 0 0;
    font-size: 12.5px;
    color: var(--text-secondary);
  }
  .ctx-link {
    color: var(--accent);
    font-size: 12.5px;
  }
  .ctx-link:hover {
    text-decoration: underline;
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
