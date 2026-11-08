"use client";

import { useEffect, useState } from "react";
import { Button, Notice } from "@/components/ui";
import {
  getNotificationPreferences,
  saveNotificationPreferences,
} from "@/lib/notification-preferences-client";
import type { NotificationPreferences as Preferences } from "@/lib/notification-preferences-client";
import styles from "./settings.module.css";

type LoadState =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ready"; saved: Preferences; values: Preferences };

type Message = { tone: "success" | "error"; text: string } | null;

const OPTIONS = [
  { field: "notifyTonight", label: "Tonight reminder", description: "A reminder at your chosen time." },
  { field: "notifyDueTomorrow", label: "Due tomorrow", description: "A heads-up about work due tomorrow." },
  { field: "notifyGradePosted", label: "Grade posted", description: "A notification when a new grade is available." },
] as const;

export function NotificationPreferences() {
  const [state, setState] = useState<LoadState>({ status: "loading" });
  const [message, setMessage] = useState<Message>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let cancelled = false;
    getNotificationPreferences().then((result) => {
      if (cancelled) {
        return;
      }
      if (!result.ok) {
        setState({ status: "error", message: result.error });
        return;
      }
      setState({ status: "ready", saved: result.data, values: result.data });
    });
    return () => {
      cancelled = true;
    };
  }, []);

  function update(field: keyof Preferences, value: boolean | string) {
    setMessage(null);
    setState((current) =>
      current.status === "ready"
        ? { ...current, values: { ...current.values, [field]: value } }
        : current,
    );
  }

  async function handleSave() {
    if (state.status !== "ready") {
      return;
    }
    setMessage(null);
    setSaving(true);
    const result = await saveNotificationPreferences(state.values);
    setSaving(false);
    if (!result.ok) {
      setMessage({ tone: "error", text: result.error });
      return;
    }
    setState({ status: "ready", saved: result.data, values: result.data });
    setMessage({ tone: "success", text: "Notification preferences saved." });
  }

  const dirty =
    state.status === "ready" &&
    (state.saved.notifyTonight !== state.values.notifyTonight ||
      state.saved.notifyDueTomorrow !== state.values.notifyDueTomorrow ||
      state.saved.notifyGradePosted !== state.values.notifyGradePosted ||
      state.saved.nightlyReminderTime !== state.values.nightlyReminderTime);

  return (
    <section className={styles.section} aria-labelledby="notification-preferences-heading">
      <div className={styles.sectionHeader}>
        <h2 id="notification-preferences-heading" className={styles.sectionTitle}>
          Notification preferences
        </h2>
      </div>
      <p className={styles.sectionNote}>
        Choose which reminders you get. The Tonight reminder time uses New York time.
      </p>

      {message ? <Notice tone={message.tone}>{message.text}</Notice> : null}
      {state.status === "loading" ? (
        <p className={styles.loading} role="status">Loading notification preferences…</p>
      ) : null}
      {state.status === "error" ? (
        <Notice tone="error">{state.message}</Notice>
      ) : null}
      {state.status === "ready" ? (
        <div className={styles.preferenceForm}>
          <fieldset className={styles.preferenceOptions} disabled={saving}>
            <legend className={styles.preferenceLegend}>Notifications</legend>
            {OPTIONS.map(({ field, label, description }) => (
              <label className={styles.preferenceOption} key={field}>
                <span className={styles.preferenceText}>
                  <span className={styles.preferenceLabel}>{label}</span>
                  <span className={styles.preferenceDescription}>{description}</span>
                </span>
                <input
                  type="checkbox"
                  name={field}
                  checked={state.values[field]}
                  onChange={(event) => update(field, event.target.checked)}
                />
              </label>
            ))}
          </fieldset>

          <div className={styles.timeField}>
            <label htmlFor="nightly-reminder-time">Tonight reminder time</label>
            <input
              id="nightly-reminder-time"
              name="nightlyReminderTime"
              type="time"
              value={state.values.nightlyReminderTime}
              disabled={saving || !state.values.notifyTonight}
              onChange={(event) => update("nightlyReminderTime", event.target.value)}
            />
          </div>
          <div className={styles.actions}>
            <Button type="button" onClick={handleSave} loading={saving} disabled={!dirty || saving}>
              Save preferences
            </Button>
          </div>
        </div>
      ) : null}
    </section>
  );
}
