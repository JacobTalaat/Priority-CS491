import type { CourseGrade, GradeSetupCourse } from "@/lib/grade-setup-client";
import styles from "./classes.module.css";

type ClassCardData = GradeSetupCourse & { grade: CourseGrade };

export function ClassCards({
  courses,
  loadedAt,
}: {
  courses: ClassCardData[];
  loadedAt: number;
}) {
  return (
    <div className={styles.classGrid} aria-label="Current classes">
      {courses.map((course) => {
        const meta = [course.courseCode, course.term].filter(Boolean).join(" · ");
        const nextDue = course.assignments
          .map((assignment) => ({
            assignment,
            dueTime: assignment.dueAt ? Date.parse(assignment.dueAt) : Number.NaN,
          }))
          .filter(({ dueTime }) => Number.isFinite(dueTime) && dueTime > loadedAt)
          .sort((first, second) => first.dueTime - second.dueTime)[0];
        const gradeLabel = !course.grade.supported
          ? "Unsupported"
          : course.grade.currentGrade === null
            ? "No graded work yet"
            : `${course.grade.currentGrade.toFixed(1)}%`;
        return (
          <article className={styles.classCard} key={course.id}>
            <header>
              <h2 className={styles.courseName}>{course.name}</h2>
              <p className={styles.courseMeta}>{meta || "Imported from Canvas"}</p>
            </header>
            <dl className={styles.cardDetails}>
              <div className={styles.cardDetail}>
                <dt className={styles.detailLabel}>Current grade</dt>
                <dd className={styles.detailValue}>{gradeLabel}</dd>
              </div>
              <div className={styles.cardDetail}>
                <dt className={styles.detailLabel}>Next due</dt>
                <dd className={styles.detailValue}>
                  {nextDue ? (
                    <>
                      <span>{nextDue.assignment.title}</span>
                      <time dateTime={nextDue.assignment.dueAt ?? undefined}>
                        {new Intl.DateTimeFormat("en", { month: "short", day: "numeric" }).format(
                          new Date(nextDue.dueTime),
                        )}
                      </time>
                    </>
                  ) : (
                    "No upcoming items"
                  )}
                </dd>
              </div>
              <div className={styles.cardDetail}>
                <dt className={styles.detailLabel}>Grade setup</dt>
                <dd className={styles.detailValue}>
                  {course.gradeSetup ? "Confirmed" : "Not confirmed"}
                </dd>
              </div>
            </dl>
          </article>
        );
      })}
    </div>
  );
}
