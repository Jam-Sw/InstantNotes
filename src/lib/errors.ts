import { ApiError } from "$lib/api/client";
import type { ErrorCode } from "$lib/api/error-codes";

/** Single place mapping error codes (API.md §14) to user-facing copy. The
 *  Record is exhaustive on purpose: a new code does not compile until it has
 *  copy here. */
const MESSAGES: Record<ErrorCode, string> = {
  NOT_FOUND: "That note couldn't be found — it may have been deleted.",
  VALIDATION_ERROR: "That didn't look right. Please check the input and try again.",
  CONFLICT: "That name is already in use.",
  STORAGE_ERROR: "Your note couldn't be saved. Please try again.",
  MIGRATION_ERROR: "The notes database needs attention — your data is safe, but the app couldn't upgrade it.",
};

/** What to say when nothing more specific is known. */
export const GENERIC_MESSAGE = "Something went wrong. Please try again.";

export function friendlyMessage(code: ErrorCode, fallback?: string): string {
  return MESSAGES[code] ?? fallback ?? GENERIC_MESSAGE;
}

/** What to tell the user about anything a store call threw: the copy for an
 *  `ApiError`'s code, and the generic line for everything else. */
export function friendlyError(e: unknown): string {
  return e instanceof ApiError ? friendlyMessage(e.code, e.message) : GENERIC_MESSAGE;
}
