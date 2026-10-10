import { describe, it, expect } from "vitest";
import { spacesShown } from "./spaces-shown";
import type { WorkspaceWithCount } from "$lib/api/types";

const space = (name: string, noteCount: number) =>
  ({ id: name, name, noteCount, createdAt: "", updatedAt: "" }) as WorkspaceWithCount;

const library = [
  space("Big", 16),
  space("DAWs", 1),
  space("Empty", 0),
  space("Skills", 3),
  space("Stories", 10),
];

describe("spacesShown", () => {
  it("keeps the largest Spaces in their own order and folds the rest away", () => {
    expect(spacesShown(library, null, 3).map((s) => s.name)).toEqual(["Big", "Skills", "Stories"]);
  });

  it("always keeps the open Space", () => {
    expect(spacesShown(library, "Empty", 3).map((s) => s.name)).toEqual(["Big", "Empty", "Skills", "Stories"]);
  });

  it("folds nothing when only one Space would be left over", () => {
    expect(spacesShown(library, null, 4)).toEqual(library);
  });
});
