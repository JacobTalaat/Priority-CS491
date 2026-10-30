import type { Metadata } from "next";
import Link from "next/link";
import styles from "./landing.module.css";

export const metadata: Metadata = {
  description:
    "Priority imports your Canvas classes, assignments, and grades, then shows you what to work on next.",
};

const imports = [
  {
    num: "01",
    source: "Courses",
    stores: "Name, course code, and term for the classes you are enrolled in now.",
    note: "Past terms are left out. Priority picks the term that started most recently.",
  },
  {
    num: "02",
    source: "Assignment groups",
    stores: "Group names and the weight your professor set in Canvas.",
    note: "A group with no weight stays unset, so it is never mistaken for zero.",
  },
  {
    num: "03",
    source: "Assignments",
    stores: "Title, due date, points possible, and the group it belongs to.",
    note: "Items worth no points are skipped. Items with no due date are kept and marked.",
  },
  {
    num: "04",
    source: "Grades",
    stores: "Your score and the date it was graded, for anything Canvas has graded.",
    note: "Ungraded and excused work is skipped rather than counted as a zero.",
  },
];

const steps = [
  {
    num: "01",
    title: "Connect Canvas",
    body: "Paste a Canvas access token in Settings. It is encrypted with AES-256-GCM before it is stored, it is never written to a log, and it is never sent back to the browser.",
  },
  {
    num: "02",
    title: "Set your weights",
    body: "Enter the categories from your syllabus and what each is worth. Where your professor already set group weights in Canvas, those are offered as the starting point.",
  },
  {
    num: "03",
    title: "Sync and see",
    body: "Press Sync now. Priority pulls your current classes, their assignments, and your grades, and tells you when it last checked.",
  },
];

