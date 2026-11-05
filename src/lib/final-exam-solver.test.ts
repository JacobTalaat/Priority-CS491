import { describe, expect, it } from "vitest";
import { calculatePointsGrade } from "@/lib/points-grade";
import { calculateWeightedGrade, type GradeAssignment } from "@/lib/weighted-grade";
import type { GradeEngineChoice } from "./grade-engine";
import type { GradeSetupPayload } from "./grade-setup";
import {
  describeFinalExamResult,
  readFinalExamAssignmentId,
  solveFinalExam,
  type FinalExamInput,
  type FinalExamResult,
} from "./final-exam-solver";

function makeSetup(
  categories: GradeSetupPayload["categories"],
  assignmentMappings: GradeSetupPayload["assignmentMappings"],
): GradeSetupPayload {
  return { categories, assignmentMappings, finalExamWeight: 0, cutoffs: {}, classDetails: {} };
}

function makeAssignment(id: string, pointsPossible: number, score: number | null = null): GradeAssignment {
  return { id, pointsPossible, grade: score === null ? null : { score } };
}

function solve(
  choice: GradeEngineChoice,
  assignments: GradeAssignment[],
  finalAssignmentId: string | null,
  cutoffs: Record<string, number>,
  finalExamWeight = 0,
) {
  return solveFinalExam({ choice, assignments, finalAssignmentId, cutoffs, finalExamWeight } satisfies FinalExamInput);
}

function needed(result: FinalExamResult, letter: string): { score: number; percent: number } {
  if (result.status !== "solved") {
    throw new Error(`expected the final exam solve to succeed, got ${result.status}`);
  }
  const entry = result.results.find((candidate) => candidate.letter === letter);
  if (!entry || entry.status !== "needed") {
    throw new Error(`expected a needed score for ${letter}, got ${JSON.stringify(entry)}`);
  }
  return { score: entry.score, percent: entry.percent };
}

// Feeds a hypothetical final score back through the real engine, the same way
// the solver does, so tests can check that a reported score truly reaches the
// cutoff.
function gradeWithFinalScore(
  choice: GradeEngineChoice,
  assignments: GradeAssignment[],
  finalId: string,
  score: number,
): number | null {
  const hypothetical = assignments.map((assignment) =>
    assignment.id === finalId ? { ...assignment, grade: { score } } : assignment,
  );
  const grade =
    choice.engine === "weighted"
      ? calculateWeightedGrade(choice.setup, hypothetical)
      : calculatePointsGrade(hypothetical);
  return grade.status === "calculated" ? grade.percentage : null;
}

// Homework: 80/100 = 80%. Final exam: its own category worth 60%. The overall
// grade is 32 + 0.6x, so A=90 needs x = 96.67, B=80 needs x = 80, and C=70
// needs x = 63.33.
const weightedSetup = makeSetup(
  [
    { name: "Homework", weight: 40 },
    { name: "Final Exam", weight: 60 },
  ],
  [
    { assignmentId: "hw-1", category: "Homework" },
    { assignmentId: "final-1", category: "Final Exam" },
  ],
);
const weightedChoice: GradeEngineChoice = { engine: "weighted", setup: weightedSetup };
const weightedAssignments = [makeAssignment("hw-1", 100, 80), makeAssignment("final-1", 100)];

