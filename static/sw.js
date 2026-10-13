const SHELL = "instantnotes-shell-v1";
const ATTACHMENTS = "/api/attachments/";
const TYPES = { png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif", webp: "image/webp" };
const PASS = ["/sync/", "/auth/", "/healthz", "/api/"];

const ENGINE = ["/web/worker.js", "/web/pkg/instantnotes_web.js", "/web/pkg/instantnotes_web_bg.wasm"];

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));

self.addEventListener("message", (event) => {
  const urls = event.data?.cache;
  if (!Array.isArray(urls)) return;
  event.waitUntil(keep(["/", ...ENGINE, ...urls]));
});

async function keep(urls) {
  const cache = await caches.open(SHELL);
  for (const url of new Set(urls)) {
    const path = new URL(url, self.location.origin);
    if (path.origin !== self.location.origin || PASS.some((p) => path.pathname.startsWith(p))) continue;
    try {
      const response = await fetch(path, { credentials: "same-origin" });
      const page = path.pathname === "/";
      if (await cacheable({ mode: page ? "navigate" : "same-origin" }, response)) {
        await cache.put(page ? "/" : path.href, response);
      }
    } catch (e) {
      continue;
    }
  }
}

self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin || event.request.method !== "GET") return;
  if (url.pathname.startsWith(ATTACHMENTS)) {
    event.respondWith(attachment(event, url));
    return;
  }
  if (PASS.some((p) => url.pathname.startsWith(p))) return;
  event.respondWith(shell(event.request));
});

async function windowFor(event) {
  const own = event.clientId ? await self.clients.get(event.clientId) : null;
  if (own) return own;
  const all = await self.clients.matchAll({ type: "window" });
  return all[0] ?? null;
}

async function attachment(event, url) {
  const name = decodeURIComponent(url.pathname.slice(ATTACHMENTS.length));
  const client = await windowFor(event);
  if (!client) return new Response(null, { status: 404 });
  const bytes = await new Promise((resolve) => {
    const channel = new MessageChannel();
    channel.port1.onmessage = (m) => resolve(m.data);
    client.postMessage({ attachment: name }, [channel.port2]);
    setTimeout(() => resolve(null), 10000);
  });
  if (!bytes) return new Response(null, { status: 404 });
  const ext = name.split(".").pop().toLowerCase();
  return new Response(bytes, {
    headers: { "Content-Type": TYPES[ext] ?? "application/octet-stream", "Cache-Control": "no-store" },
  });
}

async function cacheable(request, response) {
  if (!response.ok) return false;
  const html = (response.headers.get("Content-Type") ?? "").startsWith("text/html");
  if (request.mode !== "navigate") return !html;
  return (await response.clone().text()).includes('name="instantnotes-runtime"');
}

async function shell(request) {
  let response;
  try {
    response = await fetch(request);
  } catch (e) {
    const hit = await caches.match(request.mode === "navigate" ? "/" : request);
    if (hit) return hit;
    throw e;
  }
  try {
    if (await cacheable(request, response)) {
      const cache = await caches.open(SHELL);
      await cache.put(request.mode === "navigate" ? "/" : request, response.clone());
    }
  } catch (e) {
    return response;
  }
  return response;
}
