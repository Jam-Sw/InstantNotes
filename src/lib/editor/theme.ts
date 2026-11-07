import { EditorView } from "@codemirror/view";

export const kernelTheme = EditorView.baseTheme({
  ".cm-wysiwyg-bullet, .cm-wysiwyg-number": {
    display: "inline-block",
    minWidth: "1em",
    textIndent: "0",
    color: "var(--text)",
    marginRight: "0.35em",
    userSelect: "none",
  },
  ".cm-wysiwyg-blockquote": {
    borderLeft: "3px solid var(--accent)",
    paddingLeft: "12px",
    color: "var(--text-secondary)",
    fontStyle: "italic",
  },
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
  ".cm-wysiwyg-hr": {
    display: "inline-block",
    width: "100%",
    height: "1px",
    verticalAlign: "middle",
    background: "var(--border)",
  },
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
  ".cm-link-clickable": {
    cursor: "pointer",
  },
  ".cm-mod-held .cm-link-target": {
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
  ".cm-calc": {
    display: "inline-block",
    fontFamily: "var(--font-meta)",
    fontSize: "0.9em",
    lineHeight: "1.4",
    verticalAlign: "baseline",
    whiteSpace: "nowrap",
  },
  ".cm-calc-attached": {
    marginLeft: "0.75em",
  },
  ".cm-calc-value, .cm-calc-error": {
    display: "inline-block",
    padding: "0 0.45em",
    borderRadius: "4px",
    background: "var(--accent-soft)",
    color: "var(--accent-text)",
  },
  ".cm-calc-value + .cm-calc-value, .cm-calc-value + .cm-calc-error": {
    marginLeft: "0.4em",
  },
  ".cm-calc-error": {
    background: "color-mix(in srgb, var(--danger) 14%, transparent)",
    color: "var(--danger)",
  },
  ".cm-calc-matrix": {
    display: "inline-table",
    borderCollapse: "collapse",
    verticalAlign: "middle",
    margin: "2px 0",
    borderLeft: "1.5px solid currentColor",
    borderRight: "1.5px solid currentColor",
    borderRadius: "3px",
  },
  ".cm-calc-matrix td": {
    padding: "0 0.4em",
    textAlign: "right",
    lineHeight: "1.3",
  },
  ".cm-figures": {
    display: "block",
    width: "100%",
    contain: "inline-size",
    whiteSpace: "normal",
    userSelect: "none",
    WebkitUserSelect: "none",
  },
  ".cm-figure": {
    position: "relative",
    display: "block",
    width: "100%",
    touchAction: "none",
    cursor: "grab",
    userSelect: "none",
    WebkitUserSelect: "none",
    WebkitTouchCallout: "none",
  },
  ".cm-figure.cm-figure-grabbing, .cm-figure.cm-figure-grabbing *": {
    cursor: "grabbing !important",
  },
  ".cm-figure-plotly": {
    width: "100%",
    overflow: "hidden",
  },
  ".cm-figure svg": {
    display: "block",
    width: "100%",
    height: "auto",
  },
  ".cm-figure polyline": {
    fill: "none",
    strokeLinejoin: "round",
    strokeLinecap: "round",
  },
  ".cm-figure-frame polyline": {
    stroke: "var(--text-tertiary)",
    strokeWidth: "1",
  },
  ".cm-figure-lines polyline": {
    strokeWidth: "1.75",
  },
  ".cm-figure-labels text": {
    fill: "var(--text-secondary)",
    fontFamily: "var(--font-meta)",
    fontSize: "10.5px",
  },
  ".cm-image-preview": {
    maxWidth: "100%",
    maxHeight: "var(--image-max-height, 420px)",
    borderRadius: "6px",
    verticalAlign: "text-bottom",
  },
});
