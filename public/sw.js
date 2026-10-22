importScripts("/push-guard.js");

const FALLBACK_TITLE = "Priority";
// A payload missing, malformed, or not an object still deserves a notification,
// just a generic one; silently dropping a push looks like a broken app.
const FALLBACK_BODY = "Open Priority to see what's new.";
const FALLBACK_URL = "/today";

self.addEventListener("push", (event) => {
  event.waitUntil(
    (async () => {
      let payload = null;
      try {
        payload = event.data && event.data.json();
      } catch {
        payload = null;
      }
      const title =
        typeof payload?.title === "string" && payload.title !== "" ? payload.title : FALLBACK_TITLE;
      const body = typeof payload?.body === "string" ? payload.body : FALLBACK_BODY;
      // Every Priority notification mentions a screen in the app; a payload url
      // that fails the guard could point anywhere and is replaced.
      const url = self.pushUrlTarget(payload?.url, self.location.origin) ?? FALLBACK_URL;
      await self.registration.showNotification(title, {
        body,
        data: { url },
      });
    })(),
  );
});

self.addEventListener("notificationclick", (event) => {
  const source = event.notification.data && event.notification.data.url;
  const target = self.pushUrlTarget(source, self.location.origin);
  event.notification.close();
  event.waitUntil(
    (async () => {
      const windows = await self.clients.matchAll({
        type: "window",
        includeUncontrolled: true,
      });
      // An open Priority tab wins: focusing it keeps the student's scroll and
      // state instead of spawning a fifth identical tab.
      for (const client of windows) {
        if (client.url.startsWith(self.location.origin)) {
          await client.focus();
          if (target && "navigate" in client) {
            const absolute = new URL(target, self.location.origin).toString();
            await client.navigate(absolute).catch(() => {});
          }
          return;
        }
      }
      if (target) {
        const absolute = new URL(target, self.location.origin).toString();
        await self.clients.openWindow(absolute);
      }
    })(),
  );
});
