import { describe, it, expect } from "vitest";
import { taskToggleChange, taskChecked } from "./tasks";

describe("taskToggleChange", () => {
  it("checks an open task", () => {
    expect(taskToggleChange("- [ ] ship it", 100)).toEqual({
      from: 103,
      to: 104,
      insert: "x",
    });
  });

  it("unchecks a done task", () => {
    expect(taskToggleChange("- [x] shipped", 0)).toEqual({
      from: 3,
      to: 4,
      insert: " ",
    });
  });

  it("handles uppercase X", () => {
    expect(taskToggleChange("- [X] done", 0)?.insert).toBe(" ");
  });

  it("handles indented and ordered task items", () => {
    expect(taskToggleChange("  - [ ] nested", 0)).toEqual({
      from: 5,
      to: 6,
      insert: "x",
    });
    expect(taskToggleChange("1. [ ] first", 0)).toEqual({
      from: 4,
      to: 5,
      insert: "x",
    });
  });

  it("returns null for non-task lines", () => {
    expect(taskToggleChange("- plain bullet", 0)).toBeNull();
    expect(taskToggleChange("plain text [ ] not a task", 0)).toBeNull();
    expect(taskToggleChange("> [ ] quoted, not a list", 0)).toBeNull();
  });
});

describe("taskChecked", () => {
  it("reads the marker state", () => {
    expect(taskChecked("[x]")).toBe(true);
    expect(taskChecked("[X]")).toBe(true);
    expect(taskChecked("[ ]")).toBe(false);
  });
});
