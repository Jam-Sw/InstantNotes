<script lang="ts">
  import { onMount } from "svelte";
  import { editorPrefs } from "$lib/stores/editor.svelte";
  import ToggleRow from "$lib/components/settings/ToggleRow.svelte";
  import SegmentedRow from "$lib/components/settings/SegmentedRow.svelte";
  import { getSetting, setSetting } from "$lib/api/client";
  import {
    parseTagSuggest,
    SURENESS,
    TAG_SUGGEST_DEFAULT,
    TAG_SUGGEST_KEY,
    type TagSuggestSetting,
  } from "$lib/tag-suggest";

  let tagSuggest = $state<TagSuggestSetting>(TAG_SUGGEST_DEFAULT);

  function saveTagSuggest(next: TagSuggestSetting) {
    tagSuggest = next;
    void setSetting(TAG_SUGGEST_KEY, next);
  }

  onMount(() => {
    void editorPrefs.init();
    getSetting<unknown>(TAG_SUGGEST_KEY).then(
      (v) => (tagSuggest = parseTagSuggest(v)),
      () => {},
    );
  });
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

  <span class="group-label">Tag suggestions</span>
  <p class="section-hint">
    The open note gets a + #tag chip when its words match notes that already carry that tag. The
    model counts words in your own notes, on this device, each time you open one. Nothing is
    stored or sent, and agents cannot see or change it. The chip's hover lists the words that led
    to it.
  </p>
  <ToggleRow
    label="Suggest a tag for the open note"
    checked={tagSuggest.enabled}
    onchange={(v) => saveTagSuggest({ ...tagSuggest, enabled: v })}
  />
  <SegmentedRow
    label="How sure it must be"
    sub="Eager suggests more often and is wrong more often. Careful speaks up only when the words clearly point to one tag."
    options={SURENESS.map((s) => ({ value: String(s.value), label: s.label }))}
    value={String(tagSuggest.showAt)}
    onchange={(v) => saveTagSuggest({ ...tagSuggest, showAt: Number(v) })}
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
