"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { FormEvent } from "react";
import { Button, ButtonLink, Input, Notice, PageHeader } from "@/components/ui";
import { getToday, markDone, undoItem } from "@/lib/today-client";
import type { TodayItem, TodayResponse } from "@/lib/today-client";
import { isValidTodayHours, readTodayHours, saveTodayHours } from "@/lib/today-hours";
import { boundaryTag, dueLabel, shareLabel } from "@/lib/today-list";
import styles from "./today.module.css";

// How long "Undo" stays on screen after marking something done.
export const UNDO_MS = 6000;

type LoadState =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ready"; data: TodayResponse };

// The item just marked done, so Undo can reverse it while the bar is up.
type UndoState = { item: TodayItem };

// An action failure shown above the list. A failed reconcile also offers the
// loud "Reload list" as the way back to server truth.
type ActionError = { message: string; needsReload: boolean };

// The reconciliation model. Marking done removes a row optimistically, before
// the server agrees, so every GET response is checked against the done records
// before it may touch the screen:
//
//   "pending"                  — the POST has not settled: the GET may have
//                                read the item as open, so the row is dropped.
//   { savedAt: <request seq> } — the POST succeeded at request sequence
//                                savedAt. A GET that started before that may
//                                have read the item open: dropped. A GET that
//                                started after it reflects the save: kept (the
//                                server will not report a saved item anyway),
//                                and the record is spent.
//
// Records are deleted outright when a done fails or an undo succeeds, so the
// next GET shows the item again.
type DoneRecord = { status: "pending" } | { status: "saved"; savedAt: number };

