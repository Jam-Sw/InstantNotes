import { describe, expect, test } from "vitest";
import { ERROR_CODES, type ErrorCode } from "./api/error-codes";
import { friendlyMessage, GENERIC_MESSAGE } from "./errors";

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

  // A code outside the registry can only arrive from a backend this build does
  // not match; the type stops it at the client boundary (client.ts's
  // asApiError), so here it is only the last-resort behaviour that matters.
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
