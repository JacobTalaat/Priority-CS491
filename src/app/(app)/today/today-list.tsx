"use client";

import { useCallback, useEffect, useState } from "react";
import { Button, ButtonLink, Input, List, ListRow, Notice, PageHeader } from "@/components/ui";
import { dueText } from "@/lib/class-page";
import { getTodayAssignments } from "@/lib/today-client";
import type { TodayAssignment } from "@/lib/today-client";
import {
  assignmentsThatFit,
  HOURS_PER_ASSIGNMENT,
  MAX_EVENING_HOURS,
  MIN_EVENING_HOURS,
  validEveningHours,
} from "@/lib/today";
import styles from "./today-list.module.css";

const EVENING_HOURS_KEY = "priority-evening-hours";

type SavedHours = { value: string; error: boolean };

type LoadState =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ready"; assignments: TodayAssignment[] };

function readSavedHours(): SavedHours {
  try {
    return { value: window.localStorage.getItem(EVENING_HOURS_KEY) ?? "", error: false };
  } catch {
    return { value: "", error: true };
  }
}

export function TodayList() {
  const [state, setState] = useState<LoadState>({ status: "loading" });
  const [hoursInput, setHoursInput] = useState("");
  const [hoursAvailable, setHoursAvailable] = useState<number | null>(null);
  const [hoursLoaded, setHoursLoaded] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const loadAssignments = useCallback(async () => {
    const result = await getTodayAssignments();
    if (result.ok) {
      setState({ status: "ready", assignments: result.data.assignments });
    } else {
      setState({ status: "error", message: result.error });
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    async function initialize() {
      const saved = readSavedHours();
      const storedHours = saved.value;
      const parsedHours = validEveningHours(storedHours);
      await Promise.resolve();
      if (cancelled) {
        return;
      }
      if (storedHours !== "" && parsedHours !== null) {
        setHoursInput(storedHours);
        setHoursAvailable(parsedHours);
      }
      if (saved.error) {
        setMessage("Your saved evening hours couldn’t be read in this browser.");
      }
      setHoursLoaded(true);
      const result = await getTodayAssignments();
      if (cancelled) {
        return;
      }
      if (result.ok) {
        setState({ status: "ready", assignments: result.data.assignments });
      } else {
        setState({ status: "error", message: result.error });
      }
    }
    void initialize();
    return () => {
      cancelled = true;
    };
  }, []);

  function handleHoursChange(value: string) {
    setHoursInput(value);
    setMessage(null);
    if (value.trim() === "") {
      setHoursAvailable(null);
      try {
        window.localStorage.removeItem(EVENING_HOURS_KEY);
      } catch {
        setMessage("Your hours were cleared for now but couldn’t be saved in this browser.");
      }
      return;
    }

    const hours = validEveningHours(value);
    if (hours === null) {
      setHoursAvailable(null);
      setMessage(`Enter between ${MIN_EVENING_HOURS} and ${MAX_EVENING_HOURS} hours.`);
      return;
    }

    setHoursAvailable(hours);
    try {
      window.localStorage.setItem(EVENING_HOURS_KEY, value);
    } catch {
      setMessage("Your hours apply for now but couldn’t be saved in this browser.");
    }
  }

  const visibleAssignments =
    state.status === "ready" ? assignmentsThatFit(state.assignments, hoursAvailable) : [];

  return (
    <div className={styles.page}>
      <PageHeader
        eyebrow="Due soon"
        title="Today"
        description="Your open assignments, ordered by due date."
      />

      <div className={styles.hours}>
        <Input
          label="Hours available tonight"
          type="number"
          min={MIN_EVENING_HOURS}
          max={MAX_EVENING_HOURS}
          step="any"
          value={hoursInput}
          onChange={(event) => handleHoursChange(event.target.value)}
          hint={`Each assignment counts as ${HOURS_PER_ASSIGNMENT} hour. Your setting stays saved in this browser.`}
        />
        {message ? <p className={styles.error} role="status">{message}</p> : null}
      </div>

      {state.status === "loading" || !hoursLoaded ? (
        <p className={styles.status} role="status">Loading your assignments…</p>
      ) : null}
      {state.status === "error" ? (
        <div className={styles.emptyState}>
          <Notice tone="error">{state.message}</Notice>
          <Button variant="secondary" onClick={loadAssignments}>Try again</Button>
        </div>
      ) : null}

      {state.status === "ready" && state.assignments.length === 0 ? (
        <div className={styles.emptyState}>
          <h2 className={styles.emptyTitle}>No assignments yet</h2>
          <p className={styles.hint}>Connect Canvas and sync a class to see its open assignments here.</p>
          <ButtonLink href="/settings">Connect Canvas</ButtonLink>
        </div>
      ) : null}

      {state.status === "ready" && state.assignments.length > 0 && visibleAssignments.length === 0 ? (
        <p className={styles.status} role="status">
          No assignments fit in {hoursAvailable} {hoursAvailable === 1 ? "hour" : "hours"}.
          Each assignment counts as {HOURS_PER_ASSIGNMENT} hour.
        </p>
      ) : null}

      {visibleAssignments.length > 0 ? (
        <>
          {hoursAvailable !== null ? (
            <p className={styles.status} role="status">
              Showing {visibleAssignments.length} of {state.status === "ready" ? state.assignments.length : 0} assignments that fit tonight.
            </p>
          ) : null}
          <List label="Assignments that fit tonight">
            {visibleAssignments.map((assignment) => (
              <ListRow
                key={assignment.id}
                title={assignment.title}
                meta={
                  <span className={styles.itemMeta}>
                    <span>
                      {assignment.course.courseCode
                        ? `${assignment.course.courseCode} · ${assignment.course.name}`
                        : assignment.course.name}
                    </span>
                    <span>{dueText(assignment.dueAt, assignment.hasDueDate)}</span>
                  </span>
                }
                trailing={`${HOURS_PER_ASSIGNMENT} hour`}
                href={`/classes/${encodeURIComponent(assignment.course.id)}`}
              />
            ))}
          </List>
        </>
      ) : null}
    </div>
  );
}
