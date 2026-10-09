import { describe, expect, it } from 'vitest';
import conformance from '../../src-tauri/installer/agreements.conformance.json';
import manifest from '../../src-tauri/installer/agreements.json';
import { pendingDocuments, withAccepted } from './agreements.svelte';

describe('agreement gate conformance', () => {
  for (const c of conformance.cases) {
    it(c.name, () => {
      let stored: unknown = c.stored;
      for (const id of c.accept ?? []) stored = withAccepted(conformance.documents, stored, id);
      expect(pendingDocuments(conformance.documents, stored)).toEqual(c.pending);
      if (c.storedAfter) expect(stored).toEqual(c.storedAfter);
    });
  }

  it('lists every document with a title, a version, and its text', () => {
    expect(manifest.documents.length).toBeGreaterThan(0);
    for (const d of manifest.documents) {
      expect(d.title && d.version && d.text).toBeTruthy();
    }
  });
});