describe("solveFinalExam", () => {
  it("solves a weighted course where the final is its own category", () => {
    const result = solve(weightedChoice, weightedAssignments, "final-1", { A: 90, B: 80, C: 70 });

    expect(result.status).toBe("solved");
    if (result.status !== "solved") {
      return;
    }
    // The percentages line up with 32 + 0.6 x, rounded up.
    expect(needed(result, "A").percent).toBeCloseTo(96.7, 1);
    expect(needed(result, "B").percent).toBe(80);
    expect(needed(result, "C").percent).toBeCloseTo(63.4, 1);
    expect(needed(result, "A").score).toBeGreaterThan(needed(result, "B").score);
    expect(needed(result, "B").score).toBeGreaterThan(needed(result, "C").score);
    // Every reported score truly reaches its cutoff, one bisection step
    // below does not, and neither does a shorter final.
    for (const [letter, cutoff] of [
      ["A", 90],
      ["B", 80],
      ["C", 70],
    ] as const) {
      const { score } = needed(result, letter);
      expect(gradeWithFinalScore(weightedChoice, weightedAssignments, "final-1", score)).toBeGreaterThanOrEqual(cutoff);
      expect(gradeWithFinalScore(weightedChoice, weightedAssignments, "final-1", score - 0.02)).toBeLessThan(cutoff);
    }
  });

  it("solves a points-based course with no setup", () => {
    // 27 of 30 points earned elsewhere; the final is 100 of the 130 total
    // points, so A=90 needs x = 90, B=80 needs x = 77, and C=70 needs x = 64.
    const assignments = [makeAssignment("hw-1", 30, 27), makeAssignment("final-1", 100)];
    const result = solve({ engine: "points", setup: null }, assignments, "final-1", { A: 90, B: 80, C: 70 });

    expect(result).toEqual({
      status: "solved",
      results: [
        { letter: "A", status: "needed", score: 90, percent: 90 },
        { letter: "B", status: "needed", score: 77, percent: 77 },
        { letter: "C", status: "needed", score: 64, percent: 64 },
      ],
      otherWorkPending: false,
    });
  });

  it("reports a letter a 0 on the final still reaches as secured", () => {
    // Homework: 100%. The overall grade is 60 + 0.4x, so C=50 is already met.
    const setup = makeSetup(
      [
        { name: "Homework", weight: 60 },
        { name: "Final Exam", weight: 40 },
      ],
      [
        { assignmentId: "hw-1", category: "Homework" },
        { assignmentId: "final-1", category: "Final Exam" },
      ],
    );
    const assignments = [makeAssignment("hw-1", 100, 100), makeAssignment("final-1", 100)];
    const result = solve({ engine: "weighted", setup }, assignments, "final-1", { A: 90, C: 50 });

    expect(result).toEqual({
      status: "solved",
      results: [
        { letter: "A", status: "needed", score: 75, percent: 75 },
        { letter: "C", status: "secured" },
      ],
      otherWorkPending: false,
    });
  });

  it("reports an out-of-reach letter with the grade a perfect final brings", () => {
    // Homework: 50%. The overall grade is 25 + 0.5x, topping out at 75: an A
    // can never happen, and B=70 needs exactly 90 points.
    const setup = makeSetup(
      [
        { name: "Homework", weight: 50 },
        { name: "Final Exam", weight: 50 },
      ],
      [
        { assignmentId: "hw-1", category: "Homework" },
        { assignmentId: "final-1", category: "Final Exam" },
      ],
    );
    const assignments = [makeAssignment("hw-1", 100, 50), makeAssignment("final-1", 100)];
    const result = solve({ engine: "weighted", setup }, assignments, "final-1", { A: 90, B: 70 });

    expect(result).toEqual({
      status: "solved",
      results: [
        { letter: "A", status: "out-of-reach", best: 75 },
        { letter: "B", status: "needed", score: 90, percent: 90 },
      ],
      otherWorkPending: false,
    });
  });

  it("rounds a needed score up so entering it exactly can never miss", () => {
    // Homework: 80%. The overall grade is 40 + 0.5x. The A needs the entire
    // final, exactly 100 points; the B needs exactly 80. Rounding the
    // bisection window up must not overshoot an exact threshold.
    const setup = makeSetup(
      [
        { name: "Homework", weight: 50 },
        { name: "Final Exam", weight: 50 },
      ],
      [
        { assignmentId: "hw-1", category: "Homework" },
        { assignmentId: "final-1", category: "Final Exam" },
      ],
    );
    const assignments = [makeAssignment("hw-1", 100, 80), makeAssignment("final-1", 100)];
    const result = solve({ engine: "weighted", setup }, assignments, "final-1", { A: 90, B: 80 });

    expect(result).toEqual({
      status: "solved",
      results: [
        { letter: "A", status: "needed", score: 100, percent: 100 },
        { letter: "B", status: "needed", score: 80, percent: 80 },
      ],
      otherWorkPending: false,
    });
  });

  it("produces a needed score that reaches the cutoff when fed back to the engine", () => {
    const { score } = needed(solve(weightedChoice, weightedAssignments, "final-1", { B: 80 }), "B");

    expect(gradeWithFinalScore(weightedChoice, weightedAssignments, "final-1", score)).toBeGreaterThanOrEqual(80);
    expect(gradeWithFinalScore(weightedChoice, weightedAssignments, "final-1", score - 0.02)).toBeLessThan(80);
  });

  it("skips a letter the setup does not define", () => {
    const result = solve(weightedChoice, weightedAssignments, "final-1", { A: 90, D: 60 });

    expect(result).toEqual({
      status: "solved",
      results: [{ letter: "A", status: "needed", score: 96.67, percent: 96.7 }],
      otherWorkPending: false,
    });
  });

  it("solves to an empty list when the setup defines no letters", () => {
    expect(solve(weightedChoice, weightedAssignments, "final-1", {})).toEqual({
      status: "solved",
      results: [],
      otherWorkPending: false,
    });
  });

  it("reports no-final when no final is picked", () => {
    expect(solve(weightedChoice, weightedAssignments, null, { A: 90 })).toEqual({ status: "no-final" });
  });

  it("reports no-final when the picked id matches none of the assignments", () => {
    expect(solve(weightedChoice, weightedAssignments, "final-9", { A: 90 })).toEqual({ status: "no-final" });
  });

  it("reports final-not-gradable when the final carries no gradable points", () => {
    expect(
      solve(weightedChoice, [makeAssignment("hw-1", 100, 80), makeAssignment("final-1", 0)], "final-1", { A: 90 }),
    ).toEqual({ status: "final-not-gradable" });
    expect(
      solve(weightedChoice, [makeAssignment("hw-1", 100, 80), makeAssignment("final-1", Infinity)], "final-1", { A: 90 }),
    ).toEqual({ status: "final-not-gradable" });
  });

  it("reports already-graded instead of overriding the real final score", () => {
    const graded = [makeAssignment("hw-1", 100, 80), makeAssignment("final-1", 100, 55)];
    expect(solve(weightedChoice, graded, "final-1", { A: 90 })).toEqual({ status: "already-graded" });
  });

  it("reports secured when extra credit elsewhere has already reached the cutoff", () => {
    // Homework: 21 of 10, 210%. The overall grade is 126 + 0.4x, so an A=90 is
    // met even with a 0 on the final, and a B=130 still needs a little more.
    const setup = makeSetup(
      [
        { name: "Homework", weight: 60 },
        { name: "Final Exam", weight: 40 },
      ],
      [
        { assignmentId: "hw-1", category: "Homework" },
        { assignmentId: "final-1", category: "Final Exam" },
      ],
    );
    const assignments = [makeAssignment("hw-1", 10, 21), makeAssignment("final-1", 100)];
    const result = solve({ engine: "weighted", setup }, assignments, "final-1", { A: 90, B: 130 });

    expect(result).toEqual({
      status: "solved",
      results: [
        { letter: "A", status: "secured" },
        { letter: "B", status: "needed", score: 10, percent: 10 },
      ],
      otherWorkPending: false,
    });
  });

  it("reports unknown when the engine cannot answer even with a perfect final", () => {
    // The homework's stored score is negative, so the engine refuses the
    // course no matter what the final scores.
    const setup = makeSetup([{ name: "Homework", weight: 100 }], [
      { assignmentId: "hw-1", category: "Homework" },
      { assignmentId: "final-1", category: "Homework" },
    ]);
    const assignments = [makeAssignment("hw-1", 10, -50), makeAssignment("final-1", 100)];
    expect(solve({ engine: "weighted", setup }, assignments, "final-1", { A: 90 })).toEqual({
      status: "solved",
      results: [{ letter: "A", status: "unknown" }],
      otherWorkPending: false,
    });
  });

  it("reports final-not-counted when the final sits in a zero-weight category", () => {
    const setup = makeSetup(
      [
        { name: "Homework", weight: 100 },
        { name: "Final Exam", weight: 0 },
      ],
      [
        { assignmentId: "hw-1", category: "Homework" },
        { assignmentId: "final-1", category: "Final Exam" },
      ],
    );
    const assignments = [makeAssignment("hw-1", 100), makeAssignment("final-1", 100)];
    expect(solve({ engine: "weighted", setup }, assignments, "final-1", { A: 90 })).toEqual({ status: "final-not-counted" });
  });

  it("reads the picked final assignment id defensively", () => {
    const setup: GradeSetupPayload = { ...weightedSetup, classDetails: { finalExamAssignmentId: "final-1" } };
    expect(readFinalExamAssignmentId(setup)).toBe("final-1");
    expect(readFinalExamAssignmentId(null)).toBeNull();
    expect(readFinalExamAssignmentId({ ...setup, classDetails: { finalExamAssignmentId: null } })).toBeNull();
    expect(readFinalExamAssignmentId({ ...setup, classDetails: { finalExamAssignmentId: 123 } })).toBeNull();
    expect(readFinalExamAssignmentId({ ...setup, classDetails: { finalExamAssignmentId: "" } })).toBeNull();
  });
});

