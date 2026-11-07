"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { FormEvent } from "react";
import { Button, ButtonLink, Input, Notice, PageHeader } from "@/components/ui";
import { getToday } from "@/lib/today-client";
import type { TodayItem, TodayResponse } from "@/lib/today-client";
import { isValidTodayHours, readTodayHours, saveTodayHours } from "@/lib/today-hours";
import { boundaryTag, dueLabel, shareLabel } from "@/lib/today-list";
import styles from "./today.module.css";

type LoadState =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ready"; data: TodayResponse };

async function loadToday(hours: number | null): Promise<LoadState> {
  const result = await getToday(hours);
  return result.ok ? { status: "ready", data: result.data } : { status: "error", message: result.error };
}

export function TodayList() {
  const [state, setState] = useState<LoadState>({ status: "loading" });
  const [hoursValue, setHoursValue] = useState("");
  const [hoursError, setHoursError] = useState<string | null>(null);
  const [hoursMessage, setHoursMessage] = useState<string | null>(null);
  const [storageError, setStorageError] = useState<string | null>(null);
  const requestId = useRef(0);
  const lastRequestedHours = useRef<number | null>(null);

  const reload = useCallback(async (hours: number | null) => {
    const currentRequest = ++requestId.current;
    lastRequestedHours.current = hours;
    setState({ status: "loading" });
    const next = await loadToday(hours);
    if (currentRequest === requestId.current) {
      setState(next);
    }
  }, []);

  useEffect(() => {
    const saved = readTodayHours();
    let cancelled = false;
    void Promise.resolve().then(() => {
      if (cancelled) {
        return;
      }
      if (saved.ok) {
        setHoursValue(saved.hours === null ? "" : String(saved.hours));
        setHoursMessage(saved.hours === null ? null : "Saved for this evening.");
        void reload(saved.hours);
      } else {
        setStorageError("Could not read your saved hours. You can still set a budget for tonight.");
        void reload(null);
      }
    });
    return () => {
      cancelled = true;
      requestId.current += 1;
    };
  }, [reload]);

  function applyHours(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const value = hoursValue.trim();
    const hours = value === "" ? null : Number(value);
    if (hours !== null && !isValidTodayHours(hours)) {
      setHoursError("Enter a number from 0.5 to 12 hours.");
      setHoursMessage(null);
      return;
    }

    setHoursError(null);
    const saved = saveTodayHours(hours);
    setStorageError(
      saved ? null : "Could not save your hours for this evening. The list will still use this budget.",
    );
    setHoursMessage(saved && hours !== null ? "Saved for this evening." : null);
    void reload(hours);
  }

  return (
    <>
      <PageHeader eyebrow="Do this first" title="Today" description="Your open work, most important first." />
      <form className={styles.hoursForm} onSubmit={applyHours}>
        <Input
          label="Hours available tonight"
          hint="Enter 0.5 to 12 hours. Leave blank to show all work."
          error={hoursError}
          type="number"
          min="0.5"
          max="12"
          step="any"
          value={hoursValue}
          onChange={(event) => {
            setHoursValue(event.target.value);
            setHoursError(null);
          }}
        />
        <Button type="submit" loading={state.status === "loading"}>
          Show what fits
        </Button>
      </form>
      {hoursMessage ? <p className={styles.hoursMessage} role="status">{hoursMessage}</p> : null}
      {storageError ? <Notice tone="warning">{storageError}</Notice> : null}
      {state.status === "loading" ? (
        <p className={styles.status} role="status">
          Loading your list…
        </p>
      ) : null}
      {state.status === "error" ? (
        <div className={styles.errorState}>
          <Notice tone="error">{state.message}</Notice>
          <Button variant="secondary" onClick={() => reload(lastRequestedHours.current)}>
            Try again
          </Button>
        </div>
      ) : null}
      {state.status === "ready" ? (
        <>
          {state.data.hoursFilter ? (
            <p className={styles.planSummary} role="status">
              Showing work that fits in {state.data.hoursFilter.hours} hours tonight
              {state.data.hoursFilter.skippedCount > 0
                ? `; ${state.data.hoursFilter.skippedCount} ${state.data.hoursFilter.skippedCount === 1 ? "item" : "items"} left off the list.`
                : "."}
            </p>
          ) : null}
          <TodayItems items={state.data.items} />
        </>
      ) : null}
    </>
  );
}

export function TodayItems({ items }: { items: TodayItem[] }) {
  if (items.length === 0) {
    return (
      <section className={styles.emptyState} aria-labelledby="today-empty-title">
        <span className={styles.emptyMark} aria-hidden="true">✓</span>
        <div className={styles.emptyMessage}>
          <h2 id="today-empty-title">You&apos;re all caught up!</h2>
          <p>There are no open items right now. Your Today list is ready when new work arrives.</p>
        </div>
        <ButtonLink href="/classes" variant="secondary">
          View classes
        </ButtonLink>
      </section>
    );
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
