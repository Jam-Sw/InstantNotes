<script lang="ts">
  // One agent conversation, as a note in the Agents Space: every call the
  // agent made, newest first, with what it touched, how long it took, what it
  // failed with, and, for a write, a Revert that puts the note back as it
  // was. Nothing here is persisted as a note; the page is drawn from the
  // trace. The live view of an agent at work stays on the notes themselves.
  import { onMount } from "svelte";
  import { agents } from "$lib/stores/agents.svelte";
  import { agentsSpace } from "$lib/stores/agents-space";
  import { library } from "$lib/stores/library.svelte";
  import { confirmDialog } from "$lib/stores/confirm.svelte";
  import { agentActivityBefore, agentActivityWire } from "$lib/api/client";
  import { sessionSummary } from "$lib/agents/space";
  import {
    canRevert,
    clientLabel,
    clockTime,
    describeActivity,
    formatDuration,
    kindLabel,
    prettyWire,
    timeAgo,
    type AgentActivity,
    type AgentWire,
    type NoteSnapshot,
  } from "$lib/agent-activity";

  let now = $state(Date.now());
  // The row whose details are unfolded, and the snapshot fetched for it.
  let openSeq = $state<number | null>(null);
  let before = $state<NoteSnapshot | null | undefined>(undefined);
  let beforeFor = $state<number | null>(null);
  // The raw exchange for the open row: undefined while it loads.
  let wire = $state<AgentWire | null | undefined>(undefined);

  const session = $derived(agentsSpace.sessionFor(library.selected?.id));

  onMount(() => {
    const tick = setInterval(() => (now = Date.now()), 15_000);
    return () => clearInterval(tick);
  });

  /** Whether the note moved on after this write: a revert would drop that. */
  function editedSince(e: AgentActivity): boolean {
    if (!e.afterUpdatedAt || e.noteIds.length !== 1) return false;
    const note = library.notes.find((n) => n.id === e.noteIds[0]);
    return !!note && note.updatedAt > e.afterUpdatedAt;
  }

  async function toggle(e: AgentActivity) {
    if (openSeq === e.seq) {
      openSeq = null;
      return;
    }
    openSeq = e.seq;
    wire = undefined;
    void agentActivityWire(e.seq).then(
      (w) => {
        if (openSeq === e.seq) wire = w;
      },
      () => {
        if (openSeq === e.seq) wire = null;
      },
    );
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

  // Leaves the Agents Space for the note, in All Notes.
  function openNote(e: AgentActivity) {
    if (e.noteIds.length !== 1) return;
    library.selectWorkspace(null);
    void library.select(e.noteIds[0]);
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

<div class="agent-note">
  <div class="column">
    {#if session}
      <h1 class="title">{clientLabel(session.client)}</h1>
      <p class="meta">
        <span>{sessionSummary(session)}</span>
        <span title={new Date(session.startedAt).toLocaleString()}>{timeAgo(session.endedAt, now)}</span>
      </p>
      <p class="lead">
        {#if agents.access === "off"}
          Agent access is off. Nothing can connect until you turn it on in Settings.
        {:else if agents.access === "read"}
          Agents may read. Every call is listed here as it happens.
        {:else}
          Agents may read and write. Every change can be reverted from here.
        {/if}
      </p>
      <ol class="rows">
        {#each session.entries as e (e.seq)}
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
                <!-- What crossed the wire, whole: the message the agent sent
                     and the one it got back. Nothing is summarized. -->
                {#if wire === undefined}
                  <span class="muted">Loading…</span>
                {:else if wire && (wire.request || wire.response)}
                  <span class="wire-label section-label">Request</span>
                  <pre class="wire">{wire.request ? prettyWire(wire.request) : "Not kept."}</pre>
                  <span class="wire-label section-label">Response · {formatDuration(e.durationMs)}</span>
                  <pre class="wire">{wire.response ? prettyWire(wire.response) : "Not kept."}</pre>
                {:else if e.client === "instantnotes"}
                  <span class="muted">Made in the app, not over MCP, so there are no messages to show.</span>
                {:else}
                  <span class="muted">
                    This call was traced before raw messages were kept: {e.tool}{#if e.error}, which failed with {e.error}{/if}.
                  </span>
                {/if}
                {#if e.kind === "write" && e.revertable}
                  <div class="before">
                    <span class="before-label section-label">Before this change</span>
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
      <div class="foot">
        {#if agents.hasMore}
          <button class="btn" onclick={() => agents.loadMore()}>Load older</button>
        {/if}
        <button class="btn quiet" onclick={clearAll}>Clear history</button>
      </div>
    {:else}
      <p class="lead">This conversation is no longer in the agent history.</p>
    {/if}
  </div>
</div>

<style>
  .agent-note {
    flex: 1;
    min-height: 0;
    overflow-y: auto;
  }
  /* The note editor's column, so the page reads as a note. */
  .column {
    font-size: calc(14px * var(--density));
    max-width: calc(var(--measure) + 32px * var(--density));
    margin: 0 auto;
    padding: 8px calc(16px * var(--density)) 32px;
  }
  .title {
    margin: 0;
    font-size: 1.7em;
    font-weight: 700;
    line-height: 1.25;
    letter-spacing: -0.012em;
    color: var(--text);
  }
  .meta {
    display: flex;
    gap: 10px;
    margin: 6px 0 0;
    padding-bottom: 10px;
    border-bottom: 1px solid var(--border);
    font-family: var(--font-meta);
    font-size: 12px;
    color: var(--text-tertiary);
  }
  .lead {
    margin: 14px 0;
    font-size: 13px;
    line-height: 1.5;
    color: var(--text-secondary);
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
    background: var(--surface-list);
    font-size: 12px;
    line-height: 1.5;
    color: var(--text-secondary);
  }
  .wire-label {
    display: block;
    margin: 10px 0 4px;
  }
  /* Raw JSON, selectable, wrapped so a long note body stays on the page. */
  .wire {
    margin: 0;
    max-height: 360px;
    overflow: auto;
    padding: 8px 10px;
    border: 1px solid var(--border);
    border-radius: var(--radius);
    background: var(--code-bg);
    color: var(--text);
    font-family: var(--font-mono);
    font-size: 11.5px;
    line-height: 1.5;
    white-space: pre-wrap;
    overflow-wrap: anywhere;
    user-select: text;
    -webkit-user-select: text;
  }
  .before {
    margin-top: 10px;
  }
  .before-label {
    display: block;
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
  .btn.quiet {
    margin-left: auto;
    border-color: transparent;
    color: var(--text-secondary);
  }
  .foot {
    display: flex;
    align-items: center;
    gap: 8px;
    margin-top: 12px;
  }
</style>
