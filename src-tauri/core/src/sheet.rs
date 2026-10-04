//! Sheet notes: a cell grid that stays a note. The grid lives in
//! `surface_data` as a versioned envelope; this module is the one place it
//! is read and written on the Rust side, so every writer (the grid in the
//! app, `append_sheet_rows` over MCP) produces the same Markdown body and
//! the same CSV sidecar. Design: openspec/changes/feat-note-sheet/design.md.
//!
//! Stored shape:
//!
//! ```json
//! { "v": 1, "engine": "grid", "data": {
//!     "cols": [{ "w": 120 }, { "w": 120 }],
//!     "rows": [["Date", "ms"], ["2026-10-03", "412"]] } }
//! ```
//!
//! `rows` is dense: every row holds exactly `cols.len()` strings, each a
//! cell's raw input. Strings only, on purpose: typed values are what a
//! formula engine produces, and none ships yet.

use serde::{Deserialize, Serialize};

pub const SHEET_ENGINE: &str = "grid";
/// Columns A to AZ.
pub const MAX_COLS: usize = 52;
pub const MAX_ROWS: usize = 5_000;
/// Without a cell cap the row and column caps bound nothing.
pub const MAX_CELL_CHARS: usize = 10_000;
pub const DEFAULT_COLS: usize = 3;
pub const DEFAULT_ROWS: usize = 20;
pub const DEFAULT_COL_WIDTH: f64 = 120.0;
/// A sheet's title is frozen on creation; this is what it freezes to when
/// the note had no words of its own.
pub const DEFAULT_TITLE: &str = "Untitled sheet";

/// Per-column view state: the width in CSS pixels.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Column {
    pub w: f64,
}

#[derive(Debug, Clone, PartialEq)]
pub struct Sheet {
    pub cols: Vec<Column>,
    pub rows: Vec<Vec<String>>,
}

#[derive(Serialize, Deserialize)]
struct Envelope {
    v: u32,
    engine: String,
    data: Data,
}

#[derive(Serialize, Deserialize)]
struct Data {
    cols: Vec<Column>,
    rows: Vec<Vec<String>>,
}

/// The spreadsheet letter(s) of column `c` (0-based): A..Z, AA..AZ.
pub fn column_name(c: usize) -> String {
    let letter = |n: usize| (b'A' + (n % 26) as u8) as char;
    if c < 26 {
        letter(c).to_string()
    } else {
        format!("{}{}", letter(c / 26 - 1), letter(c))
    }
}

fn row_is_empty(row: &[String]) -> bool {
    row.iter().all(String::is_empty)
}

impl Sheet {
    /// An all-empty grid.
    pub fn empty(cols: usize, rows: usize) -> Sheet {
        Sheet {
            cols: vec![
                Column {
                    w: DEFAULT_COL_WIDTH
                };
                cols
            ],
            rows: vec![vec![String::new(); cols]; rows],
        }
    }

    /// What a new sheet holds.
    pub fn new_default() -> Sheet {
        Sheet::empty(DEFAULT_COLS, DEFAULT_ROWS)
    }

    /// Read a stored envelope, refusing anything that is not a well-formed
    /// grid within the limits. The message is for the writer, in words an
    /// agent can act on.
    pub fn parse(raw: &str) -> Result<Sheet, String> {
        let envelope: Envelope = serde_json::from_str(raw)
            .map_err(|e| format!("a sheet's surface must be a grid envelope: {e}"))?;
        if envelope.v != 1 || envelope.engine != SHEET_ENGINE {
            return Err(format!(
                "a sheet's surface must be {{\"v\":1,\"engine\":\"{SHEET_ENGINE}\"}}, got v{} {}",
                envelope.v, envelope.engine
            ));
        }
        let sheet = Sheet {
            cols: envelope.data.cols,
            rows: envelope.data.rows,
        };
        sheet.validate()?;
        Ok(sheet)
    }

