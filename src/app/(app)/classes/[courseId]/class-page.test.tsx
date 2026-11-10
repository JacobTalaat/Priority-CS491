import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { CourseDetailsResponse, CourseGradeResponse } from "@/lib/course-client";

const { mockUseShowGrades } = vi.hoisted(() => ({
  mockUseShowGrades: vi.fn(),
}));

vi.mock("@/lib/grades-visibility", () => ({
  useShowGrades: mockUseShowGrades,
}));

import { ClassPageView } from "./class-page";

const details: CourseDetailsResponse = {
  course: { id: "c1", name: "Algorithms", courseCode: "CS 341", term: "Fall 2026", termEndsAt: null },
  details: {
    instructor: "Dr. Ruiz",
    section: null,
    credits: 3,
    officeHours: "Tue 2-3 pm",
    latePolicy: null,
    contacts: "Sam Lee (TA) slee@njit.edu",
    confirmedAt: "2026-10-20T12:00:00.000Z",
  },
  assignments: [
    {
      id: "hw-1",
      title: "Homework 1",
      dueAt: "2026-10-12T03:59:00Z",
      hasDueDate: true,
      pointsPossible: 20,
      htmlUrl: null,
      assignmentGroup: { name: "Assignments" },
      grade: { score: 18, gradedAt: "2026-10-13T12:00:00.000Z" },
    },
    {
      id: "exam-1",
      title: "Midterm",
      dueAt: null,
      hasDueDate: false,
      pointsPossible: 100,
      htmlUrl: null,
      assignmentGroup: null,
      grade: null,
    },
  ],
};

const weightedGrade: CourseGradeResponse = {
  setupConfirmed: true,
  engine: "weighted",
  letter: null,
  grade: { status: "calculated", percentage: 90 },
  breakdown: [
    { category: "Homework", weight: 40, percentage: 90, pointsEarned: 18, pointsPossible: 20, gradedCount: 1, ungradedCount: 0 },
    { category: "Exams", weight: 60, percentage: null, pointsEarned: 0, pointsPossible: 0, gradedCount: 0, ungradedCount: 1 },
  ],
  finalExam: { status: "no-final" },
  shares: [
    { assignmentId: "hw-1", share: 40, category: "Homework" },
    { assignmentId: "exam-1", share: 60, category: "Exams" },
  ],
};

