<script lang="ts">
  import { exportVaultToFolder } from "$lib/vault-export";
  import { toasts } from "$lib/stores/toasts.svelte";

  let exporting = $state(false);

  async function runExport() {
    if (exporting) return;
    exporting = true;
    try {
      const result = await exportVaultToFolder();
      if ("cancelled" in result) {
        // Nothing to report.
      } else if (result.ok) {
        toasts.show("Exported. Every note is now a plain Markdown file in the folder you chose.");
      } else {
        toasts.show(`Couldn't export. ${result.error}`);
      }
    } finally {
      exporting = false;
    }
  }
</script>

<div class="vault-pane">
  <h2>Vault</h2>
  <p class="section-hint">
    Export a copy of everything: every note as a plain Markdown file with its
    tags and Spaces, plus your attachments, to a folder you choose.
    Readable and editable with InstantNotes closed, in any editor, on any
    device. This is a snapshot: InstantNotes still keeps its own copy, and
    nothing here is synced back in yet.
  </p>

  <button class="export-btn" disabled={exporting} onclick={runExport}>
    {exporting ? "Exporting…" : "Export a copy…"}
  </button>
</div>

<style>
  .vault-pane {
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
    margin: 0 0 16px;
  }
  .export-btn {
    padding: 8px 18px;
    border-radius: var(--radius);
    background: var(--accent);
    color: #fff;
    font-size: 13px;
    font-weight: 600;
  }
  .export-btn:hover:not(:disabled) {
    filter: brightness(1.05);
  }
  .export-btn:disabled {
    opacity: 0.5;
  }
</style>
