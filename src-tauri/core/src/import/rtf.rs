//! RTF, as the Cocoa text system writes it (Apple Stickies, TextEdit), to the
//! Markdown the editor renders. The mapping is in the feat-stickies-import
//! design, section 4.
//!
//! The input is bytes, not text: RTF is 7-bit with `\'hh` escapes in the
//! document's code page, and Cocoa also writes one raw byte (0xAC) after
//! each attachment. The reader is one loop over a stack of group states, with
//! no recursion, so a file costs time in proportion to its size and nothing
//! more.

use std::mem::take;

/// Everything past this is left out of the conversion.
pub const MAX_RTF_BYTES: usize = 16 * 1024 * 1024;

/// Convert `rtf` to Markdown. `image` is asked for each attachment by its
/// file name and returns the Markdown that stands for it, or `None` when it
/// could not be brought in, which the note then says in its place.
pub fn to_markdown(rtf: &[u8], image: impl FnMut(&str) -> Option<String>) -> String {
    let mut reader = Reader::new(image);
    reader.read(&rtf[..rtf.len().min(MAX_RTF_BYTES)]);
    reader.finish()
}

/// How a run of text looks, as far as Markdown can say it.
#[derive(Clone, Copy, Default, PartialEq, Eq)]
struct Style {
    bold: bool,
    italic: bool,
    strike: bool,
}

/// What a group's text is for.
#[derive(Clone, Copy, Default, PartialEq, Eq)]
enum Dest {
    #[default]
    Text,
    /// Not rendered: font and color tables, list definitions, metadata.
    Skip,
    /// `{\*\fldinst ...}`: a field's instruction, `HYPERLINK "url"`.
    FieldInst,
    /// `{\listtext ...}`: the list marker Cocoa drew for this paragraph.
    ListText,
    /// `{\NeXTGraphic name \width...}`: an attachment's file name.
    Graphic,
}

#[derive(Clone, Default)]
struct Group {
    style: Style,
    dest: Dest,
    /// The link every character of this group belongs to.
    link: Option<String>,
    /// `\ucN`: fallback characters that follow each `\uN`.
    uc: usize,
}

enum Piece {
    Text {
        text: String,
        style: Style,
        link: Option<String>,
    },
    /// Markdown written as is (an image).
    Raw(String),
    /// A line break inside a paragraph.
    Break,
}

/// Groups whose first control word says they are not text.
const SKIPPED: &[&str] = &[
    "fonttbl",
    "colortbl",
    "stylesheet",
    "info",
    "pict",
    "header",
    "headerl",
    "headerr",
    "footer",
    "footerl",
    "footerr",
    "footnote",
    "listtable",
    "listoverridetable",
];

struct Reader<F> {
    image: F,
    group: Group,
    stack: Vec<Group>,
    /// The next token is the first in its group.
    group_start: bool,
    /// The group began with `\*`: skip it unless it is one we read.
    starred: bool,
    lines: Vec<String>,
    para: Vec<Piece>,
    list_level: usize,
    marker: String,
    inst: String,
    graphic: String,
    graphic_named: bool,
    /// Right after an attachment, Cocoa writes a placeholder character.
    after_graphic: bool,
    high_surrogate: Option<u32>,
    /// `\uc` fallback characters still to skip.
    fallback: usize,
}

impl<F: FnMut(&str) -> Option<String>> Reader<F> {
    fn new(image: F) -> Self {
        Reader {
            image,
            group: Group {
                uc: 1,
                ..Group::default()
            },
            stack: Vec::new(),
            group_start: false,
            starred: false,
            lines: Vec::new(),
            para: Vec::new(),
            list_level: 0,
            marker: String::new(),
            inst: String::new(),
            graphic: String::new(),
            graphic_named: false,
            after_graphic: false,
            high_surrogate: None,
            fallback: 0,
        }
    }

