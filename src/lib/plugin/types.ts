import type { EditorView } from "@codemirror/view";

export type Region =
  | {
      readonly kind: "fence";
      readonly lang: string;
      readonly lines: readonly string[];
    }
  | { readonly kind: "inline"; readonly text: string }
  | { readonly kind: "prose"; readonly text: string }
  | {
      readonly kind: "table";
      readonly rows: readonly (readonly string[])[];
      readonly header: boolean;
    };

export interface View {
  readonly text: string;
  readonly error?: boolean;
  readonly hint?: boolean;
  readonly grid?: readonly (readonly string[])[] | null;
}

export interface Out {
  readonly at: number;
  readonly views: readonly View[];
}

export interface Mark {
  readonly from: number;
  readonly to: number;
  readonly kind: "spelling" | "style";
  readonly message: string;
  readonly fixes?: readonly string[] | (() => readonly string[]);
}

export interface Block {
  readonly id: number;
  readonly data: unknown;
}

export interface Result {
  readonly out: readonly Out[];
  readonly marks?: readonly Mark[];
  readonly blocks?: readonly Block[];
}

export const OPENING = -1;

export const MASK = "\uFFFC";

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
  readonly kind?: "options" | "text" | "file";
  readonly options?: readonly {
    readonly value: string;
    readonly label: string;
  }[];
  readonly extensions?: readonly string[];
  readonly placeholder?: string;
  readonly default: string;
  readonly when?: {
    readonly key: string;
    readonly is?: string;
    readonly not?: string;
  };
}

export type Prefs = Readonly<Record<string, string>>;

export interface Host {
  readText(path: string): Promise<string>;
  post(url: string, body: string, signal?: AbortSignal): Promise<string>;
  notify(message: string): void;
  refresh(): void;
}

export interface Context {
  readonly off: readonly {
    readonly label: string;
    readonly fences: readonly string[];
  }[];
  readonly settings: string;
  readonly host: Host;
}

export interface CompleteRequest {
  readonly before: string;
  readonly after: string;
}

export interface Plugin {
  readonly id: string;
  readonly label: string;
  readonly api: 1;
  readonly fences?: readonly string[] | "*";
  readonly inline?: Claim;
  readonly cells?: Claim;
  readonly prose?: boolean;
  readonly isolated?: boolean;
  readonly prefs?: readonly PrefSpec[];
  readonly theme?: Parameters<typeof EditorView.baseTheme>[0];
  readonly block?: {
    same(a: unknown, b: unknown): boolean;
    mount(data: unknown): BlockHandle;
  };
  run(regions: readonly Region[], prefs: Prefs, context: Context): readonly Result[];
  complete?(
    request: CompleteRequest,
    prefs: Prefs,
    context: Context,
    signal: AbortSignal,
  ): Promise<string | null> | string | null;
}

export interface PluginConfig {
  readonly plugins: readonly Plugin[];
  readonly prefs: Readonly<Record<string, Prefs>>;
  readonly context?: Context;
}

const unavailable = (): Promise<string> => Promise.reject(new Error("not available"));

const NO_HOST: Host = {
  readText: unavailable,
  post: unavailable,
  notify() {},
  refresh() {},
};

export const NO_CONTEXT: Context = { off: [], settings: "", host: NO_HOST };

export const prefShown = (spec: PrefSpec, prefs: Prefs): boolean => {
  const when = spec.when;
  if (!when) return true;
  const value = prefs[when.key] ?? "";
  return (when.is === undefined || value === when.is) && (when.not === undefined || value !== when.not);
};

export const cellAt = (r: number, c: number): number => r * 4096 + c;

export const claims = (claim: Claim | undefined, text: string): boolean =>
  claim !== undefined && text.startsWith(claim.prefix) && (claim.test?.(text) ?? true);
