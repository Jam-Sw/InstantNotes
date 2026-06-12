import { describe, expect, test } from "vitest";
import { friendlyMessage } from "./errors";

describe("friendlyMessage", () => {
  test("maps known API error codes to friendly copy", () => {
    expect(friendlyMessage("NOT_FOUND")).toMatch(/found/i);
    expect(friendlyMessage("STORAGE_ERROR")).toMatch(/sav|stor/i);
    expect(friendlyMessage("VALIDATION_ERROR")).toBeTruthy();
    expect(friendlyMessage("CONFLICT")).toBeTruthy();
    expect(friendlyMessage("MIGRATION_ERROR")).toBeTruthy();
  });

  test("unknown code falls back to provided message", () => {
    expect(friendlyMessage("WEIRD_CODE", "backend said no")).toBe("backend said no");
  });

  test("unknown code without fallback yields generic copy", () => {
    expect(friendlyMessage("WEIRD_CODE")).toMatch(/something went wrong/i);
  });

  test("never exposes raw codes to users", () => {
    for (const code of ["NOT_FOUND", "STORAGE_ERROR", "WEIRD_CODE"]) {
      expect(friendlyMessage(code)).not.toContain(code);
    }
  });
});
