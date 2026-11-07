<script lang="ts">
  import { onMount } from "svelte";
  import {
    listPrefs,
    LIST_DEFAULTS,
    PREVIEW_RANGE,
    RECENT_RANGE,
    type ListSortBy,
    type ListSortOrder,
  } from "$lib/stores/list.svelte";
  import { library } from "$lib/stores/library.svelte";
  import PrefRow from "$lib/components/settings/PrefRow.svelte";
  import SegmentedRow from "$lib/components/settings/SegmentedRow.svelte";
  import ToggleRow from "$lib/components/settings/ToggleRow.svelte";

  const SORT_OPTIONS: { value: ListSortBy; label: string }[] = [
    { value: "updatedAt", label: "Updated" },
    { value: "createdAt", label: "Created" },
    { value: "lastOpenedAt", label: "Opened" },
    { value: "title", label: "Title" },
  ];

  const ORDER_OPTIONS: { value: ListSortOrder; label: string }[] = [
    { value: "desc", label: "Newest" },
    { value: "asc", label: "Oldest" },
  ];

  function setSortBy(v: ListSortBy) {
    listPrefs.setSortBy(v);
    void library.refresh();
  }

  function setSortOrder(v: ListSortOrder) {
    listPrefs.setSortOrder(v);
    void library.refresh();
  }

  onMount(() => {
    void listPrefs.init();
  });
</script>

<div class="list-pane-settings">
  <h2>List</h2>

  <SegmentedRow
    label="Sort by"
    options={SORT_OPTIONS}
    value={listPrefs.sortBy}
    reset={listPrefs.sortBy !== LIST_DEFAULTS.sortBy ? () => setSortBy(LIST_DEFAULTS.sortBy) : undefined}
    onchange={setSortBy}
  />
  <SegmentedRow
    label="Order"
    options={ORDER_OPTIONS}
    value={listPrefs.sortOrder}
    reset={listPrefs.sortOrder !== LIST_DEFAULTS.sortOrder ? () => setSortOrder(LIST_DEFAULTS.sortOrder) : undefined}
    onchange={setSortOrder}
  />
  <ToggleRow
    label="Reopen last note"
    checked={listPrefs.reopenLast}
    reset={listPrefs.reopenLast !== LIST_DEFAULTS.reopenLast ? () => listPrefs.setReopenLast(LIST_DEFAULTS.reopenLast) : undefined}
    onchange={(v) => listPrefs.setReopenLast(v)}
  />

  <details class="more">
    <summary>More</summary>
    <PrefRow
      label="Preview length"
      reset={listPrefs.previewChars !== LIST_DEFAULTS.previewChars
        ? () => listPrefs.setPreviewChars(LIST_DEFAULTS.previewChars)
        : undefined}
    >
      {#snippet control()}
        <div class="slider-cell">
          <input
            type="range"
            min={PREVIEW_RANGE.min}
            max={PREVIEW_RANGE.max}
            step={PREVIEW_RANGE.step}
            value={listPrefs.previewChars}
            oninput={(e) => listPrefs.setPreviewChars(+e.currentTarget.value)}
            aria-label="Preview length"
          />
          <span class="slider-val">{listPrefs.previewChars}</span>
        </div>
      {/snippet}
    </PrefRow>
    <PrefRow
      label="Recent notes"
      reset={listPrefs.recentCount !== LIST_DEFAULTS.recentCount
        ? () => listPrefs.setRecentCount(LIST_DEFAULTS.recentCount)
        : undefined}
    >
      {#snippet control()}
        <div class="slider-cell">
          <input
            type="range"
            min={RECENT_RANGE.min}
            max={RECENT_RANGE.max}
            step="1"
            value={listPrefs.recentCount}
            oninput={(e) => listPrefs.setRecentCount(+e.currentTarget.value)}
            aria-label="Recent notes"
          />
          <span class="slider-val">{listPrefs.recentCount}</span>
        </div>
      {/snippet}
    </PrefRow>
  </details>
</div>

<style>
  .list-pane-settings {
    max-width: 560px;
  }
  .list-pane-settings h2 {
    margin: 0 0 6px;
    font-size: 18px;
    font-weight: 600;
  }
</style>
