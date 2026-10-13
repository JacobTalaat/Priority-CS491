"use client";

import { useEffect, useState } from "react";
import { Button, Notice } from "@/components/ui";
import { canvasErrorMessage, formatLastSynced, getLastSynced, syncNow, syncSummary } from "@/lib/canvas-client";
import type { SyncResult } from "@/lib/canvas-client";
import styles from "./sync-now.module.css";

type Message = { tone: "success" | "error"; text: string } | null;

type SyncNowProps = {
  // Lets the page refresh its own data (e.g. the course list) after a sync.
  onSynced?: (result: SyncResult) => void;
};

export function SyncNow({ onSynced }: SyncNowProps) {
  const [lastSyncedAt, setLastSyncedAt] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [message, setMessage] = useState<Message>(null);
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    let cancelled = false;
    getLastSynced().then((result) => {
      if (cancelled) {
        return;
      }
      if (result.ok) {
        setLastSyncedAt(result.data.lastSyncedAt);
      }
      setLoaded(true);
    });
    // Keep "5 minutes ago" accurate while the page stays open.
    const timer = window.setInterval(() => setNow(new Date()), 30 * 1000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, []);

  async function handleSync() {
    setMessage(null);
    setSyncing(true);
    const result = await syncNow();
    setSyncing(false);
    setNow(new Date());
    if (!result.ok) {
      setMessage({
        tone: "error",
        text: result.status === 409 ? "Connect Canvas first, then sync." : canvasErrorMessage(result),
      });
      return;
    }
    setLastSyncedAt(result.data.lastSyncedAt);
    setMessage({ tone: "success", text: syncSummary(result.data) });
    onSynced?.(result.data);
  }

  return (
    <div className={styles.sync}>
      <div className={styles.row}>
        <Button variant="secondary" onClick={handleSync} loading={syncing}>
          {syncing ? "Syncing…" : "Sync now"}
        </Button>
        <p className={styles.last} aria-live="polite">
          <span className={styles.label}>Last synced</span>{" "}
          {loaded ? (
            <time dateTime={lastSyncedAt ?? undefined} title={lastSyncedAt ? new Date(lastSyncedAt).toLocaleString() : undefined}>
              {syncing ? "Syncing with Canvas…" : formatLastSynced(lastSyncedAt, now)}
            </time>
          ) : (
            "…"
          )}
        </p>
      </div>
      {message ? <Notice tone={message.tone}>{message.text}</Notice> : null}
    </div>
  );
}
