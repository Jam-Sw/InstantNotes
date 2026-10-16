import { getSyncServerStatus } from "$lib/api/client";
import { noteLink } from "$lib/qr";

interface OpenElsewhereRequest {
  noteId: string;
  link: string | null;
}

class OpenElsewhereStore {
  request = $state<OpenElsewhereRequest | null>(null);

  async show(noteId: string): Promise<void> {
    const status = await getSyncServerStatus().catch(() => null);
    this.request = { noteId, link: noteLink(status, noteId) };
  }

  close(): void {
    this.request = null;
  }
}

export const openElsewhere = new OpenElsewhereStore();
