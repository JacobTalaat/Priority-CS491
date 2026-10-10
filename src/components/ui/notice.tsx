import type { ReactNode } from "react";
import styles from "./notice.module.css";

type NoticeProps = {
  tone: "error" | "success";
  children: ReactNode;
};

// Errors are announced right away; success messages wait for the screen reader to finish.
export function Notice({ tone, children }: NoticeProps) {
  return (
    <p className={`${styles.notice} ${styles[tone]}`} role={tone === "error" ? "alert" : "status"}>
      {children}
    </p>
  );
}
