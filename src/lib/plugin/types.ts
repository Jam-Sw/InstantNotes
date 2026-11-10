import type { EditorView } from "@codemirror/view";

export type Region =
  | { readonly kind: "fence"; readonly lang: string; readonly lines: readonly string[] }
  | { readonly kind: "inline"; readonly text: string }
  | { readonly kind: "table"; readonly rows: readonly (readonly string[])[]; readonly header: boolean };

export interface View {
  readonly text: string;
  readonly error?: boolean;
  readonly grid?: readonly (readonly string[])[] | null;
}

export interface Out {
  readonly at: number;
  readonly views: readonly View[];
}

export interface Block {
  readonly id: number;
  readonly data: unknown;
}

export interface Result {
  readonly out: readonly Out[];
  readonly blocks?: readonly Block[];
}

export interface BlockHandle {
  readonly el: HTMLElement;
  update(data: unknown): void;
  destroy(): void;
}

export interface Claim {
  readonly prefix: string;
  readonly test?: (text: string) => boolean;
}

export interface PrefSpec {
  readonly key: string;
  readonly label: string;
  readonly options: readonly { readonly value: string; readonly label: string }[];
  readonly default: string;
}

export type Prefs = Readonly<Record<string, string>>;

export interface Plugin {
  readonly id: string;
  readonly label: string;
  readonly api: 1;
  readonly fences?: readonly string[];
  readonly inline?: Claim;
  readonly cells?: Claim;
  readonly prefs?: readonly PrefSpec[];
  readonly theme?: Parameters<typeof EditorView.baseTheme>[0];
  readonly block?: {
    same(a: unknown, b: unknown): boolean;
    mount(data: unknown): BlockHandle;
  };
  run(regions: readonly Region[], prefs: Prefs): readonly Result[];
}

export interface PluginConfig {
  readonly plugins: readonly Plugin[];
  readonly prefs: Readonly<Record<string, Prefs>>;
}

export const cellAt = (r: number, c: number): number => r * 4096 + c;

export const claims = (claim: Claim | undefined, text: string): boolean =>
  claim !== undefined && text.startsWith(claim.prefix) && (claim.test?.(text) ?? true);
