import { ApiError } from "$lib/api/client";
import { ERROR_CODES, type ErrorCode } from "$lib/api/error-codes";

const MESSAGES: Record<ErrorCode, string> = {
  NOT_FOUND: "Note not found",
  VALIDATION_ERROR: "Invalid input",
  CONFLICT: "Name already in use",
  STORAGE_ERROR: "Note not saved",
  MIGRATION_ERROR: "Database upgrade failed",
};

export const GENERIC_MESSAGE = "Unexpected error";

export function friendlyMessage(code: ErrorCode, fallback?: string): string {
  return MESSAGES[code] ?? fallback ?? GENERIC_MESSAGE;
}

export function friendlyError(e: unknown, conflict?: string): string {
  if (!(e instanceof ApiError)) return GENERIC_MESSAGE;
  if (conflict && e.code === ERROR_CODES.CONFLICT) return conflict;
  return friendlyMessage(e.code, e.message);
}

export const SAVE_CONFLICT_MESSAGE =
  "Not saved: note changed elsewhere";
