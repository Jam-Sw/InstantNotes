import { describe, expect, it } from "vitest";
import { linkedNoteId, noteLink, qrDrawing } from "./qr";

describe("qrDrawing", () => {
  it("renders a known string at a known module count", () => {
    const qr = qrDrawing("HELLO");
    expect(qr.modules).toBe(21);
    expect(qr.size).toBe(29);
    expect(qr.path.startsWith("M4 4h1v1h-1z")).toBe(true);
  });

  it("grows the code for a longer link", () => {
    expect(qrDrawing(`https://notes.example.com/#note=${"a".repeat(36)}`).modules).toBeGreaterThan(21);
  });
});

describe("noteLink", () => {
  it("builds the link from the signed-in server address", () => {
    expect(noteLink({ stage: "upToDate", address: "https://notes.example.com" }, "n1")).toBe(
      "https://notes.example.com/#note=n1",
    );
  });

  it("keeps a path the server is served under and drops a trailing slash", () => {
    expect(noteLink({ stage: "syncing", address: "https://example.com/notes/" }, "n1")).toBe(
      "https://example.com/notes/#note=n1",
    );
  });

  it("reads a bare host, as the web app reports it, as https", () => {
    expect(noteLink({ stage: "upToDate", address: "notes.example.com:8443" }, "n1")).toBe(
      "https://notes.example.com:8443/#note=n1",
    );
  });

  it("encodes the note id", () => {
    expect(noteLink({ stage: "upToDate", address: "https://a.example" }, "a b#c")).toBe(
      "https://a.example/#note=a%20b%23c",
    );
  });

  it("gives no link without a signed-in server", () => {
    expect(noteLink(null, "n1")).toBeNull();
    expect(noteLink({ stage: "off", address: null }, "n1")).toBeNull();
    expect(noteLink({ stage: "off", address: "https://a.example" }, "n1")).toBeNull();
    expect(noteLink({ stage: "signedOut", address: "https://a.example" }, "n1")).toBeNull();
    expect(noteLink({ stage: "upToDate", address: "  " }, "n1")).toBeNull();
    expect(noteLink({ stage: "upToDate", address: "ftp://a.example" }, "n1")).toBeNull();
  });

  it("still links while offline or with problems, since the address is known", () => {
    expect(noteLink({ stage: "offline", address: "https://a.example" }, "n1")).toBe(
      "https://a.example/#note=n1",
    );
  });
});

describe("linkedNoteId", () => {
  it("reads the note id from the hash", () => {
    expect(linkedNoteId("#note=n1")).toBe("n1");
    expect(linkedNoteId("#note=a%20b%23c")).toBe("a b#c");
  });

  it("returns null for anything else", () => {
    expect(linkedNoteId("")).toBeNull();
    expect(linkedNoteId("#")).toBeNull();
    expect(linkedNoteId("#note=")).toBeNull();
    expect(linkedNoteId("#other=n1")).toBeNull();
    expect(linkedNoteId("#note=%E0%A4%A")).toBeNull();
  });
});
