// The license agreement as a place in the sidebar, the way an update is
// (update-space.ts): a License Space whose notes are the source license and
// the EULA. It renders the installers agreement gate (agreements.svelte.ts)
// in InstantNotes' own form. Until both documents are agreed it is the only
// place the library window offers, and capture and stickies stand down
// (installers README, "The agreement gate", rule 3). Derived from
// `agreements` and never stored, so it cannot become user data.

import { agreements, type AgreementDocument } from "$lib/agreements.svelte";

export const LICENSE_SPACE_NAME = "License";

class LicenseSpace {
  #shownId = $state<string | null>(null);

  /** True until every document is agreed at its current version. */
  get locked(): boolean {
    return !agreements.done;
  }

  get documents(): AgreementDocument[] {
    return agreements.documents;
  }

  /** The open document: the one picked, else the first still to agree to. */
  get shown(): AgreementDocument | undefined {
    const id = this.#shownId ?? agreements.pending[0];
    return this.documents.find((d) => d.id === id) ?? this.documents[0];
  }

  isAgreed(id: string): boolean {
    return agreements.isAgreed(id);
  }

  show(id: string): void {
    this.#shownId = id;
  }

  /** Agree to one document, then open the next one still to agree to. */
  agree(id: string): void {
    agreements.agree(id);
    this.#shownId = agreements.pending[0] ?? null;
  }
}

export const licenseSpace = new LicenseSpace();
