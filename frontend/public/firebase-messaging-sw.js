/* Firebase Cloud Messaging service worker – shows portal push notifications.
   The Firebase config is passed in the registration URL's query string.
   The backend sends data-only messages, so this is the one place they are shown. */
importScripts("https://www.gstatic.com/firebasejs/11.10.0/firebase-app-compat.js");
importScripts("https://www.gstatic.com/firebasejs/11.10.0/firebase-messaging-compat.js");

// Take over straight away so push can subscribe on the very first visit
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));

const params = Object.fromEntries(new URL(self.location.href).searchParams);
if (params.apiKey) {
  firebase.initializeApp(params);
  firebase.messaging().onBackgroundMessage((payload) => {
    const d = payload.data || payload.notification || {};
    return self.registration.showNotification(d.title || "Silora Academy", {
      body: d.body || "",
      icon: "/favicon.ico",
      badge: "/favicon.ico",
      tag: d.id || undefined,
      data: { link: d.link || payload.fcmOptions?.link || "/portal" },
    });
  });
}

// Open the link – reuse a portal tab when one is already open
self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const link = event.notification.data?.link || "/portal";
  event.waitUntil(
    clients.matchAll({ type: "window", includeUncontrolled: true }).then((list) => {
      const tab = list.find((c) => new URL(c.url).origin === new URL(link, self.location.origin).origin);
      if (tab) return tab.focus().then(() => tab.navigate(link).catch(() => clients.openWindow(link)));
      return clients.openWindow(link);
    })
  );
});
