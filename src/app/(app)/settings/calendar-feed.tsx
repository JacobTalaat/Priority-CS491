"use client";

import { useEffect, useState } from "react";
import type { FormEvent } from "react";
import { Button, Input, Notice } from "@/components/ui";
import {
  canvasErrorMessage,
  clearCalendarFeed,
  getCalendarFeedStatus,
  saveCalendarFeed,
} from "@/lib/canvas-client";
import type { CalendarFeedStatus } from "@/lib/canvas-client";
import styles from "./settings.module.css";

type Message = { tone: "success" | "error"; text: string } | null;

export function CalendarFeed() {
  const [status, setStatus] = useState<CalendarFeedStatus | null>(null);
  const [feedUrl, setFeedUrl] = useState("");
  const [message, setMessage] = useState<Message>(null);
  const [busy, setBusy] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    getCalendarFeedStatus().then((result) => {
      if (cancelled) {
        return;
      }
      if (result.ok) {
        setStatus(result.data);
      } else {
        setLoadError(canvasErrorMessage(result));
      }
    });
    return () => {
      cancelled = true;
    };
  }, []);

  async function handleSave(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setMessage(null);
    setBusy(true);
    const result = await saveCalendarFeed(feedUrl);
    setBusy(false);
    if (!result.ok) {
      setMessage({ tone: "error", text: canvasErrorMessage(result) });
      return;
    }
    setFeedUrl("");
    setStatus(result.data);
    setMessage({ tone: "success", text: "Canvas calendar feed saved." });
  }

  async function handleClear() {
    setMessage(null);
    setBusy(true);
    const result = await clearCalendarFeed();
    setBusy(false);
    if (!result.ok) {
      setMessage({ tone: "error", text: canvasErrorMessage(result) });
      return;
    }
    setStatus(result.data);
    setMessage({ tone: "success", text: "Canvas calendar feed removed." });
  }

  return (
    <section className={styles.section} aria-labelledby="calendar-feed-heading">
      <div className={styles.sectionHeader}>
        <h2 id="calendar-feed-heading" className={styles.sectionTitle}>
          Calendar feed
        </h2>
        {status ? (
          <span className={status.configured ? `${styles.badge} ${styles.badgeOn}` : styles.badge}>
            {status.configured ? "Saved" : "Not configured"}
          </span>
        ) : null}
      </div>
      <p className={styles.sectionNote}>
        Save your Canvas calendar feed link so assignment due dates can still sync if your Canvas access token stops working.
        The private link is encrypted for your account and never displayed again.
      </p>
      {message ? <Notice tone={message.tone}>{message.text}</Notice> : null}
      {loadError ? <Notice tone="error">{loadError}</Notice> : null}
      <form className={styles.form} onSubmit={handleSave}>
        <Input
          label="Canvas calendar feed link"
          name="calendarFeedUrl"
          type="url"
          inputMode="url"
          autoComplete="off"
          spellCheck={false}
          value={feedUrl}
          onChange={(event) => setFeedUrl(event.target.value)}
          hint="Copy the calendar feed link from Canvas Calendar. Treat this private link like a password."
          required
        />
        <div className={styles.actions}>
          <Button type="submit" loading={busy}>
            Save feed link
          </Button>
          {status?.configured ? (
            <Button type="button" variant="ghost" onClick={handleClear} disabled={busy}>
              Remove saved link
            </Button>
          ) : null}
        </div>
      </form>
    </section>
  );
}
