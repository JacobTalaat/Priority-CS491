import { describe, expect, it } from "vitest";
import type { GradeSetupPayload } from "@/lib/grade-setup";
import { assignmentShares } from "./grade-share";
import type { GradeAssignment } from "@/lib/weighted-grade";

function setupPayload(overrides: Partial<GradeSetupPayload> = {}): GradeSetupPayload {
  return {
    categories: [{ name: "Homework", weight: 100 }],
    assignmentMappings: [{ assignmentId: "hw-1", category: "Homework" }],
    finalExamWeight: 0,
    cutoffs: {},
    classDetails: {},
    ...overrides,
  };
}

function assignment(id: string, pointsPossible: number, score: number | null = null): GradeAssignment {
  return { id, pointsPossible, grade: score === null ? null : { score } };
}

describe("weighted shares", () => {
  it("splits each category's weight across its mapped assignments by points", () => {
    const setup = setupPayload({
      categories: [
        { name: "Homework", weight: 40 },
        { name: "Exams", weight: 60 },
      ],
      assignmentMappings: [
        { assignmentId: "hw-1", category: "Homework" },
        { assignmentId: "hw-2", category: "Homework" },
        { assignmentId: "exam-1", category: "Exams" },
      ],
    });
    const assignments = [
      assignment("hw-1", 50),
      assignment("hw-2", 150),
      assignment("exam-1", 150),
    ];

    // Homework's category total is 50 + 150 = 200, so 50/200 * 40 = 10 and
    // 150/200 * 40 = 30; Exams: all of 60 = 60.
    expect(assignmentShares(setup, assignments)).toEqual([
      { assignmentId: "hw-1", share: 10, category: "Homework" },
      { assignmentId: "hw-2", share: 30, category: "Homework" },
      { assignmentId: "exam-1", share: 60, category: "Exams" },
    ]);
  });

  it("returns null for an assignment not mapped to a known category", () => {
    const setup = setupPayload({
      assignmentMappings: [{ assignmentId: "hw-1", category: "Homework" }],
    });
    const assignments = [assignment("hw-1", 50), assignment("hw-2", 50)];

    expect(assignmentShares(setup, assignments)).toEqual([
      { assignmentId: "hw-1", share: 100, category: "Homework" },
      { assignmentId: "hw-2", share: null, category: null },
    ]);
  });

  it("returns null for every assignment in a category whose weight is zero", () => {
    const setup = setupPayload({
      categories: [
        { name: "Homework", weight: 0 },
        { name: "Exams", weight: 100 },
      ],
      assignmentMappings: [
        { assignmentId: "hw-1", category: "Homework" },
        { assignmentId: "exam-1", category: "Exams" },
      ],
    });
    const assignments = [assignment("hw-1", 50), assignment("exam-1", 50)];

    expect(assignmentShares(setup, assignments)).toEqual([
      { assignmentId: "hw-1", share: null, category: "Homework" },
      { assignmentId: "exam-1", share: 100, category: "Exams" },
    ]);
  });

  it("gives a zero point assignment a 0 share, not null, and counts nothing toward the category total", () => {
    const setup = setupPayload({
      assignmentMappings: [
        { assignmentId: "hw-1", category: "Homework" },
        { assignmentId: "hw-2", category: "Homework" },
      ],
    });
    const assignments = [assignment("hw-1", 0), assignment("hw-2", 40)];

    expect(assignmentShares(setup, assignments)).toEqual([
      { assignmentId: "hw-1", share: 0, category: "Homework" },
      { assignmentId: "hw-2", share: 100, category: "Homework" },
    ]);
  });

  it("counts ungraded assignments in the category total, graded or not", () => {
    const setup = setupPayload({
      assignmentMappings: [
        { assignmentId: "hw-1", category: "Homework" },
        { assignmentId: "hw-2", category: "Homework" },
      ],
    });
    const assignments = [assignment("hw-1", 30, 30), assignment("hw-2", 90, null)];

    expect(assignmentShares(setup, assignments)).toEqual([
      { assignmentId: "hw-1", share: 25, category: "Homework" },
      { assignmentId: "hw-2", share: 75, category: "Homework" },
    ]);
  });

  it("returns every share as unknown when the final exam weight is held outside the categories", () => {
    // Homework 70 plus a final exam weight of 30 with the final mapped into Homework would
    // otherwise rank the final as 35% of the grade instead of 30%.
    const setup = setupPayload({
      categories: [{ name: "Homework", weight: 70 }],
      assignmentMappings: [
        { assignmentId: "hw-1", category: "Homework" },
        { assignmentId: "final", category: "Homework" },
      ],
      finalExamWeight: 30,
    });
    const assignments = [assignment("hw-1", 100), assignment("final", 100)];

    expect(assignmentShares(setup, assignments)).toEqual([
      { assignmentId: "hw-1", share: null, category: null },
      { assignmentId: "final", share: null, category: null },
    ]);
  });

  it("does not fall back to points shares when only the final exam carries weight", () => {
    const setup = setupPayload({
      categories: [{ name: "Homework", weight: 0 }],
      assignmentMappings: [{ assignmentId: "hw-1", category: "Homework" }],
      finalExamWeight: 100,
    });
    const assignments = [assignment("hw-1", 10), assignment("final", 10)];

    expect(assignmentShares(setup, assignments).map((share) => share.share)).toEqual([null, null]);
  });
});

describe("points shares", () => {
  it("splits points across the course by pointsPossible", () => {
    const assignments = [
      assignment("hw-1", 10),
      assignment("hw-2", 30),
      assignment("exam-1", 60),
    ];

    expect(assignmentShares(null, assignments)).toEqual([
      { assignmentId: "hw-1", share: 10, category: null },
      { assignmentId: "hw-2", share: 30, category: null },
      { assignmentId: "exam-1", share: 60, category: null },
    ]);
  });

  it("gives a zero point assignment a 0 share, not null", () => {
    const assignments = [assignment("hw-1", 0), assignment("hw-2", 40)];

    expect(assignmentShares(null, assignments)).toEqual([
      { assignmentId: "hw-1", share: 0, category: null },
      { assignmentId: "hw-2", share: 100, category: null },
    ]);
  });

  it("returns null shares when the course's assignments add up to no points", () => {
    const assignments = [assignment("hw-1", 0), assignment("hw-2", Number.NaN)];

    expect(assignmentShares(null, assignments)).toEqual([
      { assignmentId: "hw-1", share: null, category: null },
      { assignmentId: "hw-2", share: null, category: null },
    ]);
  });
});

describe("shares sum to the weighted course's category weights", () => {
  it("a fully mapped 100-weight course sums to 100 within rounding", () => {
    const setup = setupPayload({
      categories: [
        { name: "Homework", weight: 40 },
        { name: "Exams", weight: 60 },
      ],
      assignmentMappings: [
        { assignmentId: "hw-1", category: "Homework" },
        { assignmentId: "hw-2", category: "Homework" },
        { assignmentId: "exam-1", category: "Exams" },
        { assignmentId: "exam-2", category: "Exams" },
      ],
    });
    const assignments = [
      assignment("hw-1", 25),
      assignment("hw-2", 75),
      assignment("exam-1", 50),
      assignment("exam-2", 150),
    ];

    const total = assignmentShares(setup, assignments).reduce(
      (sum, entry) => sum + (entry.share ?? 0),
      0,
    );
    expect(total).toBeCloseTo(100, 9);
  });
});
