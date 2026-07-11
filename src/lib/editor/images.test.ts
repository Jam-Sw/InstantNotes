import { describe, it, expect } from "vitest";
import { attachmentSrc, extForMime, attachmentMarkdown } from "./images";

const convert = (p: string) => `asset://${p}`;

describe("attachmentSrc", () => {
  it("resolves a relative attachment through the converter", () => {
    expect(attachmentSrc("attachments/a1.png", "/data/App", convert)).toBe(
      "asset:///data/App/a1.png",
    );
  });

  it("returns null until the base directory is known", () => {
    expect(attachmentSrc("attachments/a1.png", null, convert)).toBeNull();
  });

  it("leaves remote URLs unresolved", () => {
    expect(attachmentSrc("https://example.com/x.png", "/data/App", convert)).toBeNull();
  });

  it("rejects traversal and nested paths", () => {
    expect(attachmentSrc("attachments/../notes.db", "/data/App", convert)).toBeNull();
    expect(attachmentSrc("attachments/sub/x.png", "/data/App", convert)).toBeNull();
    expect(attachmentSrc("attachments/", "/data/App", convert)).toBeNull();
  });
});

describe("extForMime", () => {
  it("maps supported image types", () => {
    expect(extForMime("image/png")).toBe("png");
    expect(extForMime("image/jpeg")).toBe("jpg");
    expect(extForMime("image/gif")).toBe("gif");
    expect(extForMime("image/webp")).toBe("webp");
  });

  it("rejects everything else", () => {
    expect(extForMime("image/svg+xml")).toBeNull();
    expect(extForMime("text/plain")).toBeNull();
  });
});

describe("attachmentMarkdown", () => {
  it("builds the relative markdown reference", () => {
    expect(attachmentMarkdown("a1.png")).toBe("![](attachments/a1.png)");
  });
});
