<script lang="ts">
  // Settings > Agents: whether agents may connect, what they may do, how to
  // connect one, and what they have done. The live view of an agent at work
  // is not here; it is on the notes themselves (see agents.svelte.ts).
  import { onMount } from "svelte";
  import { agents } from "$lib/stores/agents.svelte";
  import {
    claudeCodeCommand,
    clientLabel,
    describeActivity,
    mcpServersJson,
    timeAgo,
    type AgentAccess,
  } from "$lib/agent-activity";
  import { toasts } from "$lib/stores/toasts.svelte";
  import SegmentedRow from "$lib/components/settings/SegmentedRow.svelte";

  const ACCESS_OPTIONS: { value: AgentAccess; label: string }[] = [
    { value: "off", label: "Off" },
    { value: "read", label: "Read" },
    { value: "write", label: "Read & write" },
  ];

  const ACCESS_SUB: Record<AgentAccess, string> = {
    off: "No agent can see your notes.",
    read: "Agents can search and read notes, tags, and Spaces. They cannot change anything.",
    write:
      "Agents can also write, tag, file, and trash notes. Nothing is ever deleted for good, and every change shows on the note as it happens.",
  };

  let now = $state(Date.now());

  onMount(() => {
    void agents.loadConnection();
    const tick = setInterval(() => (now = Date.now()), 30_000);
    return () => clearInterval(tick);
  });

  async function copy(text: string, what: string) {
    try {
      await navigator.clipboard.writeText(text);
      toasts.show(`Copied the ${what}.`);
    } catch {
      toasts.show("Couldn't copy. Select the text and copy it instead.");
    }
  }
</script>

<div class="agents-pane">
  <h2>Agents</h2>
  <p class="section-hint">
    Connect Claude Code, Codex, Cursor, or any agent that speaks the Model
    Context Protocol. It works through the same search and the same rules you
    do, and whatever it reads or changes lights up in your library while it
    does it.
  </p>

  <SegmentedRow
    label="Access"
    sub={ACCESS_SUB[agents.access]}
    options={ACCESS_OPTIONS}
    value={agents.access}
    onchange={(v) => agents.setAccess(v)}
  />

  <span class="group-label">Connect an agent</span>
  {#if agents.connection}
    {@const conn = agents.connection}
    <div class="connect">
      <div class="connect-head">
        <span>Claude Code: run once in a terminal</span>
        <button class="card-btn" onclick={() => copy(claudeCodeCommand(conn), "command")}>
          Copy
        </button>
      </div>
      <pre class="code">{claudeCodeCommand(conn)}</pre>
      <div class="connect-head">
        <span>Other apps: add to their MCP settings</span>
        <button class="card-btn" onclick={() => copy(mcpServersJson(conn), "settings")}>
          Copy
        </button>
      </div>
      <pre class="code">{mcpServersJson(conn)}</pre>
    </div>
    <p class="fine-print">
      The agent runs InstantNotes itself in the background to reach your notes,
      so it works whether or not this window is open. Access applies to every
      agent, and turning it off takes effect on their next request.
    </p>
  {:else}
    <p class="fine-print">Finding this app's location…</p>
  {/if}

  <span class="group-label">Recent activity</span>
  {#if agents.recent.length === 0}
    <p class="fine-print">No agent has connected yet.</p>
  {:else}
    <ul class="activity" aria-label="Recent agent activity">
      {#each agents.recent as entry, i (`${entry.at}-${i}`)}
        <li data-kind={entry.kind}>
          <span class="who">{clientLabel(entry.client)}</span>
          <span class="what">{describeActivity(entry)}</span>
          <span class="when">{timeAgo(entry.at, now)}</span>
        </li>
      {/each}
    </ul>
  {/if}
</div>

<style>
  .agents-pane {
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
    margin: 0 0 20px;
  }
  .group-label {
    display: block;
    margin: 20px 0 6px;
    font-size: 11px;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.4px;
    color: var(--text-tertiary);
    font-family: var(--font-meta);
  }
  .connect {
    background: var(--bg-sidebar);
    border: 1px solid var(--border);
    border-radius: var(--radius);
    padding: 10px 14px 12px;
  }
  .connect-head {
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: 12px;
    margin-top: 6px;
    font-size: 12.5px;
    color: var(--text-secondary);
  }
  .code {
    margin: 6px 0 4px;
    padding: 8px 10px;
    background: var(--bg);
    border: 1px solid var(--border);
    border-radius: var(--radius);
    font-family: var(--font-mono);
    font-size: 11.5px;
    line-height: 1.5;
    white-space: pre-wrap;
    word-break: break-all;
    user-select: text;
    color: var(--text);
  }
  .card-btn {
    padding: 4px 10px;
    border: 1px solid var(--border);
    border-radius: var(--radius);
    color: var(--accent);
    font-size: 12.5px;
  }
  .card-btn:hover {
    background: var(--bg-hover);
  }
  .fine-print {
    margin: 8px 0 0;
    color: var(--text-tertiary);
    font-size: 12px;
    line-height: 1.5;
  }
  .activity {
    list-style: none;
    margin: 0;
    padding: 0;
    border: 1px solid var(--border);
    border-radius: var(--radius);
    max-height: 260px;
    overflow-y: auto;
  }
  .activity li {
    display: grid;
    grid-template-columns: auto 1fr auto;
    gap: 8px;
    align-items: baseline;
    padding: 6px 12px;
    font-size: 12.5px;
    border-bottom: 1px solid var(--border);
  }
  .activity li:last-child {
    border-bottom: none;
  }
  .who {
    color: var(--accent-text);
    font-weight: 600;
  }
  .what {
    color: var(--text);
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .activity li[data-kind="read"] .what {
    color: var(--text-secondary);
  }
  .when {
    color: var(--text-tertiary);
    font-family: var(--font-meta);
    font-size: 11px;
  }
</style>
