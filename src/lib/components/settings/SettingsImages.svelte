<script lang="ts">
  import { onMount } from "svelte";
  import { imagePrefs, IMAGE_HEIGHT_RANGE, type ImageStorage } from "$lib/stores/images.svelte";
  import {
    getLibraryStats,
    getAttachmentsDir,
    openAttachmentsFolder,
    unusedAttachments,
    removeUnusedAttachments,
  } from "$lib/api/client";
  import type { AttachmentCleanup } from "$lib/api/types";
  import { confirmDialog } from "$lib/stores/confirm.svelte";
  import { formatBytes } from "$lib/format";
  import { toasts } from "$lib/stores/toasts.svelte";
  import PrefRow from "$lib/components/settings/PrefRow.svelte";
  import SegmentedRow from "$lib/components/settings/SegmentedRow.svelte";

  const STORAGE_OPTIONS: { value: ImageStorage; label: string }[] = [
    { value: "copy", label: "Copy in" },
    { value: "link", label: "Link original" },
  ];

  // The preview-height row is a slider rather than one of the two row
  // primitives, so it wires its own sub line to the control.
  const heightSubId = $props.id();

  let attachmentsCount = $state<number | null>(null);
  let attachmentsBytes = $state(0);
  let attachmentsDir = $state("");
  let unused = $state<AttachmentCleanup | null>(null);
  let removing = $state(false);

  const plural = (n: number) => `${n} ${n === 1 ? "image" : "images"}`;

  function loadCounts() {
    void getLibraryStats()
      .then((s) => {
        attachmentsCount = s.attachmentsCount;
        attachmentsBytes = s.attachmentsBytes;
      })
      .catch(() => {});
    void unusedAttachments()
      .then((u) => (unused = u))
      .catch(() => {});
  }

  onMount(() => {
    void imagePrefs.init();
    loadCounts();
    void getAttachmentsDir()
      .then((d) => (attachmentsDir = d))
      .catch(() => {});
  });

  // Deleting a note for good already takes the images only it used; this
  // clears what older versions left behind, or what a note stopped using.
  async function removeUnused() {
    if (!unused?.count || removing) return;
    const ok = await confirmDialog.ask({
      title: `Remove ${plural(unused.count)} no note uses?`,
      body: "They are deleted from the attachments folder for good. Images used by notes in the Trash or the Archive are kept, and anything added in the last hour is left alone.",
      confirmLabel: "Remove",
      tone: "danger",
    });
    if (!ok) return;
    removing = true;
    try {
      const done = await removeUnusedAttachments();
      toasts.show(`Removed ${done.count} unused ${done.count === 1 ? "image" : "images"} (${formatBytes(done.bytes)}).`);
    } catch (e) {
      toasts.show(`Couldn't remove unused images. ${e instanceof Error ? e.message : e}`);
    } finally {
      removing = false;
      loadCounts();
    }
  }

  async function openFolder() {
    try {
      await openAttachmentsFolder();
    } catch (e) {
      toasts.show(`Couldn't open the folder. ${e instanceof Error ? e.message : e}`);
    }
  }
</script>

<div class="images-pane">
  <h2>Images</h2>
  <p class="section-hint">
    Screenshots and drawings you paste, drop, or insert into notes. How they are
    stored, how large they preview, and where they live.
  </p>

  <span class="group-label">Storage</span>
  <SegmentedRow
    label="When adding an image"
    sub="Copy keeps a portable copy inside InstantNotes; Link references the original file where it already sits."
    options={STORAGE_OPTIONS}
    value={imagePrefs.storage}
    onchange={(v) => imagePrefs.setStorage(v)}
  />
  <p class="fine-print">
    {#if imagePrefs.storage === "copy"}
      Images are copied into the attachments folder, so exported markdown stays
      self-contained. This is the safe default.
    {:else}
      A picked file is referenced by its path and read from where it sits.
      Pasted or dropped screenshots have no original file, so they are always
      copied in regardless of this setting.
    {/if}
  </p>

  <span class="group-label">Preview</span>
  <PrefRow
    label="Maximum height in the note"
    sub="How tall an image can render before it is scaled down. Wide images always fit the note width."
    subId={heightSubId}
  >
    {#snippet control()}
      <div class="slider-cell">
        <input
          type="range"
          min={IMAGE_HEIGHT_RANGE.min}
          max={IMAGE_HEIGHT_RANGE.max}
          step="20"
          value={imagePrefs.maxPreviewHeight}
          oninput={(e) => imagePrefs.setMaxPreviewHeight(+e.currentTarget.value)}
          aria-label="Maximum image preview height"
          aria-describedby={heightSubId}
        />
        <span class="slider-val">{imagePrefs.maxPreviewHeight}px</span>
      </div>
    {/snippet}
  </PrefRow>

  <span class="group-label">Stored images</span>
  <div class="attach-card">
    <div class="attach-row">
      <span class="attach-key">Count</span>
      <span class="attach-val">{attachmentsCount ?? "-"}</span>
    </div>
    <div class="attach-row">
      <span class="attach-key">Total size</span>
      <span class="attach-val">{formatBytes(attachmentsBytes)}</span>
    </div>
    <div class="attach-row">
      <span class="attach-key">Unused</span>
      <span class="attach-val">
        {#if !unused}-{:else if unused.count === 0}None{:else}{plural(unused.count)}, {formatBytes(unused.bytes)}{/if}
      </span>
    </div>
    <div class="attach-row">
      <span class="attach-key">Location</span>
      <span class="attach-path" title={attachmentsDir}>{attachmentsDir || "-"}</span>
    </div>
    <div class="attach-actions">
      <button class="folder-btn" onclick={openFolder}>Open attachments folder</button>
      <button class="folder-btn" disabled={!unused?.count || removing} onclick={removeUnused}>
        Remove unused…
      </button>
    </div>
  </div>
</div>

<style>
  .images-pane {
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
  .fine-print {
    margin: 8px 0 0;
    color: var(--text-tertiary);
    font-size: 12px;
    line-height: 1.5;
  }
  .slider-cell {
    display: flex;
    align-items: center;
    gap: 10px;
    flex-shrink: 0;
  }
  .slider-val {
    font-family: var(--font-meta);
    font-size: 12px;
    color: var(--text-secondary);
    min-width: 44px;
    text-align: right;
  }
  .attach-card {
    margin-top: 8px;
    background: var(--bg-sidebar);
    border: 1px solid var(--border);
    border-radius: var(--radius);
    padding: 12px 16px;
  }
  .attach-row {
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: 12px;
    padding: 5px 0;
  }
  .attach-key {
    font-size: 12px;
    color: var(--text-tertiary);
    text-transform: uppercase;
    letter-spacing: 0.04em;
    font-family: var(--font-meta);
  }
  .attach-val {
    font-size: 13px;
    color: var(--text);
    font-weight: 500;
  }
  .attach-path {
    font-size: 12px;
    color: var(--text-secondary);
    font-family: var(--font-meta);
    max-width: 320px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .folder-btn {
    margin-top: 10px;
    padding: 6px 12px;
    border: 1px solid var(--border);
    border-radius: var(--radius);
    color: var(--accent);
    font-size: 13px;
  }
  .folder-btn:hover:not(:disabled) {
    background: var(--bg-hover);
  }
  .folder-btn:disabled {
    opacity: 0.5;
  }
  .attach-actions {
    display: flex;
    gap: 8px;
  }
</style>
