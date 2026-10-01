import { describe, it, expect } from "vitest";
import {
  attachmentSrc,
  extForMime,
  attachmentMarkdown,
  localFilePath,
  imageSrc,
  linkedImagePaths,
} from "./images";

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

describe("localFilePath", () => {
  it("passes through an absolute POSIX path", () => {
    expect(localFilePath("/Users/jam/shot.png")).toBe("/Users/jam/shot.png");
  });
  it("decodes a file:// URL to its path", () => {
    expect(localFilePath("file:///Users/jam/my%20shot.png")).toBe("/Users/jam/my shot.png");
  });
  it("accepts a Windows drive path", () => {
    expect(localFilePath("C:\\Users\\jam\\shot.png")).toBe("C:\\Users\\jam\\shot.png");
  });
  it("rejects attachments, remote, and data URLs", () => {
    expect(localFilePath("attachments/x.png")).toBeNull();
    expect(localFilePath("https://e.com/x.png")).toBeNull();
    expect(localFilePath("data:image/png;base64,AAAA")).toBeNull();
  });
});

describe("imageSrc", () => {
  it("resolves stored attachments through the base dir", () => {
    expect(imageSrc("attachments/a1.png", "/data/App", convert)).toBe("asset:///data/App/a1.png");
  });
  it("resolves a linked absolute file directly", () => {
    expect(imageSrc("/Users/jam/shot.png", null, convert)).toBe("asset:///Users/jam/shot.png");
  });
  it("returns null for remote images", () => {
    expect(imageSrc("https://e.com/x.png", "/data/App", convert)).toBeNull();
  });
});

describe("linkedImagePaths", () => {
  it("collects unique linked local paths, ignoring attachments and remotes", () => {
    const body =
      "![a](/x/1.png) ![b](attachments/2.png) ![c](/x/1.png) ![d](https://e.com/3.png)";
    expect(linkedImagePaths(body)).toEqual(["/x/1.png"]);
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
