"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Button, Notice, PageHeader } from "@/components/ui";
import { getToday, markDone, undoItem } from "@/lib/today-client";
import type { TodayItem } from "@/lib/today-client";
import { boundaryTag, dueLabel, insertAt, shareLabel } from "@/lib/today-list";
import styles from "./today.module.css";

// How long "Undo" stays on screen after marking something done.
export const UNDO_MS = 6000;

type LoadState =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ready"; items: TodayItem[]; generatedAt: string };

// The item just marked done and where it sat, so Undo can put it back in the same place.
type UndoState = { item: TodayItem; index: number };

async function loadToday(): Promise<LoadState> {
  const result = await getToday();
  return result.ok
    ? { status: "ready", items: result.data.items, generatedAt: result.data.generatedAt }
    : { status: "error", message: result.error };
}

function newRequestId(): string {
  return crypto.randomUUID();
}

export function TodayList() {
  const [state, setState] = useState<LoadState>({ status: "loading" });
  const [undo, setUndo] = useState<UndoState | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const undoTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Each done request, so Undo can wait for it: an undo that reached the server first would
  // leave the item done.
  const pendingDone = useRef(new Map<string, Promise<boolean>>());

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
      if (undoTimer.current) {
        clearTimeout(undoTimer.current);
      }
    };
  }, []);

  function putBack(item: TodayItem, index: number) {
    setState((current) =>
      current.status === "ready" && !current.items.some((entry) => entry.assignmentId === item.assignmentId)
        ? { ...current, items: insertAt(current.items, item, index) }
        : current,
    );
  }

  function handleDone(item: TodayItem, index: number) {
    if (state.status !== "ready") {
      return;
    }
    setActionError(null);
    setState({ ...state, items: state.items.filter((entry) => entry.assignmentId !== item.assignmentId) });
    const request = markDone(item.assignmentId, { rank: index + 1, listGeneratedAt: state.generatedAt }, newRequestId()).then(
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
      {actionError ? <Notice tone="error">{actionError}</Notice> : null}
      {state.status === "ready" ? <TodayItems items={state.items} onDone={handleDone} /> : null}
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
}: {
  items: TodayItem[];
  onDone?: (item: TodayItem, index: number) => void;
}) {
  if (items.length === 0) {
    return <p className={styles.status}>Nothing on your list right now.</p>;
  }
  return (
    <ol className={styles.list} aria-label="Today">
      {items.map((item, index) => {
        const share = shareLabel(item.share);
        const tag = boundaryTag(item.boundary);
        return (
          <li key={item.assignmentId} className={styles.item}>
            {/* Positions in the list as shown, so marking one done never leaves a gap. */}
            <span className={styles.rank} aria-hidden="true">
              {index + 1}
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