    fn validate(&self) -> Result<(), String> {
        let width = self.cols.len();
        if width == 0 {
            return Err("a sheet needs at least one column".into());
        }
        if width > MAX_COLS {
            return Err(format!(
                "a sheet holds at most {MAX_COLS} columns, got {width}"
            ));
        }
        if self.rows.len() > MAX_ROWS {
            return Err(format!(
                "a sheet holds at most {MAX_ROWS} rows, got {}",
                self.rows.len()
            ));
        }
        if let Some(col) = self.cols.iter().find(|c| !c.w.is_finite() || c.w <= 0.0) {
            return Err(format!(
                "a column width must be a positive number, got {}",
                col.w
            ));
        }
        for (r, row) in self.rows.iter().enumerate() {
            if row.len() != width {
                return Err(format!(
                    "row {} has {} cells; the sheet has {width} columns",
                    r + 1,
                    row.len()
                ));
            }
            check_cells(row, r)?;
        }
        Ok(())
    }

    pub fn serialize(&self) -> String {
        let envelope = Envelope {
            v: 1,
            engine: SHEET_ENGINE.to_string(),
            data: Data {
                cols: self.cols.clone(),
                rows: self.rows.clone(),
            },
        };
        serde_json::to_string(&envelope).expect("a sheet always serializes")
    }

    /// How many rows hold data: the index of the last non-empty row plus
    /// one. Appends land here, so a new sheet's trailing empty rows are
    /// filled before any are added.
    pub fn filled_rows(&self) -> usize {
        self.rows
            .iter()
            .rposition(|row| !row_is_empty(row))
            .map_or(0, |i| i + 1)
    }

    /// The grid as a GitHub-flavored Markdown table: row 1 is the header,
    /// trailing empty rows and columns are trimmed, pipes and newlines are
    /// escaped. An all-empty sheet is an empty string. This is the note's
    /// `body`, so search, inline `#tags`, previews, and the vault's Markdown
    /// file see what the sheet holds.
    pub fn markdown(&self) -> String {
        let rows = &self.rows[..self.filled_rows()];
        let Some(width) = rows
            .iter()
            .filter_map(|row| row.iter().rposition(|c| !c.is_empty()))
            .max()
            .map(|last| last + 1)
        else {
            return String::new();
        };
        let line = |cells: &[String]| -> String {
            let escaped: Vec<String> = cells[..width].iter().map(|c| escape_cell(c)).collect();
            format!("| {} |", escaped.join(" | "))
        };
        let mut out = String::new();
        out.push_str(&line(&rows[0]));
        out.push('\n');
        out.push_str(&format!("|{}", " --- |".repeat(width)));
        for row in &rows[1..] {
            out.push('\n');
            out.push_str(&line(row));
        }
        out
    }

    /// The grid as RFC 4180 CSV: CRLF line ends, UTF-8 without a BOM,
    /// trailing empty rows trimmed, every column kept. The vault's sidecar
    /// and Export Note.
    pub fn csv(&self) -> String {
        let mut out = String::new();
        for row in &self.rows[..self.filled_rows()] {
            let fields: Vec<String> = row.iter().map(|c| csv_field(c)).collect();
            out.push_str(&fields.join(","));
            out.push_str("\r\n");
        }
        out
    }

    /// Add `rows` after the last row holding data, reusing the empty rows at
    /// the bottom before growing the grid. A row shorter than the sheet is
    /// padded; one wider is refused, so a writer cannot change the sheet's
    /// shape. Returns the 0-based index of the first appended row.
    pub fn append_rows(&mut self, rows: Vec<Vec<String>>) -> Result<usize, String> {
        if rows.is_empty() {
            return Err("give at least one row".into());
        }
        let width = self.cols.len();
        let start = self.filled_rows();
        for (k, row) in rows.iter().enumerate() {
            if row.len() > width {
                return Err(format!(
                    "row {} has {} cells; the sheet has {width} columns ({})",
                    k + 1,
                    row.len(),
                    (0..width).map(column_name).collect::<Vec<_>>().join(", ")
                ));
            }
            check_cells(row, start + k)?;
        }
        let needed = start + rows.len();
        if needed > MAX_ROWS {
            return Err(format!(
                "a sheet holds at most {MAX_ROWS} rows; this one has {start} filled, and {} more would make {needed}",
                rows.len()
            ));
        }
        if needed > self.rows.len() {
            self.rows.resize(needed, vec![String::new(); width]);
        }
        for (k, mut row) in rows.into_iter().enumerate() {
            row.resize(width, String::new());
            self.rows[start + k] = row;
        }
        Ok(start)
    }
}

