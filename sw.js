const VERSION = "folha-v4.29";
const ASSETS = [
  "./index.html",
  "./style.css?v=4.19",
  "./app.js?v=4.29"
];

self.addEventListener("install", e => {
  e.waitUntil(
    caches.open(VERSION)
      .then(c => c.addAll(ASSETS))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(
        keys.filter(k => k !== VERSION).map(k => caches.delete(k))
      ))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", e => {
  // Tudo: cache primeiro, rede como fallback (abre instantâneo)
  e.respondWith(
    caches.match(e.request).then(cached => {
      const networkFetch = fetch(e.request).then(response => {
        if (response.ok) {
          caches.open(VERSION).then(c => c.put(e.request, response.clone()));
        }
        return response;
      }).catch(() => cached);
      return cached || networkFetch;
    })
  );
});
