/** Single place mapping AppError codes (API.md §11) to user-facing copy. */
const MESSAGES: Record<string, string> = {
  NOT_FOUND: "That note couldn't be found — it may have been deleted.",
  VALIDATION_ERROR: "That didn't look right. Please check the input and try again.",
  CONFLICT: "That name is already in use.",
  STORAGE_ERROR: "Your note couldn't be saved. Please try again.",
  MIGRATION_ERROR: "The notes database needs attention — your data is safe, but the app couldn't upgrade it.",
};

export function friendlyMessage(code: string, fallback?: string): string {
  return MESSAGES[code] ?? fallback ?? "Something went wrong. Please try again.";
}
