"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import type { FormEvent } from "react";
import { Button, ButtonLink, Input, List, ListRow, Notice, PageHeader } from "@/components/ui";
import { getCourseDetails, getCourseGrade, saveManualGrade } from "@/lib/course-client";
import type { CourseDetailsResponse, CourseGradeResponse } from "@/lib/course-client";
import { categoryLine, dueText, formatPercent, gradeSummary, scoreText, shareText } from "@/lib/class-page";
import styles from "./class-page.module.css";

type LoadState =
  | { status: "loading" }
  | { status: "not-found" }
  | { status: "error"; message: string }
  | { status: "ready"; details: CourseDetailsResponse; grade: GradeState };

// The grade is fetched separately, so a grade failure still leaves the assignments and
// class details on screen.
type GradeState = { ok: true; data: CourseGradeResponse } | { ok: false; message: string };

async function loadClass(courseId: string): Promise<LoadState> {
  const [details, grade] = await Promise.all([getCourseDetails(courseId), getCourseGrade(courseId)]);
  if (!details.ok) {
    return details.status === 404 ? { status: "not-found" } : { status: "error", message: details.error };
  }
  return {
    status: "ready",
    details: details.data,
    grade: grade.ok ? { ok: true, data: grade.data } : { ok: false, message: grade.error },
  };
}

