<script lang="ts">
  import { onMount } from "svelte";
  import { getLibraryStats, submitFeedback, openFeedbackLog, openUrl } from "$lib/api/client";
  import { isMac } from "$lib/platform";
  import { toasts } from "$lib/stores/toasts.svelte";
  import {
    FEEDBACK_CATEGORIES,
    githubIssueUrl,
    diagnosticsMarkdown,
    type FeedbackCategory,
    type FeedbackDiagnostics,
  } from "$lib/feedback";
  import SegmentedRow from "$lib/components/settings/SegmentedRow.svelte";
  import ToggleRow from "$lib/components/settings/ToggleRow.svelte";

  let { appVersion }: { appVersion: string } = $props();

  let category = $state<FeedbackCategory>("bug");
  let message = $state("");
  let includeDiagnostics = $state(true);
  let sending = $state(false);
  let notes = $state(0);
  let attachments = $state(0);

  const platform = isMac ? "macOS" : "Windows / Linux";

  const diagnostics = $derived<FeedbackDiagnostics>({
    appVersion,
    platform,
    notes,
    attachments,
  });

  onMount(() => {
    void getLibraryStats()
      .then((s) => {
        notes = s.notesTotal;
        attachments = s.attachmentsCount;
      })
      .catch(() => {});
  });

  async function send() {
    const text = message.trim();
    if (!text || sending) return;
    sending = true;
    const diag = includeDiagnostics ? diagnostics : null;
    try {
      await submitFeedback({ category, message: text, appVersion, diagnostics: diag });
    } catch (e) {
      toasts.show(`Couldn't send feedback. ${e instanceof Error ? e.message : e}`);
      sending = false;
      return;
    }
    message = "";
    try {
      await openUrl(
        githubIssueUrl({
          category,
          message: text,
          diagnostics: diag ? diagnosticsMarkdown(diag) : null,
        }),
      );
      toasts.show("Thanks. Saved locally, and GitHub is opening to file it.");
    } catch {
      toasts.show("Saved locally, but couldn't open GitHub automatically.");
    } finally {
      sending = false;
    }
  }

  async function revealLog() {
    try {
      await openFeedbackLog();
    } catch (e) {
      toasts.show(`Couldn't open the feedback log. ${e instanceof Error ? e.message : e}`);
    }
  }
</script>

<div class="feedback-pane">
  <h2>Feedback</h2>
  <p class="section-hint">
    Found a bug or have an idea? Send it straight from here. It is saved on this
    machine and opens a prefilled GitHub issue so it reaches the project.
  </p>

  <SegmentedRow
    label="Kind"
    options={FEEDBACK_CATEGORIES}
    value={category}
    onchange={(v) => (category = v)}
  />

  <label class="field-label" for="fb-message">Message</label>
  <textarea
    id="fb-message"
    class="fb-textarea"
    placeholder={category === "bug"
      ? "What happened, and what did you expect?"
      : category === "idea"
        ? "What would make InstantNotes better for you?"
        : "Tell us anything."}
    bind:value={message}
  ></textarea>

  <ToggleRow
    label="Include diagnostics"
    sub="Attach the details below so a report is actionable. Nothing else is sent."
    checked={includeDiagnostics}
    onchange={(v) => (includeDiagnostics = v)}
  />
  {#if includeDiagnostics}
    <pre class="fb-diag">{diagnosticsMarkdown(diagnostics)}</pre>
  {/if}

  <div class="fb-actions">
    <button class="fb-send" disabled={!message.trim() || sending} onclick={send}>
      {sending ? "Sending…" : "Send feedback"}
    </button>
    <button class="fb-reveal" onclick={revealLog}>Reveal saved feedback</button>
  </div>
  <p class="fine-print">
    Every submission is appended to a local file, kept in full, and never
    pruned automatically.
  </p>
</div>

<style>
  .feedback-pane {
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
    margin: 0 0 12px;
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
  .fb-textarea {
    width: 100%;
    min-height: 120px;
    resize: vertical;
    padding: 10px 12px;
    border: 1px solid var(--border);
    border-radius: var(--radius);
    background: var(--bg-input);
    color: var(--text);
    font-family: var(--font-body);
    font-size: 14px;
    line-height: 1.5;
    margin-bottom: 4px;
  }
  .fb-textarea:focus {
    outline: none;
    border-color: var(--accent);
  }
  .fb-diag {
    margin: 8px 0 0;
    padding: 10px 12px;
    border: 1px solid var(--border);
    border-radius: var(--radius);
    background: var(--bg-sidebar);
    color: var(--text-secondary);
    white-space: pre-wrap;
    font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
    font-size: 12px;
    line-height: 1.5;
  }
  .fb-actions {
    margin-top: 20px;
    display: flex;
    align-items: center;
    gap: 10px;
  }
  .fine-print {
    margin: 8px 0 0;
    color: var(--text-tertiary);
    font-size: 12px;
    line-height: 1.5;
  }
  .fb-reveal {
    padding: 8px 14px;
    border: 1px solid var(--border);
    border-radius: var(--radius);
    color: var(--accent);
    font-size: 13px;
  }
  .fb-reveal:hover {
    background: var(--bg-hover);
  }
  .fb-send {
    padding: 8px 18px;
    border-radius: var(--radius);
    background: var(--accent);
    color: #fff;
    font-size: 13px;
    font-weight: 600;
  }
  .fb-send:hover:not(:disabled) {
    filter: brightness(1.05);
  }
  .fb-send:disabled {
    opacity: 0.5;
  }
</style>
