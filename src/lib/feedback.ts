// Pure helpers for the in-app feedback flow: the category set, the diagnostics
// snapshot format, and the prefilled GitHub issue URL. Kept free of runes and
// Tauri so it is unit-testable; the component supplies live values.

export type FeedbackCategory = "bug" | "idea" | "other";

export const FEEDBACK_CATEGORIES: { value: FeedbackCategory; label: string }[] = [
  { value: "bug", label: "Bug" },
  { value: "idea", label: "Idea" },
  { value: "other", label: "Other" },
];

/** The optional diagnostics snapshot a user can attach. Exactly these fields
 *  are shown in the preview and stored, so nothing is sent that was not seen. */
export interface FeedbackDiagnostics {
  appVersion: string;
  platform: string;
  notes: number;
  attachments: number;
}

/** Human-readable diagnostics block, used both in the preview and the issue. */
export function diagnosticsMarkdown(d: FeedbackDiagnostics): string {
  return [
    `- App version: ${d.appVersion || "unknown"}`,
    `- Platform: ${d.platform}`,
    `- Notes: ${d.notes}`,
    `- Attachments: ${d.attachments}`,
  ].join("\n");
}

const DEFAULT_REPO = "Jam-Sw/InstantNotes";

const TITLE_PREFIX: Record<FeedbackCategory, string> = {
  bug: "Bug: ",
  idea: "Idea: ",
  other: "",
};

const LABEL: Record<FeedbackCategory, string> = {
  bug: "bug",
  idea: "enhancement",
  other: "feedback",
};

// A GitHub "new issue" URL is handed to the OS shell (`open_url`), whose
// length limits are far stricter than a browser's address bar in some
// environments. The full message is always in the local feedback.jsonl
// record regardless, so it is safe to truncate what rides in the URL.
const MAX_URL_BODY_CHARS = 1500;
const TRUNCATION_NOTE = "\n\n[message truncated — the full text is saved locally]";

/**
 * Build a prefilled GitHub "new issue" URL from a feedback submission. The
 * title is derived from the first line of the message; the diagnostics, when
 * present, are appended under a divider. The message is truncated past
 * `MAX_URL_BODY_CHARS` so a long report cannot produce a URL the OS shell
 * refuses to open; the diagnostics block is never truncated, since it is
 * always short.
 */
export function githubIssueUrl(opts: {
  category: FeedbackCategory;
  message: string;
  diagnostics?: string | null;
  repo?: string;
}): string {
  const repo = opts.repo ?? DEFAULT_REPO;
  const trimmed = opts.message.trim();
  const firstLine = trimmed.split("\n")[0].slice(0, 60) || "Feedback";
  const title = `${TITLE_PREFIX[opts.category]}${firstLine}`;
  const truncated = trimmed.length > MAX_URL_BODY_CHARS;
  let body = truncated ? trimmed.slice(0, MAX_URL_BODY_CHARS) + TRUNCATION_NOTE : trimmed;
  if (opts.diagnostics) body += `\n\n---\n${opts.diagnostics}`;
  const params = new URLSearchParams({ title, body, labels: LABEL[opts.category] });
  return `https://github.com/${repo}/issues/new?${params.toString()}`;
}
