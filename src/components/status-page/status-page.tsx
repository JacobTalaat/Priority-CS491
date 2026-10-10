import type { ReactNode } from "react";
import styles from "./status-page.module.css";

type StatusPageProps = {
  code: string;
  title: string;
  description: ReactNode;
  actions: ReactNode;
  footnote?: ReactNode;
};

// Shared body for the not found and error pages so they look the same everywhere.
export function StatusPage({ code, title, description, actions, footnote }: StatusPageProps) {
  return (
    <section className={styles.page} aria-labelledby="status-title">
      <p className="eyebrow">{code}</p>
      <h1 id="status-title" className={styles.title}>
        {title}
      </h1>
      <p className={styles.description}>{description}</p>
      <div className={styles.actions}>{actions}</div>
      {footnote ? <p className={styles.footnote}>{footnote}</p> : null}
    </section>
  );
}