// Applies the rules above to a fresh GET response and reports whether the
// response reflects every local change — only then may the empty states speak
// for the server plan again.
function reconcileGetResponse(
  data: TodayResponse,
  startedAt: number,
  records: Map<string, DoneRecord>,
  lastSavedDoneSeq: number,
): { data: TodayResponse; planCurrent: boolean } {
  // A GET that started after a save makes that save visible on screen; its
  // record has done its job guarding older GETs.
  for (const [id, record] of records) {
    if (record.status === "saved" && record.savedAt < startedAt) {
      records.delete(id);
    }
  }
  const items = data.items.filter((entry) => {
    const record = records.get(entry.assignmentId);
    return !record || (record.status === "saved" && startedAt > record.savedAt);
  });
  const planCurrent =
    startedAt > lastSavedDoneSeq &&
    ![...records.values()].some((record) => record.status === "pending");
  return { data: { ...data, items }, planCurrent };
}

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
  const [actionError, setActionError] = useState<ActionError | null>(null);
  const [hoursValue, setHoursValue] = useState("");
  const [hoursError, setHoursError] = useState<string | null>(null);
  const [hoursMessage, setHoursMessage] = useState<string | null>(null);
  const [storageError, setStorageError] = useState<string | null>(null);
  // True while a done removed a row under a budget and no GET has yet applied a
  // plan that reflects it: the empty states would be guesses, not server truth.
  const [planStale, setPlanStale] = useState(false);
  const undoTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const requestId = useRef(0);
  const activeHours = useRef<number | null>(null);
  // Each done request, so Undo can wait for it: an undo that reached the server first would
  // leave the item done.
  const pendingDone = useRef(new Map<string, Promise<boolean>>());
  const doneRecords = useRef(new Map<string, DoneRecord>());
  const lastSavedDoneSeq = useRef(0);
  // The loud/quiet split: a loud reload owns the visible loading state, so a
  // quiet one never invalidates it — it is skipped while a loud one is in
  // flight and re-run once the loud response has been applied.
  const loudRequestId = useRef(0);
  const loudInFlight = useRef(0);
  const reconcileOwed = useRef(false);

  const quietReload = useCallback(async () => {
    if (loudInFlight.current > 0) {
      reconcileOwed.current = true;
      return;
    }
    const startedAt = ++requestId.current;
    const next = await loadToday(activeHours.current);
    // A quiet response stands only when no newer reload of either kind started.
    if (startedAt !== requestId.current) {
      return;
    }
    if (next.status === "error") {
      // Keep the list on screen and report through the action error instead of
      // replacing the page with the error state.
      setActionError({ message: "Couldn't refresh your list.", needsReload: true });
      return;
    }
    if (next.status === "ready") {
      const { data, planCurrent } = reconcileGetResponse(
        next.data,
        startedAt,
        doneRecords.current,
        lastSavedDoneSeq.current,
      );
      setState({ status: "ready", data });
      if (planCurrent) {
        setPlanStale(false);
      }
    }
  }, []);

  const reload = useCallback(
    async (hours = activeHours.current) => {
      const startedAt = ++requestId.current;
      loudRequestId.current = startedAt;
      loudInFlight.current += 1;
      activeHours.current = hours;
      setState({ status: "loading" });
      const next = await loadToday(hours);
      loudInFlight.current -= 1;
      // A loud response stands unless a newer LOUD reload started; quiet
      // reloads never invalidate it.
      if (startedAt === loudRequestId.current) {
        if (next.status !== "ready") {
          setState(next);
        } else {
          const { data, planCurrent } = reconcileGetResponse(
            next.data,
            startedAt,
            doneRecords.current,
            lastSavedDoneSeq.current,
          );
          setState({ status: "ready", data });
          setActionError(null);
          if (planCurrent) {
            setPlanStale(false);
          }
        }
      }
      // Once the last loud has landed — applied, obsolete or failed — a quiet
      // reconcile skipped while a loud was in flight is re-run here: the loud
      // GET may have started before the latest save.
      if (loudInFlight.current === 0 && reconcileOwed.current) {
        reconcileOwed.current = false;
        void quietReload();
      }
    },
    [quietReload],
  );

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

  function handleDone(item: TodayItem, index: number) {
    if (state.status !== "ready") {
      return;
    }
    setActionError(null);
    setState({
      ...state,
      data: { ...state.data, items: state.data.items.filter((entry) => entry.assignmentId !== item.assignmentId) },
    });
    // Removing a row makes the plan on screen older than the student's actions
    // until a GET reconciles it — under a budget the empty states would be
    // guesses, without one the caught-up claim would be.
    setPlanStale(true);
    doneRecords.current.set(item.assignmentId, { status: "pending" });
    const request = markDone(
      item.assignmentId,
      { rank: index + 1, listGeneratedAt: state.data.generatedAt },
      newRequestId(),
    ).then(
      (result) => {
        if (!result.ok) {
          // The server kept the item open: forget the record so the reconcile
          // shows the row again.
          doneRecords.current.delete(item.assignmentId);
          void quietReload();
          setUndo((current) => (current?.item.assignmentId === item.assignmentId ? null : current));
          setActionError({
            message: `Couldn't mark “${item.title}” done. ${result.error}`,
            needsReload: false,
          });
          return result.ok;
        }
        // The save is server truth from sequence savedAt on; a GET that started
        // before it may still have read the item open. The reconcile always
        // runs: it also rebuilds a plan that a budget submit may have built
        // while this POST was pending.
        const savedAt = requestId.current;
        doneRecords.current.set(item.assignmentId, { status: "saved", savedAt });
        lastSavedDoneSeq.current = savedAt;
        void quietReload();
        return result.ok;
      },
    );
    pendingDone.current.set(item.assignmentId, request);
    setUndo({ item });
    if (undoTimer.current) {
      clearTimeout(undoTimer.current);
    }
    undoTimer.current = setTimeout(() => setUndo(null), UNDO_MS);
  }

  async function handleUndo() {
    if (!undo) {
      return;
    }
    const { item } = undo;
    if (undoTimer.current) {
      clearTimeout(undoTimer.current);
    }
    setUndo(null);
    setActionError(null);
    const saved = await pendingDone.current.get(item.assignmentId);
    pendingDone.current.delete(item.assignmentId);
    if (!saved) {
      // The done never saved, so there is nothing to undo; the reload shows
      // what the server actually has. Its failure already forgot the record.
      await quietReload();
      return;
    }
    const result = await undoItem(item.assignmentId, newRequestId());
    if (!result.ok) {
      // The item stays done on the server, so its record keeps guarding older
      // GETs.
      setActionError({ message: `Couldn't undo “${item.title}”. ${result.error}`, needsReload: false });
    } else {
      // The row is open again; the next GET may show it.
      doneRecords.current.delete(item.assignmentId);
    }
    // Reload on success and on failure: the item only comes back when the list
    // reflects the server, so a slow undo keeps it off screen until this lands.
    await quietReload();
  }

  // From the "nothing fits" state: no budget at all, so the plan on screen
  // matches the full list the reload brings back.
  function showAllWork() {
    setHoursValue("");
    setHoursError(null);
    const saved = saveTodayHours(null);
    setStorageError(
      saved ? null : "Could not save your hours for this evening. The list will still use this budget.",
    );
    setHoursMessage(null);
    void reload(null);
  }

  // A loud reload is already in flight, so retry buttons must not overlap it.
  const busy = state.status === "loading";

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
              hint="0.5 to 12 hours. Each item counts as 1 hour unless it has an estimate. Leave blank to show all work."
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
          <Button variant="secondary" disabled={busy} onClick={() => void reload()}>
            Try again
          </Button>
        </div>
      ) : null}
      {actionError ? (
        <Notice tone="error">
          {actionError.message}{" "}
          {actionError.needsReload ? (
            <Button variant="secondary" disabled={busy} onClick={() => void reload()}>
              Reload list
            </Button>
          ) : null}
        </Notice>
      ) : null}
      {state.status === "ready" ? (
        <>
          {state.data.hoursFilter ? (
            <p className={styles.planSummary} role="status">
              Showing work that fits in {state.data.hoursFilter.hours} hours tonight
              {state.data.hoursFilter.skippedCount > 0
                ? `; ${state.data.hoursFilter.skippedCount} ${state.data.hoursFilter.skippedCount === 1 ? "item" : "items"} left off the list.`
                : "."}
              {state.data.hoursFilter.unestimatedCount > 0
                ? " Items without a time estimate count as 1 hour."
                : ""}
            </p>
          ) : null}
          {state.data.items.length === 0 && planStale && !actionError?.needsReload ? (
            // The plan on screen is older than the last done: neither empty
            // state may speak for the server until the reconcile has applied.
            // A failed reconcile shows its error notice instead.
            <p className={styles.status} role="status">
              Updating your plan…
            </p>
          ) : state.data.items.length === 0 &&
            !planStale &&
            state.data.hoursFilter !== null &&
            state.data.hoursFilter.skippedCount > 0 ? (
            <section className={styles.emptyState} aria-labelledby="today-nothing-fits-title">
              <div className={styles.emptyMessage}>
                <h2 id="today-nothing-fits-title">
                  Nothing fits in {state.data.hoursFilter.hours}{" "}
                  {state.data.hoursFilter.hours === 1 ? "hour" : "hours"}
                </h2>
                <p>Each item counts as 1 hour unless it has an estimate. Try at least 1 hour, or clear the box to see everything.</p>
              </div>
              <Button variant="secondary" onClick={showAllWork}>
                Show all work
              </Button>
            </section>
          ) : state.data.items.length === 0 && planStale ? null : (
            <TodayItems items={state.data.items} onDone={handleDone} />
          )}
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
