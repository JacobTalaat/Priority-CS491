import { describe, expect, it } from "vitest";
import type { GradeSetupPayload } from "@/lib/grade-setup";
import { categoryGradeSummaries } from "./course-grade-summary";

const setup: GradeSetupPayload = {
  categories: [
    { name: "Homework", weight: 60 },
    { name: "Exams", weight: 40 },
  ],
  assignmentMappings: [
    { assignmentId: "homework-1", category: "Homework" },
    { assignmentId: "exam-1", category: "Exams" },
  ],
  finalExamWeight: 0,
  cutoffs: {},
  classDetails: {},
};

describe("categoryGradeSummaries", () => {
  it("calculates per-category percentages from graded mapped assignments", () => {
    expect(
      categoryGradeSummaries(setup, [
        { id: "homework-1", pointsPossible: 100, grade: { score: 80 } },
        { id: "exam-1", pointsPossible: 50, grade: { score: 45 } },
      ]),
    ).toEqual([
      { name: "Homework", weight: 60, percentage: 80 },
      { name: "Exams", weight: 40, percentage: 90 },
    ]);
  });

  it("reports null percentages when a category has no valid graded work", () => {
    expect(
      categoryGradeSummaries(setup, [
        { id: "homework-1", pointsPossible: 100, grade: { score: null } },
        { id: "exam-1", pointsPossible: 0, grade: { score: 0 } },
      ]),
    ).toEqual([
      { name: "Homework", weight: 60, percentage: null },
      { name: "Exams", weight: 40, percentage: null },
    ]);
  });
});
