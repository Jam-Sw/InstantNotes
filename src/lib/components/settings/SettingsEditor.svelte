<script lang="ts">
  import { onMount } from "svelte";
  import { editorPrefs, EDITOR_DEFAULTS, type EditorWidth, type AutosaveMs, type IndentWidth } from "$lib/stores/editor.svelte";
  import { pluginPrefs } from "$lib/stores/plugins.svelte";
  import { plugins } from "$lib/plugin";
  import type { PrefSpec } from "$lib/plugin/types";
  import ToggleRow from "$lib/components/settings/ToggleRow.svelte";
  import SegmentedRow from "$lib/components/settings/SegmentedRow.svelte";
  import TextRow from "$lib/components/settings/TextRow.svelte";
  import FileRow from "$lib/components/settings/FileRow.svelte";
  import { getSetting, setSetting } from "$lib/api/client";
  import { toasts } from "$lib/stores/toasts.svelte";
  import {
    parseSuggestSetting,
    RELATED_SUGGEST_KEY,
    SUGGEST_DEFAULT,
    SURENESS,
    TAG_SUGGEST_KEY,
    type SuggestSetting,
  } from "$lib/suggest-setting";

  const isSwitch = (spec: PrefSpec): boolean =>
    spec.options?.length === 2 && spec.options.every((o) => o.value === "on" || o.value === "off");

  let tagSuggest = $state<SuggestSetting>(SUGGEST_DEFAULT);
  let relatedSuggest = $state<SuggestSetting>(SUGGEST_DEFAULT);
  const widths: { value: EditorWidth; label: string }[] = [
    { value: "readable", label: "Readable" },
    { value: "wide", label: "Wide" },
    { value: "full", label: "Full width" },
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
    void setSetting(TAG_SUGGEST_KEY, next).catch(() => toasts.show("Couldn't save setting"));
  }

  function saveRelatedSuggest(next: SuggestSetting) {
    relatedSuggest = next;
    void setSetting(RELATED_SUGGEST_KEY, next).catch(() => toasts.show("Couldn't save setting"));
  }

  onMount(() => {
    void editorPrefs.init();
    void pluginPrefs.init();
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
  <ToggleRow
    label="Wrap long titles"
    checked={editorPrefs.titleWrap}
    reset={editorPrefs.titleWrap !== EDITOR_DEFAULTS.titleWrap
      ? () => editorPrefs.setTitleWrap(EDITOR_DEFAULTS.titleWrap)
      : undefined}
    onchange={(v) => editorPrefs.setTitleWrap(v)}
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
    {#each plugins as p (p.id)}
      <ToggleRow
        label={p.label}
        checked={pluginPrefs.on(p)}
        reset={pluginPrefs.on(p) ? undefined : () => pluginPrefs.setOn(p, true)}
        onchange={(v) => pluginPrefs.setOn(p, v)}
      />
      {#if pluginPrefs.on(p)}
        {#each (p.prefs ?? []).filter((spec) => pluginPrefs.shown(p, spec)) as spec (spec.key)}
          {#if spec.kind === "text"}
            <TextRow
              label={spec.label}
              value={pluginPrefs.value(p, spec)}
              placeholder={spec.placeholder}
              reset={pluginPrefs.value(p, spec) !== spec.default
                ? () => pluginPrefs.setValue(p, spec, spec.default)
                : undefined}
              onchange={(v) => pluginPrefs.setValue(p, spec, v)}
            />
          {:else if spec.kind === "file"}
            <FileRow
              label={spec.label}
              value={pluginPrefs.value(p, spec)}
              extensions={spec.extensions ?? []}
              reset={pluginPrefs.value(p, spec) !== spec.default
                ? () => pluginPrefs.setValue(p, spec, spec.default)
                : undefined}
              onchange={(v) => pluginPrefs.setValue(p, spec, v)}
            />
          {:else if isSwitch(spec)}
            <ToggleRow
              label={spec.label}
              checked={pluginPrefs.value(p, spec) === "on"}
              reset={pluginPrefs.value(p, spec) !== spec.default
                ? () => pluginPrefs.setValue(p, spec, spec.default)
                : undefined}
              onchange={(v) => pluginPrefs.setValue(p, spec, v ? "on" : "off")}
            />
          {:else}
            <SegmentedRow
              label={spec.label}
              options={[...(spec.options ?? [])]}
              value={pluginPrefs.value(p, spec)}
              reset={pluginPrefs.value(p, spec) !== spec.default
                ? () => pluginPrefs.setValue(p, spec, spec.default)
                : undefined}
              onchange={(v) => pluginPrefs.setValue(p, spec, v)}
            />
          {/if}
        {/each}
      {/if}
    {/each}
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
