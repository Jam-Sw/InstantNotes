<script lang="ts">
  // Sidebar footer: pick a theme, choose light/dark/auto, and import/export
  // portable .intheme.json files. Theme state lives in the theme store; file
  // exchange goes through share.ts.
  import { theme, type ThemeMode } from "$lib/stores/theme.svelte";
  import { effectiveVariant } from "$lib/themes/apply";
  import { exportTheme, importTheme } from "$lib/themes/share";

  const modes: { id: ThemeMode; label: string }[] = [
    { id: "auto", label: "Auto" },
    { id: "light", label: "Light" },
    { id: "dark", label: "Dark" },
  ];

  let status = $state<string | null>(null);
  let statusError = $state(false);

  // Preview each theme in the variant currently showing, so swatches track the
  // light/dark choice.
  function swatch(id: string) {
    const t = theme.allThemes.find((x) => x.id === id)!;
    const v = effectiveVariant(t, theme.resolvedVariant);
    const set = (v === "dark" ? t.dark : t.light)!;
    return set;
  }

  function flash(msg: string, isError = false) {
    status = msg;
    statusError = isError;
    setTimeout(() => (status = null), 3000);
  }

  async function onImport() {
    const r = await importTheme();
    if ("ok" in r && r.ok) flash(`Imported "${r.name}"`);
    else if ("error" in r) flash(r.error, true);
  }

  async function onExport() {
    const r = await exportTheme();
    if ("ok" in r && r.ok) flash(`Exported "${r.name}"`);
    else if ("error" in r) flash(r.error, true);
  }
</script>

<div class="theme-picker">
  <div class="tags-header">Theme</div>
  <div class="swatches">
    {#each theme.allThemes as t (t.id)}
      {@const s = swatch(t.id)}
      <button
        class="swatch"
        class:active={theme.activeId === t.id}
        title={t.name}
        style="--sw-bg:{s.bg}; --sw-accent:{s.accent}; --sw-border:{s.border}"
        onclick={() => theme.setTheme(t.id)}
      >
        <span class="dot"></span>
        <span class="swatch-name">{t.name}</span>
        {#if theme.customThemes.some((c) => c.id === t.id)}
          <span
            class="swatch-remove"
            role="button"
            tabindex="0"
            title="Remove imported theme"
            onclick={(e) => {
              e.stopPropagation();
              theme.removeCustomTheme(t.id);
            }}
            onkeydown={(e) => e.key === "Enter" && theme.removeCustomTheme(t.id)}
          >
            ×
          </span>
        {/if}
      </button>
    {/each}
  </div>

  <div class="mode-toggle">
    {#each modes as m (m.id)}
      <button class="mode" class:active={theme.mode === m.id} onclick={() => theme.setMode(m.id)}>
        {m.label}
      </button>
    {/each}
  </div>

  <div class="share-row">
    <button class="share-btn" onclick={onImport}>Import…</button>
    <button class="share-btn" onclick={onExport}>Export</button>
  </div>

  {#if status}
    <div class="share-status" class:error={statusError}>{status}</div>
  {/if}
</div>

<style>
  .theme-picker {
    border-top: 1px solid var(--border);
    margin-top: 8px;
    padding-top: 8px;
  }
  .tags-header {
    margin: 4px 10px;
    font-size: 11px;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.4px;
    color: var(--text-tertiary);
    font-family: var(--font-meta);
  }
  .swatches {
    display: flex;
    flex-direction: column;
    gap: 1px;
  }
  .swatch {
    display: flex;
    align-items: center;
    gap: 7px;
    width: 100%;
    text-align: left;
    padding: 4px 10px;
    border-radius: var(--radius);
    color: var(--text-secondary);
  }
  .swatch:hover {
    background: var(--bg-hover);
  }
  .swatch.active {
    background: var(--accent-soft);
    color: var(--accent-text);
    font-weight: 500;
  }
  .dot {
    flex-shrink: 0;
    width: 13px;
    height: 13px;
    border-radius: 50%;
    background: var(--sw-bg);
    border: 1px solid var(--sw-border);
    box-shadow: inset 0 0 0 2px var(--sw-accent);
  }
  .swatch-name {
    flex: 1;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .swatch-remove {
    flex-shrink: 0;
    color: var(--text-tertiary);
    font-size: 13px;
    line-height: 1;
    visibility: hidden;
  }
  .swatch:hover .swatch-remove {
    visibility: visible;
  }
  .swatch-remove:hover {
    color: var(--danger);
  }
  .mode-toggle {
    display: flex;
    gap: 2px;
    margin: 8px 8px 0;
    padding: 2px;
    background: var(--bg-hover);
    border-radius: var(--radius);
  }
  .mode {
    flex: 1;
    padding: 3px 0;
    border-radius: calc(var(--radius) - 2px);
    font-size: 11px;
    color: var(--text-secondary);
    font-family: var(--font-meta);
  }
  .mode.active {
    background: var(--bg);
    color: var(--text);
    font-weight: 500;
  }
  .share-row {
    display: flex;
    gap: 4px;
    margin: 6px 8px 0;
  }
  .share-btn {
    flex: 1;
    padding: 4px 0;
    border: 1px solid var(--border);
    border-radius: var(--radius);
    font-size: 11px;
    color: var(--text-secondary);
    font-family: var(--font-meta);
  }
  .share-btn:hover {
    background: var(--bg-hover);
  }
  .share-status {
    margin: 6px 10px 2px;
    font-size: 11px;
    color: var(--text-tertiary);
    font-family: var(--font-meta);
  }
  .share-status.error {
    color: var(--danger);
  }
</style>
