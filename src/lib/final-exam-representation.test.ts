import { describe, expect, it } from "vitest";
import { parseGradeSetup } from "./grade-setup";
import { calculateWeightedGrade, type GradeAssignment } from "./weighted-grade";

// The syllabus reader puts the final exam in categories because the grade engine only
// reaches weights through setup.categories, and a final exam exists as a Canvas assignment
// that must be mapped to a category. This test pins the representation and documents the
// alternative that reads the wrong grade.
describe("final exam representation from a syllabus read", () => {
  const assignments: GradeAssignment[] = [
    { id: "hw-1", pointsPossible: 100, grade: { score: 100 } },
    { id: "final-1", pointsPossible: 100, grade: { score: 0 } },
  ];

  it("a final exam as its own category is a submittable setup computing the correct grade", () => {
    const parsed = parseGradeSetup({
      categories: [
        { name: "Homework", weight: 70 },
        { name: "Final Exam", weight: 30 },
      ],
      assignmentMappings: [
        { assignmentId: "hw-1", category: "Homework" },
        { assignmentId: "final-1", category: "Final Exam" },
      ],
      finalExamWeight: 0,
      cutoffs: { A: 90 },
      classDetails: {},
    });
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) {
      return;
    }
    // Homework earned everything, the final earned nothing: the syllabus's 70/30 split is 70%.
    expect(calculateWeightedGrade(parsed.data, assignments)).toEqual({
      status: "calculated",
      percentage: 70,
    });
  });

  it("the old shape is a clean parse whose engine math is wrong, 50 instead of 70", () => {
    // Round 1 parked the final's 30 in finalExamWeight, which the engine never reads, so the
    // final's 100-point assignment had to map into Homework: 100 of 200 points reads 50.
    const broken = {
      categories: [{ name: "Homework", weight: 70 }],
      assignmentMappings: [
        { assignmentId: "hw-1", category: "Homework" },
        { assignmentId: "final-1", category: "Homework" },
      ],
      finalExamWeight: 30,
      cutoffs: { A: 90 },
      classDetails: {},
    };
    const parsed = parseGradeSetup(broken);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) {
      return;
    }
    expect(calculateWeightedGrade(parsed.data, assignments)).toEqual({
      status: "calculated",
      percentage: 50,
    });
  });
});
