import { describe, expect, it } from "vitest";
import { calculateCourseGrade } from "./course-grade";

const SETUP = {
  categories: [
    { name: "Homework", weight: 30 },
    { name: "Exams", weight: 50 },
  ],
  assignmentMappings: [
    { assignmentId: "homework-1", category: "Homework" },
    { assignmentId: "exam-1", category: "Exams" },
  ],
  finalExamWeight: 20,
  cutoffs: { A: 90, B: 80 },
  classDetails: {},
};

describe("calculateCourseGrade", () => {
  it("calculates category percentages and normalizes the current grade over graded categories", () => {
    expect(
      calculateCourseGrade(SETUP, [
        { id: "homework-1", pointsPossible: 20, score: 18 },
        { id: "exam-1", pointsPossible: 100, score: 80 },
      ]),
    ).toEqual({
      supported: true,
      currentGrade: 83.75,
      categories: [
        { name: "Homework", weight: 30, grade: 90 },
        { name: "Exams", weight: 50, grade: 80 },
      ],
      message: null,
    });
  });

  it("excludes categories with no graded work from the current grade", () => {
    expect(
      calculateCourseGrade(SETUP, [
        { id: "homework-1", pointsPossible: 20, score: 18 },
        { id: "exam-1", pointsPossible: 100, score: null },
      ]),
    ).toMatchObject({
      supported: true,
      currentGrade: 90,
      categories: [
        { name: "Homework", grade: 90 },
        { name: "Exams", grade: null },
      ],
    });
  });

  it("reports an unsupported grade when setup is missing or assignments are unmapped", () => {
    expect(calculateCourseGrade(null, [])).toMatchObject({
      supported: false,
      currentGrade: null,
    });
    expect(
      calculateCourseGrade(SETUP, [
        { id: "homework-1", pointsPossible: 20, score: 18 },
        { id: "new-assignment", pointsPossible: 10, score: 9 },
      ]),
    ).toMatchObject({
      supported: false,
      message: "Update the confirmed setup to map every current assignment.",
    });
  });

  it("returns no current grade when there is no weighted graded work", () => {
    expect(
      calculateCourseGrade(SETUP, [
        { id: "homework-1", pointsPossible: 20, score: null },
        { id: "exam-1", pointsPossible: 100, score: null },
      ]),
    ).toMatchObject({
      supported: true,
      currentGrade: null,
      message: "No weighted graded work yet.",
    });
  });
});
