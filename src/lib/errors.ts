import { ApiError } from "$lib/api/client";
import { ERROR_CODES, type ErrorCode } from "$lib/api/error-codes";

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

/**
 * What to say when nothing more specific is known.
 * @internal
 */
export const GENERIC_MESSAGE = "Something went wrong. Please try again.";

/** @internal */
export function friendlyMessage(code: ErrorCode, fallback?: string): string {
  return MESSAGES[code] ?? fallback ?? GENERIC_MESSAGE;
}

/** What to tell the user about anything a store call threw: the copy for an
 *  `ApiError`'s code, and the generic line for everything else. `CONFLICT`
 *  means a taken name unless the caller passes `conflict`: the copy for what a
 *  conflict means where it was called (a save that lost a race, a revert). */
export function friendlyError(e: unknown, conflict?: string): string {
  if (!(e instanceof ApiError)) return GENERIC_MESSAGE;
  if (conflict && e.code === ERROR_CODES.CONFLICT) return conflict;
  return friendlyMessage(e.code, e.message);
}

/** A save that lost the version race on every attempt. */
export const SAVE_CONFLICT_MESSAGE =
  "This note kept changing somewhere else, so your edit couldn't be saved. Please try again.";
