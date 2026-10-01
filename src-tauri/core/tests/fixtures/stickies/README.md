# A Stickies folder, for `import_test.rs`

Laid out the way Apple Stickies keeps its notes: one `<UUID>.rtfd` package per
sticky, and `.SavedStickiesState`.

The RTF is not hand-written. `textutil`, which saves through the same Cocoa
writer Stickies uses (`\cocoartf`), made it from HTML on macOS 27:

| Package | Made with |
| --- | --- |
| `0B7D6A52….rtfd/TXT.rtf` | `textutil -convert rtf` of a page with bold, italic, strikethrough, underline, nested and numbered lists, a link, cp1252 punctuation, an emoji, escapes, and an image (which plain RTF drops) |
| `6E2F9C31….rtfd/` | `textutil -convert rtfd` of the same page: `TXT.rtf` refers to `Attachment.png` with `\NeXTGraphic` and a raw `0xAC` byte |
| `C4A81E07….rtfd/TXT.rtf` | `textutil -convert rtf` of an emoji, Cyrillic, and a check mark |

`.SavedStickiesState` is a binary plist written by `plutil -convert binary1`
with the keys Stickies uses (`UUID`, `StickyColor` as float `Red`/`Green`/`Blue`/
`Alpha`, `Frame`, `Floating`, `Translucent`): yellow for the first package,
blue for the second, the third missing, and one entry for a sticky that is
not here.

Two entries are not stickies and must be skipped: `9F3E5D1C….rtfd` is a flat
file (a sticky Stickies has not saved yet), and `5A6B7C8D….rtfd` has no
`TXT.rtf`.
