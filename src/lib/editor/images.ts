import { EditorView } from "@codemirror/view";
import { StateEffect, StateField, type Extension } from "@codemirror/state";

export const setAttachmentsBase = StateEffect.define<string>();

export const attachmentsBaseField = StateField.define<string | null>({
  create: () => null,
  update(val, tr) {
    for (const e of tr.effects) {
      if (e.is(setAttachmentsBase)) return e.value;
    }
    return val;
  },
});

const ATTACHMENT_PREFIX = "attachments/";

export function attachmentSrc(
  url: string,
  base: string | null,
  convert: (path: string) => string,
): string | null {
  const u = url.trim();
  if (!u.startsWith(ATTACHMENT_PREFIX)) return null;
  const name = u.slice(ATTACHMENT_PREFIX.length);
  if (!name || name.includes("/") || name.includes("\\") || name.includes("..")) {
    return null;
  }
  return base ? convert(`${base}/${name}`) : null;
}

export function localFilePath(url: string): string | null {
  const u = url.trim();
  if (u.startsWith(ATTACHMENT_PREFIX)) return null;
  if (/^https?:\/\//i.test(u) || u.startsWith("data:")) return null;
  if (u.startsWith("file://")) {
    try {
      return decodeURIComponent(new URL(u).pathname);
    } catch {
      return null;
    }
  }
  if (u.startsWith("/")) return u;
  if (/^[a-zA-Z]:[\\/]/.test(u)) return u;
  return null;
}

export function imageSrc(
  url: string,
  base: string | null,
  convert: (path: string) => string,
): string | null {
  const att = attachmentSrc(url, base, convert);
  if (att) return att;
  const local = localFilePath(url);
  return local ? convert(local) : null;
}

export function linkedImagePaths(body: string): string[] {
  const out = new Set<string>();
  const re = /!\[[^\]]*\]\(([^)\s]+)\)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(body)) !== null) {
    const p = localFilePath(m[1]);
    if (p) out.add(p);
  }
  return [...out];
}

export function extForMime(mime: string): string | null {
  switch (mime) {
    case "image/png":
      return "png";
    case "image/jpeg":
      return "jpg";
    case "image/gif":
      return "gif";
    case "image/webp":
      return "webp";
    default:
      return null;
  }
}

export function attachmentMarkdown(name: string): string {
  return `![](${ATTACHMENT_PREFIX}${name})`;
}

function imageFiles(data: DataTransfer | null): File[] {
  if (!data) return [];
  return [...data.files].filter((f) => extForMime(f.type) !== null);
}

export interface ImageCaptureOpts {
  save: (bytes: Uint8Array, ext: string) => Promise<string>;
  onError?: (message: string) => void;
}

export function imageCapture(opts: ImageCaptureOpts): Extension {
  async function insertFiles(view: EditorView, files: File[], at: number) {
    let pos = at;
    for (const file of files) {
      const ext = extForMime(file.type);
      if (!ext) continue;
      try {
        const bytes = new Uint8Array(await file.arrayBuffer());
        const name = await opts.save(bytes, ext);
        const insert = attachmentMarkdown(name);
        const clamped = Math.min(pos, view.state.doc.length);
        view.dispatch({
          changes: { from: clamped, insert },
          selection: { anchor: clamped + insert.length },
        });
        pos = clamped + insert.length;
      } catch (e) {
        opts.onError?.(e instanceof Error ? e.message : String(e));
      }
    }
  }

  return EditorView.domEventHandlers({
    paste(e, view) {
      const files = imageFiles(e.clipboardData);
      if (files.length === 0) return false;
      e.preventDefault();
      void insertFiles(view, files, view.state.selection.main.from);
      return true;
    },
    drop(e, view) {
      const files = imageFiles(e.dataTransfer);
      if (files.length === 0) return false;
      e.preventDefault();
      const pos =
        view.posAtCoords({ x: e.clientX, y: e.clientY }) ??
        view.state.selection.main.from;
      void insertFiles(view, files, pos);
      return true;
    },
  });
}
