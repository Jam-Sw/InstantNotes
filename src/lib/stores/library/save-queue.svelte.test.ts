import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { updateNote } from "$lib/api/client";
import type { Note } from "$lib/api/types";
import { SaveQueue } from "./save-queue.svelte";

vi.mock("$lib/api/client", () => {
  class ApiError extends Error {
    code = "";
  }
  return { ApiError, getNote: vi.fn(), updateNote: vi.fn() };
});

const mockUpdateNote = vi.mocked(updateNote);

const saved = { id: "n1", updatedAt: "2026-01-01T00:00:00Z" } as Note;

function queueWith(delayMs?: () => number): SaveQueue {
  return new SaveQueue({ onPersisted: () => {}, onError: () => {}, delayMs });
}

beforeEach(() => {
  vi.useFakeTimers();
  mockUpdateNote.mockReset().mockResolvedValue(saved);
});

afterEach(() => {
  vi.useRealTimers();
});

describe("SaveQueue autosave delay", () => {
  it("waits 400 ms by default", async () => {
    const q = queueWith();
    q.queue("n1", { body: "a" });
    await vi.advanceTimersByTimeAsync(399);
    expect(mockUpdateNote).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(mockUpdateNote).toHaveBeenCalledTimes(1);
  });

  it("follows the configured delay as it changes", async () => {
    let ms = 150;
    const q = queueWith(() => ms);
    q.queue("n1", { body: "a" });
    await vi.advanceTimersByTimeAsync(150);
    expect(mockUpdateNote).toHaveBeenCalledTimes(1);
    ms = 1000;
    q.queue("n1", { body: "b" });
    await vi.advanceTimersByTimeAsync(999);
    expect(mockUpdateNote).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(mockUpdateNote).toHaveBeenCalledTimes(2);
  });
});
