import { describe, expect, it } from "vitest";
import { parseGradeSetup, type GradeSetupPayload } from "@/lib/grade-setup";
import { calculateWeightedGrade, type GradeAssignment } from "./weighted-grade";

function makeSetup(
  categories: GradeSetupPayload["categories"],
  assignmentMappings: GradeSetupPayload["assignmentMappings"],
  finalExamWeight = 0,
): GradeSetupPayload {
  return { categories, assignmentMappings, finalExamWeight, cutoffs: {}, classDetails: {} };
}

function makeAssignment(id: string, pointsPossible: number, score: number | null = null): GradeAssignment {
  return { id, pointsPossible, grade: score === null ? null : { score } };
}

describe("calculateWeightedGrade", () => {
  it("calculates one graded category while other assigned categories are ungraded", () => {
    const setup = makeSetup(
      [{ name: "Homework", weight: 40 }, { name: "Exams", weight: 40 }],
      [{ assignmentId: "homework", category: "Homework" }, { assignmentId: "exam", category: "Exams" }],
      20,
    );

    expect(calculateWeightedGrade(setup, [makeAssignment("homework", 10, 8), makeAssignment("exam", 100)])).toEqual({
      status: "calculated",
      percentage: 80,
    });
  });

  it("combines graded categories using unequal weights", () => {
    const setup = makeSetup(
      [{ name: "Homework", weight: 20 }, { name: "Exams", weight: 60 }],
      [{ assignmentId: "homework", category: "Homework" }, { assignmentId: "exam", category: "Exams" }],
    );

    expect(calculateWeightedGrade(setup, [makeAssignment("homework", 100, 100), makeAssignment("exam", 100, 50)])).toEqual({
      status: "calculated",
      percentage: 62.5,
    });
  });

  it("includes a zero score when all categories are graded", () => {
    const setup = makeSetup(
      [{ name: "Homework", weight: 50 }, { name: "Exams", weight: 50 }],
      [{ assignmentId: "homework", category: "Homework" }, { assignmentId: "exam", category: "Exams" }],
    );

    expect(calculateWeightedGrade(setup, [makeAssignment("homework", 10, 0), makeAssignment("exam", 10, 10)])).toEqual({
      status: "calculated",
      percentage: 50,
    });
  });

  it("returns insufficient data when no assignments are graded", () => {
    const setup = makeSetup([{ name: "Homework", weight: 80 }], [{ assignmentId: "homework", category: "Homework" }], 20);

    expect(calculateWeightedGrade(setup, [makeAssignment("homework", 10)])).toEqual({ status: "insufficient-data" });
  });

  it("excludes an ungraded zero point assignment such as a calendar feed placeholder", () => {
    const setup = makeSetup(
      [{ name: "Homework", weight: 40 }, { name: "Exams", weight: 40 }],
      [{ assignmentId: "homework", category: "Homework" }, { assignmentId: "exam", category: "Exams" }],
    );

    expect(calculateWeightedGrade(setup, [makeAssignment("homework", 0), makeAssignment("exam", 10, 6)])).toEqual({
      status: "calculated",
      percentage: 60,
    });
  });

  it("excludes a zero point assignment scored zero", () => {
    const setup = makeSetup(
      [{ name: "Homework", weight: 40 }, { name: "Exams", weight: 40 }],
      [{ assignmentId: "homework", category: "Homework" }, { assignmentId: "exam", category: "Exams" }],
    );

    expect(calculateWeightedGrade(setup, [makeAssignment("homework", 0, 0), makeAssignment("exam", 10, 6)])).toEqual({
      status: "calculated",
      percentage: 60,
    });
  });

  it("returns unsupported when a zero point assignment carries a positive score", () => {
    const setup = makeSetup(
      [{ name: "Homework", weight: 40 }, { name: "Exams", weight: 40 }],
      [{ assignmentId: "homework", category: "Homework" }, { assignmentId: "exam", category: "Exams" }],
    );

    expect(calculateWeightedGrade(setup, [makeAssignment("homework", 0, 8), makeAssignment("exam", 10, 6)])).toEqual({
      status: "unsupported",
      reason: "extra-credit",
    });
  });

  it("returns unsupported for a negative score rather than flooring it at zero", () => {
    const setup = makeSetup([{ name: "Homework", weight: 100 }], [{ assignmentId: "homework", category: "Homework" }]);

    expect(calculateWeightedGrade(setup, [makeAssignment("homework", 100, -50)])).toEqual({
      status: "unsupported",
      reason: "negative-score",
    });
  });

  it("returns unsupported when category totals overflow to a non-finite result", () => {
    const setup = makeSetup([{ name: "Homework", weight: 100 }], [
      { assignmentId: "a", category: "Homework" },
      { assignmentId: "b", category: "Homework" },
    ]);

    expect(
      calculateWeightedGrade(setup, [
        makeAssignment("a", Number.MAX_VALUE, Number.MAX_VALUE),
        makeAssignment("b", Number.MAX_VALUE, Number.MAX_VALUE),
      ]),
    ).toEqual({ status: "unsupported", reason: "non-finite-result" });
  });

  it("rounds away floating point drift so cutoff comparisons are stable", () => {
    const setup = makeSetup([{ name: "Homework", weight: 100 }], [
      { assignmentId: "a", category: "Homework" },
      { assignmentId: "b", category: "Homework" },
    ]);

    expect(calculateWeightedGrade(setup, [makeAssignment("a", 10, 10), makeAssignment("b", 90, 45)])).toEqual({
      status: "calculated",
      percentage: 55,
    });
  });

  it("ignores a mapping for an assignment that does not exist", () => {
    const setup = makeSetup([{ name: "Homework", weight: 80 }], [{ assignmentId: "missing", category: "Homework" }], 20);

    expect(calculateWeightedGrade(setup, [])).toEqual({ status: "insufficient-data" });
  });

  it("ignores a mapping for a category that does not exist", () => {
    const setup = makeSetup([{ name: "Homework", weight: 80 }], [{ assignmentId: "homework", category: " homework " }], 20);

    expect(calculateWeightedGrade(setup, [makeAssignment("homework", 10, 10)])).toEqual({ status: "insufficient-data" });
  });

  it("returns unsupported when a graded assignment has extra credit", () => {
    const setup = makeSetup([{ name: "Homework", weight: 80 }], [{ assignmentId: "homework", category: "Homework" }], 20);

    expect(calculateWeightedGrade(setup, [makeAssignment("homework", 10, 11)])).toEqual({
      status: "unsupported",
      reason: "extra-credit",
    });
  });

  it("does not include a graded zero-weight category", () => {
    const setup = makeSetup(
      [{ name: "Homework", weight: 0 }, { name: "Exams", weight: 80 }],
      [{ assignmentId: "homework", category: "Homework" }, { assignmentId: "exam", category: "Exams" }],
    );

    expect(calculateWeightedGrade(setup, [makeAssignment("homework", 10, 0), makeAssignment("exam", 10, 9)])).toEqual({
      status: "calculated",
      percentage: 90,
    });
  });

  it("does not include the final exam weight", () => {
    const setup = makeSetup([{ name: "Homework", weight: 80 }], [{ assignmentId: "homework", category: "Homework" }], 20);

    expect(calculateWeightedGrade(setup, [makeAssignment("homework", 10, 10)])).toEqual({
      status: "calculated",
      percentage: 100,
    });
  });

  it("returns only finite percentages from zero to one hundred", () => {
    const setup = makeSetup(
      [{ name: "Homework", weight: 50 }, { name: "Exams", weight: 50 }],
      [{ assignmentId: "homework", category: "Homework" }, { assignmentId: "exam", category: "Exams" }],
    );
    const results = [
      calculateWeightedGrade(setup, [makeAssignment("homework", 10, 5), makeAssignment("exam", 10, 8)]),
      calculateWeightedGrade(setup, [makeAssignment("homework", 10, -5), makeAssignment("exam", 10, 8)]),
    ];

    for (const result of results) {
      if (result.status === "calculated") {
        expect(Number.isFinite(result.percentage)).toBe(true);
        expect(result.percentage).toBeGreaterThanOrEqual(0);
        expect(result.percentage).toBeLessThanOrEqual(100);
      }
    }
  });
});

