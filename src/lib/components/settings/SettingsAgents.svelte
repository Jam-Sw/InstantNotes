<script lang="ts">
  import { onMount } from "svelte";
  import { agents } from "$lib/stores/agents.svelte";
  import {
    AGENT_KINDS,
    agentName,
    claudeCodeCommand,
    clientLabel,
    codexCommand,
    describeActivity,
    hermesConfig,
    kindLabel,
    mcpServersJson,
    timeAgo,
    type AgentAccess,
    type AgentNotify,
  } from "$lib/agent-activity";
  import { toasts } from "$lib/stores/toasts.svelte";
  import PrefRow from "$lib/components/settings/PrefRow.svelte";
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
      "Agents can also write, tag, file, and trash notes. Nothing is ever deleted for good, every change is traced, and each one can be reverted.",
  };

  const NOTIFY_OPTIONS: { value: AgentNotify; label: string }[] = [
    { value: "writes", label: "Changes" },
    { value: "all", label: "Everything" },
    { value: "off", label: "Off" },
  ];

  const NOTIFY_SUB: Record<AgentNotify, string> = {
    writes: "A toast for every change an agent makes, with Revert on it. Reads stay quiet.",
    all: "A toast for every call, reads and searches included.",
    off: "No toasts. The live marks on your notes and the Agents Space still show everything.",
  };

  function saveTags(client: string, raw: string) {
    const names = raw
      .split(",")
      .map((t) => t.trim().replace(/^#+/, ""))
      .filter(Boolean);
    agents.setTags(client, [...new Set(names)]);
  }

  type Client = "claude" | "codex" | "hermes" | "json";
  let client = $state<Client>("claude");
  let now = $state(Date.now());

  const RECENT_SHOWN = 8;
  const recent = $derived(agents.recent.slice(0, RECENT_SHOWN));
  const writes = $derived(agents.recent.filter((e) => e.kind === "write" && e.status === "ok").length);
  const errors = $derived(agents.recent.filter((e) => e.status === "error").length);

  onMount(() => {
    void agents.loadConnection();
    const tick = setInterval(() => (now = Date.now()), 30_000);
    return () => clearInterval(tick);
  });

  function snippet(): string {
    const conn = agents.connection;
    if (!conn) return "";
    if (client === "claude") return claudeCodeCommand(conn);
    if (client === "codex") return codexCommand(conn);
    if (client === "hermes") return hermesConfig(conn);
    return mcpServersJson(conn);
  }

  const SNIPPET_HINT: Record<Client, string> = {
    claude: "Run once in a terminal. Then ask Claude Code about your notes.",
    codex: "Run once in a terminal.",
    hermes: "Add to ~/.hermes/config.yaml, then restart Hermes.",
    json: "Add to the app's MCP settings (Claude Desktop, Cursor, Zed, Windsurf).",
  };

  async function copy(text: string) {
    try {
      await navigator.clipboard.writeText(text);
      toasts.show("Copied.");
    } catch {
      toasts.show("Couldn't copy. Select the text and copy it instead.");
    }
  }
</script>

<div class="agents-pane">
  <h2>Agents</h2>
  <p class="section-hint">
    Connect Claude Code, Codex, Hermes, Cursor, or any agent that speaks the Model
    Context Protocol. It works through the same search and the same rules you
    do. Whatever it reads or changes lights up in your library as it happens,
    and every change can be reverted.
  </p>

  <SegmentedRow
    label="Access"
    sub={ACCESS_SUB[agents.access]}
    options={ACCESS_OPTIONS}
    value={agents.access}
    onchange={(v) => agents.setAccess(v)}
  />
  <SegmentedRow
    label="Notify me about"
    sub={NOTIFY_SUB[agents.notify]}
    options={NOTIFY_OPTIONS}
    value={agents.notify}
    onchange={(v) => agents.setNotify(v)}
  />

  <span class="group-label">Each agent</span>
  {#each AGENT_KINDS as client (client)}
    <PrefRow
      label={clientLabel(client)}
      sub="Tags it puts on every note it creates, separated by commas. Block refuses everything it asks for."
    >
      {#snippet control()}
        <div class="kind-controls">
          <input
            class="tag-field"
            placeholder="No tags"
            value={(agents.tags[client] ?? []).join(", ")}
            aria-label="Tags for {clientLabel(client)}"
            onchange={(e) => saveTags(client, e.currentTarget.value)}
          />
          <label class="block-toggle">
            <input
              type="checkbox"
              checked={agents.isBlocked(client)}
              aria-label="Block {clientLabel(client)}"
              onchange={(e) => agents.setBlocked(client, e.currentTarget.checked)}
            />
            Block
          </label>
        </div>
      {/snippet}
    </PrefRow>
  {/each}

  <span class="group-label">Connect an agent</span>
  {#if agents.connection}
    <div class="connect">
      <div class="tabs" role="tablist" aria-label="Agent">
        <button role="tab" aria-selected={client === "claude"} onclick={() => (client = "claude")}>Claude Code</button>
        <button role="tab" aria-selected={client === "codex"} onclick={() => (client = "codex")}>Codex</button>
        <button role="tab" aria-selected={client === "hermes"} onclick={() => (client = "hermes")}>Hermes</button>
        <button role="tab" aria-selected={client === "json"} onclick={() => (client = "json")}>Other apps</button>
      </div>
      <div class="connect-head">
        <span>{SNIPPET_HINT[client]}</span>
        <button class="card-btn" onclick={() => copy(snippet())}>Copy</button>
      </div>
      <pre class="code">{snippet()}</pre>
    </div>
    <p class="fine-print">
      The agent runs InstantNotes itself in the background to reach your notes,
      so it works whether or not this window is open. Access applies to every
      agent, and turning it off takes effect on their next request. Besides
      tools, notes are offered as <code>instantnotes://notes/&lt;id&gt;</code>
      resources for apps that browse them.
    </p>
  {:else}
    <p class="fine-print">Finding this app's location…</p>
  {/if}

  <span class="group-label">Activity</span>
  <div class="activity-card">
    <div class="activity-stats">
      <div class="stat">
        <span class="stat-num">{agents.recent.length}</span>
        <span class="stat-label">calls</span>
      </div>
      <div class="stat">
        <span class="stat-num">{writes}</span>
        <span class="stat-label">changes</span>
      </div>
      <div class="stat">
        <span class="stat-num" class:bad={errors > 0}>{errors}</span>
        <span class="stat-label">failed</span>
      </div>
      <button class="card-btn open-trace" onclick={() => agents.show()}>
        Open the full trace
      </button>
    </div>
    <p class="connected-line">
      <span class="live-dot" data-state={agents.connectedCount > 0 ? (agents.working ? "working" : "connected") : "off"}></span>
      {#if agents.connectedCount === 0}
        No agent is connected right now.
      {:else}
        {agents.connectedCount} connected: {agents.sessions.filter((s) => s.connected).map((s) => agentName(s.client, s.label)).join(", ")}
      {/if}
    </p>
    {#if recent.length === 0}
      <p class="fine-print">No agent has asked for anything yet.</p>
    {:else}
      <ul class="activity" aria-label="Recent agent activity">
        {#each recent as entry (entry.seq)}
          <li data-kind={entry.status === "error" ? "error" : kindLabel(entry)} class:reverted={entry.revertedAt !== null}>
            <span class="who">{clientLabel(entry.client)}</span>
            <span class="what">{describeActivity(entry)}</span>
            <span class="when">{timeAgo(entry.at, now)}</span>
          </li>
        {/each}
      </ul>
    {/if}
  </div>
</div>

<style>
  .connected-line {
    display: flex;
    align-items: center;
    gap: 8px;
    margin: 10px 0 0;
    font-size: 12.5px;
    color: var(--text-secondary);
  }
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
  .kind-controls {
    display: flex;
    align-items: center;
    gap: 12px;
  }
  .block-toggle {
    display: inline-flex;
    align-items: center;
    gap: 5px;
    font-size: 12.5px;
    color: var(--text-secondary);
  }
  .tag-field {
    width: 200px;
    padding: 5px 8px;
    border: 1px solid var(--border);
    border-radius: var(--radius);
    background: var(--bg-input);
    color: var(--text);
    font-size: 12.5px;
    outline: none;
  }
  .tag-field:focus {
    border-color: var(--accent);
  }
  .connect,
  .activity-card {
    background: var(--bg-sidebar);
    border: 1px solid var(--border);
    border-radius: var(--radius);
    padding: 10px 14px 12px;
  }
  .tabs {
    display: flex;
    gap: 2px;
    padding: 2px;
    border: 1px solid var(--border);
    border-radius: var(--radius);
    width: max-content;
    background: var(--bg);
  }
  .tabs button {
    padding: 3px 10px;
    border-radius: calc(var(--radius) - 2px);
    font-size: 12px;
    color: var(--text-secondary);
  }
  .tabs button[aria-selected="true"] {
    background: var(--accent-soft);
    color: var(--accent-text);
    font-weight: 500;
  }
  .connect-head {
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: 12px;
    margin-top: 10px;
    font-size: 12.5px;
    color: var(--text-secondary);
  }
  .code {
    margin: 6px 0 2px;
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
    white-space: nowrap;
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
  .fine-print code {
    font-family: var(--font-mono);
    font-size: 11px;
  }
  .activity-stats {
    display: flex;
    align-items: center;
    gap: 18px;
    margin-bottom: 10px;
  }
  .stat {
    display: flex;
    align-items: baseline;
    gap: 5px;
  }
  .stat-num {
    font-size: 18px;
    font-weight: 700;
    color: var(--text);
    font-family: var(--font-ui);
  }
  .stat-num.bad {
    color: var(--danger);
  }
  .stat-label {
    font-size: 11px;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    color: var(--text-tertiary);
    font-family: var(--font-meta);
  }
  .open-trace {
    margin-left: auto;
  }
  .activity {
    list-style: none;
    margin: 0;
    padding: 0;
    border: 1px solid var(--border);
    border-radius: var(--radius);
    background: var(--bg);
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
  .activity li[data-kind="read"] .what,
  .activity li[data-kind="search"] .what {
    color: var(--text-secondary);
  }
  .activity li[data-kind="error"] .what {
    color: var(--danger);
  }
  .activity li.reverted .what {
    text-decoration: line-through;
    color: var(--text-tertiary);
  }
  .when {
    color: var(--text-tertiary);
    font-family: var(--font-meta);
    font-size: 11px;
  }
</style>
