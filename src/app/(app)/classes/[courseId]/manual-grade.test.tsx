// @vitest-environment jsdom
import { act, type ReactElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { CourseDetailsResponse, CourseGradeResponse } from "@/lib/course-client";

const { mockSaveManualGrade } = vi.hoisted(() => ({
  mockSaveManualGrade: vi.fn(),
}));

vi.mock("@/lib/course-client", () => ({
  getCourseDetails: vi.fn(),
  getCourseGrade: vi.fn(),
  saveManualGrade: mockSaveManualGrade,
}));

import { ClassPageView } from "./class-page";

const details: CourseDetailsResponse = {
  course: { id: "course-1", name: "Algorithms", courseCode: "CS 341", term: "Fall 2026", termEndsAt: null },
  details: {
    instructor: null,
    section: null,
    credits: null,
    officeHours: null,
    latePolicy: null,
    contacts: null,
    confirmedAt: null,
  },
  assignments: [
    {
      id: "assignment-1",
      title: "Homework 1",
      dueAt: null,
      hasDueDate: false,
      pointsPossible: 20,
      htmlUrl: null,
      assignmentGroup: null,
      grade: null,
    },
  ],
};

const grade: CourseGradeResponse = {
  setupConfirmed: false,
  engine: "points",
  grade: { status: "insufficient-data" },
  breakdown: [],
  finalExam: { status: "no-final" },
  shares: [],
};

async function withMounted(element: ReactElement, test: (container: HTMLElement) => Promise<void>) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  const actEnvironment = globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean };
  const previousActEnvironment = actEnvironment.IS_REACT_ACT_ENVIRONMENT;
  actEnvironment.IS_REACT_ACT_ENVIRONMENT = true;
  try {
    await act(async () => {
      root.render(element);
    });
    await test(container);
  } finally {
    await act(async () => {
      root.unmount();
    });
    actEnvironment.IS_REACT_ACT_ENVIRONMENT = previousActEnvironment;
    container.remove();
  }
}

async function enterScore(input: HTMLInputElement, value: string) {
  await act(async () => {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
    setter?.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

describe("manual assignment grades", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it("saves the assignment score through the manual grades route and refreshes the class", async () => {
    mockSaveManualGrade.mockResolvedValue({
      ok: true,
      status: 200,
      data: { grade: { score: 18, gradedAt: "2026-10-20T12:00:00.000Z", isManual: true } },
    });
    const onGradeSaved = vi.fn().mockResolvedValue(undefined);

    await withMounted(
      <ClassPageView details={details} grade={{ ok: true, data: grade }} onGradeSaved={onGradeSaved} />,
      async (container) => {
        const input = container.querySelector('input[type="number"]');
        expect(input).not.toBeNull();
        expect((input as HTMLInputElement).type).toBe("number");
        expect((input as HTMLInputElement).max).toBe("20");
        await enterScore(input as HTMLInputElement, "18");

        const form = (input as HTMLInputElement).closest("form");
        if (!form) {
          throw new Error("Grade field is missing its save form");
        }
        await act(async () => {
          form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
        });

        expect(mockSaveManualGrade).toHaveBeenCalledWith("course-1", "assignment-1", 18);
        expect(onGradeSaved).toHaveBeenCalledOnce();
        expect(container.textContent).toContain("Grade saved.");
      },
    );
  });

  it("shows a route validation error without refreshing the class", async () => {
    mockSaveManualGrade.mockResolvedValue({
      ok: false,
      status: 400,
      error: "Enter a score of at most 20 points.",
    });
    const onGradeSaved = vi.fn();

    await withMounted(
      <ClassPageView details={details} grade={{ ok: true, data: grade }} onGradeSaved={onGradeSaved} />,
      async (container) => {
        const input = container.querySelector('input[type="number"]') as HTMLInputElement | null;
        expect(input).not.toBeNull();
        await enterScore(input!, "21");
        const form = input!.closest("form");
        if (!form) {
          throw new Error("Grade field is missing its save form");
        }
        await act(async () => {
          form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
        });

        expect(container.querySelector('[role="alert"]')?.textContent).toBe("Enter a score of at most 20 points.");
        expect(onGradeSaved).not.toHaveBeenCalled();
      },
    );
  });
});
