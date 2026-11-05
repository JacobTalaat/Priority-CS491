import type { Metadata } from "next";
import styles from "../auth.module.css";
import { ForgotPasswordForm } from "./forgot-password-form";

export const metadata: Metadata = { title: "Forgot password" };

export default function ForgotPasswordPage() {
  return (
    <>
      <div className={styles.heading}>
        <p className="eyebrow">Locked out?</p>
        <h1 className={styles.title}>Forgot password</h1>
        <p className={styles.subtitle}>Enter your email and we&apos;ll send you a link to choose a new password.</p>
      </div>
      <ForgotPasswordForm />
    </>
  );
}
