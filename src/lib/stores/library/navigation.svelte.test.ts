import { describe, expect, it } from "vitest";
import { NavigationModel, revisitFilter } from "./navigation.svelte";

/** A model with every dimension set away from its default. */
function dirty(): NavigationModel {
  const nav = new NavigationModel();
  nav.statusFilter = "trash";
  nav.activeWorkspaceId = "w1";
  nav.activeTagId = "t1";
  nav.scopedTagId = "t2";
  nav.revisitMode = true;
  nav.graphMode = true;
  return nav;
}

function dims(nav: NavigationModel) {
  return {
    statusFilter: nav.statusFilter,
    activeWorkspaceId: nav.activeWorkspaceId,
    activeTagId: nav.activeTagId,
    scopedTagId: nav.scopedTagId,
    revisitMode: nav.revisitMode,
    graphMode: nav.graphMode,
  };
}

const DEFAULTS = {
  statusFilter: "active",
  activeWorkspaceId: null,
  activeTagId: null,
  scopedTagId: null,
  revisitMode: false,
  graphMode: false,
};

describe("NavigationModel", () => {
  it("starts at All Notes, active", () => {
    expect(dims(new NavigationModel())).toEqual(DEFAULTS);
  });

  it("reset clears all six dimensions", () => {
    const nav = dirty();
    nav.reset();
    expect(dims(nav)).toEqual(DEFAULTS);
  });

  it("showGraph resets the others", () => {
    const nav = dirty();
    nav.showGraph();
    expect(dims(nav)).toEqual({ ...DEFAULTS, graphMode: true });
  });

  it("showWorkspace resets the others", () => {
    const nav = dirty();
    nav.showWorkspace("w9");
    expect(dims(nav)).toEqual({ ...DEFAULTS, activeWorkspaceId: "w9" });
    nav.showWorkspace(null);
    expect(dims(nav)).toEqual(DEFAULTS);
  });

  it("showRevisit resets the others", () => {
    const nav = dirty();
    nav.showRevisit();
    expect(dims(nav)).toEqual({ ...DEFAULTS, revisitMode: true });
  });

  it("showTag resets the others", () => {
    const nav = dirty();
    nav.showTag("t9");
    expect(dims(nav)).toEqual({ ...DEFAULTS, activeTagId: "t9" });
  });

  it("setStatus keeps the active space and tag but leaves revisit and graph", () => {
    const nav = dirty();
    nav.setStatus("archived");
    expect(dims(nav)).toEqual({
      statusFilter: "archived",
      activeWorkspaceId: "w1",
      activeTagId: "t1",
      scopedTagId: "t2",
      revisitMode: false,
      graphMode: false,
    });
  });

  it("toggleScopedTag is a no-op returning false without a workspace", () => {
    const nav = new NavigationModel();
    expect(nav.toggleScopedTag("t1")).toBe(false);
    expect(nav.scopedTagId).toBeNull();
  });

  it("toggleScopedTag toggles the chip on and off inside a workspace", () => {
    const nav = new NavigationModel();
    nav.showWorkspace("w1");
    expect(nav.toggleScopedTag("t1")).toBe(true);
    expect(nav.scopedTagId).toBe("t1");
    expect(nav.toggleScopedTag("t2")).toBe(true);
    expect(nav.scopedTagId).toBe("t2");
    expect(nav.toggleScopedTag("t2")).toBe(true);
    expect(nav.scopedTagId).toBeNull();
  });

  describe("filter()", () => {
    it("active: no constraints", () => {
      expect(new NavigationModel().filter()).toEqual({});
    });

    it("archived", () => {
      const nav = new NavigationModel();
      nav.setStatus("archived");
      expect(nav.filter()).toEqual({ isArchived: true });
    });

    it("trash", () => {
      const nav = new NavigationModel();
      nav.setStatus("trash");
      expect(nav.filter()).toEqual({ isDeleted: true });
    });

    it("a workspace", () => {
      const nav = new NavigationModel();
      nav.showWorkspace("w1");
      expect(nav.filter()).toEqual({ workspaceId: "w1" });
    });

    it("a workspace with a scoped tag", () => {
      const nav = new NavigationModel();
      nav.showWorkspace("w1");
      nav.toggleScopedTag("t1");
      expect(nav.filter()).toEqual({ workspaceId: "w1", tagIds: ["t1"] });
    });

    it("a status composes with the workspace", () => {
      const nav = new NavigationModel();
      nav.showWorkspace("w1");
      nav.setStatus("trash");
      expect(nav.filter()).toEqual({ isDeleted: true, workspaceId: "w1" });
    });

    it("a global tag", () => {
      const nav = new NavigationModel();
      nav.showTag("t1");
      expect(nav.filter()).toEqual({ tagIds: ["t1"] });
    });

    it("revisit: the flag the store expands into the open-loop query", () => {
      const nav = new NavigationModel();
      nav.showRevisit();
      // Only the flag crosses IPC; the rule (never opened, older than the
      // window, oldest first) lives in core, whose own tests pin it.
      expect(nav.filter()).toEqual({ revisit: true });
      expect(revisitFilter()).toEqual({ revisit: true });
    });
  });
});
