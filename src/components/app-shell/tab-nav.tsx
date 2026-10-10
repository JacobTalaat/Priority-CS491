"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { TABS, isTabActive } from "@/lib/tabs";
import styles from "./app-shell.module.css";

export function TabNav() {
  const pathname = usePathname();

  return (
    <nav className={styles.tabs} aria-label="Main">
      <ul className={styles.tabList}>
        {TABS.map((tab) => {
          const active = isTabActive(pathname, tab.href);
          return (
            <li key={tab.href} className={styles.tabItem}>
              <Link
                href={tab.href}
                className={active ? `${styles.tab} ${styles.tabActive}` : styles.tab}
                aria-current={active ? "page" : undefined}
              >
                {tab.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
