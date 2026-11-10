"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { FormEvent } from "react";
import { Button, ButtonLink, Input, Notice, PageHeader } from "@/components/ui";
import { getToday, markDone, undoItem } from "@/lib/today-client";
import type { TodayItem, TodayResponse } from "@/lib/today-client";
import { isValidTodayHours, readTodayHours, saveTodayHours } from "@/lib/today-hours";
import { boundaryTag, dueLabel, insertAt, shareLabel } from "@/lib/today-list";
import styles from "./today.module.css";

// How long "Undo" stays on screen after marking something done.
export const UNDO_MS = 6000;

type LoadState =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ready"; data: TodayResponse };

// The item just marked done and where it sat, so Undo can put it back in the same place.
type UndoState = { item: TodayItem; index: number };

async function loadToday(hours: number | null): Promise<LoadState> {
  const result = await getToday(hours);
  return result.ok ? { status: "ready", data: result.data } : { status: "error", message: result.error };
}

function newRequestId(): string {
  return crypto.randomUUID();
}

function safeCanvasUrl(htmlUrl: string | null): string | null {
  if (!htmlUrl) {
    return null;
  }
  try {
    const url = new URL(htmlUrl);
    return url.protocol === "https:" ? url.href : null;
  } catch {
    return null;
  }
}

export function TodayList() {
  const [state, setState] = useState<LoadState>({ status: "loading" });
  const [undo, setUndo] = useState<UndoState | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [hoursValue, setHoursValue] = useState("");
  const [hoursError, setHoursError] = useState<string | null>(null);
  const [hoursMessage, setHoursMessage] = useState<string | null>(null);
  const [storageError, setStorageError] = useState<string | null>(null);
  const undoTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const requestId = useRef(0);
  const activeHours = useRef<number | null>(null);
  // Each done request, so Undo can wait for it: an undo that reached the server first would
  // leave the item done.
  const pendingDone = useRef(new Map<string, Promise<boolean>>());

  const reload = useCallback(async (hours = activeHours.current) => {
    const currentRequest = ++requestId.current;
    activeHours.current = hours;
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
      if (undoTimer.current) {
        clearTimeout(undoTimer.current);
      }
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

  function putBack(item: TodayItem, index: number) {
    setState((current) =>
      current.status === "ready" &&
      !current.data.items.some((entry) => entry.assignmentId === item.assignmentId)
        ? { ...current, data: { ...current.data, items: insertAt(current.data.items, item, index) } }
        : current,
    );
  }

  function handleDone(item: TodayItem, index: number) {
    if (state.status !== "ready") {
      return;
    }
    setActionError(null);
    setState({
      ...state,
      data: { ...state.data, items: state.data.items.filter((entry) => entry.assignmentId !== item.assignmentId) },
    });
    const request = markDone(
      item.assignmentId,
      { rank: index + 1, listGeneratedAt: state.data.generatedAt },
      newRequestId(),
    ).then(
      (result) => {
        if (!result.ok) {
          putBack(item, index);
          setUndo((current) => (current?.item.assignmentId === item.assignmentId ? null : current));
          setActionError(`Couldn't mark “${item.title}” done. ${result.error}`);
        }
        return result.ok;
      },
    );
    pendingDone.current.set(item.assignmentId, request);
    setUndo({ item, index });
    if (undoTimer.current) {
      clearTimeout(undoTimer.current);
    }
    undoTimer.current = setTimeout(() => setUndo(null), UNDO_MS);
  }

  async function handleUndo() {
    if (!undo) {
      return;
    }
    const { item, index } = undo;
    if (undoTimer.current) {
      clearTimeout(undoTimer.current);
    }
    setUndo(null);
    setActionError(null);
    putBack(item, index);
    const saved = await pendingDone.current.get(item.assignmentId);
    pendingDone.current.delete(item.assignmentId);
    if (!saved) {
      // The done never saved, so there is nothing to undo; the item is already back.
      return;
    }
    const result = await undoItem(item.assignmentId, newRequestId());
    if (!result.ok) {
      setActionError(`Couldn't undo “${item.title}”. ${result.error}`);
      await reload();
    }
  }

  return (
    <>
      {/* The hours filter sits opposite the title, so it fills the header instead of
          leaving an empty row beside the button. */}
      <PageHeader
        eyebrow="Do this first"
        title="Today"
        description="Your open work, most important first."
        actions={
          <form className={styles.hoursForm} onSubmit={applyHours}>
            <Input
              label="Hours available tonight"
              hint="0.5 to 12 hours. Leave blank to show all work."
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
            <Button type="submit" className={styles.hoursSubmit} loading={state.status === "loading"}>
              Show what fits
            </Button>
          </form>
        }
      />
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
          <Button variant="secondary" onClick={() => void reload()}>
            Try again
          </Button>
        </div>
      ) : null}
      {actionError ? <Notice tone="error">{actionError}</Notice> : null}
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
          <TodayItems items={state.data.items} onDone={handleDone} />
        </>
      ) : null}
      {undo ? (
        <div className={styles.undoBar} role="status">
          <span className={styles.undoText}>Marked “{undo.item.title}” done.</span>
          <button type="button" className={styles.undoButton} onClick={handleUndo}>
            Undo
          </button>
        </div>
      ) : null}
    </>
  );
}

