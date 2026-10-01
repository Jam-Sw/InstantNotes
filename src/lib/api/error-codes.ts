// The frontend's one definition of the error codes a command can reject with
// (API.md §14). The authority for the strings is the core's `AppError::code()`
// in src-tauri/core/src/error.rs; `contract.test.ts` holds this list, that
// match, and the API.md table equal, which is the only check that can cross
// the IPC boundary.

export const ERROR_CODES = {
  NOT_FOUND: "NOT_FOUND",
  VALIDATION_ERROR: "VALIDATION_ERROR",
  CONFLICT: "CONFLICT",
  STORAGE_ERROR: "STORAGE_ERROR",
  MIGRATION_ERROR: "MIGRATION_ERROR",
} as const;

export type ErrorCode = keyof typeof ERROR_CODES;

/** Narrow a code off the wire. A string that fails this means the backend and
 *  this build disagree, which `contract.test.ts` exists to prevent. */
export function isErrorCode(value: string): value is ErrorCode {
  return value in ERROR_CODES;
}
