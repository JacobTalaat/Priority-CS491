"use client";

import { ErrorView } from "@/components/status-page/error-view";
import styles from "@/components/status-page/status-page.module.css";
import "./globals.css";

// Replaces the root layout when the layout itself fails, so it needs its own html and body.
export default function GlobalError({ error, retry }: { error: Error & { digest?: string }; retry: () => void }) {
  return (
    <html lang="en">
      <body>
        <title>Something went wrong · Priority</title>
        <main className={styles.standalone}>
          <ErrorView error={error} retry={retry} />
        </main>
      </body>
    </html>
  );
}
