"use client";

import { useCallback, useEffect, useState } from "react";
import { Button, ButtonLink, List, ListRow, Notice, PageHeader } from "@/components/ui";
import {
  canvasErrorMessage,
  getImportedCourses,
  syncNow,
} from "@/lib/canvas-client";
import type { ImportedCoursesResponse } from "@/lib/canvas-client";
import type { ApiResult } from "@/lib/api-client";
import { getGradeSetupCourses } from "@/lib/grade-setup-client";
import { logEvent } from "@/lib/usage";
import styles from "./classes.module.css";

type ClassesData = {
  connected: boolean;
  courses: (ImportedCoursesResponse["courses"][number] & { setupConfirmed: boolean })[];
};

type LoadState =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ready"; data: ClassesData };

async function getClassesData(): Promise<ApiResult<ClassesData>> {
  const [importedResult, setupResult] = await Promise.all([getImportedCourses(), getGradeSetupCourses()]);
  if (!importedResult.ok) {
    return { ...importedResult, error: canvasErrorMessage(importedResult) };
  }
  if (!setupResult.ok) {
    return { ...setupResult, error: canvasErrorMessage(setupResult) };
  }

  const setupByCourseId = new Map(
    setupResult.data.courses.map((course) => [course.id, Boolean(course.gradeSetup)]),
  );
  return {
    ok: true,
    status: importedResult.status,
    data: {
      connected: importedResult.data.connected,
      courses: importedResult.data.courses.map((course) => ({
        ...course,
        setupConfirmed: setupByCourseId.get(course.id) ?? false,
      })),
    },
  };
}

function applyCourseResult(
  result: ApiResult<ClassesData>,
  setState: (state: LoadState) => void,
) {
  if (result.ok) {
    setState({ status: "ready", data: result.data });
  } else {
    setState({ status: "error", message: result.error });
  }
}

export function ClassesList() {
  const [state, setState] = useState<LoadState>({ status: "loading" });
  const [syncing, setSyncing] = useState(false);
  const [syncError, setSyncError] = useState<string | null>(null);

  const loadCourses = useCallback(async () => {
    const result = await getClassesData();
    applyCourseResult(result, setState);
  }, []);

  useEffect(() => {
    let cancelled = false;
    getClassesData().then((result) => {
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
    logEvent("sync_now");
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

      {state.status === "ready" && (!connected || courses.length === 0) ? (
        <div className={styles.emptyState}>
          <h2 className={styles.emptyTitle}>No classes yet</h2>
          <p className={styles.emptyDescription}>
            {connected
              ? "Sync Canvas to import the courses in your current term."
              : "Connect Canvas to import and see your current classes here."}
          </p>
          <ButtonLink href="/settings">Connect Canvas</ButtonLink>
        </div>
      ) : null}

      {connected && courses.length > 0 ? (
        <List label="Current classes">
          {courses.map((course) => {
            const meta = [course.courseCode, course.term].filter(Boolean).join(" · ");
            return (
              <ListRow
                key={course.id}
                title={course.name}
                meta={meta || "Imported from Canvas"}
                trailing={course.setupConfirmed ? "Confirmed" : "Not confirmed"}
                href={`/weights?course=${encodeURIComponent(course.id)}`}
              />
            );
          })}
        </List>
      ) : null}
    </>
  );
}