export default function Home() {
  return (
    <div className={styles.page}>
      <header className={styles.bar}>
        <span className={styles.wordmark}>Priority</span>
        <nav className={styles.nav}>
          <div className={styles.navJumps}>
            <a href="#how">How it works ↓</a>
            <a href="#imports">Imports ↓</a>
            <a href="#build">Build ↓</a>
          </div>
          <Link href="/login" className={styles.textLink}>
            Log in
          </Link>
          <Link href="/signup" className={styles.primary}>
            Sign up
          </Link>
        </nav>
      </header>

      <main>
        <section className={styles.hero}>
          <div className={`${styles.labelRow} ${styles.up} ${styles.u1}`}>
            <span className={styles.microLabel}>NJIT Capstone · Priority</span>
            <span className={styles.status}>
              <span className={styles.dot} aria-hidden="true" />
              <span className={styles.statusLabel}>In development</span>
            </span>
          </div>
          <div className={styles.heroRule} />

          <h1 className={`${styles.display} ${styles.up} ${styles.u2}`}>
            <span>Every deadline</span>
            <span className={styles.displayTwo}>in order</span>
          </h1>

          <div className={styles.heroGrid}>
            <p className={`${styles.heroLead} ${styles.up} ${styles.u3}`}>
              Canvas tells you everything that is due. It will not tell you what to do first.
            </p>
            <p className={`${styles.heroBody} ${styles.up} ${styles.u3}`}>
              Priority reads your classes, assignments, and grades straight from Canvas, takes the
              grade weights from your syllabus, and works out which assignment actually moves your
              grade. One list, in the order that matters.
            </p>
            <div className={`${styles.heroLinks} ${styles.up} ${styles.u4}`}>
              <a href="https://github.com/JacobTalaat/Priority-CS491">GitHub ↗</a>
              <a href="#how">How it works ↓</a>
            </div>
          </div>
        </section>

        <div className={styles.jumps}>
          <a className={styles.jump} href="#how">
            <span className={styles.jumpNum}>01</span>
            <div className={styles.jumpTitle}>How it works</div>
            <div className={styles.jumpMeta}>Three steps, one token</div>
          </a>
          <a className={styles.jump} href="#imports">
            <span className={styles.jumpNum}>02</span>
            <div className={styles.jumpTitle}>What it imports</div>
            <div className={styles.jumpMeta}>Four kinds of Canvas data</div>
          </a>
          <a className={styles.jump} href="#weights">
            <span className={styles.jumpNum}>03</span>
            <div className={styles.jumpTitle}>Grade setup</div>
            <div className={styles.jumpMeta}>Categories and cutoffs</div>
          </a>
          <a className={styles.jump} href="#build">
            <span className={styles.jumpNum}>04</span>
            <div className={styles.jumpTitle}>Build</div>
            <div className={styles.jumpMeta}>Stack and status</div>
          </a>
        </div>

        <section className={styles.section} id="how">
          <div className={styles.sectionHead}>
            <span className={styles.sectionNum}>01</span>
            <h2 className={styles.sectionLabel}>How it works</h2>
          </div>
          <div className={styles.sectionRule} />
          <table className={styles.table}>
            <thead>
              <tr>
                <th scope="col" className={styles.colNum}>No.</th>
                <th scope="col">Step</th>
                <th scope="col">What happens</th>
              </tr>
            </thead>
            <tbody>
              {steps.map((step) => (
                <tr key={step.num}>
                  <td className={styles.colNum}>{step.num}</td>
                  <td>
                    <div className={styles.rowTitle}>{step.title}</div>
                  </td>
                  <td>{step.body}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>

        <section className={styles.section} id="imports">
          <div className={styles.sectionHead}>
            <span className={styles.sectionNum}>02</span>
            <h2 className={styles.sectionLabel}>What it imports</h2>
          </div>
          <div className={styles.sectionRule} />
          <div className={styles.statement}>
            <h3 className={styles.statementTitle}>Only this term, only what counts</h3>
            <div className={styles.statementBody}>
              <table className={styles.table}>
                <thead>
                  <tr>
                    <th scope="col" className={styles.colNum}>No.</th>
                    <th scope="col">From Canvas</th>
                    <th scope="col">Stored</th>
                    <th scope="col">Rule</th>
                  </tr>
                </thead>
                <tbody>
                  {imports.map((row) => (
                    <tr key={row.num}>
                      <td className={styles.colNum}>{row.num}</td>
                      <td>
                        <div className={styles.rowTitle}>{row.source}</div>
                      </td>
                      <td>{row.stores}</td>
                      <td className={styles.rowNote}>{row.note}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </section>

        <section className={styles.section} id="weights">
          <div className={styles.sectionHead}>
            <span className={styles.sectionNum}>03</span>
            <h2 className={styles.sectionLabel}>Grade setup</h2>
          </div>
          <div className={styles.sectionRule} />
          <div className={styles.specs}>
            <div className={styles.spec}>
              <span className={styles.microLabel}>Categories</span>
              <span className={styles.specValue}>Homework, labs, exams, whatever your syllabus uses</span>
            </div>
            <div className={styles.spec}>
              <span className={styles.microLabel}>Weights</span>
              <span className={styles.specValue}>Must total 100% with the final exam</span>
            </div>
            <div className={styles.spec}>
              <span className={styles.microLabel}>Mapping</span>
              <span className={styles.specValue}>Every assignment maps to exactly one category</span>
            </div>
            <div className={styles.spec}>
              <span className={styles.microLabel}>Cutoffs</span>
              <span className={styles.specValue}>The percentage each letter grade needs</span>
            </div>
            <div className={`${styles.spec} ${styles.specWide}`}>
              <span className={styles.microLabel}>Defaults</span>
              <span className={styles.specValue}>
                Where your professor set group weights in Canvas and they add up, Priority offers
                them as the starting point. Otherwise you enter them by hand.
              </span>
            </div>
            <div className={`${styles.spec} ${styles.specWide}`}>
              <span className={styles.microLabel}>No Canvas token</span>
              <span className={styles.specValue}>
                A read-only Canvas calendar feed link works as a fallback for due dates.
              </span>
            </div>
          </div>
        </section>

        <section className={styles.section} id="build">
          <div className={styles.sectionHead}>
            <span className={styles.sectionNum}>04</span>
            <h2 className={styles.sectionLabel}>Build</h2>
          </div>
          <div className={styles.sectionRule} />
          <div className={styles.statement}>
            <h3 className={styles.statementTitle}>Built in the open for a capstone</h3>
            <div className={styles.statementBody}>
              <div className={styles.specs}>
                <div className={styles.spec}>
                  <span className={styles.microLabel}>Web</span>
                  <span className={styles.specValue}>Next.js, React, TypeScript</span>
                </div>
                <div className={styles.spec}>
                  <span className={styles.microLabel}>Data</span>
                  <span className={styles.specValue}>PostgreSQL, Prisma</span>
                </div>
                <div className={styles.spec}>
                  <span className={styles.microLabel}>Accounts</span>
                  <span className={styles.specValue}>Supabase Auth, encrypted Canvas tokens</span>
                </div>
                <div className={styles.spec}>
                  <span className={styles.microLabel}>Import</span>
                  <span className={styles.specValue}>Canvas REST API, iCalendar feed</span>
                </div>
                <div className={styles.spec}>
                  <span className={styles.microLabel}>iOS</span>
                  <span className={styles.specValue}>Planned, not yet built</span>
                </div>
                <div className={styles.spec}>
                  <span className={styles.microLabel}>Source</span>
                  <span className={styles.specValue}>
                    <a href="https://github.com/JacobTalaat/Priority-CS491">GitHub ↗</a>
                  </span>
                </div>
              </div>

              <div className={styles.metaRows}>
                <div className={styles.metaRow}>
                  <span className={styles.microLabel}>Course</span>
                  <span className={styles.metaValue}>NJIT CS491 / CS490 Capstone</span>
                </div>
                <div className={styles.metaRow}>
                  <span className={styles.microLabel}>Team</span>
                  <span className={styles.metaValue}>Jacob Moawad, Omar Sabeha, Rana Khan</span>
                </div>
                <div className={styles.metaRow}>
                  <span className={styles.microLabel}>Hosted at</span>
                  <span className={styles.metaValue}>
                    <span className={styles.todo}>[ADD LIVE URL]</span>
                  </span>
                </div>
                <div className={styles.metaRow}>
                  <span className={styles.microLabel}>Privacy</span>
                  <span className={styles.metaValue}>
                    <span className={styles.todo}>[ADD PRIVACY POLICY]</span>
                  </span>
                </div>
              </div>
            </div>
          </div>
        </section>

        <section className={styles.close}>
          <div className={styles.closeText}>
            <h2 className={styles.closeTitle}>Stop guessing what is urgent</h2>
            <p className={styles.closeBody}>
              Connect Canvas once, enter your weights once, and let the list sort itself out from
              there. Your token stays encrypted and your grades stay yours.
            </p>
          </div>
          <div className={styles.closeActions}>
            <Link href="/signup" className={styles.primary}>
              Create an account
            </Link>
            <Link href="/login" className={styles.textLink}>
              Log in
            </Link>
          </div>
        </section>
      </main>

      <footer className={styles.footer}>
        <span className={styles.microLabel}>Priority · NJIT Capstone</span>
        <span className={styles.microLabel}>Imports Canvas. Stores your token encrypted.</span>
      </footer>
    </div>
  );
}
