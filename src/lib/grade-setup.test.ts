import { describe, expect, it } from "vitest";
import { parseGradeSetup } from "./grade-setup";

const VALID_SETUP = {
  categories: [
    { name: "Homework", weight: 30 },
    { name: "Exams", weight: 50 },
  ],
  assignmentMappings: [{ assignmentId: "assignment-1", category: "Homework" }],
  finalExamWeight: 20,
  cutoffs: { A: 90, B: 80, C: 70 },
  classDetails: { instructor: "Professor Example", section: "02" },
};

describe("parseGradeSetup", () => {
  it("accepts a complete setup and normalizes category names", () => {
    expect(parseGradeSetup(VALID_SETUP)).toEqual({
      ok: true,
      data: {
        categories: VALID_SETUP.categories,
        assignmentMappings: VALID_SETUP.assignmentMappings,
        finalExamWeight: 20,
        cutoffs: VALID_SETUP.cutoffs,
        classDetails: VALID_SETUP.classDetails,
      },
    });
  });

  it("rejects category and final-exam weights that do not total 100", () => {
    const result = parseGradeSetup({ ...VALID_SETUP, finalExamWeight: 19 });
    expect(result).toEqual({
      ok: false,
      error: "Category weights and the final exam weight must add up to 100.",
    });
  });

  it("rejects duplicate category names and invalid category weights", () => {
    expect(
      parseGradeSetup({
        ...VALID_SETUP,
        categories: [
          { name: "Homework", weight: 30 },
          { name: " homework ", weight: 50 },
        ],
      }),
    ).toMatchObject({ ok: false, error: "Category names must be unique." });
    expect(
      parseGradeSetup({
        ...VALID_SETUP,
        categories: [{ name: "Homework", weight: Number.NaN }],
      }),
    ).toMatchObject({ ok: false });
  });

  it("rejects assignments mapped to missing categories or mapped more than once", () => {
    expect(
      parseGradeSetup({
        ...VALID_SETUP,
        assignmentMappings: [{ assignmentId: "assignment-1", category: "Participation" }],
      }),
    ).toMatchObject({ ok: false, error: "Each assignment must map to an existing category." });
    expect(
      parseGradeSetup({
        ...VALID_SETUP,
        assignmentMappings: [
          { assignmentId: "assignment-1", category: "Homework" },
          { assignmentId: "assignment-1", category: "Exams" },
        ],
      }),
    ).toMatchObject({ ok: false, error: "An assignment cannot be mapped more than once." });
  });

  it("rejects invalid cutoffs and class details", () => {
    expect(parseGradeSetup({ ...VALID_SETUP, cutoffs: { A: 110 } })).toMatchObject({ ok: false });
    expect(parseGradeSetup({ ...VALID_SETUP, classDetails: { credits: Number.POSITIVE_INFINITY } })).toMatchObject({
      ok: false,
    });
  });
});
