<script lang="ts">
  import { onMount } from "svelte";
  import { openUrl } from "$lib/api/client";
  import { modKey } from "$lib/platform";
  import { linkPrefs } from "$lib/stores/links.svelte";

  // Track whether a Cmd/Ctrl modifier is held so the sample link shows the
  // pointer cursor exactly when a modifier-click would open it, mirroring the
  // editor's behavior in the "open with Cmd/Ctrl+Click" mode.
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

  // The sample link mirrors the reading (preview) behavior so trying it here
  // feels exactly like clicking in a note.
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

  <!-- Live sample: real classes, real click behavior, so a change is
       felt here before a note is ever touched. -->
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

  <div class="pref-row">
    <span class="pref-label">Open links with</span>
    <div class="seg" role="radiogroup" aria-label="Open links with">
      <button
        class="seg-btn"
        aria-checked={linkPrefs.openWith === "click"}
        role="radio"
        onclick={() => linkPrefs.setOpenWith("click")}
      >Click</button>
      <button
        class="seg-btn"
        aria-checked={linkPrefs.openWith === "modclick"}
        role="radio"
        onclick={() => linkPrefs.setOpenWith("modclick")}
      >{modKey} Click</button>
    </div>
  </div>

  <div class="pref-row">
    <span class="pref-label">Underline</span>
    <div class="seg" role="radiogroup" aria-label="Underline links">
      <button
        class="seg-btn"
        aria-checked={linkPrefs.underline === "always"}
        role="radio"
        onclick={() => linkPrefs.setUnderline("always")}
      >Always</button>
      <button
        class="seg-btn"
        aria-checked={linkPrefs.underline === "hover"}
        role="radio"
        onclick={() => linkPrefs.setUnderline("hover")}
      >On hover</button>
      <button
        class="seg-btn"
        aria-checked={linkPrefs.underline === "never"}
        role="radio"
        onclick={() => linkPrefs.setUnderline("never")}
      >Never</button>
    </div>
  </div>

  <div class="pref-row">
    <span class="pref-label">
      Show destination on hover
      <span class="pref-sub">The URL stays hidden in the text; hovering reveals where a link goes.</span>
    </span>
    <button
      class="switch"
      role="switch"
      aria-checked={linkPrefs.tooltip}
      aria-label="Show destination on hover"
      onclick={() => linkPrefs.setTooltip(!linkPrefs.tooltip)}
    ><span class="switch-thumb"></span></button>
  </div>

  <div class="pref-row">
    <span class="pref-label">
      Mark external links with &#8599;
      <span class="pref-sub">A small arrow after links that leave the app.</span>
    </span>
    <button
      class="switch"
      role="switch"
      aria-checked={linkPrefs.externalIndicator}
      aria-label="Mark external links"
      onclick={() => linkPrefs.setExternalIndicator(!linkPrefs.externalIndicator)}
    ><span class="switch-thumb"></span></button>
  </div>
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
  /* The sample link wears the same treatments the editor theme applies, so
     what is shown here is what a note shows. */
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
  .pref-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 16px;
    padding: 12px 0;
    border-top: 1px solid var(--border);
  }
  .pref-label {
    display: flex;
    flex-direction: column;
    gap: 2px;
    font-size: 13px;
    color: var(--text);
  }
  .pref-sub {
    color: var(--text-tertiary);
    font-size: 11.5px;
  }
  .seg {
    display: flex;
    flex-shrink: 0;
    border: 1px solid var(--border);
    border-radius: var(--radius);
    overflow: hidden;
  }
  .seg-btn {
    padding: 4px 12px;
    font-size: 12px;
    color: var(--text-secondary);
  }
  .seg-btn + .seg-btn {
    border-left: 1px solid var(--border);
  }
  .seg-btn:hover {
    background: var(--bg-hover);
  }
  .seg-btn[aria-checked="true"] {
    background: var(--accent-soft);
    color: var(--accent-text);
    font-weight: 500;
  }
  .switch {
    position: relative;
    flex-shrink: 0;
    width: 34px;
    height: 20px;
    border-radius: 10px;
    background: var(--bg-hover);
    border: 1px solid var(--border);
    transition: background 0.15s ease;
  }
  .switch[aria-checked="true"] {
    background: var(--accent);
    border-color: var(--accent);
  }
  .switch-thumb {
    position: absolute;
    top: 2px;
    left: 2px;
    width: 14px;
    height: 14px;
    border-radius: 50%;
    background: var(--bg);
    box-shadow: 0 1px 2px rgba(0, 0, 0, 0.2);
    transition: transform 0.15s ease;
  }
  .switch[aria-checked="true"] .switch-thumb {
    transform: translateX(14px);
  }
</style>
