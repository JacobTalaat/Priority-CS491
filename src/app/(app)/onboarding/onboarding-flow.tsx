"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import type { FormEvent } from "react";
import { useRouter } from "next/navigation";
import { Button, ButtonLink, Input, Notice, PageHeader } from "@/components/ui";
import {
  DEFAULT_CANVAS_URL,
  canvasErrorMessage,
  connectCanvas,
  getCanvasStatus,
  syncNow,
  validateCanvasForm,
} from "@/lib/canvas-client";
import type { CanvasFormErrors, CanvasStatus } from "@/lib/canvas-client";
import { getGradeSetupCourses } from "@/lib/grade-setup-client";
import type { GradeSetupCourse } from "@/lib/grade-setup-client";
import styles from "./onboarding.module.css";

type OnboardingState =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ready"; canvas: CanvasStatus; courses: GradeSetupCourse[] };

type Message = { tone: "error" | "success"; text: string } | null;
type Busy = "connect" | "sync" | null;

async function loadOnboardingState(): Promise<OnboardingState> {
  const canvasResult = await getCanvasStatus();
  if (!canvasResult.ok) {
    return { status: "error", message: canvasErrorMessage(canvasResult) };
  }
  if (!canvasResult.data.connected) {
    return { status: "ready", canvas: canvasResult.data, courses: [] };
  }

  const coursesResult = await getGradeSetupCourses();
  if (!coursesResult.ok) {
    return { status: "error", message: canvasErrorMessage(coursesResult) };
  }
  return { status: "ready", canvas: canvasResult.data, courses: coursesResult.data.courses };
}

