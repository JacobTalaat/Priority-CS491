"use client";

import Link from "next/link";
import { useEffect, useState, useSyncExternalStore } from "react";
import { Button, ButtonLink, Notice, PageHeader } from "@/components/ui";
import {
  canvasErrorMessage,
  getImportedCourses,
  syncNow,
} from "@/lib/canvas-client";
import type { ImportedCoursesResponse } from "@/lib/canvas-client";
import { formatPercent } from "@/lib/class-page";
import { getCourseGrade } from "@/lib/course-client";
import type { CourseGradeResponse } from "@/lib/course-client";
import type { ApiResult } from "@/lib/api-client";
import { logEvent } from "@/lib/usage";
import styles from "./classes.module.css";

type LoadState =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ready"; data: ImportedCoursesResponse };

type CardGrade =
  | { status: "calculated"; percentage: number; letter: string | null }
  | { status: "loading" }
  | { status: "no-grade" }
  | { status: "unsupported" }
  | { status: "unavailable" };

const SHOW_GRADES_KEY = "priority.classes.showGrades";

function cardGradeFromResponse(grade: CourseGradeResponse): CardGrade {
  if (grade.grade.status === "calculated") {
    return { status: "calculated", percentage: grade.grade.percentage, letter: grade.letter };
  }
  // The class page wordings for the same grade states: nothing graded yet, or a
  // rule the engine cannot grade.
  return grade.grade.status === "insufficient-data" ? { status: "no-grade" } : { status: "unsupported" };
}

async function loadCardGrade(courseId: string): Promise<CardGrade> {
  const result = await getCourseGrade(courseId);
  return result.ok ? cardGradeFromResponse(result.data) : { status: "unavailable" };
}

// Like the theme in the dashboard, the toggle reads storage through a store
// subscription with a server snapshot, so the first server paint always shows
// grades and the client corrects itself without a setState-in-effect.
const GRADES_VISIBILITY_EVENT = "priority-grades-visibility-change";

// The snapshot is cached so a blocked write cannot flip what the toggle already
// applied. Every mount re-reads the saved choice, and an external storage event
// (another tab, or settings elsewhere) invalidates the cache first.
let showGradesCache: boolean | null = null;

function subscribeToGradesVisibility(onChange: () => void): () => void {
  showGradesCache = null;
  const onExternalChange = () => {
    showGradesCache = null;
    onChange();
  };
  window.addEventListener(GRADES_VISIBILITY_EVENT, onChange);
  window.addEventListener("storage", onExternalChange);
  return () => {
    window.removeEventListener(GRADES_VISIBILITY_EVENT, onChange);
    window.removeEventListener("storage", onExternalChange);
  };
}

function readShowGrades(): boolean {
  if (showGradesCache === null) {
    try {
      showGradesCache = localStorage.getItem(SHOW_GRADES_KEY) !== "false";
    } catch {
      showGradesCache = true;
    }
  }
  return showGradesCache;
}

function writeStoredShowGrades(showGrades: boolean): void {
  showGradesCache = showGrades;
  try {
    localStorage.setItem(SHOW_GRADES_KEY, showGrades ? "true" : "false");
  } catch {
    return;
  }
}

function applyCourseResult(
  result: ApiResult<ImportedCoursesResponse>,
  setState: (state: LoadState) => void,
) {
  if (result.ok) {
    setState({ status: "ready", data: result.data });
  } else {
    setState({ status: "error", message: canvasErrorMessage(result) });
  }
}

type LoadTargets = {
  setState: (state: LoadState) => void;
  setGrades: (grades: Record<string, CardGrade>) => void;
};

async function loadCoursesAndGrades({ setState, setGrades }: LoadTargets): Promise<void> {
  const result = await getImportedCourses();
  applyCourseResult(result, setState);
  if (!result.ok || !result.data.connected || result.data.courses.length === 0) {
    setGrades({});
    return;
  }
  setGrades({});
  // One request per class, settled together: a failing request only marks its
  // own card as unavailable rather than losing the whole list's grades.
  const entries = await Promise.all(
    result.data.courses.map(async (course) => {
      const grade = await loadCardGrade(course.id).catch(() => ({ status: "unavailable" }) as const);
      return [course.id, grade] as const;
    }),
  );
  setGrades(Object.fromEntries(entries));
}

export function ClassesList() {
  const [state, setState] = useState<LoadState>({ status: "loading" });
  const [grades, setGrades] = useState<Record<string, CardGrade>>({});
  const showGrades = useSyncExternalStore(subscribeToGradesVisibility, readShowGrades, () => true);
  const [syncing, setSyncing] = useState(false);
  const [syncError, setSyncError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    loadCoursesAndGrades({
      setState: (next) => {
        if (!cancelled) {
          setState(next);
        }
      },
      setGrades: (next) => {
        if (!cancelled) {
          setGrades(next);
        }
      },
    });
    return () => {
      cancelled = true;
    };
  }, []);

  function handleToggleGrades() {
    writeStoredShowGrades(!showGrades);
    window.dispatchEvent(new Event(GRADES_VISIBILITY_EVENT));
  }

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
    await loadCoursesAndGrades({ setState, setGrades });
  }

  async function handleTryAgain() {
    setSyncError(null);
    await loadCoursesAndGrades({ setState, setGrades });
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
            <>
              <Button
                variant="secondary"
                aria-pressed={!showGrades}
                onClick={handleToggleGrades}
              >
                {showGrades ? "Hide grades" : "Show grades"}
              </Button>
              <Button onClick={handleSync} loading={syncing}>
                {syncing ? "Syncing…" : "Sync classes"}
              </Button>
            </>
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
          <Button variant="secondary" onClick={handleTryAgain}>
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
        <ul className={styles.grid} aria-label="Current classes">
          {courses.map((course) => {
            const meta = [course.courseCode, course.term].filter(Boolean).join(" · ") || "Imported from Canvas";
            return (
              <li key={course.id} className={styles.card}>
                <Link href={`/classes/${encodeURIComponent(course.id)}`} className={styles.cardLink}>
                  <span className={styles.cardTitle}>{course.name}</span>
                  <span className={styles.cardMeta}>{meta}</span>
                  <span className={styles.cardGrade}>
                    <GradeContent grade={grades[course.id]} showGrades={showGrades} />
                  </span>
                </Link>
              </li>
            );
          })}
        </ul>
      ) : null}
    </>
  );
}

function GradeContent({ grade, showGrades }: { grade: CardGrade | undefined; showGrades: boolean }) {
  if (!showGrades) {
    return <span className={styles.gradePlaceholder}>Grade hidden</span>;
  }
  if (!grade || grade.status === "loading") {
    return (
      <span className={`${styles.gradeMuted} ${styles.gradeLoading}`} aria-hidden="true">
        …
      </span>
    );
  }
  if (grade.status === "unavailable") {
    return <span className={styles.gradeMuted}>Grade unavailable</span>;
  }
  if (grade.status === "no-grade") {
    return <span className={styles.gradeMuted}>No grade yet</span>;
  }
  if (grade.status === "unsupported") {
    return <span className={styles.gradeMuted}>Can’t work out a grade</span>;
  }
  return (
    <span className={styles.gradeValues}>
      {grade.letter !== null ? <span className={styles.gradeLetter}>{grade.letter}</span> : null}
      <span className={styles.gradePercent}>{formatPercent(grade.percentage)}</span>
    </span>
  );
}
