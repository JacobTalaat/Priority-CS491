import Link from "next/link";
import type { ReactNode } from "react";
import styles from "./auth.module.css";

export default function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <div className={styles.shell}>
      <Link className={styles.wordmark} href="/" aria-label="Priority home">
        <span className={styles.mark} aria-hidden="true">
          P.
        </span>
        <span>PRIORITY</span>
      </Link>
      <main className={styles.panel}>{children}</main>
    </div>
  );
}
