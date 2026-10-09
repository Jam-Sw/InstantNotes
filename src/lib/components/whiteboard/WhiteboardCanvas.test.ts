import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { render, cleanup, waitFor } from "@testing-library/svelte";
import WhiteboardCanvas from "./WhiteboardCanvas.svelte";
import { serializeBoard, emptyBoard } from "$lib/whiteboard/document";

type Rendered = { type: unknown; props: Record<string, any>; children: unknown[] };
const rendered: Rendered[] = [];
const unmount = vi.fn();

vi.mock("react", () => ({
  createElement: (type: unknown, props: Record<string, unknown> | null, ...children: unknown[]) => ({
    type,
    props: props ?? {},
    children,
  }),
}));
vi.mock("react-dom/client", () => ({
  createRoot: () => ({ render: (el: Rendered) => rendered.push(el), unmount }),
}));
vi.mock("@excalidraw/excalidraw/index.css", () => ({}));
vi.mock("$lib/whiteboard/excalidraw", () => {
  const Stub = () => null;
  const MainMenu = Object.assign(() => null, {
    DefaultItems: { ChangeCanvasBackground: Stub, ClearCanvas: Stub, Help: Stub },
  });
  const WelcomeScreen = Object.assign(() => null, {
    Hints: { MenuHint: Stub, ToolbarHint: Stub, HelpHint: Stub },
  });
  return {
    loadExcalidraw: async () => ({ Excalidraw: Stub, MainMenu, WelcomeScreen }),
  };
});

const rect = (id: string, version = 1, extra = {}) => ({
  id,
  type: "rectangle",
  x: 0,
  y: 0,
  version,
  ...extra,
});
const label = (id: string, text: string) => ({ id, type: "text", x: 0, y: 0, version: 1, text });

const STORED = serializeBoard({ ...emptyBoard(), elements: [rect("r1") as never] });

function mount(overrides: Record<string, unknown> = {}) {
  const onchange = vi.fn();
  let flushHook: (() => void) | null = null;
  const onlinkopen = vi.fn();
  const view = render(WhiteboardCanvas, {
    noteId: "b1",
    surfaceData: STORED,
    readonly: false,
    theme: "light",
    onchange,
    registerFlush: (f: () => void) => {
      flushHook = f;
      return () => (flushHook = null);
    },
    onlinkopen,
    ...overrides,
  });
  return { view, onchange, onlinkopen, flushHook: () => flushHook };
}

const latest = () => rendered[rendered.length - 1];
const excalidrawProps = () => latest().props;

beforeEach(() => {
  rendered.length = 0;
  unmount.mockReset();
  vi.useFakeTimers({ shouldAdvanceTime: true });
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("WhiteboardCanvas", () => {
  it("opens the stored board", async () => {
    mount();
    await waitFor(() => expect(rendered.length).toBe(1));
    expect(excalidrawProps().initialData.elements).toEqual([rect("r1")]);
    expect(excalidrawProps().theme).toBe("light");
  });

  it("does not save when nothing on the board changed (scroll, zoom, select)", async () => {
    const { onchange } = mount();
    await waitFor(() => expect(rendered.length).toBe(1));
    excalidrawProps().onChange([rect("r1")], { scrollX: 40 }, {});
    await vi.advanceTimersByTimeAsync(1000);
    expect(onchange).not.toHaveBeenCalled();
  });

  it("saves an edit, with the words on the board as the note's text", async () => {
    const { onchange } = mount();
    await waitFor(() => expect(rendered.length).toBe(1));
    excalidrawProps().onChange(
      [rect("r1", 2), label("t1", "ship it")],
      { viewBackgroundColor: "#fff", selectedElementIds: { r1: true } },
      {},
    );
    expect(onchange).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(250);
    expect(onchange).toHaveBeenCalledTimes(1);
    const [id, edit] = onchange.mock.calls[0];
    expect(id).toBe("b1");
    expect(edit.body).toBe("ship it");
    const saved = JSON.parse(edit.surfaceData).data;
    expect(saved.elements.map((e: { id: string }) => e.id)).toEqual(["r1", "t1"]);
    expect(saved.appState).not.toHaveProperty("selectedElementIds");
    expect(saved.appState.viewBackgroundColor).toBe("#fff");
  });

  it("batches a burst of changes into one save of the latest scene", async () => {
    const { onchange } = mount();
    await waitFor(() => expect(rendered.length).toBe(1));
    for (let v = 2; v <= 6; v++) excalidrawProps().onChange([rect("r1", v)], {}, {});
    await vi.advanceTimersByTimeAsync(250);
    expect(onchange).toHaveBeenCalledTimes(1);
    expect(JSON.parse(onchange.mock.calls[0][1].surfaceData).data.elements[0].version).toBe(6);
  });

  it("leaves deleted elements and the images only they used out of the save", async () => {
    const { onchange } = mount();
    await waitFor(() => expect(rendered.length).toBe(1));
    excalidrawProps().onChange(
      [
        rect("r1", 2),
        { ...rect("img1"), type: "image", fileId: "f1", isDeleted: true },
        { ...rect("img2"), type: "image", fileId: "f2" },
      ],
      {},
      { f1: { id: "f1" }, f2: { id: "f2" } },
    );
    await vi.advanceTimersByTimeAsync(250);
    const saved = JSON.parse(onchange.mock.calls[0][1].surfaceData).data;
    expect(saved.elements.map((e: { id: string }) => e.id)).toEqual(["r1", "img2"]);
    expect(Object.keys(saved.files)).toEqual(["f2"]);
  });

  it("hands a waiting edit over when the board closes, instead of dropping it", async () => {
    const { view, onchange } = mount();
    await waitFor(() => expect(rendered.length).toBe(1));
    excalidrawProps().onChange([rect("r1", 2)], {}, {});
    view.unmount();
    expect(onchange).toHaveBeenCalledTimes(1);
    expect(onchange.mock.calls[0][0]).toBe("b1");
    expect(unmount).toHaveBeenCalled();
  });

  it("hands a waiting edit over when the library flushes (quit, switch, trash)", async () => {
    const { onchange, flushHook } = mount();
    await waitFor(() => expect(rendered.length).toBe(1));
    excalidrawProps().onChange([rect("r1", 2)], {}, {});
    flushHook()?.();
    expect(onchange).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1000);
    expect(onchange).toHaveBeenCalledTimes(1);
  });

  it("follows the app theme and read-only state without remounting", async () => {
    const { view } = mount();
    await waitFor(() => expect(rendered.length).toBe(1));
    await view.rerender({ theme: "dark", readonly: true });
    await waitFor(() => expect(excalidrawProps().theme).toBe("dark"));
    expect(excalidrawProps().viewModeEnabled).toBe(true);
    expect(unmount).not.toHaveBeenCalled();
  });

  it("opens web links in the browser, not inside the app", async () => {
    const { onlinkopen } = mount();
    await waitFor(() => expect(rendered.length).toBe(1));
    const preventDefault = vi.fn();
    excalidrawProps().onLinkOpen({ link: "https://example.com" }, { preventDefault });
    expect(preventDefault).toHaveBeenCalled();
    expect(onlinkopen).toHaveBeenCalledWith("https://example.com");
  });
});