    fn read(&mut self, input: &[u8]) {
        let mut i = 0;
        while i < input.len() {
            let b = input[i];
            i += 1;
            match b {
                b'{' => self.open_group(),
                b'}' => self.close_group(),
                b'\\' => i = self.control(input, i),
                b'\r' | b'\n' => {}
                _ => {
                    self.group_start = false;
                    self.char(cp1252(b));
                }
            }
        }
    }

    fn open_group(&mut self) {
        // A group starts as its parent is, so the children of a skipped or
        // collecting group stay skipped or collecting.
        let inner = self.group.clone();
        self.stack.push(take(&mut self.group));
        self.group = inner;
        self.group_start = true;
        self.starred = false;
        self.fallback = 0;
    }

    fn close_group(&mut self) {
        let Some(outer) = self.stack.pop() else {
            return; // an unbalanced brace: nothing to close
        };
        let closed = std::mem::replace(&mut self.group, outer);
        self.fallback = 0;
        self.group_start = false;
        if closed.dest == Dest::Graphic && self.group.dest != Dest::Graphic {
            let name = take(&mut self.graphic);
            let name = name.trim();
            if !name.is_empty() {
                let md = (self.image)(name).unwrap_or_else(|| format!("[Not imported: {name}]"));
                self.para.push(Piece::Raw(md));
                self.after_graphic = true;
            }
        }
    }

    /// A backslash at `input[i - 1]`; returns where reading resumes.
    fn control(&mut self, input: &[u8], mut i: usize) -> usize {
        let Some(&next) = input.get(i) else {
            return i;
        };
        if !next.is_ascii_alphabetic() {
            i += 1;
            let first = take(&mut self.group_start);
            match next {
                b'\\' | b'{' | b'}' => self.char(next as char),
                b'\'' => {
                    let hex = input
                        .get(i..i + 2)
                        .and_then(|h| std::str::from_utf8(h).ok());
                    if let Some(byte) = hex.and_then(|h| u8::from_str_radix(h, 16).ok()) {
                        self.char(cp1252(byte));
                        i += 2;
                    }
                }
                b'\n' | b'\r' if self.group.dest == Dest::Text => self.paragraph(),
                b'~' => self.char(' '),
                b'_' => self.char('-'),
                b'*' if first => self.starred = true,
                _ => {} // \- optional hyphen, \: index subentry, \| formula
            }
            return i;
        }
        let start = i;
        while i < input.len() && input[i].is_ascii_alphabetic() {
            i += 1;
        }
        let word = std::str::from_utf8(&input[start..i]).unwrap_or_default();
        let num_start = i;
        if i < input.len() && input[i] == b'-' {
            i += 1;
        }
        while i < input.len() && input[i].is_ascii_digit() {
            i += 1;
        }
        let param = std::str::from_utf8(&input[num_start..i])
            .ok()
            .and_then(|n| n.parse::<i64>().ok());
        if i < input.len() && input[i] == b' ' {
            i += 1; // the delimiter belongs to the control word
        }
        self.word(word, param);
        i
    }

