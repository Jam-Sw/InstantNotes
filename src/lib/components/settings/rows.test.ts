// @vitest-environment jsdom
// The two settings row primitives. They are shared by every settings page, so
// their props and their keyboard behavior are covered here rather than
// re-tested through each page that mounts them.
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, fireEvent, cleanup } from "@testing-library/svelte";
import SegmentedRow from "./SegmentedRow.svelte";
import ToggleRow from "./ToggleRow.svelte";

afterEach(cleanup);

const OPTIONS = [
  { value: "copy", label: "Copy in" },
  { value: "link", label: "Link original" },
  { value: "ask", label: "Ask" },
];

// A key press lands on the focused segment, which is the selected one: the
// group itself is never a tab stop.
function press(radios: HTMLElement[], key: string) {
  const focused = radios.find((r) => r.getAttribute("tabindex") === "0") ?? radios[0];
  return fireEvent.keyDown(focused, { key });
}

function segment(overrides: Record<string, unknown> = {}) {
  return {
    label: "When adding an image",
    options: OPTIONS,
    value: "copy",
    onchange: vi.fn(),
    ...overrides,
  };
}

describe("SegmentedRow", () => {
  it("renders one radio per option and marks the selected one", () => {
    const { getAllByRole } = render(SegmentedRow, segment({ value: "link" }));
    const radios = getAllByRole("radio");
    expect(radios.map((r) => r.textContent)).toEqual(["Copy in", "Link original", "Ask"]);
    expect(radios.map((r) => r.getAttribute("aria-checked"))).toEqual(["false", "true", "false"]);
  });

  it("makes only the selected segment a tab stop", () => {
    const { getAllByRole } = render(SegmentedRow, segment({ value: "link" }));
    expect(getAllByRole("radio").map((r) => r.getAttribute("tabindex"))).toEqual(["-1", "0", "-1"]);
  });

  it("reports the new value on click, and stays quiet when it is already selected", async () => {
    const props = segment();
    const { getAllByRole } = render(SegmentedRow, props);
    await fireEvent.click(getAllByRole("radio")[2]);
    expect(props.onchange).toHaveBeenCalledWith("ask");

    await fireEvent.click(getAllByRole("radio")[0]);
    expect(props.onchange).toHaveBeenCalledTimes(1);
  });

  it("moves the selection with the arrow keys, wrapping at both ends", async () => {
    const props = segment();
    const { getAllByRole } = render(SegmentedRow, props);
    const radios = getAllByRole("radio");

    await press(radios, "ArrowRight");
    expect(props.onchange).toHaveBeenLastCalledWith("link");

    // Down and up are the same axis as right and left on a segmented control.
    await press(radios, "ArrowDown");
    expect(props.onchange).toHaveBeenLastCalledWith("link");

    // From the first option, going back wraps to the last.
    await press(radios, "ArrowLeft");
    expect(props.onchange).toHaveBeenLastCalledWith("ask");
  });

  it("jumps to the ends with Home and End", async () => {
    const props = segment({ value: "link" });
    const { getAllByRole } = render(SegmentedRow, props);
    const radios = getAllByRole("radio");

    await press(radios, "End");
    expect(props.onchange).toHaveBeenLastCalledWith("ask");

    await press(radios, "Home");
    expect(props.onchange).toHaveBeenLastCalledWith("copy");
  });

  it("keeps focus on the segment the keyboard moved to", async () => {
    const { getAllByRole } = render(SegmentedRow, segment());
    const radios = getAllByRole("radio");
    await press(radios, "End");
    expect(document.activeElement).toBe(radios[2]);
  });

  it("leaves keys it does not handle to the page", async () => {
    const props = segment();
    const { getAllByRole } = render(SegmentedRow, props);
    const notPrevented = await press(getAllByRole("radio"), "Tab");
    expect(notPrevented).toBe(true);
    expect(props.onchange).not.toHaveBeenCalled();
  });

  it("is inert when disabled, by pointer and by keyboard", async () => {
    const props = segment({ disabled: true });
    const { getAllByRole } = render(SegmentedRow, props);
    const radios = getAllByRole("radio");
    expect(radios.every((r) => (r as HTMLButtonElement).disabled)).toBe(true);

    await fireEvent.click(radios[1]);
    await press(radios, "ArrowRight");
    expect(props.onchange).not.toHaveBeenCalled();
  });

  it("announces the sub line as the control's description", () => {
    const sub = "Copy keeps a portable copy inside InstantNotes.";
    const { getByRole, getByText } = render(SegmentedRow, segment({ sub }));
    const describedBy = getByRole("radiogroup").getAttribute("aria-describedby");
    expect(describedBy).toBeTruthy();
    expect(getByText(sub).id).toBe(describedBy);
  });

  it("carries no description when there is no sub line", () => {
    const { getByRole } = render(SegmentedRow, segment());
    expect(getByRole("radiogroup").getAttribute("aria-describedby")).toBe(null);
  });
});

function toggle(overrides: Record<string, unknown> = {}) {
  return {
    label: "Show exact save time",
    checked: false,
    onchange: vi.fn(),
    ...overrides,
  };
}

describe("ToggleRow", () => {
  it("reports the flipped value on click", async () => {
    const props = toggle();
    const { getByRole } = render(ToggleRow, props);
    const sw = getByRole("switch", { name: "Show exact save time" });
    expect(sw.getAttribute("aria-checked")).toBe("false");
    await fireEvent.click(sw);
    expect(props.onchange).toHaveBeenCalledWith(true);
  });

  it("reports false when it is already on", async () => {
    const props = toggle({ checked: true });
    const { getByRole } = render(ToggleRow, props);
    expect(getByRole("switch").getAttribute("aria-checked")).toBe("true");
    await fireEvent.click(getByRole("switch"));
    expect(props.onchange).toHaveBeenCalledWith(false);
  });

  it("is inert when disabled", async () => {
    const props = toggle({ disabled: true });
    const { getByRole } = render(ToggleRow, props);
    expect((getByRole("switch") as HTMLButtonElement).disabled).toBe(true);
    await fireEvent.click(getByRole("switch"));
    expect(props.onchange).not.toHaveBeenCalled();
  });

  it("announces the sub line as the switch's description", () => {
    const sub = "The exact time is always on hover.";
    const { getByRole, getByText } = render(ToggleRow, toggle({ sub }));
    const describedBy = getByRole("switch").getAttribute("aria-describedby");
    expect(describedBy).toBeTruthy();
    expect(getByText(sub).id).toBe(describedBy);
  });
});
