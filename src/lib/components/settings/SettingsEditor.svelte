<script lang="ts">
  import { onMount } from "svelte";
  import { editorPrefs, type EditorWidth } from "$lib/stores/editor.svelte";
  import ToggleRow from "$lib/components/settings/ToggleRow.svelte";
  import SegmentedRow from "$lib/components/settings/SegmentedRow.svelte";
  import { getSetting, setSetting } from "$lib/api/client";
  import {
    parseSuggestSetting,
    RELATED_SUGGEST_KEY,
    SUGGEST_DEFAULT,
    SURENESS,
    TAG_SUGGEST_KEY,
    type SuggestSetting,
  } from "$lib/suggest-setting";

  let tagSuggest = $state<SuggestSetting>(SUGGEST_DEFAULT);
  let relatedSuggest = $state<SuggestSetting>(SUGGEST_DEFAULT);
  const widths: { value: EditorWidth; label: string }[] = [
    { value: "readable", label: "Readable" },
    { value: "wide", label: "Wide" },
    { value: "full", label: "Full width" },
  ];
  const sureness = SURENESS.map((s) => ({ value: String(s.value), label: s.label }));

  function saveTagSuggest(next: SuggestSetting) {
    tagSuggest = next;
    void setSetting(TAG_SUGGEST_KEY, next);
  }

  function saveRelatedSuggest(next: SuggestSetting) {
    relatedSuggest = next;
    void setSetting(RELATED_SUGGEST_KEY, next);
  }

  onMount(() => {
    void editorPrefs.init();
    getSetting<unknown>(TAG_SUGGEST_KEY).then(
      (v) => (tagSuggest = parseSuggestSetting(v)),
      () => {},
    );
    getSetting<unknown>(RELATED_SUGGEST_KEY).then(
      (v) => (relatedSuggest = parseSuggestSetting(v)),
      () => {},
    );
  });
</script>

<div class="editor-pane-settings">
  <h2>Editor</h2>

  <span class="group-label">Writing area</span>
  <SegmentedRow
    label="Width"
    options={widths}
    value={editorPrefs.width}
    onchange={(v) => editorPrefs.setWidth(v)}
  />

  <span class="group-label">Timestamps</span>
  <ToggleRow
    label="Show exact save time"
    checked={editorPrefs.showExactTime}
    onchange={(v) => editorPrefs.setShowExactTime(v)}
  />

  <span class="group-label">Formatting</span>
  <ToggleRow
    label="Show the formatting toolbar"
    checked={editorPrefs.toolbarOpen}
    onchange={() => editorPrefs.toggleToolbar()}
  />
  <ToggleRow
    label="Show Markdown source"
    checked={editorPrefs.sourceMode}
    onchange={() => editorPrefs.toggleSourceMode()}
  />

  <span class="group-label">Suggestions</span>
  <ToggleRow
    label="Tag suggestions"
    checked={tagSuggest.enabled}
    onchange={(v) => saveTagSuggest({ ...tagSuggest, enabled: v })}
  />
  <SegmentedRow
    label="Tag strictness"
    options={sureness}
    value={String(tagSuggest.showAt)}
    onchange={(v) => saveTagSuggest({ ...tagSuggest, showAt: Number(v) })}
  />
  <ToggleRow
    label="Around this note"
    checked={relatedSuggest.enabled}
    onchange={(v) => saveRelatedSuggest({ ...relatedSuggest, enabled: v })}
  />
  <SegmentedRow
    label="Match strictness"
    options={sureness}
    value={String(relatedSuggest.showAt)}
    onchange={(v) => saveRelatedSuggest({ ...relatedSuggest, showAt: Number(v) })}
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