export function OnboardingFlow() {
  const router = useRouter();
  const [state, setState] = useState<OnboardingState>({ status: "loading" });
  const [canvasToken, setCanvasToken] = useState("");
  const [baseUrl, setBaseUrl] = useState(DEFAULT_CANVAS_URL);
  const [fieldErrors, setFieldErrors] = useState<CanvasFormErrors>({});
  const [message, setMessage] = useState<Message>(null);
  const [busy, setBusy] = useState<Busy>(null);

  const refresh = useCallback(async () => {
    const next = await loadOnboardingState();
    setState(next);
    return next;
  }, []);

  useEffect(() => {
    let cancelled = false;
    loadOnboardingState().then((next) => {
      if (!cancelled) {
        setState(next);
        if (next.status === "ready" && next.canvas.baseUrl) {
          setBaseUrl(next.canvas.baseUrl);
        }
      }
    });
    return () => {
      cancelled = true;
    };
  }, []);

  async function handleConnect(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setMessage(null);
    const errors = validateCanvasForm(canvasToken, baseUrl);
    setFieldErrors(errors);
    if (Object.keys(errors).length > 0) {
      return;
    }

    setBusy("connect");
    const result = await connectCanvas(canvasToken, baseUrl);
    if (!result.ok) {
      setMessage({ tone: "error", text: canvasErrorMessage(result) });
      setBusy(null);
      return;
    }
    setCanvasToken("");

    const syncResult = await syncNow();
    const next = await refresh();
    if (!syncResult.ok) {
      setMessage({ tone: "error", text: canvasErrorMessage(syncResult) });
    } else if (next.status === "error") {
      setMessage({ tone: "error", text: next.message });
    } else {
      setMessage({ tone: "success", text: `Connected to Canvas as ${result.data.canvasUser.name}.` });
    }
    setBusy(null);
  }

  async function handleSync() {
    setMessage(null);
    setBusy("sync");
    const result = await syncNow();
    const next = await refresh();
    if (!result.ok) {
      setMessage({ tone: "error", text: canvasErrorMessage(result) });
    } else if (next.status === "error") {
      setMessage({ tone: "error", text: next.message });
    } else {
      setMessage({ tone: "success", text: "Your Canvas classes are up to date." });
    }
    setBusy(null);
  }

  function updateField(field: keyof CanvasFormErrors, value: string) {
    if (field === "token") {
      setCanvasToken(value);
    } else {
      setBaseUrl(value);
    }
    setFieldErrors((current) => ({ ...current, [field]: undefined }));
  }

  const connected = state.status === "ready" && state.canvas.connected;
  const confirmedCourse =
    state.status === "ready" ? state.courses.find((course) => course.gradeSetup !== null) ?? null : null;
  const coursesToConfirm =
    state.status === "ready" ? state.courses.filter((course) => course.gradeSetup === null) : [];
  const completedSteps = Number(connected) + Number(confirmedCourse !== null);
  const activeStep = Math.min(completedSteps + 1, 3);

  return (
    <>
      <PageHeader
        eyebrow="A quick start"
        title="Your first three steps"
        description="Connect Canvas, confirm one class, and you’ll be ready to see what’s due today."
      />

      {state.status === "loading" ? (
        <p className={styles.status} role="status">Checking your setup…</p>
      ) : null}
      {state.status === "error" ? (
        <div className={styles.loadError}>
          <Notice tone="error">{state.message}</Notice>
          <Button variant="secondary" onClick={() => void refresh()}>Try again</Button>
        </div>
      ) : null}
      {message ? <Notice tone={message.tone}>{message.text}</Notice> : null}

      <section className={styles.progress} aria-labelledby="progress-heading">
        <div className={styles.progressHeader}>
          <h2 id="progress-heading">Setup progress</h2>
          <span>{completedSteps} of 3 complete</span>
        </div>
        <progress className={styles.progressBar} value={completedSteps} max={3} aria-label="Setup progress" />
        <ol className={styles.steps}>
          <li className={activeStep === 1 ? styles.activeStep : connected ? styles.completeStep : ""}>
            <span className={styles.stepNumber} aria-hidden="true">{connected ? "✓" : "1"}</span>
            <div className={styles.stepContent}>
              <h3>Connect Canvas</h3>
              <p>{connected ? "Your Canvas account is connected." : "Link your school account to import your classes."}</p>
              {!connected && state.status === "ready" ? (
                <form className={styles.form} onSubmit={handleConnect} noValidate>
                  <Input
                    label="Canvas access token"
                    name="canvasToken"
                    type="password"
                    autoComplete="off"
                    spellCheck={false}
                    value={canvasToken}
                    onChange={(event) => updateField("token", event.target.value)}
                    hint="In Canvas, open Account → Settings → New Access Token, then copy the token it shows."
                    error={fieldErrors.token}
                  />
                  <Input
                    label="Canvas address"
                    name="baseUrl"
                    type="url"
                    inputMode="url"
                    autoComplete="off"
                    spellCheck={false}
                    value={baseUrl}
                    onChange={(event) => updateField("baseUrl", event.target.value)}
                    error={fieldErrors.baseUrl}
                  />
                  <p className={styles.help}>
                    Need help? <Link href="/settings/canvas-token-guide">Follow the Canvas token guide</Link>.
                  </p>
                  <Button type="submit" loading={busy === "connect"} disabled={busy !== null}>
                    {busy === "connect" ? "Connecting and importing…" : "Connect Canvas"}
                  </Button>
                </form>
              ) : null}
            </div>
            <span className={styles.stepStatus}>{connected ? "Done" : activeStep === 1 ? "Next" : "Up next"}</span>
          </li>

          <li className={activeStep === 2 ? styles.activeStep : confirmedCourse ? styles.completeStep : ""}>
            <span className={styles.stepNumber} aria-hidden="true">{confirmedCourse ? "✓" : "2"}</span>
            <div className={styles.stepContent}>
              <h3>Confirm one class</h3>
              {confirmedCourse ? (
                <p>{confirmedCourse.name} is set up and confirmed.</p>
              ) : !connected ? (
                <p>Connect Canvas first to choose a class.</p>
              ) : state.status === "ready" && coursesToConfirm.length === 0 ? (
                <>
                  <p>No classes have been imported yet. Sync Canvas to find your current classes.</p>
                  <Button onClick={handleSync} loading={busy === "sync"} disabled={busy !== null}>
                    {busy === "sync" ? "Syncing classes…" : "Sync classes"}
                  </Button>
                </>
              ) : (
                <>
                  <p>Choose a class and confirm its grading setup.</p>
                  <ul className={styles.courseList}>
                    {coursesToConfirm.map((course) => (
                      <li key={course.id}>
                        <span>
                          <strong>{course.name}</strong>
                          {course.courseCode ? <small>{course.courseCode}</small> : null}
                        </span>
                        <ButtonLink
                          href={`/weights?course=${encodeURIComponent(course.id)}&onboarding=1`}
                          variant="secondary"
                        >
                          Confirm this class
                        </ButtonLink>
                      </li>
                    ))}
                  </ul>
                </>
              )}
            </div>
            <span className={styles.stepStatus}>
              {confirmedCourse ? "Done" : activeStep === 2 ? "Next" : "Up next"}
            </span>
          </li>

          <li className={activeStep === 3 ? styles.activeStep : ""}>
            <span className={styles.stepNumber} aria-hidden="true">3</span>
            <div className={styles.stepContent}>
              <h3>See Today</h3>
              <p>Open your Today list to see the assignments that need your attention.</p>
              {confirmedCourse ? (
                <Button onClick={() => router.replace("/today")}>Go to Today</Button>
              ) : (
                <p className={styles.muted}>Available after you confirm a class.</p>
              )}
            </div>
            <span className={styles.stepStatus}>{activeStep === 3 ? "Next" : "Up next"}</span>
          </li>
        </ol>
      </section>
    </>
  );
}
