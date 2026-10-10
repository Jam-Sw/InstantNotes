import { agreements, type AgreementDocument } from "$lib/agreements.svelte";

export const LICENSE_SPACE_NAME = "License";

class LicenseSpace {
  #shownId = $state<string | null>(null);

  get locked(): boolean {
    return !agreements.done;
  }

  get documents(): AgreementDocument[] {
    return agreements.documents;
  }

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

  agree(id: string): void {
    agreements.agree(id);
    this.#shownId = agreements.pending[0] ?? null;
  }
}

export const licenseSpace = new LicenseSpace();