export function TodayItems({
  items,
  onDone,
  now,
}: {
  items: TodayItem[];
  onDone?: (item: TodayItem, index: number) => void;
  // Fixed in tests so "today" and "tomorrow" don't depend on the clock.
  now?: Date;
}) {
  if (items.length === 0) {
    return (
      <section className={styles.emptyState} aria-labelledby="today-empty-title">
        <span className={styles.emptyMark} aria-hidden="true">
          ✓
        </span>
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
      {items.map((item, index) => {
        const share = shareLabel(item.share);
        const tag = boundaryTag(item.boundary);
        const canvasUrl = safeCanvasUrl(item.htmlUrl);
        return (
          <li key={item.assignmentId} className={styles.item}>
            {/* Positions in the list as shown, so marking one done never leaves a gap. */}
            <span className={styles.rank} aria-hidden="true">
              {index + 1}
            </span>
            <div className={styles.body}>
              {/* Title, course and due date stay visible so the list scans at a glance; the
                  reason and the Canvas link open underneath. */}
              <details className={styles.details}>
                <summary className={styles.summary}>
                  <span className={styles.title}>{item.title}</span>
                  <span className={styles.meta}>
                    <span>{item.courseName}</span>
                    <span className={item.overdue ? styles.overdue : undefined}>
                      {dueLabel(item.dueAt, item.overdue, now)}
                    </span>
                    {tag ? (
                      <span className={item.boundary?.direction === "at-risk" ? styles.atRisk : styles.withinReach}>
                        {tag}
                      </span>
                    ) : null}
                  </span>
                </summary>
                <div className={styles.detailContent}>
                  <p className={styles.reason}>{item.reason}</p>
                  <p className={styles.shareDetail}>
                    <span>Weight share</span>
                    <strong>{share ?? "Unavailable"}</strong>
                  </p>
                  {canvasUrl ? (
                    <a className={styles.canvasLink} href={canvasUrl} target="_blank" rel="noopener noreferrer">
                      Open in Canvas
                    </a>
                  ) : null}
                </div>
              </details>
            </div>
            <div className={styles.side}>
              {share ? (
                <span className={styles.share}>
                  <span className={styles.shareValue}>{share}</span>
                  <span className={styles.shareLabel}>of grade</span>
                </span>
              ) : null}
              {onDone ? (
                <button
                  type="button"
                  className={styles.doneButton}
                  aria-label={`Mark ${item.title} done`}
                  onClick={() => onDone(item, index)}
                >
                  Done
                </button>
              ) : null}
            </div>
          </li>
        );
      })}
    </ol>
  );
}
