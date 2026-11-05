"use client";

import Link from "next/link";
import { useState } from "react";
import type { FormEvent } from "react";
import { Button, Input, Notice } from "@/components/ui";
import { RESET_COULD_NOT_SEND, RESET_LINK_SENT, sendPasswordResetEmail, validateResetRequest } from "@/lib/auth-client";
import type { FieldErrors } from "@/lib/auth-client";
import styles from "../auth.module.css";

export function ForgotPasswordForm() {
  const [email, setEmail] = useState("");
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [sent, setSent] = useState(false);
  const [unreachable, setUnreachable] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const errors = validateResetRequest({ email });
    if (Object.keys(errors).length > 0) {
      setFieldErrors(errors);
      return;
    }

    setSubmitting(true);
    // The answer is only read for the one case that proves nothing about
    // accounts: no HTTP exchange at all. Unknown addresses, rate limits, and
    // any other API error get the same message as a success, so this form
    // cannot be used to find out who is registered.
    const status = await sendPasswordResetEmail(email);
    setUnreachable(status === "unreachable");
    setSubmitting(false);
    setSent(true);
  }

  if (sent) {
    return (
      <>
        <Notice tone={unreachable ? "error" : "success"}>
          {unreachable ? RESET_COULD_NOT_SEND : RESET_LINK_SENT}
        </Notice>
        <p className={styles.switch}>
          <Link href="/forgot-password">Try a different address</Link> or{" "}
          <Link href="/login">back to log in</Link>
        </p>
      </>
    );
  }

  return (
    <>
      <form className={styles.form} onSubmit={handleSubmit} noValidate>
        <Input
          label="Email"
          name="email"
          type="email"
          autoComplete="email"
          inputMode="email"
          value={email}
          onChange={(event) => {
            setEmail(event.target.value);
            setFieldErrors({});
          }}
          error={fieldErrors.email}
        />
        <Button type="submit" fullWidth loading={submitting}>
          {submitting ? "Sending link…" : "Send reset link"}
        </Button>
      </form>
      <p className={styles.switch}>
        Remembered it? <Link href="/login">Back to log in</Link>
      </p>
    </>
  );
}
