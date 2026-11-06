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
  const options = { body: payload.notification?.body || "Open Moonledger for a quick check-in.", icon: "/moonledger-icon.svg", badge: "/moon.svg", data: { url: payload.fcmOptions?.link || "/" } };
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
