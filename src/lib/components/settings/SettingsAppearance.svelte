<script lang="ts">
  import { theme, type ThemeMode } from "$lib/stores/theme.svelte";
  import { effectiveVariant } from "$lib/themes/apply";
  import { exportTheme, importTheme } from "$lib/themes/share";
  import { BODY_FONTS, type BodyFontId } from "$lib/themes/fonts";
  import type { Theme, TokenSet } from "$lib/themes/types";
  import { toasts } from "$lib/stores/toasts.svelte";
  import { confirmDialog } from "$lib/stores/confirm.svelte";
  import SegmentedRow from "$lib/components/settings/SegmentedRow.svelte";
  import PrefRow from "$lib/components/settings/PrefRow.svelte";

  const MODE_OPTIONS: { value: ThemeMode; label: string }[] = [
    { value: "auto", label: "Auto" },
    { value: "light", label: "Light" },
    { value: "dark", label: "Dark" },
  ];
  const MODE_SUB: Record<ThemeMode, string> = {
    auto: "Follows the system appearance.",
    light: "Always the light variant.",
    dark: "Always the dark variant.",
  };

  function previewTokens(t: Theme): TokenSet {
    const v = effectiveVariant(t, theme.resolvedVariant);
    return (v === "dark" ? t.dark : t.light) as TokenSet;
  }

  function previewStyle(t: Theme): string {
    const k = previewTokens(t);
    return [
      `--p-bg:${k.bg}`,
      `--p-side:${k.bgSidebar}`,
      `--p-text:${k.text}`,
      `--p-text2:${k.textSecondary}`,
      `--p-border:${k.border}`,
      `--p-accent:${k.accent}`,
      `--p-soft:${k.accentSoft}`,
      `--p-radius:${t.metrics.radius}`,
      `--p-font:${t.fonts.body === "mono" ? t.fonts.mono : t.fonts.ui}`,
    ].join(";");
  }

  const isCustom = (t: Theme) => theme.customThemes.some((c) => c.id === t.id);

  async function onImport() {
    const r = await importTheme();
    if ("cancelled" in r) return;
    toasts.show(r.ok ? `Imported “${r.name}”.` : `Couldn't import. ${r.error}`);
  }

  async function onExport(id: string) {
    const r = await exportTheme(id);
    if ("cancelled" in r) return;
    toasts.show(r.ok ? `Saved “${r.name}” as a theme file.` : `Couldn't export. ${r.error}`);
  }

  async function onRemove(t: Theme) {
    const ok = await confirmDialog.ask({
      title: `Remove “${t.name}”?`,
      body: "The imported theme is removed from this list. A file you exported is not touched.",
      confirmLabel: "Remove",
      tone: "danger",
    });
    if (ok) theme.removeCustomTheme(t.id);
  }

  const fontId = $derived<BodyFontId | "theme">(theme.bodyFontId ?? "theme");
  const fontSubId = "appearance-body-font-sub";
</script>

