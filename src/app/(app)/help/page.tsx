import type { Metadata } from "next";
import Link from "next/link";
import { PageHeader } from "@/components/ui";
import styles from "./help.module.css";

export const metadata: Metadata = { title: "Help" };

export default function HelpPage() {
  return (
    <>
      <PageHeader
        eyebrow="Priority guide"
        title="Help"
        description="A quick guide to your work list, grade estimates, and Canvas connection."
      />

      <article className={styles.guide}>
        <section className={styles.section} aria-labelledby="ranking-heading">
          <h2 id="ranking-heading">How the ranking works</h2>
          <p>
            Today groups open assignments by due date, with overdue work in today’s group. Within the same
            due-date group, assignments that count for more of your grade come first. Work without a due
            date appears last, and assignments with an unknown grade share rank after items with a known share.
          </p>
          <p>
            Overdue work stays on the list for up to seven days. Submitted, graded, excused, and work you
            marked done is not treated as open work.
          </p>
        </section>

        <section className={styles.section} aria-labelledby="grading-heading">
          <h2 id="grading-heading">Grading rules Priority supports</h2>
          <p>
            Priority calculates grades from graded assignments only; ungraded work is not counted as a zero.
            A graded zero counts. Extra points above an assignment’s maximum are included as earned points.
          </p>
          <ul>
            <li>
              <strong>Points-based:</strong> total earned points divided by total possible points.
            </li>
            <li>
              <strong>Weighted categories:</strong> graded points are calculated within each category, then
              combined using the category weights you confirmed.
            </li>
          </ul>
          <p>
            Priority does not apply syllabus adjustments such as dropping the lowest score, curves, late
            penalties, or extra-credit policies. When the syllabus reader identifies an unsupported rule,
            Priority marks the grade unsupported rather than presenting an adjusted grade it cannot calculate.
          </p>
          <p>
            Review or update your class setup on the <Link href="/weights">Weights</Link> page.
          </p>
        </section>

        <section className={styles.section} aria-labelledby="canvas-heading">
          <h2 id="canvas-heading">Get a Canvas access token</h2>
          <p>
            In Canvas, open <strong>Account → Settings</strong>, choose <strong>Add New Access Token</strong>
            under Approved Integrations, give it a purpose and expiration date, and generate it. Copy it
            immediately; Canvas may only show it once. Keep the token private.
          </p>
          <p>
            Paste the token and your school’s Canvas URL in <Link href="/settings">Settings</Link>, then select
            Connect Canvas. For screenshots and more detail, see the{" "}
            <Link href="/settings/canvas-token-guide">step-by-step Canvas token guide</Link>. If your school
            does not allow you to create a token, contact its Canvas administrator.
          </p>
        </section>
      </article>
    </>
  );
}
