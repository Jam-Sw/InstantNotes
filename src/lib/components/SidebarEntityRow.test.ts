// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, fireEvent, cleanup, waitFor } from "@testing-library/svelte";
import SidebarEntityRow from "./SidebarEntityRow.svelte";

afterEach(cleanup);

function base(overrides: Record<string, unknown> = {}) {
  return {
    name: "Projects",
    count: 3,
    normalize: (s: string) => s.trim(),
    noun: "Space",
    active: false,
    editing: false,
    onSelect: vi.fn(),
    onStartRename: vi.fn(),
    onRename: vi.fn().mockResolvedValue({ ok: true }),
    onDoneRename: vi.fn(),
    onMenu: vi.fn(),
    ...overrides,
  };
}

describe("SidebarEntityRow", () => {
  it("renders name (with prefix) and count, and selects on click", async () => {
    const props = base({ prefix: "#", name: "idea", count: 5 });
    const { getByRole } = render(SidebarEntityRow, props);
    const button = getByRole("button");
    expect(button.textContent).toContain("#idea");
    expect(button.textContent).toContain("5");
    await fireEvent.click(button);
    expect(props.onSelect).toHaveBeenCalledTimes(1);
  });

  it("opens the context menu on right-click", async () => {
    const props = base();
    const { getByRole } = render(SidebarEntityRow, props);
    await fireEvent.contextMenu(getByRole("button"));
    expect(props.onMenu).toHaveBeenCalledTimes(1);
  });

  it("commits a normalized new name on Enter and finishes editing", async () => {
    const props = base({ editing: true, name: "old" });
    const { getByRole } = render(SidebarEntityRow, props);
    const input = getByRole("textbox") as HTMLInputElement;
    await fireEvent.input(input, { target: { value: "  new name  " } });
    await fireEvent.keyDown(input, { key: "Enter" });
    expect(props.onRename).toHaveBeenCalledWith("new name");
    await waitFor(() => expect(props.onDoneRename).toHaveBeenCalledTimes(1));
  });

  it("shows an error and does not call onRename when the name is empty", async () => {
    const props = base({ editing: true, name: "old" });
    const { getByRole, findByRole } = render(SidebarEntityRow, props);
    const input = getByRole("textbox") as HTMLInputElement;
    await fireEvent.input(input, { target: { value: "   " } });
    await fireEvent.keyDown(input, { key: "Enter" });
    const alert = await findByRole("alert");
    expect(alert.textContent).toContain("Space name can't be empty");
    expect(props.onRename).not.toHaveBeenCalled();
  });

  it("cancels on Escape without renaming", async () => {
    const props = base({ editing: true, name: "old" });
    const { getByRole } = render(SidebarEntityRow, props);
    const input = getByRole("textbox") as HTMLInputElement;
    await fireEvent.input(input, { target: { value: "changed" } });
    await fireEvent.keyDown(input, { key: "Escape" });
    expect(props.onRename).not.toHaveBeenCalled();
    await waitFor(() => expect(props.onDoneRename).toHaveBeenCalledTimes(1));
  });
});
