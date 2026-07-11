// Attachment storage plumbing and image capture (paste/drop).
//
// Rendering lives in constructs/image.ts; this module owns the pure path
// resolution (unit-tested) and the capture flow: pasting or dropping an
// image file saves it as an attachment (bytes go to Rust, which owns the
// attachments directory) and inserts the relative markdown reference at the
// caret/drop point.

import { EditorView } from "@codemirror/view";
import { StateEffect, StateField, type Extension } from "@codemirror/state";

// ---------------------------------------------------------------------------
// Attachments base directory
//
// The absolute directory arrives async from Rust after the view exists, so it
// lives in a state field seeded by an effect. Until it lands, attachment
// images simply stay as markdown text.
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Pure helpers (unit-tested without a view)
// ---------------------------------------------------------------------------

const ATTACHMENT_PREFIX = "attachments/";

/**
 * Resolve a markdown image URL to something the webview can load, or null
 * when it can't be rendered. Only relative attachment paths resolve; the
 * `convert` parameter is Tauri's convertFileSrc, injected so this stays pure.
 */
export function attachmentSrc(
  url: string,
  base: string | null,
  convert: (path: string) => string,
): string | null {
  const u = url.trim();
  if (!u.startsWith(ATTACHMENT_PREFIX)) return null;
  const name = u.slice(ATTACHMENT_PREFIX.length);
  // A traversal like attachments/../notes.db must never reach the resolver.
  if (!name || name.includes("/") || name.includes("\\") || name.includes("..")) {
    return null;
  }
  return base ? convert(`${base}/${name}`) : null;
}

/** File extension for a pasteable image MIME type, or null to skip the file. */
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

/** The markdown inserted for a stored attachment. */
export function attachmentMarkdown(name: string): string {
  return `![](${ATTACHMENT_PREFIX}${name})`;
}

function imageFiles(data: DataTransfer | null): File[] {
  if (!data) return [];
  return [...data.files].filter((f) => extForMime(f.type) !== null);
}

// ---------------------------------------------------------------------------
// Paste / drop capture
// ---------------------------------------------------------------------------

export interface ImageCaptureOpts {
  /** Persist one image; resolves to the stored filename. */
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
        // The document may have changed while the save was in flight; clamp
        // rather than dispatch out of range.
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
