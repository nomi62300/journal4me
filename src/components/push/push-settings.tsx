"use client";

/**
 * "Enable alerts." Deceptively small surface, most of it existing to handle
 * one platform: since iOS 16.4, Safari delivers web push ONLY to a PWA
 * installed via Share -> Add to Home Screen — never to a plain browser tab,
 * and a permission prompt from a tab is silently ignored rather than denied.
 * Feature-detecting `PushManager` alone can't tell the difference (it exists
 * in the tab too), so this component checks standalone-launch state
 * explicitly and shows install instructions instead of a button that would
 * quietly do nothing. Getting this wrong looks like a broken feature to
 * every iPhone user — see docs/build-plan.md's push section.
 */

import { useEffect, useState, useTransition } from "react";
import { BellOff, BellRing, Share, SquarePlus, Smartphone } from "lucide-react";
import { toast } from "sonner";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { UpgradePrompt } from "@/components/billing/upgrade-prompt";
import {
  sendTestPush,
  subscribeToPush,
  unsubscribeFromPush,
} from "@/lib/push/actions";
import type { PushSubscriptionRow } from "@/lib/push/queries";

type Support = "checking" | "unsupported" | "ios-needs-install" | "ready";

function isIOSDevice(): boolean {
  // Classic iPhone/iPad UA check, plus iPadOS 13+, which reports as a Mac
  // but exposes touch points a real Mac never does.
  return (
    /iphone|ipad|ipod/i.test(navigator.userAgent) ||
    (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1)
  );
}

function isStandaloneDisplay(): boolean {
  return (
    window.matchMedia("(display-mode: standalone)").matches ||
    // iOS's own non-standard flag — matchMedia alone under-detects on older
    // iOS versions that still support standalone launch.
    (navigator as unknown as { standalone?: boolean }).standalone === true
  );
}

/** applicationServerKey needs raw bytes, not the base64url string VAPID
 *  keys are generated/shared as. Built over an explicit `new ArrayBuffer`
 *  (not `Uint8Array.from`, whose return type widens to the
 *  SharedArrayBuffer-compatible `ArrayBufferLike`) so it satisfies
 *  `pushManager.subscribe()`'s stricter `ArrayBufferView<ArrayBuffer>`. */