fn check_cells(row: &[String], r: usize) -> Result<(), String> {
    for (c, cell) in row.iter().enumerate() {
        let chars = cell.chars().count();
        if chars > MAX_CELL_CHARS {
            return Err(format!(
                "a cell holds at most {MAX_CELL_CHARS} characters; {}{} has {chars}",
                column_name(c),
                r + 1
            ));
        }
    }
    Ok(())
}

/// A cell's text inside a Markdown table row: a pipe would end the cell and
/// a newline the row.
fn escape_cell(cell: &str) -> String {
    cell.replace('\\', "\\\\")
        .replace('|', "\\|")
        .replace("\r\n", "<br>")
        .replace(['\r', '\n'], "<br>")
}

fn csv_field(cell: &str) -> String {
    if cell.contains([',', '"', '\r', '\n']) {
        format!("\"{}\"", cell.replace('"', "\"\""))
    } else {
        cell.to_string()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn sheet(rows: &[&[&str]]) -> Sheet {
        let width = rows.iter().map(|r| r.len()).max().unwrap_or(1);
        let mut s = Sheet::empty(width, 0);
        for row in rows {
            let mut cells: Vec<String> = row.iter().map(|c| c.to_string()).collect();
            cells.resize(width, String::new());
            s.rows.push(cells);
        }
        s
    }

    #[test]
    fn column_names_run_a_to_az() {
        assert_eq!(column_name(0), "A");
        assert_eq!(column_name(25), "Z");
        assert_eq!(column_name(26), "AA");
        assert_eq!(column_name(51), "AZ");
    }

    #[test]
    fn a_new_sheet_is_three_by_twenty_and_round_trips() {
        let s = Sheet::new_default();
        assert_eq!(s.cols.len(), 3);
        assert_eq!(s.rows.len(), 20);
        assert_eq!(s.filled_rows(), 0);
        assert_eq!(Sheet::parse(&s.serialize()).unwrap(), s);
        assert_eq!(s.markdown(), "");
        assert_eq!(s.csv(), "");
    }

    #[test]
    fn the_envelope_is_checked_by_name() {
        let other = r#"{"v":1,"engine":"excalidraw","data":{"cols":[],"rows":[]}}"#;
        assert!(Sheet::parse(other).unwrap_err().contains("engine"));
        assert!(Sheet::parse("not json").unwrap_err().contains("envelope"));
        let v2 = r#"{"v":2,"engine":"grid","data":{"cols":[{"w":1}],"rows":[]}}"#;
        assert!(Sheet::parse(v2).unwrap_err().contains("v2"));
    }

    #[test]
    fn a_ragged_row_is_refused_by_number() {
        let raw =
            r#"{"v":1,"engine":"grid","data":{"cols":[{"w":1},{"w":1}],"rows":[["a","b"],["c"]]}}"#;
        let err = Sheet::parse(raw).unwrap_err();
        assert!(err.contains("row 2") && err.contains("2 columns"), "{err}");
    }

    #[test]
    fn the_limits_are_enforced() {
        let wide = Sheet::empty(MAX_COLS + 1, 1);
        assert!(Sheet::parse(&wide.serialize())
            .unwrap_err()
            .contains("52 columns"));
        let tall = Sheet::empty(1, MAX_ROWS + 1);
        assert!(Sheet::parse(&tall.serialize())
            .unwrap_err()
            .contains("5000 rows"));
        let mut long = Sheet::empty(2, 2);
        long.rows[1][1] = "x".repeat(MAX_CELL_CHARS + 1);
        let err = Sheet::parse(&long.serialize()).unwrap_err();
        assert!(
            err.contains("10000 characters") && err.contains("B2"),
            "{err}"
        );
        assert!(Sheet::parse(&Sheet::empty(0, 0).serialize()).is_err());
        let exact = Sheet::empty(MAX_COLS, MAX_ROWS);
        assert!(Sheet::parse(&exact.serialize()).is_ok());
    }

    #[test]
    fn a_bad_width_is_refused() {
        let raw = r#"{"v":1,"engine":"grid","data":{"cols":[{"w":0}],"rows":[]}}"#;
        assert!(Sheet::parse(raw).unwrap_err().contains("width"));
    }

    #[test]
    fn the_body_is_a_gfm_table_with_row_one_as_header() {
        let s = sheet(&[&["Date", "Build", "ms"], &["2026-10-03", "a1f3", "412"]]);
        assert_eq!(
            s.markdown(),
            "| Date | Build | ms |\n| --- | --- | --- |\n| 2026-10-03 | a1f3 | 412 |"
        );
    }

    #[test]
    fn the_body_trims_trailing_empty_rows_and_columns_only() {
        let mut s = sheet(&[&["", "b", "", ""], &["c", "", "", ""], &["", "", "", ""]]);
        s.rows.push(vec![String::new(); 4]);
        assert_eq!(s.markdown(), "|  | b |\n| --- | --- |\n| c |  |");
    }

    #[test]
    fn a_single_filled_row_is_a_header_alone() {
        let s = sheet(&[&["a", "b"]]);
        assert_eq!(s.markdown(), "| a | b |\n| --- | --- |");
    }

    #[test]
    fn pipes_newlines_and_backslashes_in_cells_are_escaped() {
        let s = sheet(&[&["a|b", "line1\nline2", "c:\\dir"]]);
        assert_eq!(
            s.markdown(),
            "| a\\|b | line1<br>line2 | c:\\\\dir |\n| --- | --- | --- |"
        );
    }

    #[test]
    fn inline_tags_in_cells_reach_the_body() {
        let s = sheet(&[&["what", "state"], &["flaky test", "#bug"]]);
        assert_eq!(
            crate::domain::extract_inline_tags(&s.markdown()),
            vec!["bug".to_string()]
        );
    }

    #[test]
    fn csv_quotes_only_what_needs_it_and_keeps_every_column() {
        let mut s = sheet(&[&["a,b", "say \"hi\"", "two\nlines", "plain", ""]]);
        s.rows.push(vec![String::new(); 5]);
        assert_eq!(
            s.csv(),
            "\"a,b\",\"say \"\"hi\"\"\",\"two\nlines\",plain,\r\n"
        );
    }

    #[test]
    fn append_reuses_the_empty_rows_at_the_bottom() {
        let mut s = Sheet::new_default();
        s.rows[0] = vec!["Date".into(), "Build".into(), "ms".into()];
        let at = s
            .append_rows(vec![vec!["2026-10-04".into(), "b2c4".into()]])
            .unwrap();
        assert_eq!(at, 1);
        assert_eq!(s.rows.len(), 20);
        assert_eq!(s.rows[1], vec!["2026-10-04", "b2c4", ""]);
        assert_eq!(s.filled_rows(), 2);
    }

    #[test]
    fn append_grows_the_grid_once_the_empty_rows_are_used() {
        let mut s = Sheet::empty(2, 1);
        s.rows[0] = vec!["h".into(), "k".into()];
        let at = s
            .append_rows(vec![vec!["1".into()], vec!["2".into(), "3".into()]])
            .unwrap();
        assert_eq!(at, 1);
        assert_eq!(s.rows.len(), 3);
        assert_eq!(s.rows[2], vec!["2", "3"]);
    }

    #[test]
    fn append_refuses_a_row_wider_than_the_sheet() {
        let mut s = Sheet::empty(2, 1);
        let err = s
            .append_rows(vec![vec!["1".into(), "2".into(), "3".into()]])
            .unwrap_err();
        assert!(
            err.contains("row 1 has 3 cells") && err.contains("A, B"),
            "{err}"
        );
        assert_eq!(s.rows.len(), 1, "a refused append changes nothing");
    }

    #[test]
    fn append_refuses_past_the_row_cap_and_the_cell_cap() {
        let mut s = Sheet::empty(1, MAX_ROWS);
        s.rows[MAX_ROWS - 1][0] = "last".into();
        assert!(s
            .append_rows(vec![vec!["x".into()]])
            .unwrap_err()
            .contains("5000 rows"));
        let mut t = Sheet::empty(1, 1);
        let err = t
            .append_rows(vec![vec!["y".repeat(MAX_CELL_CHARS + 1)]])
            .unwrap_err();
        assert!(err.contains("A1"), "{err}");
        assert!(s
            .append_rows(vec![])
            .unwrap_err()
            .contains("at least one row"));
    }
}
