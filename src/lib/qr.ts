import qrcode from "qrcode-generator";
import type { SyncServerStatus } from "$lib/api/types";

const QUIET = 4;
const SIGNED_OUT = new Set(["off", "signingIn", "signedOut", "otherLibrary"]);

export interface QrDrawing {
  size: number;
  modules: number;
  path: string;
}

export function qrDrawing(text: string): QrDrawing {
  const code = qrcode(0, "M");
  code.addData(text);
  code.make();
  const count = code.getModuleCount();
  let path = "";
  for (let row = 0; row < count; row++) {
    for (let col = 0; col < count; col++) {
      if (code.isDark(row, col)) path += `M${col + QUIET} ${row + QUIET}h1v1h-1z`;
    }
  }
  return { size: count + QUIET * 2, modules: count, path };
}

export function noteLink(
  status: Pick<SyncServerStatus, "stage" | "address"> | null,
  noteId: string,
): string | null {
  const address = status?.address?.trim();
  if (!status || !address || SIGNED_OUT.has(status.stage)) return null;
  let url: URL;
  try {
    url = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(address) ? address : `https://${address}`);
  } catch {
    return null;
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") return null;
  return `${url.origin}${url.pathname.replace(/\/+$/, "")}/#note=${encodeURIComponent(noteId)}`;
}

export function linkedNoteId(hash: string): string | null {
  const match = /^#note=([^&]+)$/.exec(hash);
  if (!match) return null;
  try {
    return decodeURIComponent(match[1]) || null;
  } catch {
    return null;
  }
}
