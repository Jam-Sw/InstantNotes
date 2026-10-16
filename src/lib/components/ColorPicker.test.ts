import { describe, it, expect, vi, afterEach } from "vitest";
import { render, fireEvent, cleanup } from "@testing-library/svelte";
import ColorPicker from "./ColorPicker.svelte";

afterEach(cleanup);

describe("ColorPicker", () => {
  it("renders a real dot for every swatch, each painted with its theme variable", () => {
    const { getAllByRole } = render(ColorPicker, { value: null, onpick: vi.fn() });
    const dots = getAllByRole("radio").filter((b) => b.classList.contains("dot"));
    expect(dots.map((d) => d.getAttribute("aria-label"))).toEqual([
      "red", "orange", "yellow", "green", "teal", "blue", "purple", "pink", "grey",
    ]);
    expect(dots[5].getAttribute("style")).toContain("var(--swatch-blue)");
  });

  it("picks a swatch by name", async () => {
    const onpick = vi.fn();
    const { getByRole } = render(ColorPicker, { value: null, onpick });
    await fireEvent.click(getByRole("radio", { name: "green" }));
    expect(onpick).toHaveBeenCalledWith("green");
  });

  it("marks the current swatch and None", () => {
    const withBlue = render(ColorPicker, { value: "blue", onpick: vi.fn() });
    expect(withBlue.getByRole("radio", { name: "blue" }).getAttribute("aria-checked")).toBe("true");
    expect(withBlue.getByRole("radio", { name: /None/ }).getAttribute("aria-checked")).toBe("false");
    cleanup();
    const none = render(ColorPicker, { value: null, onpick: vi.fn() });
    expect(none.getByRole("radio", { name: /None/ }).getAttribute("aria-checked")).toBe("true");
  });

  it("clears with None", async () => {
    const onpick = vi.fn();
    const { getByRole } = render(ColorPicker, { value: "red", onpick });
    await fireEvent.click(getByRole("radio", { name: /None/ }));
    expect(onpick).toHaveBeenCalledWith(null);
  });

  it("takes a custom #rrggbb, normalised, on Enter", async () => {
    const onpick = vi.fn();
    const { getByRole } = render(ColorPicker, { value: null, onpick });
    await fireEvent.click(getByRole("radio", { name: /Custom/ }));
    const input = getByRole("textbox") as HTMLInputElement;
    await fireEvent.input(input, { target: { value: "3A7BFF" } });
    await fireEvent.keyDown(input, { key: "Enter" });
    expect(onpick).toHaveBeenCalledWith("#3a7bff");
  });

  it("refuses an invalid custom value", async () => {
    const onpick = vi.fn();
    const { getByRole } = render(ColorPicker, { value: null, onpick });
    await fireEvent.click(getByRole("radio", { name: /Custom/ }));
    const input = getByRole("textbox") as HTMLInputElement;
    await fireEvent.input(input, { target: { value: "#zzz" } });
    await fireEvent.keyDown(input, { key: "Enter" });
    expect(onpick).not.toHaveBeenCalled();
    expect(input.getAttribute("aria-invalid")).toBe("true");
    expect((getByRole("button", { name: "Set" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("shows an existing custom colour as checked and prefilled", async () => {
    const { getByRole } = render(ColorPicker, { value: "#112233", onpick: vi.fn() });
    const custom = getByRole("radio", { name: /Custom/ });
    expect(custom.getAttribute("aria-checked")).toBe("true");
    await fireEvent.click(custom);
    expect((getByRole("textbox") as HTMLInputElement).value).toBe("#112233");
  });

  it("moves between choices with the arrow keys", async () => {
    const { getByRole } = render(ColorPicker, { value: "red", onpick: vi.fn() });
    const red = getByRole("radio", { name: "red" });
    red.focus();
    await fireEvent.keyDown(red, { key: "ArrowRight" });
    expect(document.activeElement).toBe(getByRole("radio", { name: "orange" }));
  });
});
