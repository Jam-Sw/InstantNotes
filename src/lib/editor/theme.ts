// Every kernel base theme in one place. Class names are unchanged from the
// retired per-feature files, so app.css overrides and user familiarity hold.
// (.cm-tag is styled in app.css; underline ownership lives here, not in the
// highlight spec, so the Links underline setting is the single source of
// truth in both modes.)

import { EditorView } from "@codemirror/view";

export const kernelTheme = EditorView.baseTheme({
  // Lists
  ".cm-wysiwyg-bullet, .cm-wysiwyg-number": {
    color: "var(--text)",
    marginRight: "0.35em",
    userSelect: "none",
  },
  // Blockquotes
  ".cm-wysiwyg-blockquote": {
    borderLeft: "3px solid var(--accent)",
    paddingLeft: "12px",
    color: "var(--text-secondary)",
    fontStyle: "italic",
  },
  // Code fences
  ".cm-wysiwyg-codeblock": {
    background: "var(--bg-sidebar)",
    fontFamily: "var(--font-meta)",
    fontSize: "0.9em",
    paddingLeft: "10px",
    paddingRight: "10px",
  },
  ".cm-wysiwyg-codeinfo": {
    color: "var(--text-tertiary)",
    fontSize: "0.85em",
  },
  // Horizontal rules
  ".cm-wysiwyg-hr": {
    display: "inline-block",
    width: "100%",
    height: "1px",
    verticalAlign: "middle",
    background: "var(--border)",
  },
  // Tables
  ".cm-wysiwyg-table": {
    fontFamily: "var(--font-meta)",
    fontSize: "0.9em",
  },
  ".cm-wysiwyg-tablehead": {
    fontWeight: "600",
  },
  ".cm-wysiwyg-tabledelim": {
    color: "var(--text-tertiary)",
  },
  // Links
  ".cm-link-clickable": {
    cursor: "pointer",
  },
  ".cm-link-ul-always": {
    textDecoration: "underline",
  },
  ".cm-link-ul-hover": {
    textDecoration: "none",
  },
  ".cm-link-ul-hover:hover": {
    textDecoration: "underline",
  },
  ".cm-link-ul-never": {
    textDecoration: "none",
  },
  ".cm-link-ext::after": {
    content: "'↗'",
    fontSize: "0.7em",
    verticalAlign: "super",
    marginLeft: "1px",
    opacity: "0.75",
  },
  // Tasks
  ".cm-task-checkbox": {
    width: "14px",
    height: "14px",
    margin: "0 6px 0 0",
    verticalAlign: "middle",
    accentColor: "var(--accent)",
    cursor: "pointer",
  },
  ".cm-task-done": {
    textDecoration: "line-through",
    color: "var(--text-tertiary)",
  },
  // Images
  ".cm-image-preview": {
    maxWidth: "100%",
    maxHeight: "420px",
    borderRadius: "6px",
    verticalAlign: "text-bottom",
  },
});
