<script lang="ts">
  // Settings > Import: Apple Stickies in as notes (macOS only; SettingsView
  // leaves the page out elsewhere). Choosing the folder is the permission,
  // the board shows every sticky as it looks, and the chosen ones come in
  // together. See openspec/changes/feat-stickies-import.
  import { importStickies, openUrl, scanStickies } from "$lib/api/client";
  import type { ImportOutcome, StickiesScan, StickyPreview } from "$lib/api/types";
  import { formatExact } from "$lib/format";
  import {
    chooseStickiesFolder,
    DEFAULT_SPACE,
    describeImport,
    describeSelection,
    PRIVACY_SETTINGS_URL,
    STICKIES_PATH_HINT,
    STICKY_YELLOW,
    stickyBody,
    stickyDate,
  } from "$lib/stickies-import";
  import PrefRow from "$lib/components/settings/PrefRow.svelte";

  let { onShowSpace }: { onShowSpace: (workspaceId: string) => void } = $props();

  type Phase =
    | { kind: "start" }
    | { kind: "reading" }
    | { kind: "denied" }
    | { kind: "preview"; scan: StickiesScan }
    | { kind: "importing"; scan: StickiesScan }
    | { kind: "done"; outcome: ImportOutcome; space: string | null }
    | { kind: "error"; message: string };

  let phase = $state<Phase>({ kind: "start" });
  let selected = $state<string[]>([]);
  let space = $state(DEFAULT_SPACE);

  const scan = $derived(
    phase.kind === "preview" || phase.kind === "importing" ? phase.scan : null,
  );
  const importable = $derived(scan ? scan.stickies.filter((s) => !s.imported) : []);
  const importing = $derived(phase.kind === "importing");

  const errorText = (e: unknown) => (e instanceof Error ? e.message : String(e));

  async function choose() {
    const choice = await chooseStickiesFolder();
    if ("cancelled" in choice) return;
    if ("error" in choice) {
      phase = { kind: "error", message: choice.error };
      return;
    }
    phase = { kind: "reading" };
    try {
      const found = await scanStickies(choice.path);
      if (!found.readable) {
        phase = { kind: "denied" };
        return;
      }
      selected = found.stickies.filter((s) => !s.imported).map((s) => s.id);
      phase = { kind: "preview", scan: found };
    } catch (e) {
      phase = { kind: "error", message: `Couldn't read that folder: ${errorText(e)}` };
    }
  }

  function toggle(sticky: StickyPreview) {
    if (sticky.imported || importing) return;
    selected = selected.includes(sticky.id)
      ? selected.filter((id) => id !== sticky.id)
      : [...selected, sticky.id];
  }

  async function runImport(from: StickiesScan) {
    const name = space.trim() || null;
    phase = { kind: "importing", scan: from };
    try {
      const outcome = await importStickies(from.folder, selected, name);
      phase = { kind: "done", outcome, space: name };
    } catch (e) {
      phase = { kind: "error", message: `Couldn't import: ${errorText(e)}` };
    }
  }

  function label(sticky: StickyPreview, on: boolean): string {
    const state = sticky.imported ? "already imported" : on ? "selected" : "not selected";
    return `${sticky.title}, ${stickyDate(sticky.updatedAt)}, ${state}`;
  }
</script>

