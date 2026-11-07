<script lang="ts">
  import { onMount } from "svelte";
  import { editorPrefs, EDITOR_DEFAULTS, type EditorWidth, type AutosaveMs, type IndentWidth } from "$lib/stores/editor.svelte";
  import type { Precision } from "$lib/calc/engine";
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
  const precisions: { value: Precision; label: string }[] = [
    { value: "short", label: "Short" },
    { value: "long", label: "Long" },
  ];
  const autosaves: { value: string; label: string }[] = [
    { value: "150", label: "Instant" },
    { value: "400", label: "Normal" },
    { value: "1000", label: "Relaxed" },
  ];
  const indents: { value: string; label: string }[] = [
    { value: "2", label: "2" },
    { value: "4", label: "4" },
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
    reset={editorPrefs.width !== EDITOR_DEFAULTS.width ? () => editorPrefs.setWidth(EDITOR_DEFAULTS.width) : undefined}
    onchange={(v) => editorPrefs.setWidth(v)}
  />

  <ToggleRow
    label="Spellcheck"
    checked={editorPrefs.spellcheck}
    reset={editorPrefs.spellcheck !== EDITOR_DEFAULTS.spellcheck
      ? () => editorPrefs.setSpellcheck(EDITOR_DEFAULTS.spellcheck)
      : undefined}
    onchange={(v) => editorPrefs.setSpellcheck(v)}
  />

  <span class="group-label">Timestamps</span>
  <ToggleRow
    label="Show exact save time"
    checked={editorPrefs.showExactTime}
    reset={editorPrefs.showExactTime !== EDITOR_DEFAULTS.showExactTime
      ? () => editorPrefs.setShowExactTime(EDITOR_DEFAULTS.showExactTime)
      : undefined}
    onchange={(v) => editorPrefs.setShowExactTime(v)}
  />

  <span class="group-label">Formatting</span>
  <ToggleRow
    label="Show the formatting toolbar"
    checked={editorPrefs.toolbarOpen}
    reset={editorPrefs.toolbarOpen !== EDITOR_DEFAULTS.toolbarOpen ? () => editorPrefs.toggleToolbar() : undefined}
    onchange={() => editorPrefs.toggleToolbar()}
  />
  <ToggleRow
    label="Show Markdown source"
    checked={editorPrefs.sourceMode}
    reset={editorPrefs.sourceMode !== EDITOR_DEFAULTS.sourceMode ? () => editorPrefs.toggleSourceMode() : undefined}
    onchange={() => editorPrefs.toggleSourceMode()}
  />

  <span class="group-label">Suggestions</span>
  <ToggleRow
    label="Tag suggestions"
    checked={tagSuggest.enabled}
    reset={tagSuggest.enabled !== SUGGEST_DEFAULT.enabled
      ? () => saveTagSuggest({ ...tagSuggest, enabled: SUGGEST_DEFAULT.enabled })
      : undefined}
    onchange={(v) => saveTagSuggest({ ...tagSuggest, enabled: v })}
  />
  <SegmentedRow
    label="Tag strictness"
    options={sureness}
    value={String(tagSuggest.showAt)}
    reset={tagSuggest.showAt !== SUGGEST_DEFAULT.showAt
      ? () => saveTagSuggest({ ...tagSuggest, showAt: SUGGEST_DEFAULT.showAt })
      : undefined}
    onchange={(v) => saveTagSuggest({ ...tagSuggest, showAt: Number(v) })}
  />
  <ToggleRow
    label="Around this note"
    checked={relatedSuggest.enabled}
    reset={relatedSuggest.enabled !== SUGGEST_DEFAULT.enabled
      ? () => saveRelatedSuggest({ ...relatedSuggest, enabled: SUGGEST_DEFAULT.enabled })
      : undefined}
    onchange={(v) => saveRelatedSuggest({ ...relatedSuggest, enabled: v })}
  />
  <SegmentedRow
    label="Match strictness"
    options={sureness}
    value={String(relatedSuggest.showAt)}
    reset={relatedSuggest.showAt !== SUGGEST_DEFAULT.showAt
      ? () => saveRelatedSuggest({ ...relatedSuggest, showAt: SUGGEST_DEFAULT.showAt })
      : undefined}
    onchange={(v) => saveRelatedSuggest({ ...relatedSuggest, showAt: Number(v) })}
  />

  <details class="more">
    <summary>More</summary>
    <ToggleRow
      label="Wrap lines"
      checked={editorPrefs.wrap}
      reset={editorPrefs.wrap !== EDITOR_DEFAULTS.wrap ? () => editorPrefs.setWrap(EDITOR_DEFAULTS.wrap) : undefined}
      onchange={(v) => editorPrefs.setWrap(v)}
    />
    <SegmentedRow
      label="Calc precision"
      options={precisions}
      value={editorPrefs.calcPrecision}
      reset={editorPrefs.calcPrecision !== EDITOR_DEFAULTS.calcPrecision
        ? () => editorPrefs.setCalcPrecision(EDITOR_DEFAULTS.calcPrecision)
        : undefined}
      onchange={(v) => editorPrefs.setCalcPrecision(v)}
    />
    <SegmentedRow
      label="Autosave delay"
      options={autosaves}
      value={String(editorPrefs.autosaveMs)}
      reset={editorPrefs.autosaveMs !== EDITOR_DEFAULTS.autosaveMs
        ? () => editorPrefs.setAutosaveMs(EDITOR_DEFAULTS.autosaveMs)
        : undefined}
      onchange={(v) => editorPrefs.setAutosaveMs(Number(v) as AutosaveMs)}
    />
    <SegmentedRow
      label="Indent width"
      options={indents}
      value={String(editorPrefs.indentWidth)}
      reset={editorPrefs.indentWidth !== EDITOR_DEFAULTS.indentWidth
        ? () => editorPrefs.setIndentWidth(EDITOR_DEFAULTS.indentWidth)
        : undefined}
      onchange={(v) => editorPrefs.setIndentWidth(Number(v) as IndentWidth)}
    />
  </details>
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
