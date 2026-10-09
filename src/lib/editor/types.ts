import type { Decoration } from "@codemirror/view";
import type { EditorState } from "@codemirror/state";
import type { SyntaxNodeRef } from "@lezer/common";

export type RevealMode = "span" | "never";

export interface ScanContext {
  readonly state: EditorState;
  readonly preview: boolean;
}

export interface Emit {
  construct(from: number, to: number, reveal: RevealMode): number;
  hide(owner: number, from: number, to: number, deco?: Decoration): void;
  mark(from: number, to: number, deco: Decoration): void;
  line(lineFrom: number, deco: Decoration): void;
}

export interface ConstructSpec {
  readonly nodes: readonly string[];
  enter(node: SyntaxNodeRef, cx: ScanContext, emit: Emit): boolean | void;
}

export interface TextSpec {
  scan(text: string, offset: number, cx: ScanContext, emit: Emit): void;
}
