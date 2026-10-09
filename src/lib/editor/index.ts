import { keymap } from "@codemirror/view";
import type { Extension } from "@codemirror/state";
import { markdownKeymap } from "@codemirror/lang-markdown";
import { convertFileSrc } from "@tauri-apps/api/core";

import { previewKernel } from "./kernel";
import { CaretGuard } from "./caret";
import { markerBackspaceKeymap } from "./blocks";
import { linkDrop, linkOpenHandler, linkPrefsField, modKeyCursor } from "./links";
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
  openUrl: (url: string) => void;
  saveImage: (bytes: Uint8Array, ext: string) => Promise<string>;
  onImageError?: (message: string) => void;
  convertSrc?: (path: string) => string;
}

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
    markerBackspaceKeymap(),
    keymap.of(markdownKeymap),
    extension,
    new CaretGuard(plugin).extension(),
    linkOpenHandler(opts.openUrl),
    modKeyCursor(),
    editModeTaskToggle(),
    linkDrop(),
    imageCapture({ save: opts.saveImage, onError: opts.onImageError }),
    kernelTheme,
  ];
}

export { setPreviewMode } from "./kernel";
export { setLinkPrefs } from "./links";
export { setAttachmentsBase, linkedImagePaths } from "./images";
