<script lang="ts">
  import { onMount, untrack } from "svelte";
  import { openUrl } from "$lib/api/client";
  import type { FolderScan, ImportOutcome } from "$lib/api/types";
  import type { FolderChoice } from "$lib/folder-picker";
  import { describeFound, describeNoteImport, shortName } from "$lib/folder-import";
  import { isMac } from "$lib/platform";
  import { PRIVACY_SETTINGS_URL } from "$lib/stickies-import";
  import PrefRow from "$lib/components/settings/PrefRow.svelte";

  let {
    source,
    label,
    sub,
    fine = "",
    defaultSpace,
    found,
    pickers,
    scan,
    run,
    onShowSpace,
  }: {
    source: string;
    label: string;
    sub?: string;
    fine?: string;
    defaultSpace: string;
    found: () => Promise<string[]>;
    pickers: { label: string; pick: () => Promise<FolderChoice> }[];
    scan: (path: string) => Promise<FolderScan>;
    run: (folder: string, space: string | null) => Promise<ImportOutcome>;
    onShowSpace: (workspaceId: string) => void;
  } = $props();

  type Phase =
    | { kind: "start" }
    | { kind: "reading" }
    | { kind: "denied" }
    | { kind: "preview"; scan: FolderScan }
    | { kind: "importing"; scan: FolderScan }
    | { kind: "done"; outcome: ImportOutcome; space: string | null }
    | { kind: "error"; message: string };

  let phase = $state<Phase>({ kind: "start" });
  let shortcuts = $state<string[]>([]);
  let space = $state(untrack(() => defaultSpace));

  const errorText = (e: unknown) => (e instanceof Error ? e.message : String(e));
  const busy = $derived(phase.kind === "reading" || phase.kind === "importing");

  onMount(() => {
    found()
      .then((paths) => (shortcuts = paths))
      .catch(() => {});
  });

  async function choose(pick: () => Promise<FolderChoice>) {
    const choice = await pick();
    if ("cancelled" in choice) return;
    if ("error" in choice) {
      phase = { kind: "error", message: choice.error };
      return;
    }
    await read(choice.path);
  }

  async function read(path: string) {
    phase = { kind: "reading" };
    try {
      const result = await scan(path);
      phase = result.readable ? { kind: "preview", scan: result } : { kind: "denied" };
    } catch (e) {
      phase = { kind: "error", message: `Couldn't read that: ${errorText(e)}` };
    }
  }

  async function runImport(from: FolderScan) {
    const name = space.trim() || null;
    phase = { kind: "importing", scan: from };
    try {
      const outcome = await run(from.folder, name);
      phase = { kind: "done", outcome, space: name };
    } catch (e) {
      phase = { kind: "error", message: `Couldn't import: ${errorText(e)}` };
    }
  }

  const fresh = (s: FolderScan) => s.notes - s.imported;
</script>

<span class="group-label">{source}</span>

{#snippet again()}
  {#each pickers as picker (picker.label)}
    <button class="card-btn" disabled={busy} onclick={() => choose(picker.pick)}>{picker.label}</button>
  {/each}
{/snippet}

{#if phase.kind === "start" || phase.kind === "reading"}
  <PrefRow {label} {sub}>
    {#snippet control()}
      {#if phase.kind === "reading"}
        <button class="primary-btn" disabled>Reading…</button>
      {:else if shortcuts.length === 0}
        <button class="primary-btn" onclick={() => choose(pickers[0].pick)}>{pickers[0].label}</button>
      {/if}
    {/snippet}
  </PrefRow>
  {#if shortcuts.length > 0 || pickers.length > 1}
    <div class="actions wrap">
      {#each shortcuts as path (path)}
        <button class="primary-btn" disabled={busy} title={path} onclick={() => read(path)}>
          Import {shortName(path)}
        </button>
      {/each}
      {#each shortcuts.length > 0 ? pickers : pickers.slice(1) as picker (picker.label)}
        <button class="card-btn" disabled={busy} onclick={() => choose(picker.pick)}>{picker.label}</button>
      {/each}
    </div>
  {/if}
  {#if fine}<p class="fine-print">{fine}</p>{/if}
{:else if phase.kind === "denied"}
  <div class="notice" role="alert">
    <p class="notice-main">No access to that folder</p>
    <div class="actions">
      {#if isMac}
        <button class="card-btn" onclick={() => openUrl(PRIVACY_SETTINGS_URL)}>Open Privacy &amp; Security</button>
      {/if}
      {@render again()}
    </div>
  </div>
{:else if phase.kind === "error"}
  <div class="notice" role="alert">
    <p class="notice-main">{phase.message}</p>
    <div class="actions">{@render again()}</div>
  </div>
{:else if phase.kind === "done"}
  {@const workspaceId = phase.outcome.workspaceId}
  <div class="notice" role="status">
    <p class="notice-main">{describeNoteImport(phase.outcome, phase.space)}</p>
    <div class="actions">
      {#if workspaceId}
        <button class="primary-btn" onclick={() => onShowSpace(workspaceId)}>Show Them</button>
      {/if}
      {@render again()}
    </div>
  </div>
{:else}
  {@const current = phase.scan}
  {@const importing = phase.kind === "importing"}
  <div class="notice" role="status">
    <p class="notice-main">{describeFound(current)}</p>
    {#if current.titles.length > 0}
      <p class="notice-sub titles">
        {current.titles.join(" · ")}{fresh(current) > current.titles.length ? " …" : ""}
      </p>
    {/if}
    <p class="notice-sub"><code>{current.folder}</code></p>
  </div>
  {#if fresh(current) > 0}
    <PrefRow label="Space">
      {#snippet control()}
        <input
          class="space-input"
          type="text"
          bind:value={space}
          placeholder="No Space"
          spellcheck="false"
          disabled={importing}
          aria-label={`Space for imported ${source} notes`}
        />
      {/snippet}
    </PrefRow>
  {/if}
  <div class="actions">
    <button class="primary-btn" disabled={fresh(current) === 0 || importing} onclick={() => runImport(current)}>
      {importing
        ? "Importing…"
        : `Import ${fresh(current)} ${fresh(current) === 1 ? "Note" : "Notes"}`}
    </button>
    {@render again()}
  </div>
{/if}

<style>
  .group-label {
    display: block;
    margin: 24px 0 2px;
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
  .actions {
    display: flex;
    gap: 8px;
    margin-top: 12px;
  }
  .actions.wrap {
    flex-wrap: wrap;
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
  .titles {
    overflow-wrap: anywhere;
  }
  .notice code {
    font-family: var(--font-mono);
    font-size: 11.5px;
    word-break: break-all;
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
</style>
