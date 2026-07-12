<script lang="ts">
  import { onMount } from "svelte";
  import { editorPrefs } from "$lib/stores/editor.svelte";
  import ToggleRow from "$lib/components/settings/ToggleRow.svelte";

  onMount(() => void editorPrefs.init());
</script>

<div class="editor-pane-settings">
  <h2>Editor</h2>
  <p class="section-hint">
    How writing and the note itself present. These apply everywhere a note is
    open.
  </p>

  <span class="group-label">Timestamps</span>
  <ToggleRow
    label="Show exact save time"
    sub="Show the full date and time, to the minute, in the editor's Saved line. The exact time is always on hover, even when this is off."
    checked={editorPrefs.showExactTime}
    onchange={(v) => editorPrefs.setShowExactTime(v)}
  />

  <span class="group-label">Formatting</span>
  <ToggleRow
    label="Open the formatting toolbar by default"
    sub="Start new notes with the Aa toolbar open (raw markdown editing) rather than the reading view."
    checked={editorPrefs.toolbarOpen}
    onchange={() => editorPrefs.toggleToolbar()}
  />
</div>

<style>
  .editor-pane-settings {
    max-width: 560px;
  }
  h2 {
    margin: 0 0 6px;
    font-size: 18px;
    font-weight: 600;
  }
  .section-hint {
    color: var(--text-secondary);
    font-size: 13px;
    margin: 0 0 20px;
  }
  .group-label {
    display: block;
    margin: 20px 0 2px;
    font-size: 11px;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.4px;
    color: var(--text-tertiary);
    font-family: var(--font-meta);
  }
</style>
