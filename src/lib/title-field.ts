export function singleLine(text: string): string {
  return text.replace(/[^\S\r\n]*(?:\r\n|\r|\n)+[^\S\r\n]*/g, " ");
}
