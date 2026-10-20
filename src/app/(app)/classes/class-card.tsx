import styles from "./classes.module.css";
import type { ClassCard as ClassCardData } from "@/lib/class-cards-client";

type ClassCardProps = { course: ClassCardData };

function formatGrade(course: ClassCardData) {
  return course.grade.status === "calculated"
    ? `${new Intl.NumberFormat("en-US", { maximumFractionDigits: 1 }).format(course.grade.percentage)}%`
    : "Unsupported";
}

function formatDueDate(value: string) {
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(new Date(value));
}

export function ClassCard({ course }: ClassCardProps) {
  const meta = [course.courseCode, course.term].filter(Boolean).join(" · ");

  return (
    <li className={styles.cardItem}>
      <article className={styles.card} aria-labelledby={`class-${course.id}`}>
        <header className={styles.cardHeader}>
          <div className={styles.cardTitleGroup}>
            <h2 className={styles.cardTitle} id={`class-${course.id}`}>{course.name}</h2>
            {meta ? <p className={styles.cardMeta}>{meta}</p> : null}
          </div>
          <span className={course.confirmed ? styles.confirmed : styles.unconfirmed}>
            {course.confirmed ? "Setup confirmed" : "Setup not confirmed"}
          </span>
        </header>

        <dl className={styles.cardDetails}>
          <div>
            <dt>Current grade</dt>
            <dd>{formatGrade(course)}</dd>
          </div>
          <div>
            <dt>Next due</dt>
            <dd>
              {course.nextDue ? (
                <>
                  {course.nextDue.title}
                  <time className={styles.dueDate} dateTime={course.nextDue.dueAt}>
                    {formatDueDate(course.nextDue.dueAt)}
                  </time>
                </>
              ) : (
                "No upcoming assignments"
              )}
            </dd>
          </div>
        </dl>
      </article>
    </li>
  );
}
