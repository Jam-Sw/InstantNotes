const MAX_PASSAGE_CHARS = 1200;

export function paragraphAround(
  lineCount: number,
  lineText: (index: number) => string,
  currentLine: number,
): string {
  if (lineCount === 0 || !lineText(currentLine).trim()) return "";
  let start = currentLine;
  while (start > 0 && lineText(start - 1).trim() !== "") {
    start--;
  }
  let end = currentLine;
  while (end + 1 < lineCount && lineText(end + 1).trim() !== "") {
    end++;
  }
  const parts: string[] = [];
  for (let i = start; i <= end; i++) parts.push(lineText(i));
  const block = parts.join("\n").trim();
  return block.length > MAX_PASSAGE_CHARS ? block.slice(0, MAX_PASSAGE_CHARS) : block;
}

export function keepOrder<T extends { noteId: string }>(previous: T[], next: T[]): T[] {
  const incoming = new Map(next.map((n) => [n.noteId, n]));
  const kept = previous.flatMap((n) => {
    const fresh = incoming.get(n.noteId);
    if (!fresh) return [];
    incoming.delete(n.noteId);
    return [fresh];
  });
  return [...kept, ...incoming.values()];
}
