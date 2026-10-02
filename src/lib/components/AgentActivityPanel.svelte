<script lang="ts">
  // The agent trace: every call an agent made, newest first, grouped by
  // conversation, with what it touched, how long it took, what it failed
  // with, and, for a write, a Revert that puts the note back as it was.
  // Slides in over the right edge of the library; Escape or the scrim closes
  // it. The live view of an agent at work stays on the notes themselves.
  import { onMount } from "svelte";
  import { agents } from "$lib/stores/agents.svelte";
  import { library } from "$lib/stores/library.svelte";
  import { confirmDialog } from "$lib/stores/confirm.svelte";
  import { agentActivityBefore } from "$lib/api/client";
  import {
    canRevert,
    clientLabel,
    clockTime,
    describeActivity,
    errorCode,
    formatDuration,
    groupSessions,
    kindLabel,
    timeAgo,
    type AgentActivity,
    type NoteSnapshot,
  } from "$lib/agent-activity";

  let now = $state(Date.now());
  let panel = $state<HTMLElement>();
  // The row whose details are unfolded, and the snapshot fetched for it.
  let openSeq = $state<number | null>(null);
  let before = $state<NoteSnapshot | null | undefined>(undefined);
  let beforeFor = $state<number | null>(null);

  const sessions = $derived(groupSessions(agents.recent));

  onMount(() => {
    const tick = setInterval(() => (now = Date.now()), 15_000);
    return () => clearInterval(tick);
  });

  $effect(() => {
    if (agents.panelOpen) {
      now = Date.now();
      queueMicrotask(() => panel?.focus());
    }
  });

  function onKeydown(e: KeyboardEvent) {
    if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      agents.closePanel();
    }
  }

  /** Whether the note moved on after this write: a revert would drop that. */
  function editedSince(e: AgentActivity): boolean {
    if (!e.afterUpdatedAt || e.noteIds.length !== 1) return false;
    const note = library.notes.find((n) => n.id === e.noteIds[0]);
    if (library.selected?.id === e.noteIds[0]) return library.selected.updatedAt > e.afterUpdatedAt;
    return !!note && note.updatedAt > e.afterUpdatedAt;
  }

  async function toggle(e: AgentActivity) {
    if (openSeq === e.seq) {
      openSeq = null;
      return;
    }
    openSeq = e.seq;
    if (e.kind === "write" && e.revertable && beforeFor !== e.seq) {
      beforeFor = e.seq;
      before = undefined;
      try {
        before = await agentActivityBefore(e.seq);
      } catch {
        before = undefined;
      }
    }
  }

  async function revert(e: AgentActivity) {
    if (editedSince(e)) {
      const ok = await confirmDialog.ask({
        title: "Revert this change?",
        body: "You have edited this note since. Reverting puts the note back as it was before the agent's change, and your edits since then go with it. The revert itself can be undone.",
        confirmLabel: "Revert",
      });
      if (!ok) return;
    }
    await agents.revert(e.seq);
  }

  function openNote(e: AgentActivity) {
    if (e.noteIds.length !== 1) return;
    void library.select(e.noteIds[0]);
    agents.closePanel();
  }

  async function clearAll() {
    const ok = await confirmDialog.ask({
      title: "Clear the agent history?",
      body: "The trace is forgotten and changes it recorded can no longer be reverted from here. Your notes are not touched.",
      confirmLabel: "Clear History",
      tone: "danger",
    });
    if (ok) await agents.clear();
  }

  const excerpt = (s: string, n = 240) => {
    const flat = s.replace(/\s+/g, " ").trim();
    return flat.length > n ? `${flat.slice(0, n)}…` : flat;
  };
</script>

