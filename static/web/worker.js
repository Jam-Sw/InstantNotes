import init, * as core from "./pkg/instantnotes_web.js";

let ready;

const plain = (e) =>
  e && typeof e === "object" && "code" in e
    ? { code: String(e.code), message: String(e.message) }
    : { code: "STORAGE_ERROR", message: String(e) };

self.onmessage = async ({ data }) => {
  const { id, fn, args } = data;
  try {
    ready ??= init().then(() => core.open());
    await ready.catch((e) => {
      ready = undefined;
      throw e;
    });
    if (fn === "open") {
      self.postMessage({ id, ok: true, value: null });
      return;
    }
    if (typeof core[fn] !== "function") throw new Error(`unknown function ${fn}`);
    self.postMessage({ id, ok: true, value: await core[fn](...args) });
  } catch (e) {
    self.postMessage({ id, ok: false, error: plain(e) });
  }
};
