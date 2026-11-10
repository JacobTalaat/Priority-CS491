"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Button, ButtonLink, Notice, PageHeader } from "@/components/ui";
import { canvasErrorMessage, getCanvasStatus } from "@/lib/canvas-client";
import { getGradeSetupCourses } from "@/lib/grade-setup-client";
import type { GradeSetupCourse } from "@/lib/grade-setup-client";
import styles from "./onboarding.module.css";

type OnboardingState =
  | { status: "loading" }
  | { status: "error"; message: string }
  | {
      status: "ready";
      canvasConnected: boolean;
      courses: GradeSetupCourse[];
    };

function setupError(message: string) {
  return { status: "error", message } as const;
}

export function Onboarding() {
  const router = useRouter();
  const [state, setState] = useState<OnboardingState>({ status: "loading" });

  const refresh = useCallback(async () => {
    setState({ status: "loading" });
    const [canvas, setups] = await Promise.all([getCanvasStatus(), getGradeSetupCourses()]);
    if (!canvas.ok) {
      setState(setupError(canvasErrorMessage(canvas)));
      return;
    }
    if (!setups.ok) {
      setState(setupError(setups.error));
      return;
    }
    setState({ status: "ready", canvasConnected: canvas.data.connected, courses: setups.data.courses });
  }, []);

  useEffect(() => {
    let cancelled = false;
    void Promise.resolve().then(() => {
      if (!cancelled) {
        void refresh();
      }
    });
    return () => {
      cancelled = true;
    };
  }, [refresh]);

  const canvasConnected = state.status === "ready" && state.canvasConnected;
  const confirmedCourse = state.status === "ready" ? state.courses.find((course) => course.gradeSetup) : undefined;
  const nextCourse = state.status === "ready" ? state.courses.find((course) => !course.gradeSetup) : undefined;
  const currentStep = !canvasConnected ? 1 : !confirmedCourse ? 2 : 3;
  const completedSteps = Number(canvasConnected) + Number(Boolean(confirmedCourse));

  return (
    <>
      <PageHeader
        eyebrow="Welcome to Priority"
        title="Your first three steps"
        description="Connect Canvas, confirm one class, and see what to work on today."
      />

      {state.status === "loading" ? (
        <p className={styles.status} role="status">Checking your setup…</p>
      ) : null}
      {state.status === "error" ? (
        <div className={styles.error}>
          <Notice tone="error">{state.message}</Notice>
          <Button variant="secondary" onClick={() => void refresh()}>Try again</Button>
        </div>
      ) : null}

      <section className={styles.progressSection} aria-label="Setup progress">
        <div className={styles.progressCopy}>
          <span>Step {currentStep} of 3</span>
          <span>{completedSteps} of 3 steps complete</span>
        </div>
        <progress className={styles.progress} value={completedSteps} max={3} aria-label="Setup progress" />
      </section>

      <ol className={styles.steps} aria-label="First run setup">
        <li className={canvasConnected ? styles.complete : styles.step}>
          <span className={styles.stepNumber} aria-hidden="true">{canvasConnected ? "✓" : "1"}</span>
          <div className={styles.stepBody}>
            <h2>Connect Canvas</h2>
            <p>{canvasConnected ? "Canvas is connected." : "Link your school account to import your classes."}</p>
            <ButtonLink href="/settings?from=onboarding" variant="secondary">
              {canvasConnected ? "Review Canvas settings" : "Connect Canvas"}
            </ButtonLink>
          </div>
          <span className={styles.stepStatus}>{canvasConnected ? "Complete" : "Next"}</span>
        </li>

        <li className={confirmedCourse ? styles.complete : styles.step}>
          <span className={styles.stepNumber} aria-hidden="true">{confirmedCourse ? "✓" : "2"}</span>
          <div className={styles.stepBody}>
            <h2>Confirm one class</h2>
            <p>
              {confirmedCourse
                ? `${confirmedCourse.name} has a confirmed grade setup.`
                : "Confirm a class’s grading setup so Priority can understand its assignments."}
            </p>
            {state.status === "ready" && !canvasConnected ? (
              <p className={styles.locked}>Connect Canvas first to continue.</p>
            ) : null}
            {state.status === "ready" && canvasConnected && state.courses.length === 0 ? (
              <p className={styles.locked}>
                No classes are imported yet. Sync Canvas in Settings, then come back here.
              </p>
            ) : null}
            {state.status === "ready" && canvasConnected && state.courses.length > 0 ? (
              <ButtonLink
                href={`/weights?from=onboarding${nextCourse ? `&course=${encodeURIComponent(nextCourse.id)}` : ""}`}
                variant="secondary"
              >
                {confirmedCourse ? "Review class setup" : "Confirm a class"}
              </ButtonLink>
            ) : null}
            {state.status === "ready" && canvasConnected && state.courses.length === 0 ? (
              <ButtonLink href="/settings?from=onboarding" variant="secondary">Go to Settings</ButtonLink>
            ) : null}
          </div>
          <span className={styles.stepStatus}>{confirmedCourse ? "Complete" : canvasConnected ? "Next" : "Waiting"}</span>
        </li>

        <li className={currentStep === 3 ? styles.step : styles.lockedStep}>
          <span className={styles.stepNumber} aria-hidden="true">3</span>
          <div className={styles.stepBody}>
            <h2>See Today</h2>
            <p>Your Today list puts the most important open work first.</p>
            {confirmedCourse ? (
              <Button onClick={() => router.replace("/today")}>Finish setup and see Today</Button>
            ) : (
              <p className={styles.locked}>Confirm one class to finish setup.</p>
            )}
          </div>
          <span className={styles.stepStatus}>{currentStep === 3 ? "Next" : "Waiting"}</span>
        </li>
      </ol>
    </>
  );
}
