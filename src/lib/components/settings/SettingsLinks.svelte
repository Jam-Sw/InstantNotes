<script lang="ts">
  import { onMount } from "svelte";
  import { openUrl } from "$lib/api/client";
  import { modKey } from "$lib/platform";
  import { linkPrefs } from "$lib/stores/links.svelte";
  import type { LinkOpenWith, LinkUnderline } from "$lib/editor/link-prefs";
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
  <p class="section-hint">
    How links inside notes look and open. Links always open in your
    browser, never inside InstantNotes.
  </p>

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
  <p class="sample-hint">
    {linkPrefs.openWith === "click"
      ? "Click the link to try it. While editing with the Aa toolbar open, links need "
      : "Links open with "}{modKey}&#8288;Click{linkPrefs.openWith === "click"
      ? " so the caret can land in the text."
      : " everywhere, so a stray click never leaves the note."}
  </p>

  <SegmentedRow
    label="Open links with"
    options={OPEN_WITH_OPTIONS}
    value={linkPrefs.openWith}
    onchange={(v) => linkPrefs.setOpenWith(v)}
  />

  <SegmentedRow
    label="Underline"
    options={UNDERLINE_OPTIONS}
    value={linkPrefs.underline}
    onchange={(v) => linkPrefs.setUnderline(v)}
  />

  <ToggleRow
    label="Show destination on hover"
    sub="The URL stays hidden in the text; hovering reveals where a link goes."
    checked={linkPrefs.tooltip}
    onchange={(v) => linkPrefs.setTooltip(v)}
  />

  <ToggleRow
    label="Mark external links with ↗"
    sub="A small arrow after links that leave the app."
    checked={linkPrefs.externalIndicator}
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
  .section-hint {
    color: var(--text-secondary);
    font-size: 13px;
    margin: 0 0 20px;
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
  .sample-hint {
    margin: 8px 0 20px;
    color: var(--text-tertiary);
    font-size: 12px;
  }
</style>
