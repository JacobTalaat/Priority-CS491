import Link from "next/link";
import type { ReactNode } from "react";
import { LogOutButton } from "./log-out-button";
import { TabNav } from "./tab-nav";
import styles from "./app-shell.module.css";

export function AppShell({ children }: { children: ReactNode }) {
  return (
    <div className={styles.shell}>
      <header className={styles.topbar}>
        <Link className={styles.wordmark} href="/today" aria-label="Priority home">
          <span className={styles.mark} aria-hidden="true">
            P.
          </span>
          <span>PRIORITY</span>
        </Link>
        <TabNav />
        <div className={styles.account}>
          <LogOutButton />
        </div>
      </header>
      <main className={styles.content}>{children}</main>
    </div>
  );
}
