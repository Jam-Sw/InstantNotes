import { describe, it, expect } from "vitest";
import { githubIssueUrl, diagnosticsMarkdown } from "./feedback";

describe("githubIssueUrl", () => {
  it("prefixes the title by category and derives it from the first line", () => {
    const url = githubIssueUrl({ category: "bug", message: "It crashes\nmore detail" });
    const parsed = new URL(url);
    expect(parsed.origin + parsed.pathname).toBe(
      "https://github.com/Jam-Sw/InstantNotes/issues/new",
    );
    expect(parsed.searchParams.get("title")).toBe("Bug: It crashes");
    expect(parsed.searchParams.get("labels")).toBe("bug");
    expect(parsed.searchParams.get("body")).toBe("It crashes\nmore detail");
  });

  it("appends diagnostics under a divider when provided", () => {
    const url = githubIssueUrl({
      category: "idea",
      message: "Add tabs",
      diagnostics: "- App version: 0.8.0",
    });
    const body = new URL(url).searchParams.get("body") ?? "";
    expect(body).toContain("Add tabs");
    expect(body).toContain("---");
    expect(body).toContain("- App version: 0.8.0");
    expect(new URL(url).searchParams.get("labels")).toBe("enhancement");
  });

  it("caps the title and falls back when the message is blank", () => {
    const long = "x".repeat(200);
    const title = new URL(githubIssueUrl({ category: "other", message: long })).searchParams.get(
      "title",
    );
    expect(title).toHaveLength(60);
    const fallback = new URL(
      githubIssueUrl({ category: "other", message: "   " }),
    ).searchParams.get("title");
    expect(fallback).toBe("Feedback");
  });
});

describe("diagnosticsMarkdown", () => {
  it("lists exactly the snapshot fields", () => {
    const md = diagnosticsMarkdown({
      appVersion: "0.8.0",
      platform: "macOS",
      notes: 42,
      attachments: 7,
    });
    expect(md).toBe(
      "- App version: 0.8.0\n- Platform: macOS\n- Notes: 42\n- Attachments: 7",
    );
  });
});
