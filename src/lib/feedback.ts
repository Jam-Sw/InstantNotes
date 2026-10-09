export type FeedbackCategory = "bug" | "idea" | "other";

export const FEEDBACK_CATEGORIES: { value: FeedbackCategory; label: string }[] = [
  { value: "bug", label: "Bug" },
  { value: "idea", label: "Idea" },
  { value: "other", label: "Other" },
];

export interface FeedbackDiagnostics {
  appVersion: string;
  platform: string;
  notes: number;
  attachments: number;
}

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

const MAX_URL_BODY_CHARS = 1500;
const TRUNCATION_NOTE = "\n\n[message truncated — the full text is saved locally]";

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
