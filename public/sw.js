const CACHE = "moonledger-shell-v15";
const SHARE_DB = "moonledger-share-inbox-v1";

function saveSharedPayload(payload) {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(SHARE_DB, 1);
    request.onupgradeneeded = () => request.result.createObjectStore("inbox", { keyPath: "id" });
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const db = request.result;
      const transaction = db.transaction("inbox", "readwrite");
      transaction.objectStore("inbox").put(payload);
      transaction.oncomplete = () => { db.close(); resolve(); };
      transaction.onerror = () => { db.close(); reject(transaction.error); };
    };
  });
}
self.addEventListener("install", (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    await cache.addAll([
      "/",
      "/manifest.webmanifest",
      "/moonledger-icon.svg",
      "/moonledger-icon-192.png",
      "/moonledger-icon-512.png",
      "/moonledger-social.png",
      "/moonlit-landscape.svg",
      "/sunrise-landscape.svg",
    ]);
    const response = await cache.match("/");
    const html = await response.text();
    const assets = Array.from(html.matchAll(/(?:src|href)="([^"]+\.(?:js|css))"/g), (match) => match[1]);
    if (assets.length) await cache.addAll(assets);
    await self.skipWaiting();
  })());
});
self.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter((key) => key.startsWith("moonledger-") && key !== CACHE).map((key) => caches.delete(key)));
    await self.clients.claim();
  })());
});
self.addEventListener("fetch", (event) => {
  const request = event.request;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  if (request.method === "POST" && url.pathname === "/share-target") {
    event.respondWith((async () => {
      try {
        const form = await request.formData();
        const file = Array.from(form.entries()).find(([field, value]) => {
          if (!(value instanceof Blob) || value.size === 0) return false;
          const name = typeof value.name === "string" ? value.name : "";
          return field === "images" || value.type.startsWith("image/") || /\.(png|jpe?g|webp|gif|heic)$/i.test(name);
        })?.[1];
        const text = [form.get("text"), form.get("title"), form.get("url")]
          .filter((value) => typeof value === "string" && value.trim())
          .join("\n").slice(0, 2000);
        if (file && file.size > 12 * 1024 * 1024) {
          return Response.redirect("/?shareError=too-large", 303);
        }
        if (!file && !text) {
          return Response.redirect("/?shareError=unsupported", 303);
        }
        if (!file) {
          const id = crypto.randomUUID();
          await saveSharedPayload({ id, text, createdAt: Date.now() });
          return Response.redirect("/?sharedPayload=" + encodeURIComponent(id), 303);
        }
        const id = crypto.randomUUID();
        await saveSharedPayload({ id, file, text, createdAt: Date.now() });
        return Response.redirect("/?sharedPayload=" + encodeURIComponent(id), 303);
      } catch (error) {
        console.warn("Could not receive shared content.", error);
        return Response.redirect("/?shareError=receive", 303);
      }
    })());
    return;
  }
  if (request.method !== "GET") return;
  if (request.mode === "navigate") {
    event.respondWith(fetch(request).then((response) => {
      const copy = response.clone(); caches.open(CACHE).then((cache) => cache.put("/", copy)); return response;
    }).catch(() => caches.match("/")));
    return;
  }
  event.respondWith(caches.match(request).then((cached) => cached || fetch(request)));
});
