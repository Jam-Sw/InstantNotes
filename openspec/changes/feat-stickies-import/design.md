# Design: Import from Apple Stickies

## 1. What Stickies keeps on disk

Verified, not assumed. Sources: the field notes of an open-source Stickies
exporter tested on a real Mac on 2026-08-30 (`RedBearAK/Stickies-to-Markdown`,
`dev_notes/MAC_FINDINGS.md`), and RTF produced on this machine by `textutil`,
which writes through the same Cocoa `NSAttributedString` RTF writer Stickies
saves with (`\cocoartf`).

```
~/Library/Containers/com.apple.Stickies/Data/Library/Stickies/
  <UUID>.rtfd/            one package per sticky
    TXT.rtf               the text, Cocoa RTF, \ansicpg1252
    <image files>         attachments, under their original names
  .SavedStickiesState     binary plist: a list of dicts, one per sticky
```

- State entries carry `UUID` and `StickyColor` (`{Red, Green, Blue, Alpha}`,
  floats 0..1), plus window geometry the importer does not need.
- A brand-new sticky exists for a few seconds as a flat `.rtfd` file before
  its first save turns it into a package. Only packages are stickies.
- Every save replaces `TXT.rtf` (new inode). Moving or recoloring a sticky
  also saves it, so the file's modified time is "last touched", not "last
  typed". It is still the closest thing to a modified date that exists.
- The package directory persists across saves, so its birth time is the
  sticky's creation time.
- `TXT.rtf` is bytes, not UTF-8: cp1252 escapes (`\'e9`), `\uN` for anything
  else (an emoji is a UTF-16 surrogate pair, two `\uN` in a row), and a raw
  `0xAC` byte after each attachment group.

## 2. Access

