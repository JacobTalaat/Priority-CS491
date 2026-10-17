"use client";

import { useCallback, useEffect, useState } from "react";
import { Button, ButtonLink, Notice, PageHeader } from "@/components/ui";
import { canvasErrorMessage, getCanvasStatus, syncNow } from "@/lib/canvas-client";
import { getCourseGrade, getGradeSetupCourses } from "@/lib/grade-setup-client";
import type { CourseGrade, GradeSetupCourse } from "@/lib/grade-setup-client";
import { ClassCards } from "./class-cards";
import styles from "./classes.module.css";

type ClassCardData = GradeSetupCourse & { grade: CourseGrade };

type LoadState =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ready"; connected: boolean; courses: ClassCardData[]; loadedAt: number };

export function ClassesList() {
  const [state, setState] = useState<LoadState>({ status: "loading" });
  const [syncing, setSyncing] = useState(false);
  const [syncError, setSyncError] = useState<string | null>(null);

  const loadCourses = useCallback(async (): Promise<LoadState> => {
    const [canvasResult, coursesResult] = await Promise.all([getCanvasStatus(), getGradeSetupCourses()]);
    if (!canvasResult.ok) {
      return { status: "error", message: canvasErrorMessage(canvasResult) };
    }
    if (!coursesResult.ok) {
      return { status: "error", message: coursesResult.error };
    }

    const gradeResults = await Promise.all(
      coursesResult.data.courses.map(async (course) => ({
        course,
        result: await getCourseGrade(course.id),
      })),
    );
    const courses: ClassCardData[] = [];
    for (const { course, result } of gradeResults) {
      if (!result.ok) {
        return { status: "error", message: result.error };
      }
      courses.push({ ...course, grade: result.data });
    }

    return { status: "ready", connected: canvasResult.data.connected, courses, loadedAt: Date.now() };
  }, []);

  useEffect(() => {
    let active = true;
    loadCourses().then((nextState) => {
      if (active) {
        setState(nextState);
      }
    });
    return () => {
      active = false;
    };
  }, [loadCourses]);

  async function handleSync() {
    setSyncing(true);
    setSyncError(null);
    const result = await syncNow();
    setSyncing(false);
    if (!result.ok) {
      setSyncError(canvasErrorMessage(result));
      return;
    }
    setState(await loadCourses());
  }

  const connected = state.status === "ready" && state.connected;
  const courses = state.status === "ready" ? state.courses : [];

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

      {state.status === "ready" && !state.connected && courses.length === 0 ? (
        <div className={styles.emptyState}>
          <h2 className={styles.emptyTitle}>Canvas isn’t connected</h2>
          <p className={styles.emptyDescription}>
            Connect Canvas to import and see your current classes here.
          </p>
          <ButtonLink href="/settings">Connect Canvas</ButtonLink>
        </div>
      ) : null}

      {state.status === "ready" && state.connected && courses.length === 0 ? (
        <div className={styles.emptyState}>
          <h2 className={styles.emptyTitle}>No current classes yet</h2>
          <p className={styles.emptyDescription}>
            Sync Canvas to import the courses in your current term.
          </p>
        </div>
      ) : null}

      {state.status === "ready" && !state.connected && courses.length > 0 ? (
        <p className={styles.description}>
          Canvas isn’t connected. Showing the classes and assignments from your last sync.
        </p>
      ) : null}

      {state.status === "ready" && courses.length > 0 ? (
        <ClassCards courses={courses} loadedAt={state.loadedAt} />
      ) : null}
    </>
  );
}
