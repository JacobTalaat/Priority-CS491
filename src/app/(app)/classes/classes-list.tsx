"use client";

import { useCallback, useEffect, useState } from "react";
import { Button, ButtonLink, Notice, PageHeader } from "@/components/ui";
import { canvasErrorMessage, syncNow } from "@/lib/canvas-client";
import type { ApiResult } from "@/lib/api-client";
import { getClassCards } from "@/lib/class-cards-client";
import type { ClassCardsResponse } from "@/lib/class-cards-client";
import { ClassCard } from "./class-card";
import styles from "./classes.module.css";

type LoadState =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ready"; data: ClassCardsResponse };

function applyCourseResult(
  result: ApiResult<ClassCardsResponse>,
  setState: (state: LoadState) => void,
) {
  if (result.ok) {
    setState({ status: "ready", data: result.data });
  } else {
    setState({ status: "error", message: canvasErrorMessage(result) });
  }
}

export function ClassesList() {
  const [state, setState] = useState<LoadState>({ status: "loading" });
  const [syncing, setSyncing] = useState(false);
  const [syncError, setSyncError] = useState<string | null>(null);

  const loadCourses = useCallback(async () => {
    const result = await getClassCards();
    applyCourseResult(result, setState);
  }, []);

  useEffect(() => {
    let cancelled = false;
    getClassCards().then((result) => {
      if (!cancelled) {
        applyCourseResult(result, setState);
      }
    });
    return () => {
      cancelled = true;
    };
  }, []);

  async function handleSync() {
    setSyncing(true);
    setSyncError(null);
    const result = await syncNow();
    setSyncing(false);
    if (!result.ok) {
      setSyncError(canvasErrorMessage(result));
      return;
    }
    await loadCourses();
  }

  const connected = state.status === "ready" && state.data.connected;
  const courses = state.status === "ready" ? state.data.courses : [];

  return (
    <>
      <PageHeader
        eyebrow="This term"
        title="Classes"
        description="Your current-term classes imported from Canvas."
        actions={
          connected ? (
            <Button onClick={handleSync} loading={syncing}>
              {syncing ? "Syncing…" : "Sync classes"}
            </Button>
          ) : null
        }
      />

      {state.status === "loading" ? (
        <p className={styles.status} role="status">
          Loading your classes…
        </p>
      ) : null}
      {state.status === "error" ? (
        <div className={styles.emptyState}>
          <Notice tone="error">{state.message}</Notice>
          <Button variant="secondary" onClick={loadCourses}>
            Try again
          </Button>
        </div>
      ) : null}
      {syncError ? <Notice tone="error">{syncError}</Notice> : null}

      {state.status === "ready" && !state.data.connected ? (
        <div className={styles.emptyState}>
          <h2 className={styles.emptyTitle}>Canvas isn’t connected</h2>
          <p className={styles.emptyDescription}>
            Connect Canvas to import and see your current classes here.
          </p>
          <ButtonLink href="/settings">Connect Canvas</ButtonLink>
        </div>
      ) : null}

      {connected && courses.length === 0 ? (
        <div className={styles.emptyState}>
          <h2 className={styles.emptyTitle}>No current classes yet</h2>
          <p className={styles.emptyDescription}>
            Sync Canvas to import the courses in your current term.
          </p>
        </div>
      ) : null}

      {connected && courses.length > 0 ? (
        <ul className={styles.cardGrid} aria-label="Current classes">
          {courses.map((course) => <ClassCard key={course.id} course={course} />)}
        </ul>
      ) : null}
    </>
  );
}
