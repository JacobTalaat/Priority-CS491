import Link from "next/link";
import type { ReactNode } from "react";
import { LogOutButton } from "./log-out-button";
import { TabNav } from "./tab-nav";
import styles from "./app-shell.module.css";

export function AppShell({ children }: { children: ReactNode }) {
  return (
    <div className={styles.shell}>
      <a className="skipLink" href="#main-content">Skip to main content</a>
      <header className={styles.topbar}>
        <Link className={styles.wordmark} href="/today" aria-label="Priority home">
          <span className={styles.mark} aria-hidden="true">
            P.
          </span>
          <span>PRIORITY</span>
        </Link>
        <div className={styles.account}>
          <LogOutButton />
        </div>
        <TabNav />
      </header>
      <main id="main-content" className={styles.content} tabIndex={-1}>{children}</main>
    </div>
  );
}