describe("describeFinalExamResult", () => {
  it("speaks plainly for every letter status", () => {
    expect(describeFinalExamResult({ letter: "B", status: "needed", score: 78.51, percent: 78.5 })).toBe(
      "You need 78.5% on the final for a B.",
    );
    expect(describeFinalExamResult({ letter: "B", status: "secured" })).toBe(
      "You have a B secured even with a 0 on the final.",
    );
    expect(describeFinalExamResult({ letter: "A", status: "out-of-reach", best: 87.2 })).toBe(
      "An A is out of reach: a perfect final brings you to 87.2%.",
    );
    expect(describeFinalExamResult({ letter: "A", status: "unknown" })).toBe(
      "We can't tell yet what you would need on the final for an A.",
    );
  });

  it("uses the right article for letter labels that start with a vowel", () => {
    expect(describeFinalExamResult({ letter: "A", status: "secured" })).toBe(
      "You have an A secured even with a 0 on the final.",
    );
    expect(describeFinalExamResult({ letter: "A", status: "needed", score: 96.67, percent: 96.7 })).toBe(
      "You need 96.7% on the final for an A.",
    );
  });

  it("drops a trailing decimal from whole percentages", () => {
    expect(describeFinalExamResult({ letter: "C", status: "needed", score: 48.01, percent: 48 })).toBe(
      "You need 48% on the final for a C.",
    );
  });

  it("speaks plainly for the course-level statuses", () => {
    expect(describeFinalExamResult({ status: "no-final" })).toBe(
      "Pick which assignment is the final exam for this class to see what you need on it.",
    );
    expect(describeFinalExamResult({ status: "final-not-gradable" })).toBe(
      "The final exam has no points to grade against, so we can't tell what you would need.",
    );
    expect(describeFinalExamResult({ status: "already-graded" })).toBe(
      "Your final exam is already graded, so there is nothing left to aim for on it.",
    );
    expect(describeFinalExamResult({ status: "solved", results: [], otherWorkPending: false })).toBe(
      "No letter grades are set up for this class, so there is nothing to aim for yet.",
    );
  });

  it("explains every letter in one breath for a solved course", () => {
    expect(
      describeFinalExamResult({
        status: "solved",
        results: [
          { letter: "A", status: "out-of-reach", best: 87.2 },
          { letter: "B", status: "needed", score: 78.51, percent: 78.5 },
        ],
        otherWorkPending: false,
      }),
    ).toBe("An A is out of reach: a perfect final brings you to 87.2%. You need 78.5% on the final for a B.");
  });
});

