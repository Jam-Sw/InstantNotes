<script lang="ts">
  import { onMount } from "svelte";
  import { agents } from "$lib/stores/agents.svelte";
  import { agentsSpace } from "$lib/stores/agents-space";
  import { library } from "$lib/stores/library.svelte";
  import { confirmDialog } from "$lib/stores/confirm.svelte";
  import { toasts } from "$lib/stores/toasts.svelte";
  import { agentActivityBefore, agentActivityWire, endAgentSession } from "$lib/api/client";
  import {
    canRevert,
    agentName,
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
  let openSeq = $state<number | null>(null);
  let before = $state<NoteSnapshot | null | undefined>(undefined);
  let beforeFor = $state<number | null>(null);
  let wire = $state<AgentWire | null | undefined>(undefined);

  const session = $derived(agentsSpace.sessionFor(library.selected?.id));
  const doing = $derived(session ? agents.doing(session.session) : null);
  const punchLabel = $derived(
    (session?.clocks ?? [])
      .flatMap((c) => [
        c.inAt !== null ? `In ${new Date(c.inAt).toLocaleString()}` : null,
        c.outAt !== null ? `Out ${new Date(c.outAt).toLocaleString()}` : null,
      ])
      .filter(Boolean)
      .join(", "),
  );

  type Filter = "all" | "changes" | "failed";
  let filter = $state<Filter>("all");
  const isChange = (e: AgentActivity) => e.kind === "write" && e.status === "ok";
  const shown = $derived(
    !session
      ? []
      : filter === "changes"
        ? session.entries.filter(isChange)
        : filter === "failed"
          ? session.entries.filter((e) => e.status === "error")
          : session.entries,
  );

  onMount(() => {
    const tick = setInterval(() => (now = Date.now()), 15_000);
    return () => clearInterval(tick);
  });

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

  function openNote(e: AgentActivity) {
    if (e.noteIds.length !== 1) return;
    library.selectWorkspace(null);
    void library.select(e.noteIds[0]);
  }

  function toggleBlock(client: string) {
    const on = !agents.isBlocked(client);
    agents.setBlocked(client, on);
    toasts.show(
      on
        ? `${clientLabel(client)} is blocked. It can no longer read or change your notes.`
        : `${clientLabel(client)} is unblocked.`,
    );
  }

  async function endSession(session: string, client: string) {
    const ok = await confirmDialog.ask({
      title: `End this ${clientLabel(client)} session?`,
      body: "Its connection to your notes closes now. The agent may start a new one; Block stops that.",
      confirmLabel: "End Session",
      tone: "danger",
    });
    if (!ok) return;
    try {
      await endAgentSession(session);
    } catch (e) {
      toasts.show(`Couldn't end the session. ${e instanceof Error ? e.message : String(e)}`);
    }
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
      <h1 class="title">{agentName(session.client, session.label)}</h1>
      <p class="status" role="status" aria-live="polite">
        <span class="live-dot" data-state={!session.connected ? "off" : doing ? "working" : "connected"}></span>
        {#if session.connected && doing}<span class="status-main">{describeActivity(doing)}</span>{/if}
        {#if punchLabel}
          <span class="punch" role="img" aria-label={punchLabel} title={punchLabel}>
            {#each session.clocks as c (c.session)}
              {#if c.inAt !== null}
                <span class="punch-stamp"><span class="punch-hole"></span>{clockTime(c.inAt)}</span>
              {/if}
              {#if c.outAt !== null}
                <span class="punch-stamp" data-out><span class="punch-hole"></span>{clockTime(c.outAt)}</span>
              {/if}
            {/each}
          </span>
        {/if}
        <span class="status-access">
          {#if agents.access === "off"}
            Agent access is off
          {:else if agents.access === "read"}
            May read
          {:else}
            May read and write
          {/if}
        </span>
      </p>
      {#if session.clientSession || session.cwd}
        <dl class="origin">
          {#if session.clientSession}
            <dt>Session</dt>
            <dd>
              <code>{session.clientSession}</code>
              {#if session.inferred}
                <span
                  class="inferred"
                  title="This client does not tell its servers which session they belong to. This is the session its process began, matched from the client's own records."
                  >best match</span
                >
              {/if}
            </dd>
          {/if}
          {#if session.cwd}
            <dt>Running in</dt>
            <dd><code>{session.cwd}</code></dd>
          {/if}
        </dl>
      {/if}
      <div class="filters" role="group" aria-label="Show">
        <button class="filter" aria-pressed={filter === "all"} onclick={() => (filter = "all")}>
          All <span class="n">{session.entries.length}</span>
        </button>
        <button class="filter" aria-pressed={filter === "changes"} onclick={() => (filter = "changes")}>
          Changes <span class="n">{session.writes}</span>
        </button>
        <button class="filter" aria-pressed={filter === "failed"} onclick={() => (filter = "failed")}>
          Failed <span class="n">{session.errors}</span>
        </button>
      </div>
      {#if shown.length === 0}
        <p class="lead">
          {#if session.entries.length === 0}
            Connected, and it has not asked for anything yet. Every call will be listed here as it happens.
          {:else if filter === "changes"}
            It has not changed anything.
          {:else}
            Nothing it tried has failed.
          {/if}
        </p>
      {/if}
      <ol class="rows" class:empty={shown.length === 0}>
        {#each shown as e (e.seq)}
          {@const kind = e.status === "error" ? "error" : kindLabel(e)}
          <li class="row" data-kind={kind} class:reverted={e.revertedAt !== null} class:open={openSeq === e.seq}>
            <div class="row-head">
              <button class="row-main" onclick={() => toggle(e)} aria-expanded={openSeq === e.seq}>
                <span class="time">{clockTime(e.at)}</span>
                <span class="mark" data-kind={kind} title={kind} aria-label={kind} role="img"></span>
                <span class="what">
                  {describeActivity(e)}
                  {#if e.revertedAt !== null}<span class="flag">reverted</span>{/if}
                  {#if canRevert(e) && editedSince(e)}<span class="flag">edited since</span>{/if}
                </span>
                <span class="dur">{formatDuration(e.durationMs)}</span>
              </button>
              {#if e.noteIds.length === 1}
                <button class="btn go" onclick={() => openNote(e)}>Open note</button>
              {/if}
              {#if canRevert(e)}
                <button class="btn revert" onclick={() => revert(e)}>Revert</button>
              {/if}
            </div>
            {#if openSeq === e.seq}
              <div class="details">
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
                {#if e.revertedAt !== null}
                  <div class="actions">
                    <span class="muted">Reverted {timeAgo(e.revertedAt, now)}</span>
                  </div>
                {/if}
              </div>
            {/if}
          </li>
        {/each}
      </ol>
      <div class="foot">
        {#if agents.hasMore}
          <button class="btn" onclick={() => agents.loadMore()}>Load older</button>
        {/if}
        {#if session.connected}
          <button class="btn quiet" onclick={() => endSession(session.session, session.client)}>End session</button>
        {/if}
        <button class="btn quiet" onclick={() => toggleBlock(session.client)}>
          {agents.isBlocked(session.client) ? "Unblock" : "Block"} {clientLabel(session.client)}
        </button>
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
  .status {
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: 8px;
    margin: 8px 0 0;
    padding-bottom: 12px;
    border-bottom: 1px solid var(--border);
    font-family: var(--font-ui);
    font-size: 12.5px;
    color: var(--text-tertiary);
  }
  .status-main {
    color: var(--text);
    font-weight: 500;
  }
  .status-access {
    margin-left: auto;
  }
  .punch {
    display: inline-flex;
    align-items: center;
    border: 1px solid var(--border);
    border-radius: 5px;
    font-family: var(--font-meta);
    font-size: 11px;
    font-variant-numeric: tabular-nums;
    color: var(--text-secondary);
  }
  .punch-stamp {
    display: inline-flex;
    align-items: center;
    gap: 5px;
    padding: 1px 7px;
  }
  .punch-stamp + .punch-stamp {
    border-left: 1px dashed var(--border);
  }
  .punch-stamp[data-out] + .punch-stamp {
    border-left-style: solid;
  }
  .punch-hole {
    width: 6px;
    height: 6px;
    border-radius: 50%;
    background: var(--text-tertiary);
  }
  .origin {
    display: grid;
    grid-template-columns: auto 1fr;
    gap: 3px 12px;
    margin: 12px 0 0;
    font-family: var(--font-ui);
    font-size: 12px;
  }
  .origin dt {
    color: var(--text-tertiary);
  }
  .origin dd {
    margin: 0;
    min-width: 0;
    overflow-wrap: anywhere;
  }
  .origin code {
    font-family: var(--font-mono);
    font-size: 11.5px;
    color: var(--text-secondary);
    user-select: text;
    -webkit-user-select: text;
  }
  .inferred {
    margin-left: 6px;
    padding: 0 6px;
    border: 1px solid var(--border);
    border-radius: 99px;
    font-family: var(--font-meta);
    font-size: 10px;
    color: var(--text-tertiary);
  }
  .filters {
    display: flex;
    gap: 4px;
    margin: 14px 0 10px;
  }
  .filter {
    padding: 3px 10px;
    border-radius: 99px;
    font-size: 12px;
    color: var(--text-secondary);
  }
  .filter:hover {
    background: var(--bg-hover);
  }
  .filter[aria-pressed="true"] {
    background: var(--select-bg);
    color: var(--text);
    font-weight: 600;
  }
  .filter .n {
    margin-left: 3px;
    font-family: var(--font-meta);
    font-size: 11px;
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
  .rows.empty {
    display: none;
  }
  .row + .row {
    border-top: 1px solid var(--border);
  }
  .row-head {
    display: flex;
    align-items: center;
  }
  .row-head:hover,
  .row.open .row-head {
    background: var(--bg-hover);
  }
  .row-main {
    flex: 1;
    min-width: 0;
    display: grid;
    grid-template-columns: auto auto 1fr auto;
    align-items: center;
    gap: 10px;
    padding: 8px 10px;
    text-align: left;
    font-size: 13px;
    color: var(--text);
  }
  .row[data-kind="read"] .what,
  .row[data-kind="search"] .what {
    color: var(--text-secondary);
  }
  .row[data-kind="write"] .what,
  .row[data-kind="revert"] .what {
    font-weight: 500;
  }
  .row[data-kind="error"] .what {
    color: var(--danger);
  }
  .row.reverted .what {
    text-decoration: line-through;
    text-decoration-color: var(--text-tertiary);
    color: var(--text-tertiary);
    font-weight: 400;
  }
  .time,
  .dur {
    font-family: var(--font-meta);
    font-size: 11px;
    color: var(--text-tertiary);
    white-space: nowrap;
    font-variant-numeric: tabular-nums;
  }
  .mark {
    width: 8px;
    height: 8px;
    border-radius: 50%;
    border: 1.5px solid var(--text-tertiary);
  }
  .mark[data-kind="search"] {
    border-style: dashed;
  }
  .mark[data-kind="write"],
  .mark[data-kind="revert"] {
    border-color: var(--accent);
    background: var(--accent);
  }
  .mark[data-kind="error"] {
    border-color: var(--danger);
    background: var(--danger);
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
    font-weight: 400;
    color: var(--text-tertiary);
    border: 1px solid var(--border);
    border-radius: 99px;
    padding: 0 6px;
    text-decoration: none;
    display: inline-block;
  }
  .btn.go {
    flex: none;
    margin-right: 8px;
  }
  .btn.revert {
    flex: none;
    margin-right: 8px;
    border-color: var(--accent);
    color: var(--accent-text);
    font-weight: 600;
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
  .btn.quiet {
    margin-left: auto;
    border-color: transparent;
    color: var(--text-secondary);
  }
  .btn.quiet + .btn.quiet {
    margin-left: 0;
  }
  .foot {
    display: flex;
    align-items: center;
    gap: 8px;
    margin-top: 12px;
  }
</style>
