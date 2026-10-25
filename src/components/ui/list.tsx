import Link from "next/link";
import type { ReactNode } from "react";
import styles from "./list.module.css";

export function List({ label, children }: { label?: string; children: ReactNode }) {
  return (
    <ul className={styles.list} aria-label={label}>
      {children}
    </ul>
  );
}

type ListRowProps = {
  title: ReactNode;
  meta?: ReactNode;
  trailing?: ReactNode;
  below?: ReactNode;
  href?: string;
};

export function ListRow({ title, meta, trailing, below, href }: ListRowProps) {
  const content = (
    <>
      <span className={styles.text}>
        <span className={styles.title}>{title}</span>
        {meta ? <span className={styles.meta}>{meta}</span> : null}
      </span>
      {trailing ? <span className={styles.trailing}>{trailing}</span> : null}
    </>
  );

  return (
    <li className={styles.item}>
      {href ? (
        <>
          <Link className={`${styles.row} ${styles.link}`} href={href}>
            {content}
          </Link>
          {below ? <div className={styles.below}>{below}</div> : null}
        </>
      ) : (
        <>
          <div className={styles.row}>{content}</div>
          {below ? <div className={styles.below}>{below}</div> : null}
        </>
      )}
    </li>
  );
}