    fn word(&mut self, word: &str, param: Option<i64>) {
        let first = take(&mut self.group_start);
        let starred = take(&mut self.starred);
        if first || starred {
            match word {
                "fldinst" => {
                    self.group.dest = Dest::FieldInst;
                    self.inst.clear();
                    return;
                }
                "listtext" => {
                    self.group.dest = Dest::ListText;
                    self.marker.clear();
                    return;
                }
                "NeXTGraphic" => {
                    self.group.dest = Dest::Graphic;
                    self.graphic.clear();
                    self.graphic_named = false;
                    return;
                }
                w if starred || SKIPPED.contains(&w) => {
                    self.group.dest = Dest::Skip;
                    return;
                }
                _ => {}
            }
        }
        if self.group.dest == Dest::Graphic {
            // The name ends where the attachment's properties begin.
            self.graphic_named = true;
            return;
        }
        let on = param.is_none_or(|p| p != 0);
        match word {
            "b" => self.group.style.bold = on,
            "i" => self.group.style.italic = on,
            "strike" | "striked" => self.group.style.strike = on,
            "plain" => self.group.style = Style::default(),
            "uc" => self.group.uc = param.unwrap_or(1).max(0) as usize,
            "u" => {
                if let Some(n) = param {
                    self.unicode(if n < 0 { n + 65536 } else { n } as u32);
                }
            }
            "fldrslt" => self.group.link = hyperlink(&take(&mut self.inst)),
            _ if self.group.dest != Dest::Text => {}
            "par" | "sect" | "page" => self.paragraph(),
            "line" => self.para.push(Piece::Break),
            "pard" => self.list_level = 0,
            "ilvl" => self.list_level = param.unwrap_or(0).clamp(0, 8) as usize,
            "tab" => self.char('\t'),
            "emdash" => self.char('\u{2014}'),
            "endash" => self.char('\u{2013}'),
            "bullet" => self.char('\u{2022}'),
            "lquote" => self.char('\u{2018}'),
            "rquote" => self.char('\u{2019}'),
            "ldblquote" => self.char('\u{201C}'),
            "rdblquote" => self.char('\u{201D}'),
            "emspace" | "enspace" | "qmspace" => self.char(' '),
            _ => {}
        }
    }

    /// `\uN`, joining UTF-16 surrogate pairs, then the fallback to skip.
    fn unicode(&mut self, unit: u32) {
        let c = match (self.high_surrogate.take(), unit) {
            (None, 0xD800..=0xDBFF) => {
                self.high_surrogate = Some(unit);
                None
            }
            (Some(high), 0xDC00..=0xDFFF) => {
                char::from_u32(0x10000 + ((high - 0xD800) << 10) + (unit - 0xDC00))
            }
            (_, 0xD800..=0xDFFF) => None, // an unpaired half
            (_, unit) => char::from_u32(unit),
        };
        if let Some(c) = c {
            self.put(c);
        }
        self.fallback = self.group.uc;
    }

    /// A character read from the text itself (not `\uN`).
    fn char(&mut self, c: char) {
        self.group_start = false;
        if self.fallback > 0 {
            self.fallback -= 1;
            return;
        }
        self.put(c);
    }

    fn put(&mut self, c: char) {
        if take(&mut self.after_graphic) && (c == '\u{AC}' || c == '\u{FFFC}') {
            return;
        }
        match self.group.dest {
            Dest::Skip => {}
            Dest::FieldInst => self.inst.push(c),
            Dest::ListText => self.marker.push(c),
            Dest::Graphic if !self.graphic_named => self.graphic.push(c),
            Dest::Graphic => {}
            Dest::Text => match c {
                '\u{2028}' => self.para.push(Piece::Break),
                '\u{FFFC}' => {}
                '\t' => self.text('\t'),
                c if c.is_control() => {}
                c => self.text(c),
            },
        }
    }

    fn text(&mut self, c: char) {
        let (style, link) = (self.group.style, &self.group.link);
        if let Some(Piece::Text {
            text,
            style: s,
            link: l,
        }) = self.para.last_mut()
        {
            if *s == style && l == link {
                text.push(c);
                return;
            }
        }
        self.para.push(Piece::Text {
            text: c.to_string(),
            style,
            link: link.clone(),
        });
    }

    fn paragraph(&mut self) {
        let pieces = take(&mut self.para);
        let marker = list_marker(&take(&mut self.marker));
        let body = render(&pieces);
        let line = match marker {
            Some(marker) => {
                let indent = "  ".repeat(self.list_level);
                // A line break inside an item stays inside the item.
                let hang = " ".repeat(indent.len() + marker.len() + 1);
                format!(
                    "{indent}{marker} {}",
                    body.replace('\n', &format!("\n{hang}"))
                )
            }
            None => body,
        };
        self.lines.push(line);
    }

