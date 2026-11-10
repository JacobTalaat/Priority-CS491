"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import type { FormEvent } from "react";
import { Button, Input, Notice } from "@/components/ui";
import { deleteAccount } from "@/lib/account-client";
import { logOutLocally } from "@/lib/auth-client";
import { unsubscribeBeforeLogout } from "@/lib/push-client";
import { clearToken } from "@/lib/session";
import styles from "./settings.module.css";

const CONFIRM_TEXT = "DELETE";

// The local sign out makes a network call, so a stalled request must not hold
// the page: this is the longest the delete screen waits before moving on.
const LOCAL_SIGN_OUT_WAIT_MS = 3000;

// Deleting the account is permanent, so the form asks twice: the password is
// what proves it is really them and the typed text is the slow, deliberate
// gesture that stops a reflexive click from ending everything.
export function DeleteAccount() {
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [password, setPassword] = useState("");
  const [confirmText, setConfirmText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  function startConfirm() {
    setError(null);
    setConfirming(true);
  }

  function cancel() {
    setConfirming(false);
    setPassword("");
    setConfirmText("");
    setError(null);
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) {
      return;
    }
    setError(null);
    setBusy(true);
    const result = await deleteAccount(password);
    if (!result.ok) {
      setBusy(false);
      setError(result.error);
      setPassword("");
      return;
    }
    // The account is gone on the server from here on, so the only choices
    // left are to forget this browser's session and go home. The sign out
    // itself goes out at most LOCAL_SIGN_OUT_WAIT_MS before the page gives up
    // waiting: the local scope always removes the stored session eventually
    // even if the user cannot be reached, and the token clearing below is
    // what actually keeps this browser signed in otherwise.
    let signOutTimeout: ReturnType<typeof setTimeout> | undefined;
    try {
      await Promise.race([
        logOutLocally(),
        new Promise<void>((resolve) => {
          signOutTimeout = setTimeout(resolve, LOCAL_SIGN_OUT_WAIT_MS);
        }),
      ]);
    } catch {
      // A rejected local sign out only means something went wrong speaking to
      // Supabase; the token clearing below is the part under our control.
    }
    if (signOutTimeout !== undefined) {
      clearTimeout(signOutTimeout);
    }
    // The push rows are already gone on the server (they cascade with the
    // account), so its DELETE will 401 harmlessly; unsubscribing the browser
    // itself still needs to happen and must not block the redirect.
    try {
      unsubscribeBeforeLogout();
    } catch {
      // Never let push cleanup stop the sign out.
    }
    clearToken();
    router.replace("/");
  }

  return (
    <section className={styles.section} aria-labelledby="delete-account-heading">
      <div className={styles.sectionHeader}>
        <h2 id="delete-account-heading" className={styles.sectionTitle}>
          Delete account
        </h2>
      </div>
      <p className={styles.sectionNote}>
        Deleting your account permanently removes your classes, grades, Canvas connection and
        notification settings. It cannot be undone.
      </p>
      {error ? <Notice tone="error">{error}</Notice> : null}
      {confirming ? (
        <form className={styles.form} onSubmit={handleSubmit}>
          <Input
            label="Password"
            name="password"
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
          />
          <Input
            label="Type DELETE to confirm"
            name="confirmText"
            type="text"
            autoComplete="off"
            spellCheck={false}
            value={confirmText}
            onChange={(event) => setConfirmText(event.target.value)}
          />
          <div className={styles.actions}>
            <Button
              type="submit"
              loading={busy}
              disabled={busy || password.length === 0 || confirmText !== CONFIRM_TEXT}
            >
              Permanently delete account
            </Button>
            <Button type="button" variant="ghost" onClick={cancel} disabled={busy}>
              Cancel
            </Button>
          </div>
        </form>
      ) : (
        <div className={styles.actions}>
          <Button type="button" variant="secondary" onClick={startConfirm} disabled={busy}>
            Delete account
          </Button>
        </div>
      )}
    </section>
  );
}
