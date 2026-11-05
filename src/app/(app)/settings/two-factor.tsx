"use client";

import { useEffect, useState } from "react";
import Image from "next/image";
import type { FormEvent } from "react";
import { Button, Input, Notice } from "@/components/ui";
import {
  disableTwoFactor,
  enableTwoFactor,
  enrollAuthenticator,
  twoFactorStatus,
  unenrollPendingFactor,
  verifyAuthenticatorCode,
} from "@/lib/two-factor-client";
import type { TotpEnrollment, TwoFactorStatus } from "@/lib/two-factor-client";
import styles from "./settings.module.css";

type Message = { tone: "success" | "error"; text: string } | null;
type Busy = "turn-on" | "verify-setup" | "turn-off" | null;

const WRONG_CODE = "That code is not right. Try again.";

export function TwoFactor() {
  const [status, setStatus] = useState<TwoFactorStatus | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [message, setMessage] = useState<Message>(null);
  const [busy, setBusy] = useState<Busy>(null);
  // Half-finished enrollment: the QR code and secret the app is waiting for.
  const [enrollment, setEnrollment] = useState<TotpEnrollment | null>(null);
  // The code entry for the setup verification, or for the turn-off step.
  const [code, setCode] = useState("");
  const [codeError, setCodeError] = useState<string | null>(null);
  // The codes are shown exactly once, banned from the page after "I saved
  // these" — they are never readable again anywhere.
  const [shownCodes, setShownCodes] = useState<string[] | null>(null);
  const [turningOff, setTurningOff] = useState(false);

  useEffect(() => {
    let cancelled = false;
    twoFactorStatus().then((result) => {
      if (cancelled) {
        return;
      }
      if (result.ok) {
        setStatus(result.data);
      } else {
        setLoadError(result.error);
      }
    });
    return () => {
      cancelled = true;
    };
  }, []);

  function resetSetup() {
    setEnrollment(null);
    setCode("");
    setCodeError(null);
  }

  async function handleTurnOn() {
    setMessage(null);
    setBusy("turn-on");
    const enrollment = await enrollAuthenticator();
    setBusy(null);
    if (!enrollment) {
      setMessage({ tone: "error", text: "Could not start the setup. Try again." });
      return;
    }
    setEnrollment(enrollment);
  }

  async function handleCancelSetup() {
    setMessage(null);
    if (enrollment) {
      // Nothing was saved yet, so leaving the factor behind unverified is the
      // only cleanup: the student's two factor state is untouched either way.
      await unenrollPendingFactor(enrollment.factorId);
    }
    resetSetup();
    setMessage({ tone: "success", text: "Setup cancelled. Nothing was turned on." });
  }

  async function handleVerifySetup(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setMessage(null);
    const digits = code.trim();
    if (!/^\d{6}$/.test(digits)) {
      setCodeError("Enter the six digit code from your authenticator app.");
      return;
    }
    if (!enrollment) {
      return;
    }
    setBusy("verify-setup");
    const check = await verifyAuthenticatorCode(enrollment.factorId, digits);
    if (!check.ok) {
      setBusy(null);
      setCodeError(WRONG_CODE);
      return;
    }
    // The check just moved this session to aal2; the setup finishes with the
    // token it handed back.
    const result = await enableTwoFactor(check.token);
    setBusy(null);
    if (!result.ok) {
      setCodeError(result.error);
      return;
    }
    // The codes are kept in the page state only. The moment the student
    // leaves this view they are gone from everywhere but their paper.
    setShownCodes(result.data.recoveryCodes);
    // Enable succeeded, so the badge can turn on right away; the status read
    // after "I saved these" agrees with the count of codes just handed out.
    setStatus({ enabled: true, recoveryCodesLeft: result.data.recoveryCodes.length });
    resetSetup();
  }

  async function handleTurnOffStart() {
    setMessage(null);
    setTurningOff(true);
    setCode("");
    setCodeError(null);
  }

  async function handleTurnOff(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setMessage(null);
    const digits = code.trim();
    if (!/^\d{6}$/.test(digits)) {
      setCodeError("Enter the six digit code from your authenticator app.");
      return;
    }
    // The route checks the code against Supabase server-side, acting as the
    // student, so a wrong code never clears anything here.
    setBusy("turn-off");
    const result = await disableTwoFactor(digits);
    setBusy(null);
    if (!result.ok) {
      if (result.status === 400) {
        setCodeError(result.error);
        return;
      }
      setMessage({ tone: "error", text: result.error });
      return;
    }
    setTurningOff(false);
    setStatus({ enabled: false, recoveryCodesLeft: 0 });
    setMessage({ tone: "success", text: "Two factor sign in is off." });
  }

  async function handleCopy() {
    setMessage(null);
    try {
      await navigator.clipboard.writeText((shownCodes ?? []).join("\n"));
      setMessage({ tone: "success", text: "Copied. Save them somewhere safe before closing this page." });
    } catch {
      setMessage({ tone: "error", text: "Copying failed. Write the codes down instead." });
    }
  }

  async function handleSavedCodes() {
    setShownCodes(null);
    await refreshStatus();
  }

  async function refreshStatus() {
    twoFactorStatus().then((result) => {
      if (result.ok) {
        setStatus(result.data);
      }
    });
  }

  const enabled = status?.enabled ?? false;

  function codeForm(onSubmit: (event: FormEvent<HTMLFormElement>) => void, submitLabel: string) {
    return (
      <form className={styles.form} onSubmit={onSubmit} noValidate>
        <Input
          label="Authenticator code"
          name="authenticator-code"
          type="text"
          inputMode="numeric"
          autoComplete="one-time-code"
          value={code}
          onChange={(event) => {
            setCode(event.target.value);
            setCodeError(null);
          }}
          error={codeError}
        />
        <div className={styles.actions}>
          <Button type="submit" loading={busy !== null}>
            {submitLabel}
          </Button>
        </div>
      </form>
    );
  }

  return (
    <section className={styles.section} aria-labelledby="two-factor-heading">
      <div className={styles.sectionHeader}>
        <h2 id="two-factor-heading" className={styles.sectionTitle}>
          Two factor sign in
        </h2>
        {status ? (
          <span className={enabled ? `${styles.badge} ${styles.badgeOn}` : styles.badge}>
            {enabled ? "On" : "Off"}
          </span>
        ) : null}
      </div>
      <p className={styles.sectionNote}>
        Ask for a code from your authenticator app every time you log in, so a password alone is never
        enough. You can turn it off here anytime.
      </p>

      {message ? <Notice tone={message.tone}>{message.text}</Notice> : null}
      {loadError ? <Notice tone="error">{loadError}</Notice> : null}
      {status === null && !loadError ? (
        <p className={styles.loading} role="status">
          Checking two factor status…
        </p>
      ) : null}

      {shownCodes ? (
        <>
          <p className={styles.sectionNote}>
            These are your recovery codes. Each one works a single time, and they are the only way to
            sign in if you lose your authenticator app. Store them now — they are never shown again.
          </p>
          <ul className={styles.codes}>
            {shownCodes.map((recoveryCode) => (
              <li key={recoveryCode}>{recoveryCode}</li>
            ))}
          </ul>
          <div className={styles.actions}>
            <Button variant="secondary" onClick={handleCopy}>
              Copy
            </Button>
            <Button onClick={handleSavedCodes}>I saved these</Button>
          </div>
        </>
      ) : enrollment ? (
        <>
          <Image
            src={enrollment.qrCode}
            alt="Two factor QR code. Scan it with your authenticator app."
            width={180}
            height={180}
            unoptimized
            className={styles.qr}
          />
          <p className={styles.sectionNote}>
            Scan this QR code with your authenticator app, or enter the secret by hand: {enrollment.secret}
          </p>
          {codeForm(handleVerifySetup, "Verify and turn on")}
          <div className={styles.actions}>
            <Button
              variant="ghost"
              onClick={handleCancelSetup}
              loading={busy === "verify-setup"}
              disabled={busy !== null}
            >
              Cancel
            </Button>
          </div>
        </>
      ) : turningOff && enabled ? (
        <>
          <p className={styles.sectionNote}>
            Turning two factor off asks for a current code, so nobody walking past can do it.
          </p>
          {codeForm(handleTurnOff, "Verify and turn off")}
          <div className={styles.actions}>
            <Button
              variant="ghost"
              onClick={() => {
                setTurningOff(false);
                setCode("");
                setCodeError(null);
              }}
              loading={busy === "turn-off"}
              disabled={busy !== null}
            >
              Keep two factor on
            </Button>
          </div>
        </>
      ) : enabled ? (
        <>
          <dl className={styles.details}>
            <div>
              <dt>Recovery codes left</dt>
              <dd>{status?.recoveryCodesLeft ?? 0}</dd>
            </div>
          </dl>
          <div className={styles.actions}>
            <Button variant="ghost" onClick={handleTurnOffStart} disabled={busy !== null}>
              Turn off
            </Button>
          </div>
        </>
      ) : status ? (
        <div className={styles.actions}>
          <Button onClick={handleTurnOn} loading={busy === "turn-on"} disabled={busy !== null}>
            Turn two factor on
          </Button>
        </div>
      ) : null}
    </section>
  );
}
