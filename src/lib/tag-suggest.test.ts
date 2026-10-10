import { describe, it, expect } from "vitest";
import { parseTagSuggest, TAG_SUGGEST_DEFAULT } from "./tag-suggest";

describe("parseTagSuggest", () => {
  it("is on and balanced until the user says otherwise", () => {
    expect(parseTagSuggest(null)).toEqual(TAG_SUGGEST_DEFAULT);
    expect(parseTagSuggest("junk")).toEqual(TAG_SUGGEST_DEFAULT);
  });

  it("keeps what was saved and snaps a stray number to a step", () => {
    expect(parseTagSuggest({ enabled: false, showAt: 0.7 })).toEqual({ enabled: false, showAt: 0.7 });
    expect(parseTagSuggest({ enabled: true, showAt: 0.4 }).showAt).toBe(0.35);
  });
});
