import { describe, expect, test } from "vitest";
import { ERROR_CODES, type ErrorCode } from "./api/error-codes";
import { ApiError } from "./api/client";
import { friendlyError, friendlyMessage, GENERIC_MESSAGE } from "./errors";

describe("friendlyMessage", () => {
  test("maps known API error codes to friendly copy", () => {
    expect(friendlyMessage("NOT_FOUND")).toMatch(/found/i);
    expect(friendlyMessage("STORAGE_ERROR")).toMatch(/sav|stor/i);
    expect(friendlyMessage("VALIDATION_ERROR")).toBeTruthy();
    expect(friendlyMessage("CONFLICT")).toBeTruthy();
    expect(friendlyMessage("MIGRATION_ERROR")).toBeTruthy();
  });

  test("every code has copy of its own", () => {
    const seen = new Set<string>();
    for (const code of Object.keys(ERROR_CODES) as ErrorCode[]) {
      const copy = friendlyMessage(code);
      expect(copy).not.toBe(GENERIC_MESSAGE);
      expect(seen.has(copy)).toBe(false);
      seen.add(copy);
    }
  });

  // A code outside the registry can only arrive from a mismatched backend; the
  // type stops it at the client boundary (asApiError), so only the
  // last-resort behaviour matters here.
  test("a code from outside the registry falls back", () => {
    const unknown = "WEIRD_CODE" as ErrorCode;
    expect(friendlyMessage(unknown, "backend said no")).toBe("backend said no");
    expect(friendlyMessage(unknown)).toBe(GENERIC_MESSAGE);
  });

  test("never exposes raw codes to users", () => {
    for (const code of [...(Object.keys(ERROR_CODES) as ErrorCode[]), "WEIRD_CODE" as ErrorCode]) {
      expect(friendlyMessage(code)).not.toContain(code);
    }
  });
});

describe("friendlyError", () => {
  test("an ApiError gets the copy for its code", () => {
    expect(friendlyError(new ApiError("NOT_FOUND", "note x not found"))).toBe(
      friendlyMessage("NOT_FOUND"),
    );
  });

  test("anything else gets the generic line", () => {
    expect(friendlyError(new Error("boom"))).toBe(GENERIC_MESSAGE);
    expect(friendlyError("a thrown string")).toBe(GENERIC_MESSAGE);
    expect(friendlyError(undefined)).toBe(GENERIC_MESSAGE);
  });
});
