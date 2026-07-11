# Tasks

- [ ] Add @codemirror/lang-markdown, @codemirror/language, @lezer/highlight
- [ ] Add live markdown styling in Editor.svelte (bold, italic, strikethrough, code, fenced code, quote, list, link); do NOT style headings
- [ ] Keep #tag highlighting taking precedence; cover with a test that a tag is never styled as a heading
- [ ] Add pure selection-formatting helpers (wrap bold/italic/strike/code, prefix quote/list, insert link) and unit-test them
- [ ] Wire formatting commands into CodeMirror with Cmd-B / Cmd-I / Cmd-E / Cmd-K shortcuts
- [ ] Add the toggle-able format toolbar UI (Bold, Italic, Strikethrough, Code, Quote, List, Link)
- [ ] Finish zoom: keep keyboard shortcuts, add A- / A+ / reset controls
- [ ] Persist zoom level and toolbar-open state via the settings store, restored on launch
- [ ] Add Saving… / Saved feedback in the status bar
- [ ] Verify: npm test, npm run check, cargo test --workspace
- [ ] Open a separate feature-request issue for clickable task checkboxes
