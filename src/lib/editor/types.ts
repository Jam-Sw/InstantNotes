// The construct model shared by every kernel module.
//
// A ConstructSpec declares what a markdown construct looks like; the scanner
// (scanner.ts) routes syntax nodes to specs and collects what they emit into
// a ConstructTable. Specs never touch the view, events, or other constructs.
// That single direction of data flow is what makes the kernel's guarantees
// hold by construction (see ARCHITECTURE.md).

import type { Decoration } from "@codemirror/view";
import type { EditorState } from "@codemirror/state";
import type { SyntaxNodeRef } from "@lezer/common";

/**
 * When a construct shows its raw syntax.
 *
 * - "span": revealed while the selection touches the span, boundary
 *   inclusive. The WYSIWYG default: approach it and it opens, leave and it
 *   folds.
 * - "never": stays rendered. Used for widget replacements (bullets, task
 *   checkboxes) that remain stable objects; their hidden ranges are atomic,
 *   so the caret treats them as single units instead of entering them.
 */
export type RevealMode = "span" | "never";

/** Read-only context handed to each spec during a scan. */
export interface ScanContext {
  readonly state: EditorState;
  /** True when the Aa toolbar is closed and markdown chrome is rendered. */
  readonly preview: boolean;
}

/**
 * The declaration surface for specs. All positions are document offsets.
 * Everything emitted is collected by the scanner; nothing renders directly.
 */
export interface Emit {
  /**
   * Declare a construct span and how it reveals. Deduplicated on
   * (from, to, reveal) so several marks sharing a parent declare it once.
   * Returns the construct id used to attach hidden ranges.
   */
  construct(from: number, to: number, reveal: RevealMode): number;
  /**
   * Markup replaced while the owning construct is folded: hidden entirely,
   * or swapped for `deco`'s widget. A no-op outside preview mode, so specs
   * never need to gate hides themselves.
   */
  hide(owner: number, from: number, to: number, deco?: Decoration): void;
  /** A styling mark, active regardless of reveal state or mode. */
  mark(from: number, to: number, deco: Decoration): void;
  /**
   * A line decoration at `lineFrom`. Deduplicated per line, first emit
   * wins, matching the retired wysiwyg layer's behavior for nested blocks.
   */
  line(lineFrom: number, deco: Decoration): void;
}

/** A tree-driven construct: the scanner routes syntax nodes by name. */
export interface ConstructSpec {
  /** Node names this spec owns. A name may belong to only one spec. */
  readonly nodes: readonly string[];
  /**
   * Handle one node. Return false to skip its children, mirroring lezer's
   * iterate contract; return true (or nothing) to descend.
   */
  enter(node: SyntaxNodeRef, cx: ScanContext, emit: Emit): boolean | void;
}

/** A text-driven construct (regex over visible text), e.g. #tags. */
export interface TextSpec {
  scan(text: string, offset: number, cx: ScanContext, emit: Emit): void;
}
