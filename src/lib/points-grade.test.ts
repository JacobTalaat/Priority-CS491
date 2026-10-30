import { describe, expect, it } from "vitest";
import type { GradeSetupPayload } from "@/lib/grade-setup";
import { calculateWeightedGrade, type GradeAssignment } from "@/lib/weighted-grade";
import { calculatePointsGrade } from "./points-grade";

function makeSetup(
  categories: GradeSetupPayload["categories"],
  assignmentMappings: GradeSetupPayload["assignmentMappings"],
): GradeSetupPayload {
  return { categories, assignmentMappings, finalExamWeight: 0, cutoffs: {}, classDetails: {} };
}

function makeAssignment(id: string, pointsPossible: number, score: number | null = null): GradeAssignment {
  return { id, pointsPossible, grade: score === null ? null : { score } };
}

describe("calculatePointsGrade", () => {
  it("sums points earned over points possible instead of averaging percentages", () => {
    expect(
      calculatePointsGrade([makeAssignment("a", 20, 18), makeAssignment("b", 30, 24), makeAssignment("c", 50, 40)]),
    ).toEqual({ status: "calculated", percentage: 82 });
  });

  it("excludes ungraded work from the denominator", () => {
    expect(calculatePointsGrade([makeAssignment("a", 10, 8), makeAssignment("b", 100)])).toEqual({
      status: "calculated",
      percentage: 80,
    });
  });

  it("ignores a graded score of null", () => {
    expect(
      calculatePointsGrade([makeAssignment("a", 10, 5), { id: "b", pointsPossible: 10, grade: { score: null } }]),
    ).toEqual({
      status: "calculated",
      percentage: 50,
    });
  });

  it("counts a graded zero score toward the grade", () => {
    expect(calculatePointsGrade([makeAssignment("a", 10, 0), makeAssignment("b", 10, 10)])).toEqual({
      status: "calculated",
      percentage: 50,
    });
  });

  it("returns insufficient data when nothing is graded", () => {
    expect(calculatePointsGrade([])).toEqual({ status: "insufficient-data" });
    expect(calculatePointsGrade([makeAssignment("a", 10)])).toEqual({ status: "insufficient-data" });
  });

  it("rounds away floating point drift", () => {
    expect(calculatePointsGrade([makeAssignment("a", 10, 10), makeAssignment("b", 90, 45)])).toEqual({
      status: "calculated",
      percentage: 55,
    });
  });

  it("excludes an ungraded zero point assignment such as a calendar feed placeholder", () => {
    expect(calculatePointsGrade([makeAssignment("a", 0), makeAssignment("b", 10, 6)])).toEqual({
      status: "calculated",
      percentage: 60,
    });
  });

  it("excludes a zero point assignment scored zero", () => {
    expect(calculatePointsGrade([makeAssignment("a", 0, 0), makeAssignment("b", 10, 6)])).toEqual({
      status: "calculated",
      percentage: 60,
    });
    expect(calculatePointsGrade([makeAssignment("a", 0, 0)])).toEqual({ status: "insufficient-data" });
  });

  it("adds a zero point assignment's positive score as pure bonus", () => {
    expect(calculatePointsGrade([makeAssignment("a", 0, 8), makeAssignment("b", 10, 6)])).toEqual({
      status: "calculated",
      percentage: 140,
    });
    expect(calculatePointsGrade([makeAssignment("a", 0, 8)])).toEqual({ status: "insufficient-data" });
  });

  it("treats a non-finite pointsPossible as a zero point assignment", () => {
    expect(calculatePointsGrade([makeAssignment("a", NaN, 0), makeAssignment("b", 10, 6)])).toEqual({
      status: "calculated",
      percentage: 60,
    });
  });

  it("treats a negative pointsPossible as a zero point assignment", () => {
    expect(calculatePointsGrade([makeAssignment("a", -5, 0), makeAssignment("b", 10, 6)])).toEqual({
      status: "calculated",
      percentage: 60,
    });
    expect(calculatePointsGrade([makeAssignment("a", -5, 3)])).toEqual({ status: "insufficient-data" });
  });

  it("returns unsupported for a negative score", () => {
    expect(calculatePointsGrade([makeAssignment("a", 100, -50)])).toEqual({
      status: "unsupported",
      reason: "negative-score",
    });
  });

  it("counts a score above pointsPossible as-is so the total can exceed 100", () => {
    expect(calculatePointsGrade([makeAssignment("a", 100, 105)])).toEqual({
      status: "calculated",
      percentage: 105,
    });
  });

  it("calculates one hundred for a full score", () => {
    expect(calculatePointsGrade([makeAssignment("a", 10, 10)])).toEqual({ status: "calculated", percentage: 100 });
  });

  it("returns unsupported when earned points overflow to a non-finite result", () => {
    expect(
      calculatePointsGrade([
        makeAssignment("a", Number.MAX_VALUE, Number.MAX_VALUE),
        makeAssignment("b", Number.MAX_VALUE, Number.MAX_VALUE),
      ]),
    ).toEqual({ status: "unsupported", reason: "non-finite-result" });
  });

  it("returns unsupported when possible points overflow to a non-finite result rather than reporting zero", () => {
    expect(
      calculatePointsGrade([
        makeAssignment("a", Number.MAX_VALUE, 0),
        makeAssignment("b", Number.MAX_VALUE, Number.MAX_VALUE),
      ]),
    ).toEqual({ status: "unsupported", reason: "non-finite-result" });
  });

  it("ignores a non-finite NaN score", () => {
    expect(calculatePointsGrade([makeAssignment("a", 10, NaN), makeAssignment("b", 10, 5)])).toEqual({
      status: "calculated",
      percentage: 50,
    });
  });

  it("agrees with the weighted engine on the same assignments", () => {
    const fixtures = [
      [makeAssignment("a", 20, 18), makeAssignment("b", 30, 24), makeAssignment("c", 50, 40)],
      [],
      [makeAssignment("a", 10)],
      [makeAssignment("a", 0), makeAssignment("b", 10, 6)],
      [makeAssignment("a", 0, 8), makeAssignment("b", 10, 6)],
      [makeAssignment("a", 100, -50)],
      [makeAssignment("a", 10, 11)],
      [makeAssignment("a", 0, 0), makeAssignment("b", 10, 6)],
      [makeAssignment("a", NaN, 0), makeAssignment("b", 10, 6)],
      [makeAssignment("a", 10, NaN), makeAssignment("b", 10, 5)],
      [{ id: "a", pointsPossible: 10, grade: { score: null } }, makeAssignment("b", 10, 5)],
      [makeAssignment("a", -5, 0), makeAssignment("b", 10, 6)],
      [makeAssignment("a", 10, 10), makeAssignment("b", 90, 45)],
      [makeAssignment("a", 10, Infinity), makeAssignment("b", 10, 5)],
    ];

    for (const assignments of fixtures) {
      const setup = makeSetup(
        [{ name: "All", weight: 100 }],
        assignments.map((assignment) => ({ assignmentId: assignment.id, category: "All" })),
      );
      expect(calculatePointsGrade(assignments)).toEqual(calculateWeightedGrade(setup, assignments));
    }
  });

  it("computes a grade from assignment rows shaped the way Prisma returns them", () => {
    const rows = [
      { id: "hw-1", pointsPossible: 20, grade: { score: 18 } },
      { id: "hw-2", pointsPossible: 30, grade: { score: 24 } },
      { id: "midterm", pointsPossible: 100, grade: { score: 72 } },
      { id: "final", pointsPossible: 200, grade: null },
      { id: "feed", pointsPossible: 0, grade: null },
    ];

    expect(calculatePointsGrade(rows)).toEqual({ status: "calculated", percentage: 76 });
  });
});
