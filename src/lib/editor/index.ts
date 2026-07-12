// The editor kernel's single entry point. Editor.svelte consumes this and
// nothing else from the kernel; everything the rest of the app needs
// (effects, fields, pure helpers, types) is re-exported here.
//
// See ARCHITECTURE.md in this directory for the experience contract and the
// module map.

import { keymap } from "@codemirror/view";
import type { Extension } from "@codemirror/state";
import { markdownKeymap } from "@codemirror/lang-markdown";
import { convertFileSrc } from "@tauri-apps/api/core";

import { previewKernel } from "./kernel";
import { CaretGuard } from "./caret";
import { markerBackspaceKeymap } from "./blocks";
import { linkOpenHandler, linkPrefsField, modKeyCursor } from "./links";
import { attachmentsBaseField, imageCapture } from "./images";
import { editModeTaskToggle } from "./tasks";
import { kernelTheme } from "./theme";

import { InlineMarkSpec } from "./constructs/inline-marks";
import { LinkSpec } from "./constructs/link";
import { HeadingSpec } from "./constructs/heading";
import { FenceSpec } from "./constructs/fence";
import { TableSpec } from "./constructs/table";
import { ListSpec } from "./constructs/list";
import { QuoteSpec } from "./constructs/quote";
import { HrSpec } from "./constructs/hr";
import { TaskSpec } from "./constructs/task";
import { ImageSpec } from "./constructs/image";
import { TagSpec } from "./constructs/tags";

export interface EditorKernelOpts {
  /** Open a normalized, scheme-checked URL externally (Rust open_url). */
  openUrl: (url: string) => void;
  /** Persist one pasted/dropped image; resolves to the stored filename. */
  saveImage: (bytes: Uint8Array, ext: string) => Promise<string>;
  onImageError?: (message: string) => void;
  /** Attachment path resolver; defaults to Tauri's convertFileSrc. */
  convertSrc?: (path: string) => string;
}

/**
 * The full editor platform bundle. Register it ABOVE defaultKeymap: the
 * kernel owns Backspace (marker-as-object deletion) and Enter (list/quote
 * continuation via markdownKeymap), which defaultKeymap would otherwise
 * shadow.
 */
export function editorKernel(opts: EditorKernelOpts): Extension {
  const { extension, plugin } = previewKernel({
    specs: [
      new InlineMarkSpec(),
      new LinkSpec(),
      new HeadingSpec(),
      new FenceSpec(),
      new TableSpec(),
      new ListSpec(),
      new QuoteSpec(),
      new HrSpec(),
      new TaskSpec(),
      new ImageSpec(opts.convertSrc ?? convertFileSrc),
    ],
    textSpecs: [new TagSpec()],
    rescanOn: [linkPrefsField, attachmentsBaseField],
  });

  return [
    linkPrefsField,
    attachmentsBaseField,
    // Keymap order within the bundle is precedence order: marker backspace
    // first, then markdown's markup-aware Backspace/Enter continuation.
    markerBackspaceKeymap(),
    keymap.of(markdownKeymap),
    extension,
    new CaretGuard(plugin).extension(),
    linkOpenHandler(opts.openUrl),
    modKeyCursor(),
    editModeTaskToggle(),
    imageCapture({ save: opts.saveImage, onError: opts.onImageError }),
    kernelTheme,
  ];
}

// ---------------------------------------------------------------------------
// Public surface for the rest of the app
// ---------------------------------------------------------------------------

export { previewModeField, setPreviewMode } from "./kernel";
export {
  setLinkPrefs,
  linkPrefsField,
  DEFAULT_LINK_PREFS,
  normalizeHref,
  linkAt,
  linkMarkClass,
} from "./links";
export type { LinkOpenWith, LinkUnderline, LinkPrefsSnapshot } from "./links";
export {
  setAttachmentsBase,
  attachmentsBaseField,
  attachmentSrc,
  imageSrc,
  localFilePath,
  linkedImagePaths,
  extForMime,
  attachmentMarkdown,
} from "./images";
export { taskToggleChange, taskChecked } from "./tasks";
export { blockMarkerRange } from "./blocks";
