"use client";

import { useEffect, useState } from "react";
import type { FormEvent } from "react";
import { SyncNow } from "@/components/sync/sync-now";
import { Button, Input, Notice } from "@/components/ui";
import {
  DEFAULT_CANVAS_URL,
  canvasErrorMessage,
  connectCanvas,
  disconnectCanvas,
  getCanvasStatus,
  testCanvasConnection,
  validateCanvasForm,
} from "@/lib/canvas-client";
import type { CanvasFormErrors, CanvasStatus } from "@/lib/canvas-client";
import styles from "./settings.module.css";

type Message = { tone: "success" | "error"; text: string } | null;
type Busy = "connect" | "test" | "disconnect" | null;

function formatCheckedAt(checkedAt: string | null) {
  if (!checkedAt) {
    return "Not checked yet";
  }
  return new Intl.DateTimeFormat("en", { dateStyle: "medium", timeStyle: "short" }).format(new Date(checkedAt));
}

export function CanvasConnection() {
  const [status, setStatus] = useState<CanvasStatus | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [replacing, setReplacing] = useState(false);
  const [canvasToken, setCanvasToken] = useState("");
  const [baseUrl, setBaseUrl] = useState(DEFAULT_CANVAS_URL);
  const [fieldErrors, setFieldErrors] = useState<CanvasFormErrors>({});
  const [message, setMessage] = useState<Message>(null);
  const [busy, setBusy] = useState<Busy>(null);

  useEffect(() => {
    let cancelled = false;
    getCanvasStatus().then((result) => {
      if (cancelled) {
        return;
      }
      if (result.ok) {
        setStatus(result.data);
        if (result.data.baseUrl) {
          setBaseUrl(result.data.baseUrl);
        }
      } else {
        setLoadError(canvasErrorMessage(result));
      }
    });
    return () => {
      cancelled = true;
    };
  }, []);

  async function handleConnect(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setMessage(null);
    const errors = validateCanvasForm(canvasToken, baseUrl);
    setFieldErrors(errors);
    if (Object.keys(errors).length > 0) {
      return;
    }

    setBusy("connect");
    const result = await connectCanvas(canvasToken, baseUrl);
    setBusy(null);
    if (!result.ok) {
      setMessage({ tone: "error", text: canvasErrorMessage(result) });
      return;
    }
    // Never keep the token around in the page once it's saved.
    setCanvasToken("");
    setReplacing(false);
    setStatus({ connected: true, baseUrl: baseUrl.trim(), checkedAt: new Date().toISOString() });
    setMessage({ tone: "success", text: `Connected to Canvas as ${result.data.canvasUser.name}.` });
  }

  async function handleTest() {
    setMessage(null);
    setBusy("test");
    const result = await testCanvasConnection();
    setBusy(null);
    if (!result.ok) {
      setMessage({ tone: "error", text: canvasErrorMessage(result) });
      return;
    }
    setStatus((current) => current && { ...current, checkedAt: new Date().toISOString() });
    setMessage({ tone: "success", text: `Canvas is working. Signed in as ${result.data.canvasUser.name}.` });
  }

  async function handleDisconnect() {
    setMessage(null);
    setBusy("disconnect");
    const result = await disconnectCanvas();
    setBusy(null);
    if (!result.ok) {
      setMessage({ tone: "error", text: canvasErrorMessage(result) });
      return;
    }
    setStatus({ connected: false, baseUrl: null, checkedAt: null });
    setMessage({ tone: "success", text: "Canvas disconnected. Your saved token was deleted." });
  }

  const connected = status?.connected ?? false;
  const showForm = status !== null && (!connected || replacing);

  return (
    <section className={styles.section} aria-labelledby="canvas-heading">
      <div className={styles.sectionHeader}>
        <h2 id="canvas-heading" className={styles.sectionTitle}>
          Canvas
        </h2>
        {status ? (
          <span className={connected ? `${styles.badge} ${styles.badgeOn}` : styles.badge}>
            {connected ? "Connected" : "Not connected"}
          </span>
        ) : null}
      </div>
      <p className={styles.sectionNote}>
        Paste a Canvas access token so Priority can read your classes and assignments. It&apos;s encrypted
        and never shown again.
      </p>

      {message ? <Notice tone={message.tone}>{message.text}</Notice> : null}
      {loadError ? <Notice tone="error">{loadError}</Notice> : null}
      {status === null && !loadError ? (
        <p className={styles.loading} role="status">
          Checking your Canvas connection…
        </p>
      ) : null}

      {connected && !replacing ? (
        <>
          <dl className={styles.details}>
            <div>
              <dt>Canvas address</dt>
              <dd>{status?.baseUrl}</dd>
            </div>
            <div>
              <dt>Last checked</dt>
              <dd>{formatCheckedAt(status?.checkedAt ?? null)}</dd>
            </div>
          </dl>
          <SyncNow />
          <div className={styles.actions}>
            <Button variant="secondary" onClick={handleTest} loading={busy === "test"} disabled={busy !== null}>
              Test connection
            </Button>
            <Button
              variant="secondary"
              onClick={() => {
                setMessage(null);
                setReplacing(true);
              }}
              disabled={busy !== null}
            >
              Replace token
            </Button>
            <Button variant="ghost" onClick={handleDisconnect} loading={busy === "disconnect"} disabled={busy !== null}>
              Disconnect
            </Button>
          </div>
        </>
      ) : null}

      {showForm ? (
        <form className={styles.form} onSubmit={handleConnect} noValidate>
          <Input
            label="Canvas access token"
            name="canvasToken"
            type="password"
            autoComplete="off"
            spellCheck={false}
            value={canvasToken}
            onChange={(event) => {
              setCanvasToken(event.target.value);
              setFieldErrors((current) => ({ ...current, token: undefined }));
            }}
            hint="In Canvas, open Account → Settings → New Access Token, then copy the token it shows."
            error={fieldErrors.token}
          />
          <Input
            label="Canvas address"
            name="baseUrl"
            type="url"
            inputMode="url"
            autoComplete="off"
            spellCheck={false}
            value={baseUrl}
            onChange={(event) => {
              setBaseUrl(event.target.value);
              setFieldErrors((current) => ({ ...current, baseUrl: undefined }));
            }}
            error={fieldErrors.baseUrl}
          />
          <div className={styles.actions}>
            <Button type="submit" loading={busy === "connect"}>
              {busy === "connect" ? "Checking with Canvas…" : "Connect Canvas"}
            </Button>
            {replacing ? (
              <Button
                variant="ghost"
                onClick={() => {
                  setReplacing(false);
                  setCanvasToken("");
                  setFieldErrors({});
                }}
                disabled={busy !== null}
              >
                Cancel
              </Button>
            ) : null}
          </div>
        </form>
      ) : null}
    </section>
  );
}