describe("stored setup to engine handoff", () => {
  it("computes a grade from a CourseGradeSetup row shaped the way Prisma returns it", () => {
    const storedRow = {
      categories: [
        { name: "Homework", weight: 30 },
        { name: "Midterm", weight: 30 },
      ],
      assignmentMappings: [
        { assignmentId: "hw-1", category: "Homework" },
        { assignmentId: "hw-2", category: "Homework" },
        { assignmentId: "midterm", category: "Midterm" },
      ],
      finalExamWeight: 40,
      cutoffs: { A: 90, B: 80 },
      classDetails: { room: "GITC 1400", credits: 3 },
    };

    const parsed = parseGradeSetup(storedRow);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) {
      return;
    }

    const result = calculateWeightedGrade(parsed.data, [
      { id: "hw-1", pointsPossible: 20, grade: { score: 18 } },
      { id: "hw-2", pointsPossible: 30, grade: { score: 24 } },
      { id: "midterm", pointsPossible: 100, grade: { score: 72 } },
      { id: "final", pointsPossible: 200, grade: null },
    ]);

    expect(result).toEqual({ status: "calculated", percentage: 78 });
  });

  it("a malformed stored setup is rejected by the parser, never reaching the engine", () => {
    const parsed = parseGradeSetup({
      categories: [{ name: "Homework", weight: 30 }],
      assignmentMappings: [],
      finalExamWeight: 30,
      cutoffs: {},
      classDetails: {},
    });

    expect(parsed.ok).toBe(false);
  });
});
