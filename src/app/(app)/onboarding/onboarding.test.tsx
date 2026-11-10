// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  replace: vi.fn(),
  getCanvasStatus: vi.fn(),
  getGradeSetupCourses: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: mocks.replace }),
}));

vi.mock("@/lib/canvas-client", () => ({
  canvasErrorMessage: (result: { error: string }) => result.error,
  getCanvasStatus: mocks.getCanvasStatus,
}));

vi.mock("@/lib/grade-setup-client", () => ({
  getGradeSetupCourses: mocks.getGradeSetupCourses,
}));

import { Onboarding } from "./onboarding";

function classCourse(confirmed: boolean) {
  return {
    id: "course-1",
    name: "Algorithms",
    courseCode: "CS 341",
    term: "Fall",
    assignmentGroups: [],
    assignments: [],
    gradeSetup: confirmed
      ? {
          categories: [{ name: "Homework", weight: 100 }],
          assignmentMappings: [],
          finalExamWeight: 0,
          cutoffs: { A: 90, B: 80, C: 70, D: 60, F: 0 },
          classDetails: {},
          unsupportedRules: [],
          confirmedAt: "2026-11-07T12:00:00.000Z",
        }
      : null,
  };
}

describe("Onboarding", () => {
  let container: HTMLElement;
  let root: Root;

  beforeEach(() => {
    mocks.replace.mockReset();
    mocks.getCanvasStatus.mockReset().mockResolvedValue({ ok: true, data: { connected: true } });
    mocks.getGradeSetupCourses.mockReset().mockResolvedValue({ ok: true, data: { courses: [classCourse(false)] } });
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => {
      root.unmount();
    });
    container.remove();
  });

  async function renderOnboarding() {
    await act(async () => {
      root.render(<Onboarding />);
      await Promise.resolve();
      await Promise.resolve();
    });
  }

  it("shows setup progress and links to confirm a class’s grade setup", async () => {
    await renderOnboarding();

    expect(container.textContent).toContain("Step 2 of 3");
    expect(container.textContent).toContain("1 of 3 steps complete");
    expect(container.querySelector('a[href="/weights?from=onboarding&course=course-1"]')?.textContent).toBe(
      "Confirm a class",
    );
    expect(container.textContent).toContain("Confirm one class");
  });

  it("finishes on Today after a class setup has been confirmed", async () => {
    mocks.getGradeSetupCourses.mockResolvedValue({ ok: true, data: { courses: [classCourse(true)] } });
    await renderOnboarding();

    expect(container.textContent).toContain("2 of 3 steps complete");
    expect(container.textContent).toContain("Algorithms has a confirmed grade setup.");
    const finish = [...container.querySelectorAll("button")].find((button) =>
      button.textContent?.includes("Finish setup and see Today"),
    );
    expect(finish).not.toBeUndefined();
    await act(async () => finish?.click());
    expect(mocks.replace).toHaveBeenCalledWith("/today");
  });
});
