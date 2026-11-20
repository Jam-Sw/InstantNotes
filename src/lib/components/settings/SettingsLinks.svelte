<script lang="ts">
  import { onMount } from "svelte";
  import { openUrl } from "$lib/api/client";
  import { modKey } from "$lib/platform";
  import { linkPrefs } from "$lib/stores/links.svelte";
  import { DEFAULT_LINK_PREFS, type LinkOpenWith, type LinkUnderline } from "$lib/editor/link-prefs";
  import SegmentedRow from "$lib/components/settings/SegmentedRow.svelte";
  import ToggleRow from "$lib/components/settings/ToggleRow.svelte";

  const OPEN_WITH_OPTIONS: { value: LinkOpenWith; label: string }[] = [
    { value: "click", label: "Click" },
    { value: "modclick", label: `${modKey} Click` },
  ];
  const UNDERLINE_OPTIONS: { value: LinkUnderline; label: string }[] = [
    { value: "always", label: "Always" },
    { value: "hover", label: "On hover" },
    { value: "never", label: "Never" },
  ];

  let modHeld = $state(false);
  onMount(() => {
    void linkPrefs.init();
    const onKey = (e: KeyboardEvent) => (modHeld = e.metaKey || e.ctrlKey);
    const onBlur = () => (modHeld = false);
    window.addEventListener("keydown", onKey, true);
    window.addEventListener("keyup", onKey, true);
    window.addEventListener("blur", onBlur, true);
    return () => {
      window.removeEventListener("keydown", onKey, true);
      window.removeEventListener("keyup", onKey, true);
      window.removeEventListener("blur", onBlur, true);
    };
  });

  function sampleLinkClick(e: MouseEvent) {
    if (linkPrefs.openWith === "modclick" && !(e.metaKey || e.ctrlKey)) return;
    void openUrl("https://example.com");
  }
</script>

<div class="links-pane">
  <h2>Links</h2>

  <span class="field-label">Sample</span>
  <div class="link-sample">
    Ship notes beat status meetings, see
    <button
      class="sample-link ul-{linkPrefs.underline}"
      class:ext={linkPrefs.externalIndicator}
      class:plain-click={linkPrefs.openWith === "click"}
      class:mod-ready={linkPrefs.openWith === "modclick" && modHeld}
      title={linkPrefs.tooltip ? "https://example.com" : undefined}
      onclick={sampleLinkClick}
    >the write-up</button> for the numbers.
  </div>

  <SegmentedRow
    label="Open links with"
    options={OPEN_WITH_OPTIONS}
    value={linkPrefs.openWith}
    reset={linkPrefs.openWith !== DEFAULT_LINK_PREFS.openWith
      ? () => linkPrefs.setOpenWith(DEFAULT_LINK_PREFS.openWith)
      : undefined}
    onchange={(v) => linkPrefs.setOpenWith(v)}
  />

  <SegmentedRow
    label="Underline"
    options={UNDERLINE_OPTIONS}
    value={linkPrefs.underline}
    reset={linkPrefs.underline !== DEFAULT_LINK_PREFS.underline
      ? () => linkPrefs.setUnderline(DEFAULT_LINK_PREFS.underline)
      : undefined}
    onchange={(v) => linkPrefs.setUnderline(v)}
  />

  <ToggleRow
    label="Show destination on hover"
    checked={linkPrefs.tooltip}
    reset={linkPrefs.tooltip !== DEFAULT_LINK_PREFS.tooltip
      ? () => linkPrefs.setTooltip(DEFAULT_LINK_PREFS.tooltip)
      : undefined}
    onchange={(v) => linkPrefs.setTooltip(v)}
  />

  <ToggleRow
    label="Mark external links with ↗"
    checked={linkPrefs.externalIndicator}
    reset={linkPrefs.externalIndicator !== DEFAULT_LINK_PREFS.externalIndicator
      ? () => linkPrefs.setExternalIndicator(DEFAULT_LINK_PREFS.externalIndicator)
      : undefined}
    onchange={(v) => linkPrefs.setExternalIndicator(v)}
  />
</div>

<style>
  .links-pane {
    max-width: 560px;
  }
  .links-pane h2 {
    margin: 0 0 6px;
    font-size: 18px;
    font-weight: 600;
  }
  .field-label {
    display: block;
    margin: 16px 0 6px;
    font-size: 11px;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.4px;
    color: var(--text-tertiary);
    font-family: var(--font-meta);
  }
  .link-sample {
    padding: 14px 16px;
    border: 1px solid var(--border);
    border-radius: var(--radius);
    background: var(--bg-sidebar);
    font-size: 14px;
    line-height: 1.6;
    color: var(--text);
  }
  .sample-link {
    color: var(--accent);
    font-size: inherit;
    padding: 0;
  }
  .sample-link.plain-click,
  .sample-link.mod-ready {
    cursor: pointer;
  }
  .sample-link.ul-always {
    text-decoration: underline;
  }
  .sample-link.ul-hover {
    text-decoration: none;
  }
  .sample-link.ul-hover:hover {
    text-decoration: underline;
  }
  .sample-link.ul-never {
    text-decoration: none;
  }
  .sample-link.ext::after {
    content: "↗";
    font-size: 0.7em;
    vertical-align: super;
    margin-left: 1px;
    opacity: 0.75;
  }
</style>
