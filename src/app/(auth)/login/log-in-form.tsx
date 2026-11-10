"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import type { FormEvent } from "react";
import { Button, Input, Notice } from "@/components/ui";
import { currentToken, logIn, validateLogIn } from "@/lib/auth-client";
import type { Credentials, FieldErrors } from "@/lib/auth-client";
import { PASSWORD_CHANGED } from "@/lib/auth-client";
import { pendingCodeStep, recoverTwoFactor, verifiedTotpFactorId, verifyAuthenticatorCode } from "@/lib/two-factor-client";
import { setToken } from "@/lib/session";
import styles from "../auth.module.css";
import { ResendConfirmation } from "../resend-confirmation";

type Stage = "credentials" | "authenticator" | "recovery";

const CODE_PATTERN = /^\d{6}$/;

const WRONG_CODE = "That code is not right. Try again.";

export function LogInForm({ next, resetDone = false }: { next: string; resetDone?: boolean }) {
  const router = useRouter();
  const [values, setValues] = useState<Credentials>({ email: "", password: "" });
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  // Set when the account is confirmed not yet: the error message says so and
  // a resend button goes with it.
  const [emailSentTo, setEmailSentTo] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  // The two factor steps take over the same form once the password side has
  // succeeded: "authenticator" asks for the code, "recovery" for one of the
  // single-use codes from setup. The token in play stays inside supabase-js
  // until one of the three ways completes.
  const [stage, setStage] = useState<Stage>("credentials");
  const [code, setCode] = useState("");
  const [codeError, setCodeError] = useState<string | null>(null);

  function update(field: keyof Credentials, value: string) {
    setValues((current) => ({ ...current, [field]: value }));
    setFieldErrors((current) => ({ ...current, [field]: undefined }));
  }

  function completeLogIn(token: string) {
    setToken(token);
    router.replace(next);
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setFormError(null);
    setEmailSentTo(null);

    const errors = validateLogIn(values);
    if (Object.keys(errors).length > 0) {
      setFieldErrors(errors);
      return;
    }

    setSubmitting(true);
    const result = await logIn(values);
    if (!result.ok) {
      setFieldErrors(result.fieldErrors);
      setFormError(result.formError ?? null);
      setEmailSentTo(result.emailSentTo ?? null);
      setValues((current) => ({ ...current, password: "" }));
      setSubmitting(false);
      return;
    }
    // The password was accepted, but that is only proven to be enough for a
    // student without a factor: their token is already aal2. For everyone
    // else Supabase answers that an aal2 step comes next, and the form asks
    // for the code instead of finishing.
    const pending = await pendingCodeStep();
    if (pending.step === "code") {
      setCode("");
      setCodeError(null);
      setStage("authenticator");
      setSubmitting(false);
      return;
    }
    completeLogIn(result.token);
  }

  async function handleAuthenticatorSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setCodeError(null);
    const digits = code.trim();
    if (!CODE_PATTERN.test(digits)) {
      setCodeError("Enter the six digit code from your authenticator app.");
      return;
    }
    setSubmitting(true);
    const factorId = await verifiedTotpFactorId();
    if (!factorId) {
      setCodeError(WRONG_CODE);
      setSubmitting(false);
      return;
    }
    const check = await verifyAuthenticatorCode(factorId, digits);
    setSubmitting(false);
    if (!check.ok) {
      setCodeError(WRONG_CODE);
      return;
    }
    // The verification moved the session to aal2 and supabase-js stored it;
    // this token is the one that reaches the app's own routes.
    completeLogIn(check.token);
  }

  async function handleRecoverySubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setCodeError(null);
    const value = code.trim();
    if (!value) {
      setCodeError("Enter a recovery code.");
      return;
    }
    setSubmitting(true);
    // The recovery route is the one place a password token is accepted
    // without the second factor: the code is the proof there.
    const result = await recoverTwoFactor(value, await currentToken());
    if (!result.ok) {
      setCodeError(result.error);
      setSubmitting(false);
      return;
    }
    // Two factor is now off, so the still password-only token opens the app.
    const token = await currentToken();
    setSubmitting(false);
    if (!token) {
      setCodeError("Two factor is off, but the log in could not be finished. Log in again.");
      return;
    }
    completeLogIn(token);
  }

  function switchStage(to: Stage) {
    setCode("");
    setCodeError(null);
    setStage(to);
  }

  if (stage !== "credentials") {
    const authenticator = stage === "authenticator";
    return (
      <>
        <form
          className={styles.form}
          onSubmit={authenticator ? handleAuthenticatorSubmit : handleRecoverySubmit}
          noValidate
        >
          {authenticator ? (
            <Input
              label="Authenticator code"
              name="authenticator-code"
              type="text"
              inputMode="numeric"
              autoComplete="one-time-code"
              value={code}
              onChange={(event) => setCode(event.target.value)}
              error={codeError}
              hint="Open the authenticator app and enter the six digit code."
            />
          ) : (
            <Input
              label="Recovery code"
              name="recovery-code"
              type="text"
              value={code}
              onChange={(event) => setCode(event.target.value)}
              error={codeError}
              hint="Enter one of the recovery codes you were shown when you turned two factor on."
            />
          )}
          <Button type="submit" fullWidth loading={submitting}>
          {submitting ? "Checking the code…" : authenticator ? "Verify and continue" : "Continue"}
        </Button>
        </form>
        <p className={styles.switch}>
          {authenticator ? (
            <button type="button" onClick={() => switchStage("recovery")}>
              Use a recovery code instead
            </button>
          ) : (
            <button type="button" onClick={() => switchStage("authenticator")}>
              Use a code from your authenticator app instead
            </button>
          )}
        </p>
      </>
    );
  }

  return (
    <>
      <form className={styles.form} onSubmit={handleSubmit} noValidate>
        {resetDone ? <Notice tone="success">{PASSWORD_CHANGED}</Notice> : null}
        {formError ? <Notice tone="error">{formError}</Notice> : null}
        {emailSentTo ? (
          <ResendConfirmation email={values.email.trim()} label="Send it again" />
        ) : null}
        <Input
          label="Email"
          name="email"
          type="email"
          autoComplete="email"
          inputMode="email"
          value={values.email}
          onChange={(event) => update("email", event.target.value)}
          error={fieldErrors.email}
        />
        <Input
          label="Password"
          name="password"
          type="password"
          autoComplete="current-password"
          value={values.password}
          onChange={(event) => update("password", event.target.value)}
          error={fieldErrors.password}
        />
        <Button type="submit" fullWidth loading={submitting}>
          {submitting ? "Logging in…" : "Log in"}
        </Button>
      </form>
      <p className={styles.switch}>
        <Link href="/forgot-password">Forgot your password?</Link>
      </p>
      <p className={styles.switch}>
        New to Priority? <Link href="/signup">Create an account</Link>
      </p>
    </>
  );
}
