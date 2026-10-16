import { describe, it, expect, afterEach } from "vitest";
import { render, cleanup } from "@testing-library/svelte";
import SpaceMarker from "./SpaceMarker.svelte";

afterEach(cleanup);

function parts(container: HTMLElement) {
  return {
    disc: container.querySelector("svg.disc"),
    flag: container.querySelector("svg.flag"),
  };
}

describe("SpaceMarker", () => {
  it("draws a solid disc in the space colour, through the theme variable", () => {
    const { container } = render(SpaceMarker, { color: "blue" });
    const solid = container.querySelector("circle.solid") as SVGElement;
    expect(solid.getAttribute("style")).toContain("var(--swatch-blue)");
    expect(parts(container).flag).toBeNull();
  });

  it("keeps a custom hex as it is", () => {
    const { container } = render(SpaceMarker, { color: "#3a7bff" });
    expect(container.querySelector("circle.solid")?.getAttribute("style")).toContain("rgb(58, 123, 255)");
  });

  it("is a neutral ring when there is neither a colour nor a slice", () => {
    const { container } = render(SpaceMarker, {});
    expect(container.querySelector("circle.neutral")).not.toBeNull();
    expect(container.querySelector("circle.solid")).toBeNull();
    expect(container.querySelectorAll("path.slice")).toHaveLength(0);
  });

  it("is a pie of the slices when the space has no colour", () => {
    const { container } = render(SpaceMarker, {
      slices: [
        { color: "red", noteCount: 1 },
        { color: "green", noteCount: 3 },
      ],
    });
    const slices = [...container.querySelectorAll("path.slice")];
    expect(slices).toHaveLength(2);
    expect(slices[0].getAttribute("style")).toContain("var(--swatch-green)");
    expect(container.querySelector("circle.centre")).toBeNull();
  });

  it("puts the space colour in the centre with the slices as an outer ring", () => {
    const { container } = render(SpaceMarker, {
      color: "purple",
      slices: [{ color: "red", noteCount: 2 }],
    });
    expect(container.querySelectorAll("path.slice")).toHaveLength(1);
    const centre = container.querySelector("circle.centre") as SVGElement;
    expect(centre.getAttribute("style")).toContain("var(--swatch-purple)");
  });

  it("draws the flag with a pole, a base and a pennant in the colour, no disc, in flag mode", () => {
    const { container } = render(SpaceMarker, { color: "red", mode: "flag" });
    const { disc, flag } = parts(container);
    expect(disc).toBeNull();
    expect(flag?.querySelector("rect.pole")).not.toBeNull();
    expect(flag?.querySelector("rect.base")).not.toBeNull();
    expect(flag?.querySelector("path.pennant")?.getAttribute("style")).toContain("var(--swatch-red)");
  });

  it("draws both in both mode", () => {
    const { container } = render(SpaceMarker, { color: "teal", mode: "both" });
    const { disc, flag } = parts(container);
    expect(disc).not.toBeNull();
    expect(flag).not.toBeNull();
  });

  it("lets the space's own flag force the flag in colour mode", () => {
    const off = render(SpaceMarker, { color: "teal", flag: false });
    expect(parts(off.container).flag).toBeNull();
    cleanup();
    const on = render(SpaceMarker, { color: "teal", flag: true });
    expect(parts(on.container).flag).not.toBeNull();
    expect(parts(on.container).disc).not.toBeNull();
  });

  it("colours the pennant from the biggest slice when the space has no colour, neutral when nothing", () => {
    const { container } = render(SpaceMarker, {
      mode: "flag",
      slices: [{ color: "orange", noteCount: 4 }],
    });
    expect(container.querySelector("path.pennant")?.getAttribute("style")).toContain("var(--swatch-orange)");
    cleanup();
    const bare = render(SpaceMarker, { mode: "flag" });
    expect(bare.container.querySelector("path.pennant")?.classList.contains("neutral")).toBe(true);
  });

  it("uses no emoji", () => {
    const { container } = render(SpaceMarker, { color: "red", mode: "both" });
    expect(container.textContent?.trim()).toBe("");
  });
});
