import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { render, fireEvent, cleanup } from "@testing-library/svelte";
import SettingsGraph from "./SettingsGraph.svelte";
import { graphPrefs } from "$lib/stores/graph.svelte";
import { setSetting } from "$lib/api/client";

vi.mock("$lib/api/client", () => ({
  getSetting: vi.fn().mockResolvedValue(undefined),
  setSetting: vi.fn().mockResolvedValue(undefined),
}));

afterEach(cleanup);

beforeEach(() => {
  graphPrefs.labels = "focus";
  graphPrefs.nodeSize = 1;
  graphPrefs.spread = 1;
  graphPrefs.lensHops = 2;
  vi.mocked(setSetting).mockClear();
});

describe("SettingsGraph", () => {
  it("shows labels and node size, with spread and depth under More", () => {
    const { getByRole, getByLabelText, getByText } = render(SettingsGraph);
    getByRole("radiogroup", { name: "Labels" });
    getByLabelText("Node size");
    const more = getByText("More").closest("details");
    expect(more?.open).toBe(false);
    expect(more?.querySelector('[aria-label="Spread"]')).not.toBeNull();
    expect(more?.querySelector('[aria-label="Focus depth"]')).not.toBeNull();
  });

  it("saves the chosen values", async () => {
    const { getByRole, getByLabelText } = render(SettingsGraph);
    await fireEvent.click(getByRole("radio", { name: "All" }));
    expect(graphPrefs.labels).toBe("all");
    expect(setSetting).toHaveBeenLastCalledWith("graph.labels", "all");
    await fireEvent.click(getByRole("radio", { name: "3" }));
    expect(graphPrefs.lensHops).toBe(3);
    expect(setSetting).toHaveBeenLastCalledWith("graph.lensHops", 3);
    await fireEvent.input(getByLabelText("Node size"), { target: { value: "1.5" } });
    expect(setSetting).toHaveBeenLastCalledWith("graph.nodeSize", 1.5);
    await fireEvent.input(getByLabelText("Spread"), { target: { value: "0.8" } });
    expect(setSetting).toHaveBeenLastCalledWith("graph.spread", 0.8);
  });

  it("starts the sliders at the defaults within their bounds", () => {
    const { getByLabelText } = render(SettingsGraph);
    for (const name of ["Node size", "Spread"]) {
      const s = getByLabelText(name) as HTMLInputElement;
      expect([s.value, s.min, s.max, s.step]).toEqual(["1", "0.5", "2", "0.1"]);
    }
  });
});

describe("SettingsGraph reset", () => {
  it("resets changed rows to the defaults", async () => {
    const { getByRole, getByLabelText, queryAllByRole } = render(SettingsGraph);
    expect(queryAllByRole("button", { name: "Reset" })).toHaveLength(0);
    await fireEvent.click(getByRole("radio", { name: "All" }));
    await fireEvent.input(getByLabelText("Node size"), { target: { value: "1.5" } });
    await fireEvent.click(getByRole("radio", { name: "3" }));
    const buttons = queryAllByRole("button", { name: "Reset" });
    expect(buttons).toHaveLength(3);
    for (const b of buttons) await fireEvent.click(b);
    expect([graphPrefs.labels, graphPrefs.nodeSize, graphPrefs.lensHops]).toEqual(["focus", 1, 2]);
    expect(queryAllByRole("button", { name: "Reset" })).toHaveLength(0);
  });
});
