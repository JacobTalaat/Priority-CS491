"use client";

import { useCallback, useEffect, useState } from "react";
import { Button, Notice, PageHeader } from "@/components/ui";
import { getToday } from "@/lib/today-client";
import type { TodayItem } from "@/lib/today-client";
import { boundaryTag, dueLabel, shareLabel } from "@/lib/today-list";
import styles from "./today.module.css";

type LoadState =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ready"; items: TodayItem[] };

async function loadToday(): Promise<LoadState> {
  const result = await getToday();
  return result.ok ? { status: "ready", items: result.data.items } : { status: "error", message: result.error };
}

export function TodayList() {
  const [state, setState] = useState<LoadState>({ status: "loading" });

  const reload = useCallback(async () => {
    setState({ status: "loading" });
    setState(await loadToday());
  }, []);

  useEffect(() => {
    let cancelled = false;
    loadToday().then((next) => {
      if (!cancelled) {
        setState(next);
      }
    });
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <>
      <PageHeader eyebrow="Do this first" title="Today" description="Your open work, most important first." />
      {state.status === "loading" ? (
        <p className={styles.status} role="status">
          Loading your list…
        </p>
      ) : null}
      {state.status === "error" ? (
        <div className={styles.errorState}>
          <Notice tone="error">{state.message}</Notice>
          <Button variant="secondary" onClick={reload}>
            Try again
          </Button>
        </div>
      ) : null}
      {state.status === "ready" ? <TodayItems items={state.items} /> : null}
    </>
  );
}

export function TodayItems({ items }: { items: TodayItem[] }) {
  if (items.length === 0) {
    return <p className={styles.status}>Nothing on your list right now.</p>;
  }
  return (
    <ol className={styles.list} aria-label="Today">
      {items.map((item) => {
        const share = shareLabel(item.share);
        const tag = boundaryTag(item.boundary);
        return (
          <li key={item.assignmentId} className={styles.item}>
            <span className={styles.rank} aria-hidden="true">
              {item.rank}
            </span>
            <div className={styles.body}>
              <p className={styles.title}>{item.title}</p>
              <p className={styles.meta}>
                <span>{item.courseName}</span>
                <span className={item.overdue ? styles.overdue : undefined}>{dueLabel(item.dueAt, item.overdue)}</span>
              </p>
              <p className={styles.reason}>{item.reason}</p>
              {tag ? (
                <span className={item.boundary?.direction === "at-risk" ? styles.atRisk : styles.withinReach}>{tag}</span>
              ) : null}
            </div>
            {share ? (
              <span className={styles.share}>
                <span className={styles.shareValue}>{share}</span>
                <span className={styles.shareLabel}>of grade</span>
              </span>
            ) : null}
          </li>
        );
      })}
    </ol>
  );
}
