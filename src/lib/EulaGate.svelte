<script lang="ts">
  // First-run EULA acceptance. Wrap the app's root layout content in this
  // component. The DMG (macOS) and AppImage (Linux) have no installer license
  // page, so this is where those users agree. Windows users see the same text
  // in the NSIS installer and again here.
  import { getCurrentWindow } from '@tauri-apps/api/window';
  import eula from '../../src-tauri/installer/EULA.txt?raw';

  let { children } = $props();

  const KEY = 'jam-sw.eula.accepted';
  const version = eula.match(/EULA version (\S+)\./)?.[1] ?? 'unknown';

  function read(): string | null {
    try {
      return localStorage.getItem(KEY);
    } catch {
      return null;
    }
  }

  let accepted = $state(read() === version);

  function accept() {
    try {
      localStorage.setItem(KEY, version);
    } catch {
      // Storage unavailable: the gate shows again next launch, which is the safe side.
    }
    accepted = true;
  }

  function decline() {
    getCurrentWindow().close();
  }
</script>

{#if accepted}
  {@render children?.()}
{:else}
  <div class="eula-gate" role="dialog" aria-modal="true" aria-labelledby="eula-title">
    <div class="eula-panel">
      <h1 id="eula-title">License agreement</h1>
      <p>Please read and accept the agreement to continue.</p>
      <pre class="eula-text">{eula}</pre>
      <div class="eula-actions">
        <button type="button" onclick={decline}>Decline</button>
        <button type="button" class="primary" onclick={accept}>I agree</button>
      </div>
    </div>
  </div>
{/if}

<style>
  .eula-gate {
    position: fixed;
    inset: 0;
    display: grid;
    place-items: center;
    padding: 24px;
    background: Canvas;
    color: CanvasText;
    z-index: 1000;
  }
  .eula-panel {
    display: flex;
    flex-direction: column;
    gap: 12px;
    width: min(720px, 100%);
    max-height: 100%;
  }
  h1 {
    margin: 0;
    font-size: 1.25rem;
  }
  p {
    margin: 0;
    opacity: 0.8;
  }
  .eula-text {
    flex: 1;
    min-height: 0;
    overflow: auto;
    margin: 0;
    padding: 16px;
    border: 1px solid color-mix(in srgb, CanvasText 20%, transparent);
    border-radius: 8px;
    font: 13px/1.5 ui-monospace, SFMono-Regular, Menlo, monospace;
    white-space: pre-wrap;
  }
  .eula-actions {
    display: flex;
    justify-content: flex-end;
    gap: 8px;
  }
  button {
    padding: 8px 16px;
    border-radius: 6px;
    border: 1px solid color-mix(in srgb, CanvasText 30%, transparent);
    background: transparent;
    color: inherit;
    font: inherit;
    cursor: pointer;
  }
  button.primary {
    background: CanvasText;
    color: Canvas;
    border-color: CanvasText;
  }
</style>
