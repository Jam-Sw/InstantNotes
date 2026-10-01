<script lang="ts">
  // What the capture panel and a sticky show until the license and EULA are
  // agreed: no editor, one way to the library, where the License Space is
  // (installers README, "The agreement gate", rule 3).
  import { openLibrary } from "$lib/api/client";
</script>

<div class="locked" role="status">
  <p>Agree to the license and EULA in InstantNotes to start writing.</p>
  <button class="btn" onclick={() => void openLibrary()}>Open InstantNotes</button>
</div>

<style>
  .locked {
    display: flex;
    flex: 1;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 10px;
    padding: 16px;
    text-align: center;
  }
  p {
    margin: 0;
    max-width: 280px;
    color: var(--text-secondary);
    font-size: 13px;
    line-height: 1.5;
  }
  .btn {
    padding: 6px 14px;
    border-radius: var(--radius);
    border: 1px solid var(--accent);
    background: var(--accent-soft);
    color: var(--accent-text);
    font-size: 13px;
    font-weight: 500;
  }
</style>
