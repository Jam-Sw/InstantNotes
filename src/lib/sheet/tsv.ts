// The clipboard format spreadsheets share: tab-separated cells, newline-
// separated rows, a cell quoted when it holds a tab, a newline, or a quote,
// with quotes doubled inside. Google Sheets, Excel, and Numbers all write
// and read this, so a range moves between them and a sheet note as cells.

/** A block of cells as text for the clipboard. */
export function toTsv(block: readonly (readonly string[])[]): string {
  return block
    .map((row) =>
      row
        .map((cell) =>
          /[\t\n\r"]/.test(cell) ? `"${cell.replace(/"/g, '""')}"` : cell,
        )
        .join("\t"),
    )
    .join("\n");
}

/**
 * Clipboard text as a block of cells. Plain text with no tab or newline is
 * one cell. One trailing newline, which every spreadsheet adds, is not an
 * extra empty row.
 */
export function fromTsv(text: string): string[][] {
  const src = text.replace(/\r\n?/g, "\n");
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let i = 0;
  while (i < src.length) {
    const ch = src[i];
    if (ch === '"' && cell === "") {
      // A quoted cell runs to the closing quote; "" inside is one quote.
      i++;
      while (i < src.length) {
        if (src[i] === '"') {
          if (src[i + 1] === '"') {
            cell += '"';
            i += 2;
          } else {
            i++;
            break;
          }
        } else {
          cell += src[i++];
        }
      }
      // Anything up to the next separator belongs to the cell too.
      while (i < src.length && src[i] !== "\t" && src[i] !== "\n") cell += src[i++];
      continue;
    }
    if (ch === "\t") {
      row.push(cell);
      cell = "";
    } else if (ch === "\n") {
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
    } else {
      cell += ch;
    }
    i++;
  }
  if (cell !== "" || row.length > 0 || rows.length === 0) {
    row.push(cell);
    rows.push(row);
  }
  return rows;
}
