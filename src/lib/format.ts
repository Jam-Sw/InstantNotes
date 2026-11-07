import { listPrefs } from "$lib/stores/list.svelte";

const timeFormat = new Intl.DateTimeFormat([], { hour: "numeric", minute: "2-digit" });
const shortDateFormat = new Intl.DateTimeFormat([], { month: "short", day: "numeric" });
const exactFormat = new Intl.DateTimeFormat([], {
  year: "numeric",
  month: "short",
  day: "numeric",
  hour: "numeric",
  minute: "2-digit",
});

export function formatDate(iso: string): string {
  const d = new Date(iso);
  const today = new Date();
  const sameDay =
    d.getFullYear() === today.getFullYear() &&
    d.getMonth() === today.getMonth() &&
    d.getDate() === today.getDate();
  return sameDay ? timeFormat.format(d) : shortDateFormat.format(d);
}

export function formatExact(iso: string): string {
  return exactFormat.format(new Date(iso));
}

export function formatBytes(n: number): string {
  if (!Number.isFinite(n) || n <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.min(units.length - 1, Math.floor(Math.log(n) / Math.log(1024)));
  const val = n / 1024 ** i;
  const shown = i === 0 ? String(val) : val.toFixed(val >= 10 || val % 1 === 0 ? 0 : 1);
  return `${shown} ${units[i]}`;
}

export function preview(body: string): string {
  const head = body.length > 1024 ? body.slice(0, 1024) : body;
  const collapsed = head.replace(/\s+/g, " ").trim();
  const max = listPrefs.previewChars;
  if (head === body || collapsed.length > max) return collapsed.slice(0, max);
  return body.replace(/\s+/g, " ").trim().slice(0, max);
}

export function sheetPreview(body: string): string {
  const cells = body
    .split("\n")
    .filter((line) => !/^\|(?:\s*-+\s*\|)+\s*$/.test(line))
    .flatMap((line) => line.replace(/^\|/, "").replace(/\|$/, "").split(/(?<!\\)\|/))
    .map((cell) => cell.replace(/\\\|/g, "|").replace(/<br>/g, " ").trim())
    .filter(Boolean);
  return cells.join(" · ").slice(0, listPrefs.previewChars);
}

export function wordCount(body: string): number {
  let n = 0;
  const words = /\S+/g;
  while (words.exec(body)) n++;
  return n;
}