function urlBase64ToUint8Array(base64url: string): Uint8Array<ArrayBuffer> {
  const padding = "=".repeat((4 - (base64url.length % 4)) % 4);
  const base64 = (base64url + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(base64);
  const bytes = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
  return bytes;
}

export function PushSettings({
  devices,
  pushAllowed,
}: {
  devices: PushSubscriptionRow[];
  pushAllowed: boolean;
}) {
  const [support, setSupport] = useState<Support>("checking");
  const [permission, setPermission] = useState<NotificationPermission | null>(null);
  const [subscribedHere, setSubscribedHere] = useState(false);
  const [pending, startTransition] = useTransition();
  const [testPending, startTestTransition] = useTransition();

  useEffect(() => {
    let cancelled = false;

    // One-time browser-environment detection has nowhere to live but an
    // effect (window/navigator don't exist during the server render this
    // component's first paint has to match), but setting state synchronously
    // in an effect body forces an extra render pass before paint. The await
    // below is a genuine yield, not a workaround for the sake of it — it's
    // the same microtask boundary the real async detection work
    // (serviceWorker.ready, getSubscription()) needs anyway, so branches that
    // don't need that work still cross it before touching state.
    (async () => {
      await Promise.resolve();
      if (cancelled) return;

      if (!("serviceWorker" in navigator) || !("PushManager" in window) || !("Notification" in window)) {
        setSupport("unsupported");
        return;
      }
      if (isIOSDevice() && !isStandaloneDisplay()) {
        setSupport("ios-needs-install");
        return;
      }

      let subscribed = false;
      try {
        const registration = await navigator.serviceWorker.ready;
        subscribed = !!(await registration.pushManager.getSubscription());
      } catch {
        subscribed = false;
      }
      if (cancelled) return;

      setPermission(Notification.permission);
      setSubscribedHere(subscribed);
      setSupport("ready");
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  function enable() {
    // Notification.requestPermission() must be called synchronously from
    // the click handler on iOS — anything awaited before it breaks the
    // "direct user gesture" requirement and the prompt never appears.
    startTransition(async () => {
      try {
        const result = await Notification.requestPermission();
        setPermission(result);
        if (result !== "granted") {
          if (result === "denied") {
            toast.error("Notifications are blocked — allow them in your browser's site settings to turn this on.");
          }
          return;
        }

        const registration = await navigator.serviceWorker.ready;
        let subscription = await registration.pushManager.getSubscription();
        if (!subscription) {
          subscription = await registration.pushManager.subscribe({
            userVisibleOnly: true,
            applicationServerKey: urlBase64ToUint8Array(
              process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY as string,
            ),
          });
        }

        const json = subscription.toJSON();
        if (!json.endpoint || !json.keys?.p256dh || !json.keys?.auth) {
          throw new Error("Browser returned an incomplete subscription.");
        }

        const saved = await subscribeToPush({
          endpoint: json.endpoint,
          p256dh: json.keys.p256dh,
          auth_key: json.keys.auth,
          user_agent: navigator.userAgent,
        });
        if (saved.error) {
          toast.error(saved.error);
          return;
        }

        setSubscribedHere(true);
        toast.success("Alerts are on for this device.");
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Couldn't turn on alerts.");
      }
    });
  }

  function disableHere() {
    startTransition(async () => {
      try {
        const registration = await navigator.serviceWorker.ready;
        const subscription = await registration.pushManager.getSubscription();
        if (subscription) {
          const endpoint = subscription.endpoint;
          await subscription.unsubscribe();
          await unsubscribeFromPush(endpoint);
        }
        setSubscribedHere(false);
        toast.success("Alerts turned off for this device.");
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Couldn't turn off alerts.");
      }
    });
  }

  function removeDevice(endpoint: string) {
    startTransition(async () => {
      const result = await unsubscribeFromPush(endpoint);
      if (result.error) toast.error(result.error);
      else toast.success("Device removed.");
    });
  }

  function testPush() {
    startTestTransition(async () => {
      const result = await sendTestPush();
      if (result.error) toast.error(result.error);
      else toast.success(`Sent to ${result.sent} device${result.sent === 1 ? "" : "s"}.`);
    });
  }

  return (
    <div className="flex flex-col gap-4">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <BellRing className="size-4" />
            Push alerts
          </CardTitle>
          <CardDescription>
            Get a notification when a rule&apos;s headroom gets tight, a challenge
            target is met, or a payout gate clears.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {!pushAllowed ? (
            <UpgradePrompt
              title="Push alerts are a Pro feature"
              description="Every alert still lands in the notification list above — upgrade to also get it as a push notification on your device."
            />
          ) : support === "checking" ? null : support === "unsupported" ? (
            <Alert>
              <BellOff className="size-4" />
              <AlertTitle>Not supported in this browser</AlertTitle>
              <AlertDescription>
                Every alert still lands in the notification list below, so nothing is missed —
                just not as a push notification here.
              </AlertDescription>
            </Alert>
          ) : support === "ios-needs-install" ? (
            <Alert>
              <Smartphone className="size-4" />
              <AlertTitle>Add journal4me to your Home Screen first</AlertTitle>
              <AlertDescription>
                <p className="mb-2">
                  iPhone only delivers push notifications to an installed app, never to a
                  Safari tab. This takes about ten seconds:
                </p>
                <ol className="list-inside list-decimal space-y-1">
                  <li className="flex items-center gap-1">
                    Tap the Share icon <Share className="inline size-3.5" /> in Safari&apos;s toolbar
                  </li>
                  <li className="flex items-center gap-1">
                    Choose <SquarePlus className="inline size-3.5" /> &quot;Add to Home Screen&quot;
                  </li>
                  <li>Open journal4me from your Home Screen, then come back to this page</li>
                </ol>
              </AlertDescription>
            </Alert>
          ) : permission === "denied" ? (
            <Alert variant="destructive">
              <BellOff className="size-4" />
              <AlertTitle>Notifications are blocked</AlertTitle>
              <AlertDescription>
                Allow notifications for this site in your browser&apos;s settings, then reload
                this page.
              </AlertDescription>
            </Alert>
          ) : subscribedHere ? (
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-2">
                <Badge>On for this device</Badge>
              </div>
              <div className="flex gap-2">
                <Button size="sm" variant="outline" onClick={testPush} disabled={testPending}>
                  {testPending ? "Sending…" : "Send test"}
                </Button>
                <Button size="sm" variant="ghost" onClick={disableHere} disabled={pending}>
                  Turn off
                </Button>
              </div>
            </div>
          ) : (
            <Button onClick={enable} disabled={pending} className="gap-1.5">
              <BellRing className="size-4" />
              {pending ? "Enabling…" : "Enable alerts on this device"}
            </Button>
          )}
        </CardContent>
      </Card>

      {devices.length > 0 ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Subscribed devices</CardTitle>
            <CardDescription>Every device currently able to receive a push.</CardDescription>
          </CardHeader>
          <CardContent className="divide-y">
            {devices.map((d) => (
              <div key={d.id} className="flex items-center justify-between gap-3 py-2.5 text-sm">
                <div className="min-w-0">
                  <p className="truncate font-medium">{describeDevice(d.user_agent)}</p>
                  <p className="text-muted-foreground text-xs">
                    Last active {new Date(d.last_seen_at).toLocaleDateString()}
                  </p>
                </div>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => removeDevice(d.endpoint)}
                  disabled={pending}
                >
                  Remove
                </Button>
              </div>
            ))}
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}

/** A short, readable label from a raw user-agent string — not a full parser,
 *  just enough for someone scanning a device list to tell "phone" from
 *  "laptop" and roughly which browser. */
function describeDevice(userAgent: string | null): string {
  if (!userAgent) return "Unknown device";
  const isIOS = /iphone|ipad/i.test(userAgent);
  const isAndroid = /android/i.test(userAgent);
  const browser = /edg\//i.test(userAgent)
    ? "Edge"
    : /chrome\//i.test(userAgent)
      ? "Chrome"
      : /firefox\//i.test(userAgent)
        ? "Firefox"
        : /safari\//i.test(userAgent)
          ? "Safari"
          : "Browser";
  const platform = isIOS ? "iPhone/iPad" : isAndroid ? "Android" : "Desktop";
  return `${browser} on ${platform}`;
}
