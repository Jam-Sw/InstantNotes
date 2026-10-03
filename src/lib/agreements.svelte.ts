// The Jam-Sw agreement gate for Svelte apps: the rules every platform follows
// (installers README, "The agreement gate"), with no UI of its own. Copied
// into the app by installers/scripts/apply.mjs, so never edit the copy.
//
// Render it with AgreementGate.svelte, or in the app's own way, as long as
// nothing in the app is usable until `done` is true and every document is
// shown with its own agreement. The texts come from agreements.json, which
// apply.mjs writes from the same strings as LICENSE and EULA.txt.

import manifest from '../../src-tauri/installer/agreements.json';

export interface AgreementDocument {
  id: string;
  title: string;
  /** Agreement is stored per version; a new version asks again. */
  version: string;
  text: string;
}

export interface AgreementCopy {
  heading: string;
  lead: string;
  agree: string;
  agreed: string;
  decline: string;
}

/** Document id to the version agreed to. */
export type Accepted = Record<string, string>;

type Versioned = Pick<AgreementDocument, 'id' | 'version'>;

function asAccepted(stored: unknown): Accepted {
  if (!stored || typeof stored !== 'object' || Array.isArray(stored)) return {};
  return Object.fromEntries(
    Object.entries(stored).filter(([, v]) => typeof v === 'string'),
  ) as Accepted;
}

/** Ids of the documents still to agree to, in manifest order. */
export function pendingDocuments(documents: Versioned[], stored: unknown): string[] {
  const accepted = asAccepted(stored);
  return documents.filter((d) => accepted[d.id] !== d.version).map((d) => d.id);
}

/** What to store after agreeing to `id`: the version shown for it, the other
 *  listed documents as they were, and nothing for documents no longer listed. */
export function withAccepted(documents: Versioned[], stored: unknown, id: string): Accepted {
  const accepted = asAccepted(stored);
  const next: Accepted = {};
  for (const d of documents) {
    if (d.id === id) next[d.id] = d.version;
    else if (d.id in accepted) next[d.id] = accepted[d.id];
  }
  return next;
}

const KEY: string = manifest.storageKey;

function read(): unknown {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? JSON.parse(raw) : {};
  } catch {
    // Unreadable or unavailable: nothing counts as agreed, the safe side.
    return {};
  }
}

class Agreements {
  readonly documents: AgreementDocument[] = manifest.documents;
  readonly copy: AgreementCopy = manifest.copy;
  #stored = $state<unknown>(read());
  readonly pending = $derived(pendingDocuments(this.documents, this.#stored));

  /** True once every document is agreed to at its current version. */
  get done(): boolean {
    return this.pending.length === 0;
  }

  isAgreed(id: string): boolean {
    return this.documents.some((d) => d.id === id) && !this.pending.includes(id);
  }

  agree(id: string): void {
    const next = withAccepted(this.documents, this.#stored, id);
    this.#stored = next;
    try {
      localStorage.setItem(KEY, JSON.stringify(next));
    } catch {
      // Not stored: the gate asks again next launch, which is the safe side.
    }
  }

  /** Re-read what this device agreed to; another window may have agreed. */
  refresh(): void {
    this.#stored = read();
  }
}

export const agreements = new Agreements();

if (typeof window !== 'undefined') {
  window.addEventListener('storage', (e) => {
    if (e.key === KEY) agreements.refresh();
  });
  window.addEventListener('focus', () => agreements.refresh());
}
