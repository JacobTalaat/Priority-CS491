"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import type { ChangeEvent } from "react";
import { ButtonLink, Input, Notice } from "@/components/ui";
import { readConfirmationResult } from "@/lib/auth-client";
import type { ConfirmationOutcome } from "@/lib/auth-client";
import { setToken } from "@/lib/session";
import styles from "../../auth.module.css";
import { ResendConfirmation } from "../../resend-confirmation";

// Split out so each outcome can be rendered directly in tests; the trickier
// decision (an error fragment, a session token, or neither) happens in
// readConfirmationResult.
export function ConfirmScreen({
  outcome,
  typedEmail,
  onTypedEmail,
}: {
  outcome: Exclude<ConfirmationOutcome, "checking">;
  typedEmail: string;
  onTypedEmail: (event: ChangeEvent<HTMLInputElement>) => void;
}) {
  if (outcome.status === "confirmed") {
    return (
      <p className="eyebrow" role="status">
        Signed in! Taking you to your classes…
      </p>
    );
  }

  if (outcome.status === "invalid") {
    return (
      <>
        <div className={styles.heading}>
          <p className="eyebrow">Almost there</p>
          <h1 className={styles.title}>Confirm your email</h1>
          <p className={styles.subtitle}>This link is not valid.</p>
        </div>
        <div className={styles.form}>
          <ButtonLink href="/login" fullWidth>
            Log in
          </ButtonLink>
        </div>
      </>
    );
  }

  return (
    <>
      <div className={styles.heading}>
        <p className="eyebrow">Almost there</p>
        <h1 className={styles.title}>Confirm your email</h1>
        <Notice tone="error">This confirmation link has expired or was already used.</Notice>
        <p className={styles.subtitle}>
          Type the email you signed up with and we&apos;ll send a fresh link.
        </p>
      </div>
      <div className={styles.form}>
        <Input
          label="Email"
          name="email"
          type="email"
          autoComplete="email"
          inputMode="email"
          value={typedEmail}
          onChange={onTypedEmail}
        />
        <ResendConfirmation email={typedEmail.trim() || null} label="Send a new link" />
      </div>
    </>
  );
}

// The work the confirm page does once it has judged the visit: only a link
// that brought an access token stores a token and moves on. Exported so the
// flow — including the setToken side effect — can be driven in tests without a
// DOM. Trust the outcome answer: it classifies by URL fragment before it ever
// looks at a stored session.
export async function finishConfirmation(navigate: (path: string) => void): Promise<ConfirmationOutcome> {
  const result = await readConfirmationResult();
  if (result.status === "confirmed") {
    setToken(result.token);
    navigate("/classes");
  }
  return result;
}

export function ConfirmForm() {
  const router = useRouter();
  const [outcome, setOutcome] = useState<ConfirmationOutcome | "checking">("checking");
  const [typedEmail, setTypedEmail] = useState("");

  // One check per page load. Effects can run twice (React's development mode does), and
  // by the second run the client may already have cleared a good link's fragment, which
  // would then read as a stray visit; the second run waits on the first check instead.
  const check = useRef<Promise<ConfirmationOutcome> | null>(null);

  useEffect(() => {
    let cancelled = false;
    check.current ??= finishConfirmation((path) => router.replace(path));
    check.current.then((result) => {
      if (!cancelled) {
        setOutcome(result);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [router]);

  if (outcome === "checking") {
    return (
      <p className="eyebrow" role="status">
        Checking your link…
      </p>
    );
  }

  return (
    <ConfirmScreen
      outcome={outcome}
      typedEmail={typedEmail}
      onTypedEmail={(event) => setTypedEmail(event.target.value)}
    />
  );
}
