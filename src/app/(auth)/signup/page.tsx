import type { Metadata } from "next";
import styles from "../auth.module.css";
import { SignUpForm } from "./sign-up-form";

export const metadata: Metadata = { title: "Sign up" };

export default function SignUpPage() {
  return (
    <>
      <div className={styles.heading}>
        <p className="eyebrow">Get started</p>
        <h1 className={styles.title}>Create your account</h1>
        <p className={styles.subtitle}>Connect Canvas next and see what&apos;s due across your classes.</p>
      </div>
      <SignUpForm />
    </>
  );
}