    fn finish(mut self) -> String {
        if !self.para.is_empty() || !self.marker.is_empty() {
            self.paragraph();
        }
        let lines = &self.lines;
        let first = lines.iter().position(|l| !l.trim().is_empty());
        let last = lines.iter().rposition(|l| !l.trim().is_empty());
        match (first, last) {
            (Some(first), Some(last)) => lines[first..=last].join("\n"),
            _ => String::new(),
        }
    }
}

/// The Markdown marker for what Cocoa drew as a list marker: the number of
/// a numbered item, a dash for any bullet. `None` when the paragraph is not
/// a list item.
fn list_marker(drawn: &str) -> Option<String> {
    let drawn = drawn.trim();
    if drawn.is_empty() {
        return None;
    }
    let digits: String = drawn.chars().filter(char::is_ascii_digit).collect();
    Some(if digits.is_empty() {
        "-".into()
    } else {
        format!("{digits}.")
    })
}

/// The URL of a `HYPERLINK "url"` field instruction.
fn hyperlink(inst: &str) -> Option<String> {
    let rest = inst.trim().strip_prefix("HYPERLINK")?.trim();
    let url = match rest.strip_prefix('"') {
        Some(quoted) => quoted.split('"').next()?,
        None => rest.split_whitespace().next()?,
    };
    (!url.is_empty()).then(|| url.to_string())
}

fn render(pieces: &[Piece]) -> String {
    let mut out = String::new();
    for piece in pieces {
        match piece {
            Piece::Text { text, style, link } => match link {
                Some(url) if text.trim() == url => out.push_str(text),
                Some(url) => {
                    let label = styled(&text.replace('[', "\\[").replace(']', "\\]"), *style);
                    let target = if url.contains([' ', '(', ')']) {
                        format!("<{url}>")
                    } else {
                        url.clone()
                    };
                    out.push_str(&format!("[{label}]({target})"));
                }
                None => out.push_str(&styled(text, *style)),
            },
            Piece::Raw(md) => out.push_str(md),
            Piece::Break => out.push('\n'),
        }
    }
    out
}

/// A run with its emphasis. Markers never touch whitespace (`**bold **` is
/// not Markdown), so a run's leading and trailing spaces go outside them.
fn styled(text: &str, style: Style) -> String {
    let core = text.trim();
    if style == Style::default() || core.is_empty() {
        return text.to_string();
    }
    let lead = &text[..text.len() - text.trim_start().len()];
    let trail = &text[text.trim_end().len()..];
    let mut s = match (style.bold, style.italic) {
        (true, true) => format!("***{core}***"),
        (true, false) => format!("**{core}**"),
        (false, true) => format!("*{core}*"),
        (false, false) => core.to_string(),
    };
    if style.strike {
        s = format!("~~{s}~~");
    }
    format!("{lead}{s}{trail}")
}

/// Windows-1252, the code page Cocoa writes (`\ansicpg1252`). Its 0xA0-0xFF
/// half is Latin-1; only 0x80-0x9F differs.
fn cp1252(b: u8) -> char {
    const HIGH: [char; 32] = [
        '\u{20AC}', '\u{81}', '\u{201A}', '\u{0192}', '\u{201E}', '\u{2026}', '\u{2020}',
        '\u{2021}', '\u{02C6}', '\u{2030}', '\u{0160}', '\u{2039}', '\u{0152}', '\u{8D}',
        '\u{017D}', '\u{8F}', '\u{90}', '\u{2018}', '\u{2019}', '\u{201C}', '\u{201D}', '\u{2022}',
        '\u{2013}', '\u{2014}', '\u{02DC}', '\u{2122}', '\u{0161}', '\u{203A}', '\u{0153}',
        '\u{9D}', '\u{017E}', '\u{0178}',
    ];
    match b {
        0x80..=0x9F => HIGH[usize::from(b - 0x80)],
        _ => char::from(b),
    }
}
