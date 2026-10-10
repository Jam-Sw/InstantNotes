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

export function fromTsv(text: string): string[][] {
  const src = text.replace(/\r\n?/g, "\n");
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let i = 0;
  while (i < src.length) {
    const ch = src[i];
    if (ch === '"' && cell === "") {
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
