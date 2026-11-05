"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import type { FormEvent } from "react";
import { Button, Input, Notice } from "@/components/ui";
import {
  MIN_PASSWORD_LENGTH,
  RESET_LINK_EXPIRED,
  abandonRecovery,
  applyNewPassword,
  currentToken,
  onRecovery,
  validateNewPassword,
} from "@/lib/auth-client";
import type { NewPasswordErrors, NewPasswordValues } from "@/lib/auth-client";
import { setToken } from "@/lib/session";
import styles from "../auth.module.css";

type Status = "checking" | "form" | "expired";

// Shown instead of the form once the password is saved but something still
// needs the student's attention.
const OTHER_DEVICES_NOTE =
  "Your password was changed. We couldn't sign out your other devices — log out there if you can.";

type Done = { note: string; linkHref: string; linkText: string };

// Supabase answers a reset link in the URL fragment: a working one carries
// `type=recovery` plus an `access_token` and turns into a recovery session; an
// expired or already used link instead returns `#error=...&error_code=otp_expired`,
// and no session ever arrives.
export function ResetPasswordForm() {
  const router = useRouter();
  const [status, setStatus] = useState<Status>("checking");
  const [done, setDone] = useState<Done | null>(null);
  const [values, setValues] = useState<NewPasswordValues>({ password: "", confirm: "" });
  const [fieldErrors, setFieldErrors] = useState<NewPasswordErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  // React runs effects twice on the development server (StrictMode), and
  // supabase-js clears a good link's fragment from the URL after reading it —
  // so the fragment is read exactly once per page load and the decision is
  // kept here for every later effect run.
  const check = useRef<Promise<Status> | null>(null);
  // A recovery session this browser may still be holding, to be abandoned if
  // the student leaves without saving.
  const recoveryRef = useRef(false);
  const savedRef = useRef(false);

  useEffect(() => {
    // The rejected-fragment read is synchronous and can re-run: such a link was
    // never processed by supabase-js, so the URL stays intact and re-reading
    // it changes nothing. The good-link read below is the one that must be
    // memoized, because supabase-js clears a good link's fragment after the
    // client first reads it.
    const fragment = new URLSearchParams(window.location.hash.slice(1));
    const rejected =
      fragment.get("error") || fragment.get("error_code") || fragment.get("error_description");

    check.current ??= (async (): Promise<Status> => {
      if (rejected) {
        return "expired";
      }
      // A recovery link is the only thing that opens the form. Any other visit
      // — including a signed-in browser that simply typed the address — shows
      // the expired message instead, because a password without the old one
      // must not be possible without the emailed link.
      if (fragment.get("type") !== "recovery" || !fragment.get("access_token")) {
        return "expired";
      }
      const token = await currentToken();
      return token ? "form" : "expired";
    })();

    if (rejected) {
      // No client touch for a rejected link: no session will come from it.
      check.current.then((next) => {
        setStatus((current) => (current === "checking" ? next : current));
      });
      return;
    }

    let cancelled = false;
    function settle(next: Status) {
      if (!cancelled) {
        setStatus((current) => (current === "checking" ? next : current));
      }
    }

    const stopRecovery = onRecovery(() => {
      // A real PASSWORD_RECOVERY event is the strongest proof: the recovery
      // link just handed this browser a session, whatever the opening check
      // concluded earlier.
      recoveryRef.current = true;
      if (!cancelled) {
        setStatus("form");
      }
    });
    check.current.then(
      (next) => {
        if (next === "form") {
          recoveryRef.current = true;
        }
        settle(next);
      },
      () => {
        // A token read that never answered: treat as expired, never crash.
        settle("expired");
      }
    );
    return () => {
      cancelled = true;
      stopRecovery();
    };
  }, []);

  useEffect(() => {
    let done = false;
    function abandon() {
      if (done || savedRef.current || !recoveryRef.current) {
        return;
      }
      done = true;
      void abandonRecovery();
    }
    // Every departure path: the tab closes, navigates, reloads, or React
    // unmounts the form. Only a saved password keeps the session alive.
    window.addEventListener("pagehide", abandon);
    return () => {
      window.removeEventListener("pagehide", abandon);
      abandon();
    };
  }, []);

  function update(field: keyof NewPasswordValues, value: string) {
    setValues((current) => ({ ...current, [field]: value }));
    setFieldErrors((current) => ({ ...current, [field]: undefined }));
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setFormError(null);

    const errors = validateNewPassword(values);
    if (Object.keys(errors).length > 0) {
      setFieldErrors(errors);
      return;
    }

    setSubmitting(true);
    try {
      const result = await applyNewPassword(values.password);
      if (result.status === "failed") {
        setFieldErrors(result.fieldErrors);
        setFormError(result.formError ?? null);
        setValues((current) => ({ ...current, password: "" }));
        return;
      }
      savedRef.current = true;
      if (result.token) {
        setToken(result.token);
      }
      if (result.token && result.otherSessionsEnded) {
        router.replace("/classes");
        return;
      }
      if (result.token) {
        setDone({
          note: OTHER_DEVICES_NOTE,
          linkHref: "/classes",
          linkText: "Go to my classes",
        });
        return;
      }
      // Not signed in on this browser after all: the login page carries the
      // message via its fixed ?reset=done flag.
      router.replace("/login?reset=done");
    } finally {
      setSubmitting(false);
    }
  }

  if (status === "checking") {
    return null;
  }

  if (status === "expired") {
    return (
      <>
        <div className={styles.heading}>
          <p className="eyebrow">Locked out?</p>
          <h1 className={styles.title}>Reset password</h1>
          <p className={styles.subtitle}>Ask for a fresh link to try again.</p>
        </div>
        <Notice tone="error">{RESET_LINK_EXPIRED}</Notice>
        <p className={styles.switch}>
          <Link href="/forgot-password">Ask for a new link</Link> or{" "}
          <Link href="/login">back to log in</Link>
        </p>
      </>
    );
  }

  return (
    <>
      <div className={styles.heading}>
        <p className="eyebrow">Access again</p>
        <h1 className={styles.title}>Choose a new password</h1>
        <p className={styles.subtitle}>You will be signed in with it right away.</p>
      </div>
      {done ? (
        <>
          <Notice tone="success">{done.note}</Notice>
          <p className={styles.switch}>
            <Link href={done.linkHref}>{done.linkText}</Link>
          </p>
        </>
      ) : (
        <>
          <form className={styles.form} onSubmit={handleSubmit} noValidate>
            {formError ? <Notice tone="error">{formError}</Notice> : null}
            <Input
              label="New password"
              name="password"
              type="password"
              autoComplete="new-password"
              value={values.password}
              onChange={(event) => update("password", event.target.value)}
              hint={`At least ${MIN_PASSWORD_LENGTH} characters.`}
              error={fieldErrors.password}
            />
            <Input
              label="Confirm new password"
              name="confirm"
              type="password"
              autoComplete="new-password"
              value={values.confirm}
              onChange={(event) => update("confirm", event.target.value)}
              error={fieldErrors.confirm}
            />
            <Button type="submit" fullWidth loading={submitting}>
              {submitting ? "Saving…" : "Save new password"}
            </Button>
          </form>
          <p className={styles.switch}>
            <Link href="/login">Back to log in</Link>
          </p>
        </>
      )}
    </>
  );
}
