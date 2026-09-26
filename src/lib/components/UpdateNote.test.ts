// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render } from "@testing-library/svelte";
import UpdateNote from "./UpdateNote.svelte";
import { updater } from "$lib/stores/updater.svelte";

vi.mock("@tauri-apps/plugin-updater", () => ({ check: vi.fn() }));

afterEach(cleanup);

beforeEach(() => {
  updater.status = "available";
  updater.version = "0.10.0";
  updater.currentVersion = "0.9.0";
  updater.notes = null;
  updater.date = null;
  updater.progress = null;
  updater.error = null;
  updater.sizeDelta = null;
  updater.deltaState = "idle";
});

describe("UpdateNote", () => {
  it("names the version jump and offers the Update button", async () => {
    const run = vi
      .spyOn(updater, "downloadAndInstall")
      .mockResolvedValue(undefined);
    const { getByText } = render(UpdateNote);

    expect(getByText("update 0.9.0 → 0.10.0")).toBeTruthy();
    await fireEvent.click(getByText("Update"));
    expect(run).toHaveBeenCalledTimes(1);
  });

  it("shows the size delta against the running version", () => {
    updater.sizeDelta = 1_258_291;
    updater.deltaState = "ready";
    const { getByText } = render(UpdateNote);
    expect(
      getByText("The download is 1.2 MB larger than v0.9.0."),
    ).toBeTruthy();
  });

  it("shows progress while installing", () => {
    updater.status = "downloading";
    updater.progress = 0.42;
    const { getByText } = render(UpdateNote);
    expect(getByText(/42% · Installing v0.10.0/)).toBeTruthy();
  });

  it("answers the finished install with Ok, which dismisses", async () => {
    updater.status = "ready";
    const done = vi.spyOn(updater, "acknowledge").mockImplementation(() => {});
    const { getByText } = render(UpdateNote);

    expect(getByText(/is installed/)).toBeTruthy();
    await fireEvent.click(getByText("Ok"));
    expect(done).toHaveBeenCalledTimes(1);
  });

  it("surfaces a failed install with a retry", async () => {
    updater.status = "error";
    updater.error = "network unreachable";
    const run = vi
      .spyOn(updater, "downloadAndInstall")
      .mockResolvedValue(undefined);
    const { getByText } = render(UpdateNote);

    expect(getByText("network unreachable")).toBeTruthy();
    await fireEvent.click(getByText("Try again"));
    expect(run).toHaveBeenCalledTimes(1);
  });
});
