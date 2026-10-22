import Link from "next/link";
import styles from "../auth.module.css";
import { ResendConfirmation } from "../resend-confirmation";

// Shown after sign up while the account is held for confirmation: not an error
// notice, but the expected next step. Supabase deliberately answers a
// sessionless success for an address that already has a confirmed account (it
// sends no email then), so the copy hedges on whether the address is new
// instead of promising an email that may never come.
export function CheckEmailScreen({ sentTo }: { sentTo: string }) {
  return (
    <>
      <div className={styles.heading}>
        <p className="eyebrow">Almost there</p>
        <h1 className={styles.title}>Check your email</h1>
        <p className={styles.subtitle}>
          If this address is new to Priority, we sent a confirmation link to {sentTo}. Open it to
          finish creating your account.
        </p>
      </div>
      <div className={styles.form}>
        <ResendConfirmation email={sentTo} label="Send it again" />
      </div>
      <p className={styles.switch}>
        Already have an account? <Link href="/login">Log in</Link>
      </p>
    </>
  );
}
