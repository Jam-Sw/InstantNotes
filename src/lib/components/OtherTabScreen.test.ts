import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render } from "@testing-library/svelte";
import { tick } from "svelte";
import OtherTabScreen from "./OtherTabScreen.svelte";
import { tab } from "$lib/web/tab.svelte";

afterEach(cleanup);

beforeEach(() => {
  tab.elsewhere = false;
  vi.restoreAllMocks();
});

describe("OtherTabScreen", () => {
  it("is hidden while this tab holds the library", () => {
    const { queryByRole } = render(OtherTabScreen);
    expect(queryByRole("alertdialog")).toBeNull();
  });

  it("shows when the library is open in another tab", async () => {
    const { getByRole, getByText } = render(OtherTabScreen);
    tab.elsewhere = true;
    await tick();
    expect(getByRole("alertdialog")).toBeTruthy();
    expect(getByText("InstantNotes is open in another tab.")).toBeTruthy();
  });

  it("moves the library here when Use here is pressed", async () => {
    const useHere = vi.spyOn(tab, "useHere").mockImplementation(() => {});
    tab.elsewhere = true;
    const { getByRole } = render(OtherTabScreen);
    await fireEvent.click(getByRole("button", { name: "Use here" }));
    expect(useHere).toHaveBeenCalledOnce();
  });
});
