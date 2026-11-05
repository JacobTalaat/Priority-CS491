import type { Metadata } from "next";
import { safeNextPath } from "@/lib/redirect";
import styles from "../auth.module.css";
import { LogInForm } from "./log-in-form";

export const metadata: Metadata = { title: "Log in" };

export default async function LogInPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const params = await searchParams;
  const next = safeNextPath(params.next);
  // A fixed flag on the URL maps onto a fixed message; nothing personal is
  // carried from the password reset back here.
  const resetDone = params.reset === "done";

  return (
    <>
      <div className={styles.heading}>
        <p className="eyebrow">Welcome back</p>
        <h1 className={styles.title}>Log in</h1>
        <p className={styles.subtitle}>Pick up where you left off.</p>
      </div>
      <LogInForm next={next} resetDone={resetDone} />
    </>
  );
}
