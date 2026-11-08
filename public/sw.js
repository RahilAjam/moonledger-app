// Keep app navigation, Web Share Target, and Firebase push in the same root
// worker. Registering a second root-scoped worker replaces this one and makes
// shared receipt files disappear intermittently.
importScripts("https://www.gstatic.com/firebasejs/12.19.0/firebase-app-compat.js");
importScripts("https://www.gstatic.com/firebasejs/12.19.0/firebase-messaging-compat.js");
firebase.initializeApp({
  apiKey: "AIzaSyChOANwWo-JL89rPl0MxQQ4vOtdmWANiYE",
  authDomain: "moonledger-2b6fb.web.app",
  projectId: "moonledger-2b6fb",
  storageBucket: "moonledger-2b6fb.firebasestorage.app",
  messagingSenderId: "456255922118",
  appId: "1:456255922118:web:9c35a8186868f34c851cc7"
});
const messaging = firebase.messaging();
messaging.onBackgroundMessage((payload) => {
  const title = payload.notification?.title || "Moonledger · a gentle reminder";
  const options = { body: payload.notification?.body || "Open Moonledger for a quick check-in.", icon: "/moonledger-icon-192.png", badge: "/moon.svg", data: { url: payload.fcmOptions?.link || "/" } };
  self.registration.showNotification(title, options);
});
self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = new URL(event.notification.data?.url || "/", self.location.origin).href;
  event.waitUntil(self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((clients) => {
    const existing = clients.find((client) => client.url.startsWith(self.location.origin));
    if (existing) return existing.focus();
    return self.clients.openWindow(url);
  }));
});

const CACHE = "moonledger-shell-v19";
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

function redirectTo(path) {
  // Response.redirect requires an absolute URL. Relative paths throw inside
  // the share-target fetch handler and silently drop the receipt handoff.
  return Response.redirect(new URL(path, self.location.origin).href, 303);
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
          return redirectTo("/?shareError=too-large");
        }
        if (!file && !text) {
          return redirectTo("/?shareError=unsupported");
        }
        if (!file) {
          const id = crypto.randomUUID();
          await saveSharedPayload({ id, text, createdAt: Date.now() });
          return redirectTo("/?sharedPayload=" + encodeURIComponent(id));
        }
        const id = crypto.randomUUID();
        // Keep the cross-context payload as plain bytes plus metadata. This is
        // more dependable than structured-cloning Android's File/URI wrapper
        // into IndexedDB on different WebView implementations.
        const fileData = await file.arrayBuffer();
        await saveSharedPayload({ id, fileData, fileType: file.type, fileName: file.name || "shared-receipt", text, createdAt: Date.now() });
        return redirectTo("/?sharedPayload=" + encodeURIComponent(id));
      } catch (error) {
        console.warn("Could not receive shared content.", error);
        return redirectTo("/?shareError=receive");
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
