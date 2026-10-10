"use client";

import { ErrorView } from "@/components/status-page/error-view";
import styles from "@/components/status-page/status-page.module.css";

export default function RootError({ error, retry }: { error: Error & { digest?: string }; retry: () => void }) {
  return (
    <main className={styles.standalone}>
      <ErrorView error={error} retry={retry} />
    </main>
  );
}
