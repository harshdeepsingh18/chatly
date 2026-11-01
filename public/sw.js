const CACHE_NAME = "chatly-shell-v22";
const SHELL_FILES = ["/", "/style.css", "/script.js", "/manifest.webmanifest", "/logo.svg", "/icon-192.png", "/icon-512.png", "/apple-touch-icon.png", "/socket.io/socket.io.js"];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(SHELL_FILES)));
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(caches.keys().then((keys) => Promise.all(
    keys.filter((key) => key.startsWith("chatly-shell-") && key !== CACHE_NAME).map((key) => caches.delete(key))
  )));
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  const url = new URL(request.url);
  if (request.method !== "GET" || url.origin !== self.location.origin) return;
  if (url.pathname.startsWith("/api/") || (url.pathname.startsWith("/socket.io/") && url.pathname !== "/socket.io/socket.io.js")) return;

  event.respondWith((async () => {
    const cache = await caches.open(CACHE_NAME);
    try {
      const response = await fetch(request);
      if (response.ok && SHELL_FILES.includes(url.pathname)) cache.put(request, response.clone());
      return response;
    } catch {
      const cached = await cache.match(request);
      if (cached) return cached;
      if (request.mode === "navigate") return (await cache.match("/")) || Response.error();
      return Response.error();
    }
  })());
});