export function ClassPage({ courseId }: { courseId: string }) {
  const [state, setState] = useState<LoadState>({ status: "loading" });

  const reload = useCallback(async () => {
    setState({ status: "loading" });
    setState(await loadClass(courseId));
  }, [courseId]);

  const refresh = useCallback(async () => {
    setState(await loadClass(courseId));
  }, [courseId]);

  useEffect(() => {
    let cancelled = false;
    loadClass(courseId).then((next) => {
      if (!cancelled) {
        setState(next);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [courseId]);

  if (state.status === "loading") {
    return (
      <p className={styles.muted} role="status">
        Loading this class…
      </p>
    );
  }
  if (state.status === "not-found") {
    return (
      <div className={styles.emptyState}>
        <h1 className={styles.emptyTitle}>Class not found</h1>
        <p className={styles.muted}>This class isn’t one of your current classes. It may have ended or been removed in Canvas.</p>
        <ButtonLink href="/classes">Back to classes</ButtonLink>
      </div>
    );
  }
  if (state.status === "error") {
    return (
      <div className={styles.emptyState}>
        <Notice tone="error">{state.message}</Notice>
        <Button variant="secondary" onClick={reload}>
          Try again
        </Button>
      </div>
    );
  }
  return <ClassPageView details={state.details} grade={state.grade} onGradeSaved={refresh} />;
}

export function ClassPageView({
  details,
  grade,
  onGradeSaved,
}: {
  details: CourseDetailsResponse;
  grade: GradeState;
  onGradeSaved?: () => Promise<void>;
}) {
  const { course } = details;
  const setupHref = `/weights?course=${encodeURIComponent(course.id)}`;
  const eyebrow = [course.courseCode, course.term].filter(Boolean).join(" · ");
  const shares = new Map(grade.ok ? grade.data.shares.map((share) => [share.assignmentId, share]) : []);

  return (
    <div className={styles.page}>
      <Link className={styles.back} href="/classes">
        ← All classes
      </Link>
      <PageHeader
        eyebrow={eyebrow || undefined}
        title={course.name}
        actions={
          <ButtonLink href={setupHref} variant="secondary">
            Grade setup
          </ButtonLink>
        }
      />

      <section className={styles.section} aria-labelledby="class-grade">
        <h2 id="class-grade" className={styles.sectionTitle}>
          Grade
        </h2>
        {grade.ok ? <GradeOverview grade={grade.data} setupHref={setupHref} /> : <Notice tone="error">{grade.message}</Notice>}
      </section>

      <section className={styles.section} aria-labelledby="class-assignments">
        <h2 id="class-assignments" className={styles.sectionTitle}>
          Assignments
        </h2>
        {details.assignments.length === 0 ? (
          <p className={styles.muted}>No assignments imported for this class yet. Sync Canvas to bring them in.</p>
        ) : (
          <List label="Assignments">
            {details.assignments.map((assignment) => {
              const share = shares.get(assignment.id);
              const category = share?.category ?? assignment.assignmentGroup?.name ?? null;
              const meta = [dueText(assignment.dueAt, assignment.hasDueDate), category, shareText(share?.share)]
                .filter(Boolean)
                .join(" · ");
              return (
                <ListRow
                  key={assignment.id}
                  title={assignment.title}
                  meta={meta}
                  trailing={scoreText(assignment.grade, assignment.pointsPossible)}
                  below={
                    <ManualGradeField
                      courseId={course.id}
                      assignmentId={assignment.id}
                      assignmentTitle={assignment.title}
                      pointsPossible={assignment.pointsPossible}
                      score={assignment.grade?.score ?? null}
                      onSaved={onGradeSaved}
                    />
                  }
                />
              );
            })}
          </List>
        )}
      </section>

      <section className={styles.section} aria-labelledby="class-details">
        <h2 id="class-details" className={styles.sectionTitle}>
          Class details
        </h2>
        <ClassDetails details={details.details} setupHref={setupHref} />
      </section>
    </div>
  );
}

function ManualGradeField({
  courseId,
  assignmentId,
  assignmentTitle,
  pointsPossible,
  score,
  onSaved,
}: {
  courseId: string;
  assignmentId: string;
  assignmentTitle: string;
  pointsPossible: number;
  score: number | null;
  onSaved?: () => Promise<void>;
}) {
  const [value, setValue] = useState(score === null ? "" : String(score));
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ tone: "success" | "error"; text: string } | null>(null);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const parsedScore = Number(value);
    if (value.trim() === "" || !Number.isFinite(parsedScore)) {
      setMessage({ tone: "error", text: "Enter a valid score." });
      return;
    }

    setSaving(true);
    setMessage(null);
    const result = await saveManualGrade(courseId, assignmentId, parsedScore);
    setSaving(false);
    if (!result.ok) {
      setMessage({ tone: "error", text: result.error });
      return;
    }
    setMessage({ tone: "success", text: "Grade saved." });
    await onSaved?.();
  }

  return (
    <form className={styles.gradeEntry} onSubmit={handleSubmit}>
      <Input
        label={`Grade for ${assignmentTitle}`}
        className={styles.gradeInput}
        type="number"
        min="0"
        max={pointsPossible}
        step="any"
        value={value}
        onChange={(event) => {
          setValue(event.target.value);
          setMessage(null);
        }}
        disabled={saving}
        required
      />
      <Button className={styles.gradeButton} type="submit" loading={saving}>
        Save
      </Button>
      {message ? (
        <span className={message.tone === "error" ? styles.gradeError : styles.gradeSuccess} role={message.tone === "error" ? "alert" : "status"}>
          {message.text}
        </span>
      ) : null}
    </form>
  );
}

function GradeOverview({ grade, setupHref }: { grade: CourseGradeResponse; setupHref: string }) {
  const summary = gradeSummary(grade.grade);
  const weighted = grade.engine === "weighted";
  return (
    <>
      <div className={styles.gradeBlock}>
        <p className={styles.grade}>{summary.headline}</p>
        {summary.detail ? <p className={styles.muted}>{summary.detail}</p> : null}
        <p className={styles.muted}>
          {weighted
            ? "Weighted by the grade setup you confirmed."
            : grade.setupConfirmed
              ? "Based on total points, because your grade setup has no category weights."
              : "Based on total points until you confirm a grade setup."}
        </p>
      </div>

      <h3 className={styles.subTitle}>By category</h3>
      {weighted && grade.breakdown.length > 0 ? (
        <List label="Grade by category">
          {grade.breakdown.map((category) => (
            <ListRow
              key={category.category}
              title={category.category}
              meta={categoryLine(category)}
              trailing={`${formatPercent(category.weight)} of grade`}
            />
          ))}
        </List>
      ) : (
        <p className={styles.muted}>
          <Link className={styles.inlineLink} href={setupHref}>
            Confirm your grade setup
          </Link>{" "}
          to see your grade broken down by category.
        </p>
      )}
    </>
  );
}

const DETAIL_ROWS = [
  { key: "officeHours", label: "Office hours" },
  { key: "latePolicy", label: "Late policy" },
  { key: "contacts", label: "Contacts" },
] as const;

function ClassDetails({ details, setupHref }: { details: CourseDetailsResponse["details"]; setupHref: string }) {
  const extras = [
    details.instructor ? { label: "Instructor", value: details.instructor } : null,
    details.section ? { label: "Section", value: details.section } : null,
    details.credits !== null ? { label: "Credits", value: String(details.credits) } : null,
  ].filter((row): row is { label: string; value: string } => row !== null);
  const anyMissing = DETAIL_ROWS.some((row) => !details[row.key]);

  return (
    <>
      <dl className={styles.details}>
        {DETAIL_ROWS.map((row) => (
          <div key={row.key} className={styles.detailRow}>
            <dt className={styles.detailLabel}>{row.label}</dt>
            <dd className={details[row.key] ? styles.detailValue : styles.detailMissing}>
              {details[row.key] ?? "Not added yet"}
            </dd>
          </div>
        ))}
        {extras.map((row) => (
          <div key={row.label} className={styles.detailRow}>
            <dt className={styles.detailLabel}>{row.label}</dt>
            <dd className={styles.detailValue}>{row.value}</dd>
          </div>
        ))}
      </dl>
      {anyMissing ? (
        <p className={styles.muted}>
          Add these on the{" "}
          <Link className={styles.inlineLink} href={setupHref}>
            grade setup page
          </Link>
          , or upload your syllabus there to fill them in.
        </p>
      ) : null}
    </>
  );
}
