import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { stores } = vi.hoisted(() => ({
  stores: {
    library: { graphMode: true },
    layout: { phone: false, back: vi.fn() },
    shell: { closeSettings: vi.fn() },
    sidebar: { revealList: vi.fn() },
  },
}));

vi.mock("$lib/stores/library.svelte", () => ({ library: stores.library }));
vi.mock("$lib/stores/layout.svelte", () => ({ layout: stores.layout }));
vi.mock("$lib/stores/shell.svelte", () => ({ shell: stores.shell }));
vi.mock("$lib/stores/sidebar.svelte", () => ({ sidebar: stores.sidebar }));

import { focusSearch } from "./search-focus";

function mountList(query: string, inert = false): HTMLInputElement {
  document.body.innerHTML = `<div class="list-slot"${inert ? " inert" : ""}><section class="list-pane"><input class="search" type="search"></section></div>`;
  const input = document.querySelector<HTMLInputElement>("input.search")!;
  input.value = query;
  return input;
}

beforeEach(() => {
  stores.library.graphMode = true;
  stores.layout.phone = false;
});

afterEach(() => {
  document.body.innerHTML = "";
  vi.clearAllMocks();
});

describe("focusing search", () => {
  it("reveals the list, leaves the graph and settings, and selects the query in the field", async () => {
    const input = mountList("alpha");
    expect(await focusSearch()).toBe(true);
    expect(stores.sidebar.revealList).toHaveBeenCalledOnce();
    expect(stores.layout.back).not.toHaveBeenCalled();
    expect(stores.shell.closeSettings).toHaveBeenCalledOnce();
    expect(stores.library.graphMode).toBe(false);
    expect(document.activeElement).toBe(input);
    expect([input.selectionStart, input.selectionEnd]).toEqual([0, 5]);
  });

  it("puts the cursor at the end when typing carries over", async () => {
    const input = mountList("trip");
    expect(await focusSearch(document, { select: false })).toBe(true);
    expect([input.selectionStart, input.selectionEnd]).toEqual([4, 4]);
  });

  it("waits for a hidden list to become focusable", async () => {
    const input = mountList("", true);
    const pending = focusSearch();
    await new Promise((resolve) => requestAnimationFrame(() => resolve(null)));
    expect(document.activeElement).not.toBe(input);
    document.querySelector(".list-slot")!.removeAttribute("inert");
    expect(await pending).toBe(true);
    expect(document.activeElement).toBe(input);
  });

  it("goes back to the list on the phone instead of revealing a pane", async () => {
    stores.layout.phone = true;
    mountList("");
    expect(await focusSearch()).toBe(true);
    expect(stores.layout.back).toHaveBeenCalledOnce();
    expect(stores.sidebar.revealList).not.toHaveBeenCalled();
  });

  it("gives up when no list ever shows", async () => {
    expect(await focusSearch()).toBe(false);
  });
});
