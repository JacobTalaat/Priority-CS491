// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  mockGetCanvasStatus: vi.fn(),
  mockGetGradeSetupCourses: vi.fn(),
  mockReplace: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: mocks.mockReplace }),
}));

vi.mock("@/lib/canvas-client", () => ({
  DEFAULT_CANVAS_URL: "https://njit.instructure.com",
  canvasErrorMessage: (result: { error: string }) => result.error,
  connectCanvas: vi.fn(),
  getCanvasStatus: mocks.mockGetCanvasStatus,
  syncNow: vi.fn(),
  validateCanvasForm: vi.fn(),
}));

vi.mock("@/lib/grade-setup-client", () => ({
  getGradeSetupCourses: mocks.mockGetGradeSetupCourses,
}));

import type { GradeSetupCourse } from "@/lib/grade-setup-client";
import { OnboardingFlow } from "./onboarding-flow";

const course: GradeSetupCourse = {
  id: "c1",
  name: "Algorithms",
  courseCode: "CS-341",
  term: "Fall 2026",
  assignmentGroups: [],
  assignments: [],
  gradeSetup: null,
};

let container: HTMLDivElement;
let root: ReturnType<typeof createRoot>;

beforeEach(() => {
  mocks.mockReplace.mockReset();
  mocks.mockGetCanvasStatus.mockReset();
  mocks.mockGetGradeSetupCourses.mockReset();
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
  const actEnvironment = globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean };
  actEnvironment.IS_REACT_ACT_ENVIRONMENT = true;
  await act(async () => {
    root.render(<OnboardingFlow />);
  });
}

describe("OnboardingFlow", () => {
  it("shows connect Canvas as the first step with zero progress", async () => {
    mocks.mockGetCanvasStatus.mockResolvedValue({
      ok: true,
      status: 200,
      data: { connected: false, baseUrl: null, checkedAt: null },
    });

    await renderOnboarding();

    expect(container.textContent).toContain("0 of 3 complete");
    expect(container.textContent).toContain("Connect Canvas");
    expect(container.querySelector("progress")?.value).toBe(0);
    expect(container.querySelector('input[name="canvasToken"]')).not.toBeNull();
  });

  it("shows one completed step and a confirmation link for an imported class", async () => {
    mocks.mockGetCanvasStatus.mockResolvedValue({
      ok: true,
      status: 200,
      data: { connected: true, baseUrl: "https://njit.instructure.com", checkedAt: null },
    });
    mocks.mockGetGradeSetupCourses.mockResolvedValue({
      ok: true,
      status: 200,
      data: { courses: [course] },
    });

    await renderOnboarding();

    expect(container.textContent).toContain("1 of 3 complete");
    expect(container.textContent).toContain("Confirm one class");
    expect(container.querySelector("progress")?.value).toBe(1);
    expect(container.querySelector('a[href="/weights?course=c1&onboarding=1"]')?.textContent).toBe(
      "Confirm this class",
    );
  });

  it("sends a student with a confirmed class to Today when they finish", async () => {
    mocks.mockGetCanvasStatus.mockResolvedValue({
      ok: true,
      status: 200,
      data: { connected: true, baseUrl: "https://njit.instructure.com", checkedAt: null },
    });
    mocks.mockGetGradeSetupCourses.mockResolvedValue({
      ok: true,
      status: 200,
      data: { courses: [{ ...course, gradeSetup: { confirmedAt: "2026-10-20T16:00:00Z" } }] },
    });

    await renderOnboarding();
    const finishButton = [...container.querySelectorAll("button")].find(
      (button) => button.textContent === "Go to Today",
    );
    expect(container.textContent).toContain("2 of 3 complete");
    expect(container.querySelector("progress")?.value).toBe(2);
    expect(finishButton).not.toBeUndefined();

    await act(async () => {
      finishButton?.click();
    });
    expect(mocks.mockReplace).toHaveBeenCalledWith("/today");
  });
});
