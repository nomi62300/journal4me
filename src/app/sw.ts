/// <reference lib="webworker" />
import { defaultCache } from "@serwist/turbopack/worker";
import type { PrecacheEntry, SerwistGlobalConfig } from "serwist";
import { Serwist } from "serwist";

// The build-time precache manifest. self.__SW_MANIFEST is the injectionPoint
// createSerwistRoute (app/sw/[...path]/route.ts) replaces at request time —
// undefined in dev, since disablePrecacheManifest is forced true there (see
// index.schema.ts), which is exactly what makes iterating on this file fast.
declare const self: ServiceWorkerGlobalScope &
  SerwistGlobalConfig & {
    __SW_MANIFEST: (PrecacheEntry | string)[] | undefined;
  };

const serwist = new Serwist({
  precacheEntries: self.__SW_MANIFEST,
  skipWaiting: true,
  clientsClaim: true,
  navigationPreload: true,
  runtimeCaching: defaultCache,
});

// --------------------------------------------------------------------------
// Push notifications — the reason this file exists at all (M7). Precaching
// above is what @serwist/turbopack needs to serve the worker; everything
// below is the actual product feature.
// --------------------------------------------------------------------------

type PushPayload = {
  title: string;
  body: string;
  /** Path to open on click, e.g. "/accounts/9". Relative, never a full URL —
   *  a payload naming another origin would let a compromised push service
   *  (or a leaked VAPID key) redirect a click anywhere. */
  url?: string;
  /** Same tag replaces an existing unclicked notification instead of
   *  stacking a second one — a stale "80% of daily limit" alert should not
   *  still be sitting in the tray once a fresher one has fired. */
  tag?: string;
};

self.addEventListener("push", (event) => {
  if (!event.data) return;

  let payload: PushPayload;
  try {
    payload = event.data.json();
  } catch {
    // A malformed payload must not throw inside the event handler — that
    // silently drops the notification with no trace in the OS or the
    // in-app centre. Fall back to something visible instead.
    payload = { title: "journal4me", body: event.data.text() };
  }

  event.waitUntil(
    self.registration.showNotification(payload.title, {
      body: payload.body,
      icon: "/icons/icon-192.png",
      badge: "/icons/icon-192.png",
      tag: payload.tag,
      data: { url: payload.url ?? "/dashboard" },
    }),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = new URL(
    (event.notification.data as { url?: string })?.url ?? "/dashboard",
    self.location.origin,
  ).href;

  event.waitUntil(
    (async () => {
      const clientsList = await self.clients.matchAll({
        type: "window",
        includeUncontrolled: true,
      });
      // Focus an already-open tab on this origin rather than always opening
      // a new one — a user tapping three alerts in a row should not end up
      // with three tabs.
      for (const client of clientsList) {
        if ("focus" in client) {
          await client.focus();
          if ("navigate" in client) await (client as WindowClient).navigate(url);
          return;
        }
      }
      await self.clients.openWindow(url);
    })(),
  );
});

serwist.addEventListeners();
