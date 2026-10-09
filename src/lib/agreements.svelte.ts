import manifest from '../../src-tauri/installer/agreements.json';

export interface AgreementDocument {
  id: string;
  title: string;
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

export type Accepted = Record<string, string>;

type Versioned = Pick<AgreementDocument, 'id' | 'version'>;

function asAccepted(stored: unknown): Accepted {
  if (!stored || typeof stored !== 'object' || Array.isArray(stored)) return {};
  return Object.fromEntries(
    Object.entries(stored).filter(([, v]) => typeof v === 'string'),
  ) as Accepted;
}

export function pendingDocuments(documents: Versioned[], stored: unknown): string[] {
  const accepted = asAccepted(stored);
  return documents.filter((d) => accepted[d.id] !== d.version).map((d) => d.id);
}

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
    return {};
  }
}

class Agreements {
  readonly documents: AgreementDocument[] = manifest.documents;
  readonly copy: AgreementCopy = manifest.copy;
  #stored = $state<unknown>(read());
  readonly pending = $derived(pendingDocuments(this.documents, this.#stored));

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
    }
  }

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