describe("ClassPageView", () => {
  beforeEach(() => {
    mockUseShowGrades.mockReset().mockReturnValue([true, () => {}]);
  });

  it("shows the grade and the breakdown by category", () => {
    const html = renderToStaticMarkup(<ClassPageView details={details} grade={{ ok: true, data: weightedGrade }} />);
    expect(html).toMatch(/<h1[^>]*>Algorithms<\/h1>/);
    expect(html).toContain("CS 341 · Fall 2026");
    expect(html).toContain("90%");
    expect(html).toContain("Weighted by the grade setup you confirmed.");
    expect(html).toContain('aria-label="Grade by category"');
    expect(html).toContain("90% · 18 of 20 points · 1 graded");
    expect(html).toContain("Nothing graded yet · 1 to go");
    expect(html).toContain("60% of grade");
  });

  it("lists assignments with their grades, using the confirmed category and share", () => {
    const html = renderToStaticMarkup(<ClassPageView details={details} grade={{ ok: true, data: weightedGrade }} />);
    expect(html).toContain("Due Sun, Oct 11 · Homework · Worth 40% of your grade");
    expect(html).toContain("18 / 20");
    expect(html).toContain("No due date · Exams · Worth 60% of your grade");
    expect(html).toContain("Not graded");
  });

  it("shows office hours, late policy, and contacts, marking what's missing", () => {
    const html = renderToStaticMarkup(<ClassPageView details={details} grade={{ ok: true, data: weightedGrade }} />);
    expect(html).toContain("Tue 2-3 pm");
    expect(html).toContain("Sam Lee (TA) slee@njit.edu");
    expect(html).toMatch(/Late policy<\/dt><dd[^>]*>Not added yet<\/dd>/);
    expect(html).toContain("Dr. Ruiz");
    expect(html).not.toContain("Section");
    expect(html).toContain('href="/weights?course=c1"');
  });

  it("asks for a confirmed setup instead of a breakdown on total points", () => {
    const pointsGrade: CourseGradeResponse = {
      ...weightedGrade,
      setupConfirmed: false,
      engine: "points",
      breakdown: [],
      shares: [
        { assignmentId: "hw-1", share: 16.6667, category: null },
        { assignmentId: "exam-1", share: 83.3333, category: null },
      ],
    };
    const html = renderToStaticMarkup(<ClassPageView details={details} grade={{ ok: true, data: pointsGrade }} />);
    expect(html).toContain("Based on total points until you confirm a grade setup.");
    expect(html).toContain("to see your grade broken down by category.");
    expect(html).not.toContain('aria-label="Grade by category"');
    // Without a confirmed category, the Canvas group still labels the assignment.
    expect(html).toContain("Due Sun, Oct 11 · Assignments · Worth 16.7% of your grade");
  });

  it("keeps the assignments and details when the grade can't be loaded", () => {
    const html = renderToStaticMarkup(
      <ClassPageView details={details} grade={{ ok: false, message: "Something went wrong (500). Try again." }} />,
    );
    expect(html).toContain('role="alert"');
    expect(html).toContain("Something went wrong (500). Try again.");
    expect(html).toContain("Homework 1");
    expect(html).toContain("Due Sun, Oct 11 · Assignments");
    expect(html).toContain("Tue 2-3 pm");
  });

  it("shows what's needed on the final for each letter", () => {
    const solved: CourseGradeResponse = {
      ...weightedGrade,
      finalExam: {
        status: "solved",
        otherWorkPending: true,
        results: [
          { letter: "A", status: "needed", score: 92, percent: 92 },
          { letter: "B", status: "needed", score: 71.5, percent: 71.5 },
          { letter: "C", status: "secured" },
        ],
      },
    };
    const html = renderToStaticMarkup(<ClassPageView details={details} grade={{ ok: true, data: solved }} />);
    expect(html).toMatch(/<h2[^>]*>Final exam<\/h2>/);
    expect(html).toContain('aria-label="What you need on the final"');
    expect(html).toContain("You need 92% on the final for an A if your other grades stay where they are.");
    expect(html).toContain("Need 71.5%");
    expect(html).toContain("Secured");
    expect(html).toContain("these numbers can move as those grades come in");
    expect(html).not.toContain("is out of reach");
  });

  it("warns clearly when an A is out of reach", () => {
    const outOfReach: CourseGradeResponse = {
      ...weightedGrade,
      finalExam: {
        status: "solved",
        otherWorkPending: false,
        results: [
          { letter: "A", status: "out-of-reach", best: 86.4 },
          { letter: "B", status: "needed", score: 55, percent: 55 },
        ],
      },
    };
    const html = renderToStaticMarkup(<ClassPageView details={details} grade={{ ok: true, data: outOfReach }} />);
    expect(html).toMatch(
      /role="status"[^>]*>.*An A is out of reach: a perfect final brings you to 86.4%. You need 55% on the final for a B./,
    );
    expect(html).toContain("Out of reach");
  });

  it("explains how to get the tool when no final is picked, with a link to the setup", () => {
    const html = renderToStaticMarkup(<ClassPageView details={details} grade={{ ok: true, data: weightedGrade }} />);
    expect(html).toContain("If your final is a Canvas assignment, pick it in the grade setup to see the score you need on it.");
    expect(html).toMatch(/<a[^>]*href="\/weights\?course=c1"[^>]*>Open the grade setup<\/a>/);
  });

  it("leaves the final exam section out when the grade can't load", () => {
    const html = renderToStaticMarkup(<ClassPageView details={details} grade={{ ok: false, message: "Boom" }} />);
    expect(html).not.toContain(">Final exam</h2>");
  });

  it("shows the letter next to the overall percentage when the grade carries one", () => {
    const html = renderToStaticMarkup(
      <ClassPageView details={details} grade={{ ok: true, data: { ...weightedGrade, letter: "A-" } }} />,
    );
    expect(html).toContain(">90%</span>");
    expect(html).toContain(">A-</span>");
  });

  it("hides every grade figure while grades are hidden, keeping the weights", () => {
    mockUseShowGrades.mockReturnValue([false, () => {}]);
    const solved: CourseGradeResponse = {
      ...weightedGrade,
      letter: "A-",
      finalExam: {
        status: "solved",
        otherWorkPending: true,
        results: [{ letter: "A", status: "needed", score: 92, percent: 92 }],
      },
    };
    const html = renderToStaticMarkup(<ClassPageView details={details} grade={{ ok: true, data: solved }} />);
    expect(html).toContain("Grade hidden");
    // The figures: the overall percentage and letter, the per-category numbers,
    // the needed final scores and each assignment's score.
    expect(html).not.toContain("90%");
    expect(html).not.toContain("A-");
    expect(html).not.toContain("90% · 18 of 20 points");
    expect(html).not.toContain("You need 92% on the final");
    expect(html).not.toContain("18 / 20");
    // Weights and shares are setup, not grades, so they stay.
    expect(html).toContain("60% of grade");
    expect(html).toContain("Worth 40% of your grade");
    // The toggle is offered in the header, next to Grade setup, pressed while hidden.
    expect(html).toContain("Show grades");
    expect(html).toContain('aria-pressed="true"');
    expect(html).toContain('href="/weights?course=c1"');
  });
});
