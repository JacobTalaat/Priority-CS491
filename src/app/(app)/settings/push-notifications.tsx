"use client";

import { useEffect, useState } from "react";
import { Button, Notice } from "@/components/ui";
import {
  deletePushSubscription,
  sendTestPush,
} from "@/lib/push-client";
import { enablePush, findBrowserSubscription, SUBSCRIBE_FAILED_MESSAGE } from "@/lib/push-subscribe";
import styles from "./settings.module.css";

type Message = { tone: "success" | "error"; text: string } | null;

// Permission is only ever asked from the student's own click (enablePush).
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

  async function handleEnable() {
    setMessage(null);
    setBusy(true);
    const result = await enablePush();
    setBusy(false);
    if (!result.ok) {
      setMessage({ tone: "error", text: result.message });
      return;
    }
    setEnabled(true);
    setMessage({ tone: "success", text: "Browser notifications are on for this device." });
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
