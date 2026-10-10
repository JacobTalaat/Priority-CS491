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
  const next = safeNextPath((await searchParams).next);

  return (
    <>
      <div className={styles.heading}>
        <p className="eyebrow">Welcome back</p>
        <h1 className={styles.title}>Log in</h1>
        <p className={styles.subtitle}>Pick up where you left off.</p>
      </div>
      <LogInForm next={next} />
    </>
  );
}