macOS 27 denies another developer's app container by default, with no prompt
("Accessing files in other developer teams' app data containers ... no
longer prompts the user for authorization; such accesses are denied by
default and can be managed by the user in Privacy & Security settings"). On
earlier macOS it prompts once, and for an ad-hoc signed app like this one the
grant lasts only the session.

So the importer never reaches into Stickies' folder on its own. The user
picks the folder in the system picker, which opens already there
(`stickies_location`), and that choice grants the running app access to it.

| Outcome of reading the chosen folder | What the page shows |
| --- | --- |
| Readable, stickies found | The preview |
| Readable, none found | "No stickies here", and where Stickies keeps them |
| Permission denied | Why, a button to Privacy & Security, and Choose again |
| Not a folder, or another I/O error | The error |

Picking the Stickies container itself, or `Data`, still works: the reader
descends to `Data/Library/Stickies` when that is where the packages are.

## 3. Pipeline

```
Choose folder ──> scan_stickies(folder) ──> preview ──> import_stickies(folder, ids, space)
                  read + convert, no writes              copy images, one store transaction
```

The scan converts every sticky (it is cheap) so the preview shows the real
text. Import converts again from disk rather than trusting the preview, so
what lands is the file as it is at that moment.

`core::import::stickies::read_folder(dir) -> Vec<Sticky>`:

| Field | From |
| --- | --- |
| `id` | Package name without `.rtfd` (the sticky's UUID) |
| `rtf` | `TXT.rtf` bytes |
| `color` | `StickyColor` as `#rrggbb`, when the state file has the sticky |
| `created_at`, `updated_at` | Package birth time (modified time where the platform has none), `TXT.rtf` modified time; `created_at` is never after `updated_at` |

A package without `TXT.rtf`, or one whose `TXT.rtf` is over 16 MiB, is left
out. An unreadable state file only costs the colors.

## 4. RTF to Markdown

`core::import::rtf::to_markdown(rtf: &[u8], image: impl FnMut(&str) -> Option<String>) -> String`.
A byte-level reader for the RTF Cocoa writes. `image` is asked for each
attachment by its file name and returns the Markdown for it, or `None` for
one it could not bring in; the converter itself never touches the disk.

| RTF | Markdown |
| --- | --- |
| `\par`, `\` + newline | a new line |
| `\line`, U+2028 | a new line |
| `\b` / `\b0`, `\i` / `\i0` | `**bold**`, `*italic*`, `***both***` |
| `\strike`, `\striked1` / `\strike0`, `\striked0` | `~~struck~~` |
| `\plain` | all of the above off |
| `\ls` + `\ilvl` + `{\listtext 1.}` | `- item` or `1. item`, two spaces per level; the number is the one Stickies drew |
| `{\field{\*\fldinst HYPERLINK "u"}{\fldrslt t}}` | `[t](u)`, or bare `u` when `t` is `u` |
| `{{\NeXTGraphic name \width…}` + `0xAC` `}` | whatever `image(name)` returns; the placeholder byte is dropped |
| `\'hh` | cp1252 |
| `\uN` (negative N wraps; surrogate pairs combine) | the character, skipping `\ucN` fallback characters |
| `\{`, `\}`, `\\`, `\~`, `\tab`, `\emdash`, `\endash`, `\bullet`, the quote words | the character |
| `\fonttbl`, `\colortbl`, `\stylesheet`, `\info`, `\pict`, any `{\*…}` except `\fldinst` | skipped |
| font, size, color, underline, alignment, spacing | dropped |

Emphasis markers never touch whitespace: `**bold **` is not Markdown, so
leading and trailing spaces of a styled run are written outside its markers.
Emphasis never spans lines; each line opens and closes its own. Plain text is
not escaped: the note reads as if it had been typed into InstantNotes, where
the same characters mean the same things.

Trailing blank lines are trimmed. Nothing else about spacing is changed.

## 5. Images

For each attachment name, `import_stickies` (shell):

1. Accepts only a plain file name that resolves inside the package, and only
   a regular file (a symlink is refused); at most 50 MiB.
2. PNG, JPEG, GIF, or WebP, confirmed by the file's first bytes: copied in as
   is.
3. Anything else on macOS: converted to PNG by `/usr/bin/sips` (TIFF, the
   classic "Pasted Graphic.tiff", HEIC, BMP), from a copy in a temporary
   folder, so `sips` never reads Stickies' folder itself.
4. Otherwise, the note says so where the image was: `[Not imported: name]`.

Copied images get new `<uuid>.<ext>` names in the attachments folder and are
referenced as `![](attachments/<name>)`, exactly like a pasted image, so the
vault mirror, cleanup, and export treat them the same.

## 6. Store

`Store::import_notes(source, items, space) -> ImportOutcome`, one
transaction (the store's usual kind, so it becomes `IMMEDIATE` with the rest
when agent access lands):

- skips any item whose source id maps to a note that still exists (Trash
  included) in the `import.<source>` settings map;
- inserts the rest with their `created_at` and `updated_at`, `last_opened_at`
  set to now, the title derived from the body, and inline tags attached;
- files each into the Space, creating it if new (none when `space` is empty);
- writes the updated map.

A note destroyed for good frees its sticky to be imported again; one in the
Trash does not (restore it instead). The vault triggers mark every inserted
note dirty, so the mirror writes them on its next flush.

## 7. Settings > Import

Shown on macOS only (`isMac`); on Windows and Linux there is nothing to
import yet, so there is no empty page.

- **Start:** what it does in one sentence; **Choose Stickies Folder…**; fine
  print: Stickies keeps its notes, formatting Markdown cannot hold stays
  behind.
- **Preview:** a grid of miniatures, each in the sticky's color with dark
  ink whatever the theme (it is a picture of the sticky), the first line
  bold, a few lines under it, the date, and an image count. Each is a toggle
  button (`aria-pressed`). Already imported ones are dimmed, labeled, and
  cannot be picked. Select all / none. "File them in" Space field.
  **Import N Stickies**.
- **Done:** "Imported N stickies into Apple Stickies." **Show Them** opens the
  Space and closes Settings.
- **Denied / empty / error:** as in section 2.

## 8. Trust boundary

The folder path comes from the webview, which chose it through the picker.
The commands read only: the folder listing, `*.rtfd/TXT.rtf`, the state
file, and attachments named by an RTF file, each checked as in section 5.
Nothing is ever written under the chosen folder. RTF is parsed with bounded
input (16 MiB) and no recursion, so a crafted file can cost time linear in its
size and nothing else.

## 9. Tests

- Converter: fixtures produced by `textutil` from HTML (formatting, nested
  and numbered lists, links, cp1252, emoji, Cyrillic, escapes, an RTFD with
  an image), checked in with a README saying how they were made, plus
  focused cases (whitespace at emphasis edges, skipped destinations,
  negative `\u`, `\ucN` fallback, unbalanced braces).
- Folder reader: packages vs flat files, missing `TXT.rtf`, the state file
  (a real binary plist written by `plutil`), descending from the container.
- Store: dates kept, titles, inline tags, Space filing, skip on re-import,
  re-import after destroy, one transaction.
- Shell: attachment name and symlink refusal, magic bytes.
- Frontend: the page's states, selection, and what it sends.
- End to end, by the maintainer: his own stickies.

## 10. Not in this change

- Watching Stickies and syncing changes back or forth.
- Recreating sticky windows (color, position) as InstantNotes stickies.
- Other sources. The page is where they go; none is built speculatively.