describe("solveFinalExam refuses to answer about a final the grade does not count", () => {
  it("reports final-not-counted when the final is mapped to no category in a weighted course", () => {
    // Homework 40% plus a final whose 60% sits in finalExamWeight: the engine
    // never sees the final, so "A out of reach" and "B secured" would both be
    // invented.
    const setup = makeSetup([{ name: "Homework", weight: 40 }], [{ assignmentId: "hw-1", category: "Homework" }]);
    const assignments = [makeAssignment("hw-1", 100, 80), makeAssignment("final-1", 100)];

    expect(solve({ engine: "weighted", setup }, assignments, "final-1", { A: 90, B: 80 }, 60)).toEqual({
      status: "final-not-counted",
    });
  });

  it("reports final-not-counted when the setup holds a final exam weight outside the categories", () => {
    // Even with the final mapped into Homework, the 30 points of weight it
    // should carry belong to no category, so the engine's answer is wrong.
    const setup = makeSetup([{ name: "Homework", weight: 70 }], [
      { assignmentId: "hw-1", category: "Homework" },
      { assignmentId: "final-1", category: "Homework" },
    ]);
    const assignments = [makeAssignment("hw-1", 100, 80), makeAssignment("final-1", 100)];

    expect(solve({ engine: "weighted", setup }, assignments, "final-1", { A: 90 }, 30)).toEqual({
      status: "final-not-counted",
    });
  });
});

