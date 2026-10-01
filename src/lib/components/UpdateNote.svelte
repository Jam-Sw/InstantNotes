<script lang="ts">
  // The update note: the one special page in the update Space, where the
  // install lives. It shows the version jump and the size delta above a single
  // Update button (the old dialog's primary button, not a new one), then turns
  // into a progress bar and finally an "Ok" that answers the notification.
  // Nothing here is persisted; the note vanishes with the Space.
  import { updater } from "$lib/stores/updater.svelte";
  import { sizeDeltaLine, updateNoteTitle } from "$lib/update/space";

  const title = $derived(
    updater.version && updater.currentVersion
      ? updateNoteTitle(updater.currentVersion, updater.version)
      : "InstantNotes update",
  );
  const pct = $derived(
    updater.progress != null ? Math.round(updater.progress * 100) : null,
  );
  const deltaLine = $derived(
    sizeDeltaLine(updater.sizeDelta, updater.currentVersion ?? ""),
  );
</script>

<div class="update-note">
  <div class="update-toolbar">
    <h1 class="update-title">{title}</h1>
  </div>
  <div class="update-body">
    <p class="update-lead">
      You're going from <span class="version">{updater.currentVersion}</span>
      to <span class="version to">{updater.version}</span>.
    </p>
    {#if updater.deltaState === "loading"}
      <p class="delta muted">Measuring the download…</p>
    {:else if deltaLine}
      <p class="delta">The download is {deltaLine}.</p>
    {/if}

    {#if updater.status === "downloading"}
      <div class="bar"><div class="bar-fill" style="width: {pct ?? 6}%"></div></div>
      <p class="muted">
        {pct != null ? `${pct}%` : "Starting…"} · Installing v{updater.version}
      </p>
    {:else if updater.status === "ready"}
      <p class="muted">
        InstantNotes v{updater.version} is installed. It applies the next time
        you open the app.
      </p>
      <button class="btn primary" onclick={() => updater.acknowledge()}>Ok</button>
    {:else if updater.status === "error"}
      <p class="error">{updater.error ?? "The update could not be installed."}</p>
      <button class="btn primary" onclick={() => updater.downloadAndInstall()}>
        Try again
      </button>
    {:else}
      <button class="btn primary" onclick={() => updater.downloadAndInstall()}>
        Update
      </button>
    {/if}
  </div>
</div>

<style>
  .update-note {
    display: flex;
    flex-direction: column;
    flex: 1;
    min-height: 0;
    overflow-y: auto;
  }
  /* Mirrors the note editor's title row, so the page reads as a note. */
  .update-toolbar {
    display: flex;
    align-items: center;
    padding: 10px 16px 6px;
  }
  .update-title {
    margin: 0;
    font-size: 17px;
    font-weight: 700;
    color: var(--text);
  }
  .update-body {
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: 10px;
    padding: 8px 16px 16px;
  }
  .update-lead {
    margin: 0;
    font-size: 14px;
    color: var(--text);
  }
  .version {
    font-family: var(--font-meta);
    font-size: 13px;
  }
  .version.to {
    color: var(--accent-text);
    font-weight: 600;
  }
  .delta {
    margin: 0;
    font-size: 13px;
    color: var(--text-secondary);
  }
  .muted {
    margin: 0;
    color: var(--text-secondary);
    font-size: 13px;
    line-height: 1.5;
  }
  .error {
    margin: 0;
    color: var(--danger);
    font-size: 13px;
  }
  .bar {
    width: 100%;
    max-width: 320px;
    height: 8px;
    border-radius: 99px;
    background: var(--bg-hover);
    overflow: hidden;
  }
  .bar-fill {
    height: 100%;
    background: var(--accent);
    border-radius: 99px;
    transition: width 0.2s ease;
  }
  /* The old update dialog's primary button, kept as the one Update button. */
  .btn {
    padding: 6px 14px;
    border-radius: var(--radius);
    border: 1px solid var(--border);
    color: var(--text-secondary);
    font-size: 13px;
  }
  .btn:hover {
    background: var(--bg-hover);
  }
  .btn.primary {
    border-color: var(--accent);
    background: var(--accent-soft);
    color: var(--accent-text);
    font-weight: 500;
  }
</style>