{#if agents.panelOpen}
  <div
    class="scrim"
    role="presentation"
    onclick={(e) => {
      if (e.target === e.currentTarget) agents.closePanel();
    }}
    onkeydown={onKeydown}
  >
    <div
      class="panel"
      role="dialog"
      aria-modal="true"
      aria-labelledby="agent-panel-title"
      tabindex="-1"
      bind:this={panel}
    >
      <header class="head">
        <div class="head-text">
          <h2 id="agent-panel-title">Agent activity</h2>
          <p class="sub">
            {#if agents.access === "off"}
              Agent access is off. Nothing can connect until you turn it on in Settings.
            {:else if agents.access === "read"}
              Agents may read. Every call is listed here as it happens.
            {:else}
              Agents may read and write. Every change can be reverted from here.
            {/if}
          </p>
        </div>
        <button class="close" aria-label="Close" onclick={() => agents.closePanel()}>&times;</button>
      </header>

      <div class="legend" aria-hidden="true">
        <span class="chip" data-kind="read">read</span>
        <span class="chip" data-kind="search">search</span>
        <span class="chip" data-kind="write">write</span>
        <span class="chip" data-kind="error">failed</span>
      </div>

      <div class="body">
        {#if sessions.length === 0}
          <p class="empty">No agent has connected yet. Connect one from Settings &rsaquo; Agents.</p>
        {/if}
        {#each sessions as s (s.session)}
          <section class="session">
            <header class="session-head">
              <span class="who">{clientLabel(s.client)}</span>
              <span class="counts">
                {#if s.writes}<span class="count" data-kind="write">{s.writes} change{s.writes === 1 ? "" : "s"}</span>{/if}
                {#if s.reads}<span class="count">{s.reads} read{s.reads === 1 ? "" : "s"}</span>{/if}
                {#if s.errors}<span class="count" data-kind="error">{s.errors} failed</span>{/if}
              </span>
              <span class="when" title={new Date(s.startedAt).toLocaleString()}>{timeAgo(s.endedAt, now)}</span>
            </header>
            <ol class="rows">
              {#each s.entries as e (e.seq)}
                {@const kind = e.status === "error" ? "error" : kindLabel(e)}
                <li class="row" data-kind={kind} class:reverted={e.revertedAt !== null} class:open={openSeq === e.seq}>
                  <button class="row-main" onclick={() => toggle(e)} aria-expanded={openSeq === e.seq}>
                    <span class="time">{clockTime(e.at)}</span>
                    <span class="chip" data-kind={kind}>{kind}</span>
                    <span class="what">
                      {describeActivity(e)}
                      {#if e.revertedAt !== null}<span class="flag">reverted</span>{/if}
                      {#if canRevert(e) && editedSince(e)}<span class="flag">edited since</span>{/if}
                    </span>
                    <span class="dur">{formatDuration(e.durationMs)}</span>
                  </button>
                  {#if openSeq === e.seq}
                    <div class="details">
                      <dl>
                        <dt>Tool</dt><dd><code>{e.tool}</code></dd>
                        {#if e.query !== null}<dt>Query</dt><dd>“{e.query}”</dd>{/if}
                        {#if e.space}<dt>Space</dt><dd>{e.space}</dd>{/if}
                        {#if e.tag}<dt>Tag</dt><dd>#{e.tag}</dd>{/if}
                        {#if e.noteCount > 0}
                          <dt>Notes</dt>
                          <dd>
                            {e.noteCount}{#if e.titles.length}: {e.titles.map((t) => `“${t || "Untitled"}”`).join(", ")}{/if}{#if e.noteCount > e.titles.length}…{/if}
                          </dd>
                        {/if}
                        {#if e.error}
                          <dt>Error</dt>
                          <dd class="err">{#if errorCode(e)}<code>{errorCode(e)}</code> {/if}{e.error.replace(/^[A-Z_]+:\s*/, "")}</dd>
                        {/if}
                        <dt>Session</dt><dd><code>{e.session}</code></dd>
                      </dl>
                      {#if e.kind === "write" && e.revertable}
                        <div class="before">
                          <span class="before-label">Before this change</span>
                          {#if beforeFor === e.seq && before === undefined}
                            <span class="muted">Loading…</span>
                          {:else if beforeFor === e.seq && before === null}
                            <span class="muted">The note did not exist yet. Reverting moves it to the Trash.</span>
                          {:else if beforeFor === e.seq && before}
                            <div class="snap">
                              <strong>{before.title || "Untitled"}</strong>
                              {#if before.body}<p>{excerpt(before.body)}</p>{:else}<p class="muted">Empty note</p>{/if}
                              <span class="muted">
                                {#if before.tags.length}#{before.tags.map(([t]) => t).join(" #")} · {/if}
                                {before.spaces.length ? before.spaces.join(", ") : "no Space"}
                                {#if before.isDeleted} · in Trash{/if}
                              </span>
                            </div>
                          {/if}
                        </div>
                      {/if}
                      <div class="actions">
                        {#if e.noteIds.length === 1}
                          <button class="btn" onclick={() => openNote(e)}>Open note</button>
                        {/if}
                        {#if canRevert(e)}
                          <button class="btn primary" onclick={() => revert(e)}>Revert</button>
                        {:else if e.revertedAt !== null}
                          <span class="muted">Reverted {timeAgo(e.revertedAt, now)}</span>
                        {/if}
                      </div>
                    </div>
                  {/if}
                </li>
              {/each}
            </ol>
          </section>
        {/each}
        {#if agents.hasMore}
          <button class="btn more" onclick={() => agents.loadMore()}>Load older</button>
        {/if}
      </div>

      {#if agents.recent.length > 0}
        <footer class="foot">
          <span class="muted">{agents.recent.length} call{agents.recent.length === 1 ? "" : "s"} shown</span>
          <button class="btn quiet" onclick={clearAll}>Clear history</button>
        </footer>
      {/if}
    </div>
  </div>
{/if}

<style>
  .scrim {
    position: fixed;
    inset: 0;
    z-index: 110;
    background: rgba(0, 0, 0, 0.18);
    display: flex;
    justify-content: flex-end;
  }
  .panel {
    width: min(460px, 92vw);
    height: 100%;
    display: flex;
    flex-direction: column;
    background: var(--bg);
    border-left: 1px solid var(--border);
    box-shadow: var(--shadow-lg);
    outline: none;
    animation: panel-in 180ms ease-out;
  }
  @keyframes panel-in {
    from {
      transform: translateX(24px);
      opacity: 0;
    }
  }
  @media (prefers-reduced-motion: reduce) {
    .panel {
      animation: none;
    }
  }
  .head {
    display: flex;
    align-items: flex-start;
    gap: 12px;
    padding: 16px 18px 10px;
  }
  .head-text {
    flex: 1;
    min-width: 0;
  }
  h2 {
    margin: 0;
    font-size: 15px;
    font-weight: 600;
    color: var(--text);
  }
  .sub {
    margin: 4px 0 0;
    font-size: 12px;
    line-height: 1.45;
    color: var(--text-secondary);
  }
  .close {
    font-size: 18px;
    line-height: 1;
    color: var(--text-tertiary);
    padding: 2px 6px;
    border-radius: var(--radius);
  }
  .close:hover {
    color: var(--text);
    background: var(--bg-hover);
  }
  .legend {
    display: flex;
    gap: 6px;
    padding: 0 18px 10px;
    border-bottom: 1px solid var(--border);
  }
  .body {
    flex: 1;
    min-height: 0;
    overflow-y: auto;
    padding: 6px 10px 12px;
  }
  .empty {
    margin: 24px 8px;
    color: var(--text-tertiary);
    font-size: 13px;
    text-align: center;
  }
  .session {
    margin: 8px 0 14px;
  }
  .session-head {
    display: flex;
    align-items: baseline;
    gap: 8px;
    padding: 6px 8px 4px;
    position: sticky;
    top: 0;
    background: var(--bg);
    z-index: 1;
  }
  .who {
    font-weight: 600;
    color: var(--accent-text);
    font-size: 12.5px;
  }
  .counts {
    display: flex;
    gap: 6px;
    flex: 1;
    min-width: 0;
    font-size: 11px;
    color: var(--text-tertiary);
    font-family: var(--font-meta);
  }
  .count[data-kind="write"] {
    color: var(--text-secondary);
  }
  .count[data-kind="error"] {
    color: var(--danger);
  }
  .when {
    font-size: 11px;
    color: var(--text-tertiary);
    font-family: var(--font-meta);
  }
  .rows {
    list-style: none;
    margin: 0;
    padding: 0;
    border: 1px solid var(--border);
    border-radius: var(--radius);
    overflow: hidden;
  }
  .row + .row {
    border-top: 1px solid var(--border);
  }
  .row-main {
    display: grid;
    grid-template-columns: auto auto 1fr auto;
    align-items: baseline;
    gap: 8px;
    width: 100%;
    padding: 7px 10px;
    text-align: left;
    font-size: 12.5px;
    color: var(--text);
  }
  .row-main:hover,
  .row.open .row-main {
    background: var(--bg-hover);
  }
  .row[data-kind="read"] .what,
  .row[data-kind="search"] .what {
    color: var(--text-secondary);
  }
  .row.reverted .what {
    text-decoration: line-through;
    text-decoration-color: var(--text-tertiary);
    color: var(--text-tertiary);
  }
  .time,
  .dur {
    font-family: var(--font-meta);
    font-size: 11px;
    color: var(--text-tertiary);
    white-space: nowrap;
  }
  .what {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .flag {
    margin-left: 6px;
    font-size: 10px;
    font-family: var(--font-meta);
    color: var(--text-tertiary);
    border: 1px solid var(--border);
    border-radius: 99px;
    padding: 0 6px;
    text-decoration: none;
    display: inline-block;
  }
  .chip {
    font-family: var(--font-meta);
    font-size: 10px;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.4px;
    padding: 1px 6px;
    border-radius: 99px;
    border: 1px solid var(--border);
    color: var(--text-tertiary);
    white-space: nowrap;
  }
  .chip[data-kind="write"],
  .chip[data-kind="revert"] {
    color: var(--accent-text);
    background: var(--accent-soft);
    border-color: transparent;
  }
  .chip[data-kind="search"] {
    color: var(--text-secondary);
  }
  .chip[data-kind="error"] {
    color: var(--danger);
    border-color: color-mix(in srgb, var(--danger) 45%, transparent);
  }
  .details {
    padding: 4px 12px 12px;
    background: var(--bg-sidebar);
    font-size: 12px;
    line-height: 1.5;
    color: var(--text-secondary);
  }
  dl {
    display: grid;
    grid-template-columns: auto 1fr;
    gap: 2px 12px;
    margin: 6px 0 0;
  }
  dt {
    color: var(--text-tertiary);
    font-family: var(--font-meta);
    font-size: 11px;
  }
  dd {
    margin: 0;
    min-width: 0;
    overflow-wrap: anywhere;
    color: var(--text);
  }
  dd code,
  .err code {
    font-family: var(--font-mono);
    font-size: 11px;
    background: var(--bg);
    border: 1px solid var(--border);
    border-radius: 4px;
    padding: 0 4px;
  }
  .err {
    color: var(--danger);
  }
  .before {
    margin-top: 10px;
  }
  .before-label {
    display: block;
    font-family: var(--font-meta);
    font-size: 10px;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.4px;
    color: var(--text-tertiary);
    margin-bottom: 4px;
  }
  .snap {
    border: 1px solid var(--border);
    border-radius: var(--radius);
    background: var(--bg);
    padding: 8px 10px;
  }
  .snap strong {
    color: var(--text);
    font-size: 12.5px;
  }
  .snap p {
    margin: 4px 0;
    color: var(--text-secondary);
    font-family: var(--font-body);
  }
  .muted {
    color: var(--text-tertiary);
    font-size: 11.5px;
  }
  .actions {
    display: flex;
    gap: 8px;
    align-items: center;
    margin-top: 10px;
  }
  .btn {
    padding: 4px 11px;
    border: 1px solid var(--border);
    border-radius: var(--radius);
    color: var(--text);
    font-size: 12px;
  }
  .btn:hover {
    background: var(--bg-hover);
  }
  .btn.primary {
    border-color: var(--accent);
    color: var(--accent-text);
    font-weight: 600;
  }
  .btn.more {
    display: block;
    margin: 4px auto 8px;
  }
  .btn.quiet {
    border-color: transparent;
    color: var(--text-secondary);
  }
  .foot {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 8px 18px;
    border-top: 1px solid var(--border);
  }
</style>
