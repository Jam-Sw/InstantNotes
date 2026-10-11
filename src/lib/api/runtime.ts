import { browser } from "$app/environment";

export const isWeb =
  browser && document.querySelector('meta[name="instantnotes-runtime"][content="web"]') !== null;

export const clientId = isWeb ? crypto.randomUUID() : "";