<div class="appearance-pane">
  <h2>Appearance</h2>
  <p class="section-hint">
    Pick a theme, choose light or dark, and set the font notes are written
    in. Themes are files you can share: export the one you use, or import one
    someone made.
  </p>

  <SegmentedRow
    label="Light or dark"
    sub={MODE_SUB[theme.mode]}
    options={MODE_OPTIONS}
    value={theme.mode}
    onchange={(v) => theme.setMode(v)}
  />

  <PrefRow
    label="Body font"
    sub="The font notes are written and read in. “Theme default” lets each theme choose."
    subId={fontSubId}
  >
    {#snippet control()}
      <select
        class="select"
        aria-label="Body font"
        aria-describedby={fontSubId}
        value={fontId}
        onchange={(e) => {
          const v = e.currentTarget.value;
          theme.setBodyFont(v === "theme" ? null : (v as BodyFontId));
        }}
      >
        <option value="theme">Theme default</option>
        {#each BODY_FONTS as f (f.id)}
          <option value={f.id}>{f.label}</option>
        {/each}
      </select>
    {/snippet}
  </PrefRow>

  <div class="themes-head">
    <span class="group-label">Theme</span>
    <button class="card-btn" onclick={onImport}>Import a theme…</button>
  </div>
  <div class="theme-grid" role="radiogroup" aria-label="Theme">
    {#each theme.allThemes as t (t.id)}
      {@const active = theme.activeId === t.id}
      <div class="theme-card" class:active>
        <button
          class="theme-pick"
          role="radio"
          aria-checked={active}
          aria-label={t.name}
          onclick={() => theme.setTheme(t.id)}
        >
          <div class="preview" style={previewStyle(t)} aria-hidden="true">
            <div class="pv-side">
              <span class="pv-pill"></span>
              <span class="pv-line"></span>
              <span class="pv-line short"></span>
            </div>
            <div class="pv-main">
              <span class="pv-title">Aa</span>
              <span class="pv-line"></span>
              <span class="pv-line"></span>
              <span class="pv-line short"></span>
              <span class="pv-accent"></span>
            </div>
          </div>
          <div class="theme-text">
            <span class="theme-name">
              {t.name}
              {#if active}<span class="check" aria-hidden="true">&#10003;</span>{/if}
            </span>
            {#if t.description}<span class="theme-desc">{t.description}</span>{/if}
            <span class="theme-meta">
              {t.appearance === "dual" ? "Light & dark" : t.appearance === "dark" ? "Dark only" : "Light only"}
              {#if t.material} · glass{/if}
              {#if isCustom(t)} · imported{/if}
            </span>
          </div>
        </button>
        <div class="theme-actions">
          <button class="mini" title="Save as a file" onclick={() => onExport(t.id)}>Export</button>
          {#if isCustom(t)}
            <button class="mini danger" onclick={() => onRemove(t)}>Remove</button>
          {/if}
        </div>
      </div>
    {/each}
  </div>
  <p class="fine-print">
    Switch themes without leaving the keyboard: the command palette lists them
    under Themes, and “Toggle light/dark” flips the appearance.
  </p>
</div>

<style>
  .appearance-pane {
    max-width: 640px;
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
    font-size: 11px;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.4px;
    color: var(--text-tertiary);
    font-family: var(--font-meta);
  }
  .themes-head {
    display: flex;
    justify-content: space-between;
    align-items: baseline;
    margin: 24px 0 8px;
  }
  .select {
    appearance: none;
    padding: 5px 28px 5px 10px;
    border: 1px solid var(--border);
    border-radius: var(--radius);
    background: var(--bg-input);
    color: var(--text);
    font-size: 12.5px;
    font-family: var(--font-ui);
    background-image: linear-gradient(45deg, transparent 50%, var(--text-tertiary) 50%),
      linear-gradient(135deg, var(--text-tertiary) 50%, transparent 50%);
    background-position:
      calc(100% - 14px) 55%,
      calc(100% - 9px) 55%;
    background-size: 5px 5px;
    background-repeat: no-repeat;
  }
  .card-btn,
  .mini {
    padding: 4px 10px;
    border: 1px solid var(--border);
    border-radius: var(--radius);
    color: var(--accent);
    font-size: 12.5px;
  }
  .card-btn:hover,
  .mini:hover {
    background: var(--bg-hover);
  }
  .theme-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(190px, 1fr));
    gap: 12px;
  }
  .theme-card {
    display: flex;
    flex-direction: column;
    border: 1px solid var(--border);
    border-radius: var(--radius-lg);
    background: var(--bg-sidebar);
    overflow: hidden;
    transition: border-color 120ms ease, box-shadow 120ms ease;
  }
  .theme-card:hover {
    border-color: color-mix(in srgb, var(--accent) 45%, var(--border));
  }
  .theme-card.active {
    border-color: var(--accent);
    box-shadow: 0 0 0 1px var(--accent);
  }
  .theme-pick {
    display: flex;
    flex-direction: column;
    text-align: left;
    width: 100%;
  }
  .theme-pick:focus-visible {
    outline: 2px solid var(--focus);
    outline-offset: -2px;
  }
  .preview {
    display: grid;
    grid-template-columns: 34% 1fr;
    height: 92px;
    background: var(--p-bg);
    border-bottom: 1px solid var(--p-border);
    font-family: var(--p-font);
  }
  .pv-side {
    background: var(--p-side);
    border-right: 1px solid var(--p-border);
    padding: 10px 8px;
    display: flex;
    flex-direction: column;
    gap: 6px;
  }
  .pv-main {
    padding: 10px 12px;
    display: flex;
    flex-direction: column;
    gap: 5px;
    position: relative;
  }
  .pv-title {
    color: var(--p-text);
    font-size: 15px;
    font-weight: 600;
    line-height: 1;
    margin-bottom: 2px;
  }
  .pv-line {
    display: block;
    height: 4px;
    border-radius: 2px;
    background: var(--p-text2);
    opacity: 0.55;
  }
  .pv-line.short {
    width: 55%;
  }
  .pv-side .pv-line {
    opacity: 0.4;
  }
  .pv-pill {
    display: block;
    height: 10px;
    border-radius: calc(var(--p-radius) / 2);
    background: var(--p-soft);
    border: 1px solid var(--p-accent);
  }
  .pv-accent {
    position: absolute;
    right: 12px;
    bottom: 10px;
    width: 14px;
    height: 14px;
    border-radius: var(--p-radius);
    background: var(--p-accent);
  }
  .theme-text {
    display: flex;
    flex-direction: column;
    gap: 2px;
    padding: 9px 12px 4px;
  }
  .theme-name {
    display: flex;
    justify-content: space-between;
    align-items: center;
    font-size: 13px;
    font-weight: 600;
    color: var(--text);
  }
  .check {
    color: var(--accent-text);
  }
  .theme-desc {
    font-size: 11.5px;
    line-height: 1.4;
    color: var(--text-secondary);
  }
  .theme-meta {
    font-size: 10.5px;
    color: var(--text-tertiary);
    font-family: var(--font-meta);
  }
  .theme-actions {
    display: flex;
    gap: 6px;
    padding: 4px 10px 10px;
  }
  .mini {
    padding: 2px 8px;
    font-size: 11px;
    color: var(--text-secondary);
  }
  .mini.danger {
    color: var(--danger);
  }
  .fine-print {
    margin: 14px 0 0;
    color: var(--text-tertiary);
    font-size: 12px;
    line-height: 1.5;
  }
</style>
