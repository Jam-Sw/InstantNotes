import { describe, it, expect, vi, afterEach } from "vitest";
import { render, fireEvent, cleanup } from "@testing-library/svelte";
import SettingsMarkers from "./SettingsMarkers.svelte";
import { library } from "$lib/stores/library.svelte";
import { markerPrefs } from "$lib/stores/markers.svelte";
import { setSetting } from "$lib/api/client";

vi.mock("$lib/api/client", () => ({
  getSetting: vi.fn(async () => null),
  setSetting: vi.fn(async () => {}),
}));

afterEach(() => {
  cleanup();
  markerPrefs.mode = "color";
  library.workspaces = [];
  library.tagSlices = [];
  vi.mocked(setSetting).mockClear();
});

describe("SettingsMarkers", () => {
  it("offers Color, Flag and Both, each with a real marker preview", () => {
    const { getAllByRole } = render(SettingsMarkers);
    const cards = getAllByRole("radio");
    expect(cards.map((c) => c.querySelector(".card-label")?.textContent)).toEqual(["Color", "Flag", "Both"]);
    expect(cards[0].querySelector("svg.disc")).not.toBeNull();
    expect(cards[0].querySelector("svg.flag")).toBeNull();
    expect(cards[1].querySelector("svg.disc")).toBeNull();
    expect(cards[1].querySelector("svg.flag")).not.toBeNull();
    expect(cards[2].querySelector("svg.disc")).not.toBeNull();
    expect(cards[2].querySelector("svg.flag")).not.toBeNull();
  });

  it("starts on Color", () => {
    const { getByRole } = render(SettingsMarkers);
    expect(getByRole("radio", { name: /Color/ }).getAttribute("aria-checked")).toBe("true");
  });

  it("saves the choice under spaceMarker", async () => {
    const { getByRole } = render(SettingsMarkers);
    await fireEvent.click(getByRole("radio", { name: /Flag/ }));
    expect(markerPrefs.mode).toBe("flag");
    expect(setSetting).toHaveBeenCalledWith("spaceMarker", "flag");
  });

  it("previews with the person's own coloured space", () => {
    library.workspaces = [
      { id: "w1", name: "Movies", createdAt: "", updatedAt: "", noteCount: 1, color: "pink", flag: false },
    ];
    const { getAllByRole, container } = render(SettingsMarkers);
    expect(container.textContent).toContain('"Movies"');
    expect(getAllByRole("radio")[0].querySelector("circle.solid")?.getAttribute("style")).toContain(
      "var(--swatch-pink)",
    );
  });
});
