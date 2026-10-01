// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { render, fireEvent, cleanup } from "@testing-library/svelte";
import SettingsFeedback from "./SettingsFeedback.svelte";
import { submitFeedback, openFeedbackLog, openUrl } from "$lib/api/client";
import { toasts } from "$lib/stores/toasts.svelte";

vi.mock("$lib/api/client", () => ({
  getLibraryStats: vi.fn().mockResolvedValue({
    notesTotal: 12,
    notesActive: 10,
    notesPinned: 1,
    notesArchived: 1,
    notesTrashed: 0,
    tags: 3,
    spaces: 2,
    attachmentsCount: 4,
    attachmentsBytes: 2048,
  }),
  submitFeedback: vi.fn().mockResolvedValue(undefined),
  openFeedbackLog: vi.fn().mockResolvedValue(undefined),
  openUrl: vi.fn().mockResolvedValue(undefined),
}));

afterEach(cleanup);

beforeEach(() => {
  vi.mocked(submitFeedback).mockReset().mockResolvedValue(undefined);
  vi.mocked(openFeedbackLog).mockReset().mockResolvedValue(undefined);
  vi.mocked(openUrl).mockReset().mockResolvedValue(undefined);
  toasts.items = [];
});

function open() {
  return render(SettingsFeedback, { appVersion: "0.9.0" });
}

function lastToast(): string | undefined {
  return toasts.items.at(-1)?.message;
}

describe("SettingsFeedback", () => {
  it("defaults to the Bug category with Bug-flavored placeholder copy", () => {
    const { getByRole, getByPlaceholderText } = open();
    const radios = getByRole("radiogroup").querySelectorAll('[role="radio"]');
    expect([...radios].map((r) => r.textContent)).toEqual(["Bug", "Idea", "Other"]);
    expect([...radios].map((r) => r.getAttribute("aria-checked"))).toEqual([
      "true",
      "false",
      "false",
    ]);
    expect(getByPlaceholderText(/what did you expect/i)).toBeTruthy();
  });

  it("switching category changes the placeholder copy", async () => {
    const { getByRole, getByPlaceholderText } = open();
    await fireEvent.click(getByRole("radio", { name: "Idea" }));
    expect(getByPlaceholderText(/better for you/i)).toBeTruthy();
  });

  it("disables Send while the message is empty or only whitespace", async () => {
    const { getByRole, getByLabelText } = open();
    const send = getByRole("button", { name: /send feedback/i }) as HTMLButtonElement;
    expect(send.disabled).toBe(true);

    await fireEvent.input(getByLabelText("Message"), { target: { value: "   " } });
    expect(send.disabled).toBe(true);

    await fireEvent.input(getByLabelText("Message"), { target: { value: "found a bug" } });
    expect(send.disabled).toBe(false);
  });

  it("submits, clears the message, and opens the prefilled GitHub issue on success", async () => {
    const { getByRole, getByLabelText } = open();
    await fireEvent.input(getByLabelText("Message"), { target: { value: "found a bug" } });
    await fireEvent.click(getByRole("button", { name: /send feedback/i }));

    expect(vi.mocked(submitFeedback)).toHaveBeenCalledWith(
      expect.objectContaining({ category: "bug", message: "found a bug", appVersion: "0.9.0" }),
    );
    expect(vi.mocked(openUrl)).toHaveBeenCalled();
    expect((getByLabelText("Message") as HTMLTextAreaElement).value).toBe("");
    expect(lastToast()).toMatch(/thanks/i);
  });

  it("keeps the draft and reports the error when the local save fails", async () => {
    vi.mocked(submitFeedback).mockRejectedValueOnce(new Error("disk full"));
    const { getByRole, getByLabelText } = open();
    await fireEvent.input(getByLabelText("Message"), { target: { value: "found a bug" } });
    await fireEvent.click(getByRole("button", { name: /send feedback/i }));

    expect(vi.mocked(openUrl)).not.toHaveBeenCalled();
    expect((getByLabelText("Message") as HTMLTextAreaElement).value).toBe("found a bug");
    expect(lastToast()).toMatch(/couldn't send feedback/i);
  });

  it("still saves and clears the draft when only the GitHub hand-off fails", async () => {
    vi.mocked(openUrl).mockRejectedValueOnce(new Error("no browser"));
    const { getByRole, getByLabelText } = open();
    await fireEvent.input(getByLabelText("Message"), { target: { value: "found a bug" } });
    await fireEvent.click(getByRole("button", { name: /send feedback/i }));

    expect(vi.mocked(submitFeedback)).toHaveBeenCalled();
    expect((getByLabelText("Message") as HTMLTextAreaElement).value).toBe("");
    expect(lastToast()).toMatch(/saved locally, but couldn't open github/i);
  });

  it("reveals the feedback log from its button", async () => {
    const { getByRole } = open();
    await fireEvent.click(getByRole("button", { name: /reveal saved feedback/i }));
    expect(vi.mocked(openFeedbackLog)).toHaveBeenCalled();
  });

  it("hides the diagnostics preview when the toggle is off, without dropping it from the submission", async () => {
    const { getByRole, getByLabelText, queryByText } = open();
    await fireEvent.click(getByRole("switch", { name: "Include diagnostics" }));
    expect(queryByText(/App version/)).toBeNull();

    await fireEvent.input(getByLabelText("Message"), { target: { value: "an idea" } });
    await fireEvent.click(getByRole("button", { name: /send feedback/i }));
    expect(vi.mocked(submitFeedback)).toHaveBeenCalledWith(
      expect.objectContaining({ diagnostics: null }),
    );
  });
});
