import { ApiError } from "$lib/api/client";
import { ERROR_CODES, type ErrorCode } from "$lib/api/error-codes";

const MESSAGES: Record<ErrorCode, string> = {
  NOT_FOUND: "That note couldn't be found — it may have been deleted.",
  VALIDATION_ERROR: "That didn't look right. Please check the input and try again.",
  CONFLICT: "That name is already in use.",
  STORAGE_ERROR: "Your note couldn't be saved. Please try again.",
  MIGRATION_ERROR: "The notes database needs attention — your data is safe, but the app couldn't upgrade it.",
};

export const GENERIC_MESSAGE = "Something went wrong. Please try again.";

export function friendlyMessage(code: ErrorCode, fallback?: string): string {
  return MESSAGES[code] ?? fallback ?? GENERIC_MESSAGE;
}

export function friendlyError(e: unknown, conflict?: string): string {
  if (!(e instanceof ApiError)) return GENERIC_MESSAGE;
  if (conflict && e.code === ERROR_CODES.CONFLICT) return conflict;
  return friendlyMessage(e.code, e.message);
}

export const SAVE_CONFLICT_MESSAGE =
  "This note kept changing somewhere else, so your edit couldn't be saved. Please try again.";
