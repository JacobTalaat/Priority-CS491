import { describe, expect, it } from "vitest";
import { withFinalExamCategory, type GradeSetupPayload } from "./grade-setup";
import { calculateWeightedGrade } from "./weighted-grade";

function setup(overrides: Partial<GradeSetupPayload> = {}): GradeSetupPayload {
  return {
    categories: [{ name: "Homework", weight: 70 }],
    assignmentMappings: [
      { assignmentId: "hw-1", category: "Homework" },
      { assignmentId: "final-1", category: "Homework" },
    ],
    finalExamWeight: 30,
    cutoffs: { A: 90 },
    classDetails: { finalExamAssignmentId: "final-1" },
    ...overrides,
  };
}

describe("withFinalExamCategory", () => {
  it("moves the picked final out of its mapped category into its own category", () => {
    expect(withFinalExamCategory(setup())).toEqual({
      categories: [
        { name: "Homework", weight: 70 },
        { name: "Final exam", weight: 30 },
      ],
      assignmentMappings: [
        { assignmentId: "hw-1", category: "Homework" },
        { assignmentId: "final-1", category: "Final exam" },
      ],
      finalExamWeight: 0,
      cutoffs: { A: 90 },
      classDetails: { finalExamAssignmentId: "final-1" },
    });
  });

  it("adds the weight to an existing Final Exam category instead of duplicating it", () => {
    const result = withFinalExamCategory(
      setup({
        categories: [
          { name: "Homework", weight: 60 },
          { name: "Final Exam", weight: 20 },
        ],
        finalExamWeight: 10,
      }),
    );
    expect(result.categories).toEqual([
      { name: "Homework", weight: 60 },
      { name: "Final Exam", weight: 30 },
    ]);
    expect(result.assignmentMappings).toEqual([
      { assignmentId: "hw-1", category: "Homework" },
      { assignmentId: "final-1", category: "Final Exam" },
    ]);
    expect(result.finalExamWeight).toBe(0);
  });

  it("leaves a setup alone when no final is picked", () => {
    const unchanged = setup({ classDetails: {} });
    expect(withFinalExamCategory(unchanged)).toEqual(unchanged);
  });

  it("leaves a setup alone when the pick is not among the mapped assignments", () => {
    const unchanged = setup({ classDetails: { finalExamAssignmentId: "other-1" } });
    expect(withFinalExamCategory(unchanged)).toEqual(unchanged);
  });

  it("leaves a setup alone when the final exam weight is 0", () => {
    const unchanged = setup({ finalExamWeight: 0 });
    expect(withFinalExamCategory(unchanged)).toEqual(unchanged);
  });

  it("never mutates the setup it is given", () => {
    const original = setup();
    const before = structuredClone(original);
    withFinalExamCategory(original);
    expect(original).toEqual(before);
  });
});

describe("withFinalExamCategory with a Final category that holds other work", () => {
  it("does not pool a final project with the final exam", () => {
    // Homework 50 (100%), a "Final" category holding a final project 20 (100%), and the
    // picked final exam worth 30 scored 0. The right grade is 70, not 75.
    const setup = {
      categories: [
        { name: "Homework", weight: 50 },
        { name: "Final", weight: 20 },
      ],
      assignmentMappings: [
        { assignmentId: "hw", category: "Homework" },
        { assignmentId: "project", category: "Final" },
        { assignmentId: "exam", category: "Homework" },
      ],
      finalExamWeight: 30,
      cutoffs: {},
      classDetails: { finalExamAssignmentId: "exam" },
    };
    const normalized = withFinalExamCategory(setup);
    const grade = calculateWeightedGrade(normalized, [
      { id: "hw", pointsPossible: 100, grade: { score: 100 } },
      { id: "project", pointsPossible: 100, grade: { score: 100 } },
      { id: "exam", pointsPossible: 100, grade: { score: 0 } },
    ]);

    expect(normalized.categories).toEqual([
      { name: "Homework", weight: 50 },
      { name: "Final", weight: 20 },
      { name: "Final exam", weight: 30 },
    ]);
    expect(grade).toEqual({ status: "calculated", percentage: 70 });
  });

  it("keeps category names unique when a busy Final exam category already exists", () => {
    const setup = {
      categories: [
        { name: "Homework", weight: 60 },
        { name: "Final Exam", weight: 10 },
      ],
      assignmentMappings: [
        { assignmentId: "hw", category: "Homework" },
        { assignmentId: "review", category: "Final Exam" },
        { assignmentId: "exam", category: "Homework" },
      ],
      finalExamWeight: 30,
      cutoffs: {},
      classDetails: { finalExamAssignmentId: "exam" },
    };
    expect(withFinalExamCategory(setup).categories.map((category) => category.name)).toEqual([
      "Homework",
      "Final Exam",
      "Final exam (picked)",
    ]);
  });
});
