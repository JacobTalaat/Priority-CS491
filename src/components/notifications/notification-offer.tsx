"use client";

import { useState } from "react";
import { Button, Notice } from "@/components/ui";
import { savePromptDismissed } from "@/lib/notification-prompt";
import { enablePush } from "@/lib/push-subscribe";
import styles from "./notification-offer.module.css";

type State = { status: "idle" | "busy" } | { status: "on" } | { status: "error"; message: string };

// Shown right after the student confirms their first class. The browser's own
// permission prompt only opens from the "Turn on" click, never by itself.
export function NotificationOffer({ onClose }: { onClose: () => void }) {
  const [state, setState] = useState<State>({ status: "idle" });

  async function turnOn() {
    setState({ status: "busy" });
    const result = await enablePush();
    setState(result.ok ? { status: "on" } : { status: "error", message: result.message });
  }

  function notNow() {
    savePromptDismissed();
    onClose();
  }

  if (state.status === "on") {
    return (
      <Notice tone="success">
        Notifications are on. You can change them anytime in Settings.
      </Notice>
    );
  }

  return (
    <section className={styles.offer} aria-labelledby="notification-offer-title">
      <div className={styles.text}>
        <h2 id="notification-offer-title" className={styles.title}>
          Get a reminder before work is due?
        </h2>
        <p className={styles.body}>
          Priority can send a short note in the evening about what&apos;s due tomorrow and when a new grade
          posts. Your browser will ask you to allow it.
        </p>
      </div>
      {state.status === "error" ? <Notice tone="error">{state.message}</Notice> : null}
      <div className={styles.actions}>
        <Button type="button" onClick={turnOn} loading={state.status === "busy"}>
          Turn on notifications
        </Button>
        <Button type="button" variant="ghost" onClick={notNow} disabled={state.status === "busy"}>
          Not now
        </Button>
      </div>
    </section>
  );
}
