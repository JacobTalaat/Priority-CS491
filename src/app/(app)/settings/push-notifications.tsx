"use client";

import { useEffect, useState } from "react";
import { Button, Notice } from "@/components/ui";
import {
  deletePushSubscription,
  getPushPublicKey,
  savePushSubscription,
  sendTestPush,
} from "@/lib/push-client";
import styles from "./settings.module.css";

type Message = { tone: "success" | "error"; text: string } | null;

const DENIED_MESSAGE = "Notifications are blocked for this site in your browser settings.";
const SUBSCRIBE_FAILED_MESSAGE =
  "This browser refused the notification subscription. Try again.";

// Everything below runs inside click handlers or effect-driven reads that never
// ask for permission: the prompt may only appear from the student's own click.
function unsupportedMessage(): string | null {
  if (typeof window === "undefined") {
    return "Web notifications are only available in the browser.";
  }
  if (!("serviceWorker" in navigator) || !("PushManager" in window) || !("Notification" in window)) {
    return "This browser doesn't support web notifications.";
  }
  return null;
}

function urlBase64ToUint8Array(value: string): Uint8Array {
  const padding = "=".repeat((4 - (value.length % 4)) % 4);
  const binary = atob(`${value.replace(/-/g, "+").replace(/_/g, "/")}${padding}`);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

// The DOM lib omits the non-standard-but-everywhere `applicationServerKey`, so
// it is read through this widened type.
type SubscriptionWithServerKey = PushSubscription & {
  applicationServerKey?: BufferSource | null;
};

function applicationServerKeyIs(newKey: string, subscription: PushSubscription): boolean {
  const expected = urlBase64ToUint8Array(newKey);
  const wide = subscription as SubscriptionWithServerKey;
  // Chrome hands the bytes back inside its own ArrayBuffer; compare one by one.
  const bytes =
    wide.applicationServerKey instanceof Uint8Array
      ? wide.applicationServerKey
      : wide.applicationServerKey
        ? new Uint8Array(wide.applicationServerKey as ArrayBuffer)
        : null;
  if (!bytes || bytes.byteLength !== expected.length) {
    return false;
  }
  for (let index = 0; index < expected.length; index += 1) {
    if (bytes[index] !== expected[index]) {
      return false;
    }
  }
  return true;
}

type SubscriptionPayload = {
  endpoint: string;
  keys: { p256dh: string; auth: string };
};

// Chrome returns the subscription as JSON in exactly the shape the route wants.
function subscriptionPayload(subscription: PushSubscription): SubscriptionPayload | null {
  const json = subscription.toJSON() as Partial<SubscriptionPayload>;
  if (
    typeof json.endpoint !== "string" ||
    typeof json.keys?.p256dh !== "string" ||
    typeof json.keys?.auth !== "string"
  ) {
    return null;
  }
  return { endpoint: json.endpoint, keys: { p256dh: json.keys.p256dh, auth: json.keys.auth } };
}

// Set on mount by reading the browser's existing subscription; no permission
// prompt and no server call, so the buttons can start in the right state.
async function findBrowserSubscription(): Promise<PushSubscription | null> {
  try {
    const registration = await navigator.serviceWorker.getRegistration();
    return (await registration?.pushManager.getSubscription()) ?? null;
  } catch {
    return null;
  }
}

export function PushNotifications() {
  const [message, setMessage] = useState<Message>(null);
  const [enabled, setEnabled] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    findBrowserSubscription().then((subscription) => {
      if (!cancelled) {
        setEnabled(subscription !== null);
      }
    });
    return () => {
      cancelled = true;
    };
  }, []);

  async function subscribeWith(registration: ServiceWorkerRegistration, publicKey: string) {
    const existing = await registration.pushManager.getSubscription();
    let target = existing;
    if (existing && !applicationServerKeyIs(publicKey, existing)) {
      // The server's key was rotated: this browser's old subscription signs up
      // under a key nobody will ever use again, so start over rather than send.
      await deletePushSubscription(existing.endpoint);
      await existing.unsubscribe();
      target = null;
    }
    return target ?? (await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(publicKey) as BufferSource,
    }));
  }

  async function handleEnable() {
    setMessage(null);
    setBusy(true);
    try {
      const blocked = unsupportedMessage();
      if (blocked) {
        setMessage({ tone: "error", text: blocked });
        return;
      }
      const permission = await Notification.requestPermission();
      if (permission !== "granted") {
        setMessage({ tone: "error", text: DENIED_MESSAGE });
        return;
      }
      // The single public key lives on the server, so fetch it with the token
      // rather than trusting a build-time copy to match the signing key.
      const keyResult = await getPushPublicKey();
      if (!keyResult.ok) {
        setMessage({ tone: "error", text: keyResult.error });
        return;
      }
      await navigator.serviceWorker.register("/sw.js");
      // ready waits for the just-registered worker to be active, so subscribing
      // never races the worker's first install.
      const registration = await navigator.serviceWorker.ready;
      const subscription = await subscribeWith(registration, keyResult.data.publicKey);
      const payload = subscriptionPayload(subscription);
      if (!payload) {
        setMessage({ tone: "error", text: SUBSCRIBE_FAILED_MESSAGE });
        return;
      }
      const result = await savePushSubscription(payload);
      if (!result.ok) {
        setMessage({ tone: "error", text: result.error });
        return;
      }
      setEnabled(true);
      setMessage({ tone: "success", text: "Browser notifications are on for this device." });
    } catch {
      setMessage({ tone: "error", text: SUBSCRIBE_FAILED_MESSAGE });
    } finally {
      setBusy(false);
    }
  }

  async function handleDisable() {
    setMessage(null);
    setBusy(true);
    try {
      const subscription = await findBrowserSubscription();
      if (subscription) {
        await deletePushSubscription(subscription.endpoint);
        await subscription.unsubscribe();
      }
      setEnabled(false);
      setMessage({ tone: "success", text: "Browser notifications are off for this device." });
    } catch {
      setMessage({ tone: "error", text: SUBSCRIBE_FAILED_MESSAGE });
    } finally {
      setBusy(false);
    }
  }

  async function handleSendTest() {
    setMessage(null);
    setBusy(true);
    const result = await sendTestPush();
    setBusy(false);
    if (!result.ok) {
      setMessage({ tone: "error", text: result.error });
      return;
    }
    if (result.data.sent > 0) {
      setMessage({ tone: "success", text: "Test notification sent. Check your notifications panel." });
      return;
    }
    setMessage({ tone: "error", text: "The push service rejected this browser's subscription." });
  }

  return (
    <section className={styles.section} aria-labelledby="push-notifications-heading">
      <div className={styles.sectionHeader}>
        <h2 id="push-notifications-heading" className={styles.sectionTitle}>
          Browser notifications
        </h2>
      </div>
      <p className={styles.sectionNote}>
        Get Priority reminders in this browser on this device. You can turn them off here anytime.
      </p>
      {message ? <Notice tone={message.tone}>{message.text}</Notice> : null}
      <div className={styles.actions}>
        {enabled ? (
          <Button type="button" variant="ghost" onClick={handleDisable} loading={busy}>
            Turn off notifications
          </Button>
        ) : (
          <Button type="button" onClick={handleEnable} loading={busy}>
            Turn on notifications
          </Button>
        )}
        {enabled ? (
          <Button type="button" onClick={handleSendTest} loading={busy}>
            Send a test notification
          </Button>
        ) : null}
      </div>
    </section>
  );
}
