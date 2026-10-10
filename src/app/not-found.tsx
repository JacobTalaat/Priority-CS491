import type { Metadata } from "next";
import { StatusPage } from "@/components/status-page/status-page";
import styles from "@/components/status-page/status-page.module.css";
import { ButtonLink } from "@/components/ui";

export const metadata: Metadata = { title: "Page not found" };

export default function NotFound() {
  return (
    <main className={styles.standalone}>
      <StatusPage
        code="404"
        title="Page not found"
        description="This page doesn't exist or has moved. Check the link, or head back to your day."
        actions={<ButtonLink href="/today">Go to Today</ButtonLink>}
      />
    </main>
  );
}
