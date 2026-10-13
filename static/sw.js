const SHELL = "instantnotes-shell-v1";
const ATTACHMENTS = "/api/attachments/";
const TYPES = { png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif", webp: "image/webp" };
const PASS = ["/sync/", "/auth/", "/healthz", "/api/"];

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));

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
  try {
    const response = await fetch(request);
    if (await cacheable(request, response)) {
      const cache = await caches.open(SHELL);
      await cache.put(request.mode === "navigate" ? "/" : request, response.clone());
    }
    return response;
  } catch (e) {
    const hit = await caches.match(request.mode === "navigate" ? "/" : request);
    if (hit) return hit;
    throw e;
  }
}
