import type { Metadata } from "next";
import Link from "next/link";
import styles from "./privacy.module.css";

export const metadata: Metadata = {
  title: "Privacy policy",
  description: "Learn what Priority collects, how it is used, and how to delete your account.",
};

export default function PrivacyPage() {
  return (
    <main className={styles.page}>
      <header className={styles.header}>
        <Link className={styles.wordmark} href="/" aria-label="Priority home">PRIORITY</Link>
        <Link className={styles.back} href="/">Back to Priority</Link>
      </header>

      <article className={styles.policy}>
        <p className={styles.eyebrow}>Your information</p>
        <h1>Privacy policy</h1>
        <p className={styles.updated}>Last updated: November 27, 2026</p>
        <p className={styles.intro}>
          Priority is a student project that helps you organize coursework. This page explains the information
          the website and its services handle, why they handle it, and what you can do about it.
        </p>

        <section>
          <h2>Information you provide or connect</h2>
          <ul>
            <li>
              <strong>Account information:</strong> your email address and account identifiers, handled by
              Supabase Auth so you can sign in and manage your account. Priority does not store your password.
            </li>
            <li>
              <strong>Canvas information:</strong> when you connect Canvas, Priority imports your current
              courses, assignment details, due dates, scores, and related class information to calculate grades
              and organize work. Your Canvas access token is encrypted before it is stored and is not shown
              back to your browser. You can disconnect Canvas in Settings to remove the saved token.
            </li>
            <li>
              <strong>Calendar feed:</strong> if you add a private Canvas calendar-feed link, Priority stores it
              encrypted and uses it to sync dates. You can remove the saved feed in Settings.
            </li>
            <li>
              <strong>Syllabus and grade setup:</strong> if you upload a syllabus PDF, Priority extracts and
              stores its text and file metadata; it does not retain the uploaded PDF. Grade categories,
              mappings, class details, and other setup choices you confirm are stored with your account.
            </li>
            <li>
              <strong>Settings and notifications:</strong> notification choices and reminder time are saved
              with your account. If you enable browser push notifications, Priority stores the browser
              subscription details needed to deliver them.
            </li>
          </ul>
        </section>

        <section>
          <h2>Questions, AI, and study data</h2>
          <p>
            When you ask a class question, Priority may send the question and relevant excerpts from your
            syllabus, Canvas assignments, grades, or saved class details to the AI service configured for the
            project (currently OpenRouter). Assignment excerpts can include scores. When Priority reads a
            syllabus, it sends extracted syllabus text for analysis. The AI service and any model provider it
            uses process that information to return an answer or suggestions. Their handling and retention are
            governed by their own policies; deleting your Priority account cannot delete copies they may retain.
          </p>
          <p>
            To evaluate the feature, Priority stores the text of questions that reach the answering step,
            whether an answer was found, the answer when found, its sources, the related course, and the time.
            This study log is linked to your account in Priority. Internal study exports use a hash in place of
            your account ID, but the hash is pseudonymous, not anonymous, and question text may identify you.
          </p>
          <p>
            Priority also records limited usage events such as opening the app, syncing classes, confirming a
            grade setup, or marking work done. These records contain an event name, whether it came from the
            web or app, and a timestamp—not free-text content.
          </p>
        </section>

        <section>
          <h2>How information is used and shared</h2>
          <p>
            Priority uses this information to authenticate you, sync your courses, calculate grades, rank open
            work, provide class answers, deliver notifications you enable, maintain the service, and evaluate
            the student project. Priority does not sell your information or use it to create advertising
            profiles.
          </p>
          <p>
            Information is sent to services needed for these features, including Supabase Auth, Canvas, the
            configured AI service and model provider, and push-notification delivery services when you enable
            notifications. These services process data under their own privacy and retention practices.
          </p>
        </section>

        <section>
          <h2>Storage, security, and retention</h2>
          <p>
            Account and coursework records are stored in Priority’s application database and associated with
            your account. Canvas credentials and private calendar-feed links are encrypted at rest by the
            application. Your signed-in browser keeps its session token in local browser storage; sign out to
            remove it from that browser.
          </p>
          <p>
            Priority keeps account data while your account is active. You can permanently delete your account
            from Settings after confirming your password. This removes your Priority account data, including
            coursework, saved settings, study logs, and notification registrations. Account deletion does not
            remove information already sent to Canvas, the AI service or model provider, or other external
            services; consult those services about their records.
          </p>
        </section>

        <section>
          <h2>Your choices and questions</h2>
          <p>
            You can disconnect Canvas, remove a calendar feed, change notification settings, sign out, or
            permanently delete your account in <Link href="/settings">Settings</Link>. You can also review
            Priority’s <Link href="https://github.com/JacobTalaat/Priority-CS491">project repository</Link>.
            For privacy questions or requests, contact the Priority team through the repository.
          </p>
        </section>

        <p className={styles.disclaimer}>
          Priority is an NJIT student capstone project. This policy describes the current app behavior; the
          services Priority connects to have their own terms and privacy policies.
        </p>
      </article>
    </main>
  );
}