describe("solveFinalExam with other work still to be graded", () => {
  const setup = makeSetup(
    [
      { name: "Homework", weight: 50 },
      { name: "Final Exam", weight: 50 },
    ],
    [
      { assignmentId: "hw-1", category: "Homework" },
      { assignmentId: "hw-2", category: "Homework" },
      { assignmentId: "final-1", category: "Final Exam" },
    ],
  );
  const assignments = [makeAssignment("hw-1", 100, 100), makeAssignment("hw-2", 100), makeAssignment("final-1", 100)];

  it("flags that the answer assumes the other grades hold", () => {
    const result = solve({ engine: "weighted", setup }, assignments, "final-1", { C: 50 });

    expect(result).toEqual({ status: "solved", results: [{ letter: "C", status: "secured" }], otherWorkPending: true });
  });

  it("says secured only on condition when other work is still to be graded", () => {
    const result = solve({ engine: "weighted", setup }, assignments, "final-1", { C: 50 });

    expect(describeFinalExamResult(result)).toBe(
      "You have a C secured even with a 0 on the final if your other grades stay where they are.",
    );
  });

  it("does not count ungraded work outside the weighted categories as pending", () => {
    const unmapped = [...assignments.filter((assignment) => assignment.id !== "hw-2"), makeAssignment("extra", 10)];
    const result = solve({ engine: "weighted", setup }, unmapped, "final-1", { C: 50 });

    expect(result.status === "solved" && result.otherWorkPending).toBe(false);
  });
});

describe("solveFinalExam edge figures", () => {
  it("never reports a needed score above what the final is worth", () => {
    const assignments = [makeAssignment("final-1", 0.001)];
    const result = solve({ engine: "points", setup: null }, assignments, "final-1", { A: 90 });

    expect(needed(result, "A").score).toBeLessThanOrEqual(0.001);
    expect(needed(result, "A").percent).toBeLessThanOrEqual(100);
  });

  it("never prints an out-of-reach best grade at or above the cutoff", () => {
    // Homework 79.92% at 50% plus a perfect final at 50% is 89.96%: an A at 90
    // is out of reach, and the sentence must not round that up to 90%.
    const setup = makeSetup(
      [
        { name: "Homework", weight: 50 },
        { name: "Final Exam", weight: 50 },
      ],
      [
        { assignmentId: "hw-1", category: "Homework" },
        { assignmentId: "final-1", category: "Final Exam" },
      ],
    );
    const assignments = [makeAssignment("hw-1", 100, 79.92), makeAssignment("final-1", 100)];
    const result = solve({ engine: "weighted", setup }, assignments, "final-1", { A: 90 });

    expect(describeFinalExamResult(result)).toBe("An A is out of reach: a perfect final brings you to 89.9%.");
  });

  it("answers for the lowest cutoff in a letter's family when the plain letter is not set", () => {
    const result = solve(weightedChoice, weightedAssignments, "final-1", { "A-": 90, "B+": 87, "B-": 80 });

    expect(result.status === "solved" && result.results.map((entry) => entry.letter)).toEqual(["A-", "B-"]);
  });
});