<div class="import-pane">
  <h2>Import</h2>
  <p class="section-hint">
    Bring notes in from other apps. The app they came from keeps its copy;
    nothing there changes.
  </p>

  <span class="group-label">Apple Stickies</span>

  {#if phase.kind === "start" || phase.kind === "reading"}
    <PrefRow
      label="Every sticky becomes a note"
      sub="With its formatting, lists, links, images, and original dates. You pick which ones and where they go."
    >
      {#snippet control()}
        <button class="primary-btn" disabled={phase.kind === "reading"} onclick={choose}>
          {phase.kind === "reading" ? "Reading…" : "Choose Stickies Folder…"}
        </button>
      {/snippet}
    </PrefRow>
    <p class="fine-print">
      macOS keeps each app's data private, so you show InstantNotes where
      Stickies keeps its notes. The picker opens there; choose Open.
    </p>
  {:else if phase.kind === "denied"}
    <div class="notice" role="alert">
      <p class="notice-main">macOS didn't let InstantNotes read that folder.</p>
      <p class="notice-sub">
        In Privacy &amp; Security, allow InstantNotes to use other apps' data,
        then choose the folder again.
      </p>
      <div class="actions">
        <button class="card-btn" onclick={() => openUrl(PRIVACY_SETTINGS_URL)}>
          Open Privacy &amp; Security
        </button>
        <button class="card-btn" onclick={choose}>Choose Again…</button>
      </div>
    </div>
  {:else if phase.kind === "error"}
    <div class="notice" role="alert">
      <p class="notice-main">{phase.message}</p>
      <div class="actions">
        <button class="card-btn" onclick={choose}>Choose Again…</button>
      </div>
    </div>
  {:else if phase.kind === "done"}
    {@const workspaceId = phase.outcome.workspaceId}
    <div class="notice" role="status">
      <p class="notice-main">{describeImport(phase.outcome, phase.space)}</p>
      <div class="actions">
        {#if workspaceId}
          <button class="primary-btn" onclick={() => onShowSpace(workspaceId)}>Show Them</button>
        {/if}
        <button class="card-btn" onclick={choose}>Choose Another Folder…</button>
      </div>
    </div>
  {:else if scan && scan.stickies.length === 0}
    <div class="notice" role="status">
      <p class="notice-main">There are no stickies in that folder.</p>
      <p class="notice-sub">Stickies keeps them in <code>{STICKIES_PATH_HINT}</code>.</p>
      <div class="actions">
        <button class="card-btn" onclick={choose}>Choose Again…</button>
      </div>
    </div>
  {:else if scan}
    <div class="toolbar">
      <span class="count">
        {describeSelection(scan.stickies.length, selected.length, scan.stickies.length - importable.length)}
      </span>
      <button
        class="link-btn"
        disabled={importing || selected.length === importable.length}
        onclick={() => (selected = importable.map((s) => s.id))}>Select All</button
      >
      <button
        class="link-btn"
        disabled={importing || selected.length === 0}
        onclick={() => (selected = [])}>Select None</button
      >
    </div>

    <div class="board" role="group" aria-label="Stickies in this folder">
      {#each scan.stickies as sticky (sticky.id)}
        {@const on = selected.includes(sticky.id)}
        <button
          class="sticky"
          class:off={!on && !sticky.imported}
          class:imported={sticky.imported}
          style:--paper={sticky.color ?? STICKY_YELLOW}
          aria-pressed={sticky.imported ? undefined : on}
          aria-label={label(sticky, on)}
          disabled={sticky.imported || importing}
          title={`Last changed ${formatExact(sticky.updatedAt)}`}
          onclick={() => toggle(sticky)}
        >
          <span class="sticky-title">{sticky.title}</span>
          <span class="sticky-text">{stickyBody(sticky.text)}</span>
          <span class="sticky-meta">
            <span>{stickyDate(sticky.updatedAt)}</span>
            {#if sticky.images}
              <span>{sticky.images === 1 ? "1 image" : `${sticky.images} images`}</span>
            {/if}
          </span>
          {#if sticky.imported}
            <span class="badge">Imported</span>
          {:else if on}
            <span class="check" aria-hidden="true">
              <svg viewBox="0 0 12 12" width="9" height="9"
                ><path d="M2.5 6.2 5 8.6l4.5-5" fill="none" stroke="currentColor" stroke-width="1.8"
                  stroke-linecap="round" stroke-linejoin="round" /></svg
              >
            </span>
          {/if}
        </button>
      {/each}
    </div>

    <PrefRow label="File them in" sub="A Space to go through them in. Leave it empty for none.">
      {#snippet control()}
        <input
          class="space-input"
          type="text"
          bind:value={space}
          placeholder="No Space"
          spellcheck="false"
          disabled={importing}
          aria-label="Space to file the imported stickies in"
        />
      {/snippet}
    </PrefRow>

    <div class="actions">
      <button
        class="primary-btn"
        disabled={selected.length === 0 || importing}
        onclick={() => runImport(scan)}
      >
        {importing
          ? "Importing…"
          : `Import ${selected.length} ${selected.length === 1 ? "Sticky" : "Stickies"}`}
      </button>
      <button class="card-btn quiet" disabled={importing} onclick={choose}>
        Choose Another Folder…
      </button>
    </div>
    <p class="fine-print">
      Stickies keeps its notes. Formatting Markdown can't hold, like fonts,
      sizes, and text colors, stays behind.
    </p>
  {/if}
</div>

<style>
  .import-pane {
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
    line-height: 1.5;
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
  .primary-btn {
    flex-shrink: 0;
    padding: 6px 14px;
    border-radius: var(--radius);
    background: var(--accent);
    color: #fff;
    font-size: 13px;
    font-weight: 600;
  }
  .primary-btn:hover:not(:disabled) {
    filter: brightness(1.05);
  }
  .primary-btn:disabled {
    opacity: 0.5;
  }
  .card-btn {
    padding: 6px 12px;
    border: 1px solid var(--border);
    border-radius: var(--radius);
    color: var(--accent);
    font-size: 13px;
  }
  .card-btn:hover:not(:disabled) {
    background: var(--bg-hover);
  }
  .card-btn:disabled {
    opacity: 0.5;
  }
  .card-btn.quiet {
    margin-left: auto;
    color: var(--text-secondary);
  }
  .actions {
    display: flex;
    gap: 8px;
    margin-top: 12px;
  }
  .fine-print {
    margin: 8px 0 0;
    color: var(--text-tertiary);
    font-size: 12px;
    line-height: 1.5;
  }
  .notice {
    margin-top: 8px;
    background: var(--bg-sidebar);
    border: 1px solid var(--border);
    border-radius: var(--radius);
    padding: 12px 16px;
  }
  .notice p {
    margin: 0;
  }
  .notice-main {
    font-size: 13px;
    color: var(--text);
    font-weight: 500;
  }
  .notice-sub {
    margin-top: 4px !important;
    font-size: 12.5px;
    line-height: 1.5;
    color: var(--text-secondary);
  }
  .notice code {
    font-family: var(--font-mono);
    font-size: 11.5px;
    word-break: break-all;
  }

  .toolbar {
    display: flex;
    align-items: baseline;
    gap: 12px;
    margin: 8px 0 10px;
  }
  .count {
    flex: 1;
    font-size: 12.5px;
    color: var(--text-secondary);
  }
  .link-btn {
    font-size: 12.5px;
    color: var(--accent);
  }
  .link-btn:disabled {
    color: var(--text-tertiary);
  }

  /* The board: each sticky as it looks on the desktop. Paper and ink are the
     sticky's own, not the theme's, in light and dark alike. */
  .board {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(118px, 1fr));
    gap: 14px;
    padding: 4px 2px 6px;
  }
  .sticky {
    position: relative;
    display: flex;
    flex-direction: column;
    gap: 3px;
    aspect-ratio: 1;
    padding: 9px 10px 8px;
    text-align: left;
    background: var(--paper);
    color: #1d1d1f;
    border-radius: 3px;
    box-shadow:
      0 1px 1px rgba(0, 0, 0, 0.12),
      0 4px 10px rgba(0, 0, 0, 0.1);
    overflow: hidden;
    transition:
      transform 0.12s ease,
      box-shadow 0.12s ease,
      opacity 0.15s ease,
      filter 0.15s ease;
  }
  .sticky:hover:not(:disabled) {
    transform: translateY(-1px);
    box-shadow:
      0 2px 3px rgba(0, 0, 0, 0.14),
      0 8px 18px rgba(0, 0, 0, 0.14);
  }
  .sticky:focus-visible {
    outline: 2px solid var(--accent);
    outline-offset: 3px;
  }
  .sticky.off {
    opacity: 0.42;
    filter: saturate(0.6);
  }
  .sticky.imported {
    opacity: 0.38;
    cursor: default;
  }
  .sticky-title {
    font-size: 11.5px;
    font-weight: 650;
    line-height: 1.3;
    overflow: hidden;
    display: -webkit-box;
    -webkit-line-clamp: 2;
    line-clamp: 2;
    -webkit-box-orient: vertical;
    word-break: break-word;
  }
  .sticky-text {
    flex: 1;
    min-height: 0;
    font-size: 10.5px;
    line-height: 1.35;
    white-space: pre-line;
    word-break: break-word;
    overflow: hidden;
    opacity: 0.78;
    mask-image: linear-gradient(to bottom, #000 70%, transparent);
  }
  .sticky-meta {
    display: flex;
    justify-content: space-between;
    gap: 6px;
    font-size: 9.5px;
    opacity: 0.55;
    font-variant-numeric: tabular-nums;
  }
  .check {
    position: absolute;
    top: 6px;
    right: 6px;
    display: grid;
    place-items: center;
    width: 16px;
    height: 16px;
    border-radius: 50%;
    background: var(--accent);
    color: #fff;
    box-shadow: 0 1px 2px rgba(0, 0, 0, 0.2);
  }
  .badge {
    position: absolute;
    top: 6px;
    right: 6px;
    padding: 1px 6px;
    border-radius: 999px;
    background: rgba(29, 29, 31, 0.72);
    color: #fff;
    font-size: 9px;
    font-weight: 600;
    letter-spacing: 0.02em;
  }
  .space-input {
    width: 180px;
    padding: 5px 8px;
    border: 1px solid var(--border);
    border-radius: var(--radius);
    background: var(--bg-input);
    color: var(--text);
    font-size: 13px;
  }
  .space-input:focus {
    outline: 2px solid var(--accent-soft);
    border-color: var(--accent);
  }
  @media (prefers-reduced-motion: reduce) {
    .sticky {
      transition: none;
    }
    .sticky:hover:not(:disabled) {
      transform: none;
    }
  }
</style>
