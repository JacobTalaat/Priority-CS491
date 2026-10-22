import { describe, expect, it } from "vitest";
import { buildCategoryBreakdown, chooseGradeEngine, hasUsableCategoryWeights } from "./grade-engine";
import type { GradeSetupPayload } from "./grade-setup";
import type { GradeAssignment } from "./weighted-grade";

function setupPayload(overrides: Partial<GradeSetupPayload> = {}): GradeSetupPayload {
  return {
    categories: [{ name: "Homework", weight: 100 }],
    assignmentMappings: [{ assignmentId: "hw-1", category: "Homework" }],
    finalExamWeight: 0,
    cutoffs: { A: 90 },
    classDetails: { section: "002" },
    ...overrides,
  };
}

function assignment(id: string, pointsPossible: number, score: number | null): GradeAssignment {
  return { id, pointsPossible, grade: score === null ? null : { score } };
}

describe("hasUsableCategoryWeights", () => {
  it("is true when at least one category carries a positive weight", () => {
    expect(hasUsableCategoryWeights(setupPayload())).toBe(true);
  });

  it("is false when every weight is zero or unusable", () => {
    expect(
      hasUsableCategoryWeights(setupPayload({ categories: [{ name: "Homework", weight: 0 }] })),
    ).toBe(false);
  });
});

describe("chooseGradeEngine", () => {
  it("chooses weighted for a setup with usable category weights", () => {
    const setup = setupPayload();
    expect(chooseGradeEngine(setup)).toEqual({ engine: "weighted", setup });
  });

  it("chooses points when there is no confirmed setup", () => {
    expect(chooseGradeEngine(null)).toEqual({ engine: "points", setup: null });
  });

  it("chooses points when the confirmed setup has no usable category weights", () => {
    expect(
      chooseGradeEngine(setupPayload({ categories: [{ name: "Homework", weight: 0 }] })),
    ).toEqual({ engine: "points", setup: null });
  });
});

describe("buildCategoryBreakdown", () => {
  it("sums each category's graded work and composes back to the weighted overall", () => {
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
      assignment("hw-1", 50, 45),
      assignment("hw-2", 50, 36),
      assignment("exam-1", 150, 120),
    ];

    const breakdown = buildCategoryBreakdown(setup, assignments);

    expect(breakdown).toEqual([
      { category: "Homework", weight: 40, percentage: 81, pointsEarned: 81, pointsPossible: 100, gradedCount: 2, ungradedCount: 0 },
      { category: "Exams", weight: 60, percentage: 80, pointsEarned: 120, pointsPossible: 150, gradedCount: 1, ungradedCount: 0 },
    ]);

    // The overall weighted engine percentage must equal the same numbers
    // weighted through the category weights.
    const usable = breakdown.filter((entry) => entry.weight > 0 && entry.pointsPossible > 0);
    const overall =
      usable.reduce((total, entry) => total + (entry.pointsEarned / entry.pointsPossible) * 100 * entry.weight, 0) /
      usable.reduce((total, entry) => total + entry.weight, 0);
    expect(overall).toBe(80.4);
  });

  it("marks a category with nothing graded as null, not zero", () => {
    const setup = setupPayload({
      categories: [
        { name: "Homework", weight: 50 },
        { name: "Labs", weight: 50 },
      ],
      assignmentMappings: [
        { assignmentId: "hw-1", category: "Homework" },
        { assignmentId: "lab-1", category: "Labs" },
      ],
    });
    const assignments = [
      assignment("hw-1", 10, 0),
      assignment("lab-1", 10, null),
    ];

    const breakdown = buildCategoryBreakdown(setup, assignments);

    expect(breakdown).toEqual([
      { category: "Homework", weight: 50, percentage: 0, pointsEarned: 0, pointsPossible: 10, gradedCount: 1, ungradedCount: 0 },
      { category: "Labs", weight: 50, percentage: null, pointsEarned: 0, pointsPossible: 0, gradedCount: 0, ungradedCount: 1 },
    ]);
  });
});
