import { describe, it, expect, vi, afterEach } from "vitest";
import { render, fireEvent, cleanup, waitFor } from "@testing-library/svelte";
import ContextMenu from "./ContextMenu.svelte";

afterEach(cleanup);

function setup() {
  const onclose = vi.fn();
  const onpick = vi.fn();
  const toggle = vi.fn();
  const view = render(ContextMenu, {
    x: 10,
    y: 10,
    onclose,
    items: [
      { label: "Rename", run: vi.fn() },
      { label: "Color", color: { value: "red", onpick } },
      { label: "Show flag", checked: false, run: toggle },
    ],
  });
  return { ...view, onclose, onpick, toggle };
}

describe("ContextMenu colour picker", () => {
  it("offers the swatches inline and closes after a pick", async () => {
    const { getByRole, onpick, onclose } = setup();
    await fireEvent.click(getByRole("radio", { name: "blue" }));
    expect(onclose).toHaveBeenCalled();
    await waitFor(() => expect(onpick).toHaveBeenCalledWith("blue"));
  });

  it("offers None and Custom", async () => {
    const { getByRole, onpick } = setup();
    await fireEvent.click(getByRole("radio", { name: /None/ }));
    await waitFor(() => expect(onpick).toHaveBeenCalledWith(null));
    expect(getByRole("radio", { name: /Custom/ })).toBeTruthy();
  });

  it("renders a toggle as a checkbox item that reports its state", () => {
    const { getByRole } = setup();
    const item = getByRole("menuitemcheckbox", { name: /Show flag/ });
    expect(item.getAttribute("aria-checked")).toBe("false");
  });

  it("runs a toggle and closes", async () => {
    const { getByRole, toggle, onclose } = setup();
    await fireEvent.click(getByRole("menuitemcheckbox", { name: /Show flag/ }));
    expect(onclose).toHaveBeenCalled();
    await waitFor(() => expect(toggle).toHaveBeenCalled());
  });

  it("arrow keys step through items and skip the swatch dots that are not the stop", async () => {
    const { getByRole } = setup();
    const menu = getByRole("menu");
    const rename = getByRole("menuitem", { name: "Rename" });
    expect(document.activeElement).toBe(rename);
    await fireEvent.keyDown(menu, { key: "ArrowDown" });
    expect(document.activeElement).toBe(getByRole("radio", { name: "red" }));
    await fireEvent.keyDown(menu, { key: "ArrowDown" });
    expect(document.activeElement).toBe(getByRole("menuitemcheckbox", { name: /Show flag/ }));
  });
});
