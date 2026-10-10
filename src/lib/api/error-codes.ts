export const ERROR_CODES = {
  NOT_FOUND: "NOT_FOUND",
  VALIDATION_ERROR: "VALIDATION_ERROR",
  CONFLICT: "CONFLICT",
  STORAGE_ERROR: "STORAGE_ERROR",
  MIGRATION_ERROR: "MIGRATION_ERROR",
} as const;

export type ErrorCode = keyof typeof ERROR_CODES;

export function isErrorCode(value: string): value is ErrorCode {
  return value in ERROR_CODES;
}
