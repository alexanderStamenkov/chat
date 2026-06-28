/*
  Simple Service Worker for chat notifications
  - Listens for messages from the client (chat.js)
  - Shows a notification via the Notification API

  NOTE: This file should be available at /sw.js in production (root scope).
*/

self.addEventListener("install", (event) => {
  // Activate SW ASAP
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  // Take control of uncontrolled clients ASAP
  event.waitUntil(self.clients.claim());
});

function normalizeNotificationTitle(title) {
  return title || "Ново съобщение";
}

function normalizeNotificationBody(body) {
  return body || "Имаш ново съобщение.";
}

self.addEventListener("message", (event) => {
  const data = event.data || {};

  // Expected shape:
  // {
  //   type: 'CHAT_NOTIFICATION',
  //   payload: { title, body, icon, tag, data }
  // }
  if (data?.type !== "CHAT_NOTIFICATION") return;

  const payload = data.payload || {};

  const title = normalizeNotificationTitle(payload.title);
  const body = normalizeNotificationBody(payload.body);
  const icon = payload.icon || "/icon.png";

  const tag = payload.tag || "chat-notification";

  const notificationData = payload.data || {};

  event.waitUntil(
    self.registration.showNotification(title, {
      body,
      icon,
      tag,
      // Keep it clickable / actionable
      data: notificationData,
      // Some browsers support these options
      // eslint-disable-next-line no-undefined
      renotify: false,
      requireInteraction: false,
    }),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();

  // Open the chat page
  const chatUrl = new URL("/chat/chat.html", self.location.origin);

  event.waitUntil(
    self.clients
      .matchAll({ type: "window", includeUncontrolled: true })
      .then((clientList) => {
        // Focus an existing tab if possible
        for (const client of clientList) {
          if (client.url && client.url.endsWith("/chat/chat.html")) {
            return client.focus();
          }
        }
        // Otherwise open a new one
        return self.clients.openWindow(chatUrl.href);
      }),
  );
});
