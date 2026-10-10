"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import type { FormEvent } from "react";
import { Button, Input, Notice } from "@/components/ui";
import { MIN_PASSWORD_LENGTH, signUp, validateSignUp } from "@/lib/auth-client";
import type { Credentials, FieldErrors } from "@/lib/auth-client";
import { setToken } from "@/lib/session";
import styles from "../auth.module.css";

export function SignUpForm() {
  const router = useRouter();
  const [values, setValues] = useState<Credentials>({ email: "", password: "" });
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  function update(field: keyof Credentials, value: string) {
    setValues((current) => ({ ...current, [field]: value }));
    setFieldErrors((current) => ({ ...current, [field]: undefined }));
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setFormError(null);

    const errors = validateSignUp(values);
    if (Object.keys(errors).length > 0) {
      setFieldErrors(errors);
      return;
    }

    setSubmitting(true);
    const result = await signUp(values);
    if (!result.ok) {
      setFieldErrors(result.fieldErrors);
      setFormError(result.formError ?? null);
      setSubmitting(false);
      return;
    }
    setToken(result.token);
    router.replace("/classes");
  }

  return (
    <>
      <form className={styles.form} onSubmit={handleSubmit} noValidate>
        {formError ? <Notice tone="error">{formError}</Notice> : null}
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
          autoComplete="new-password"
          value={values.password}
          onChange={(event) => update("password", event.target.value)}
          hint={`At least ${MIN_PASSWORD_LENGTH} characters.`}
          error={fieldErrors.password}
        />
        <Button type="submit" fullWidth loading={submitting}>
          {submitting ? "Creating account…" : "Create account"}
        </Button>
      </form>
      <p className={styles.switch}>
        Already have an account? <Link href="/login">Log in</Link>
      </p>
    </>
  );
}
