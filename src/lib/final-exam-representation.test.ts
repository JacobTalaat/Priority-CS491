import { describe, expect, it, vi } from "vitest";

const {
  mockSessionFindUnique,
  mockCourseFindFirst,
  mockAssignmentFindMany,
  mockGradeSetupUpsert,
} = vi.hoisted(() => ({
  mockSessionFindUnique: vi.fn(),
  mockCourseFindFirst: vi.fn(),
  mockAssignmentFindMany: vi.fn(),
  mockGradeSetupUpsert: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    session: { findUnique: mockSessionFindUnique },
    course: { findFirst: mockCourseFindFirst },
    assignment: { findMany: mockAssignmentFindMany },
    courseGradeSetup: { upsert: mockGradeSetupUpsert },
  },
}));

import { parseGradeSetup, withFinalExamCategory } from "./grade-setup";
import { chooseGradeEngine } from "./grade-engine";
import { calculateWeightedGrade, type GradeAssignment } from "./weighted-grade";
import { POST as saveGradeSetup } from "@/app/api/courses/[courseId]/grade-setup/route";

// Weights only count through setup.categories, and a final exam exists as a Canvas
// assignment that must be mapped to a category. A setup that parks the final's weight
// in finalExamWeight grades correctly only once the picked final is folded into a
// category on the grade route; these tests pin both paths.
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

  it("the old shape grades 70 through the grade route path once the final is picked", () => {
    // Round 1 saved Homework 70 with the final's 30 in finalExamWeight and the final's
    // 100-point assignment mapped into Homework. Before the final is folded out, that
    // math reads 50; the grade route now normalizes it, so the syllabus's 70/30 split
    // with the final graded zero reads 70.
    const saved = {
      categories: [{ name: "Homework", weight: 70 }],
      assignmentMappings: [
        { assignmentId: "hw-1", category: "Homework" },
        { assignmentId: "final-1", category: "Homework" },
      ],
      finalExamWeight: 30,
      cutoffs: { A: 90 },
      classDetails: { finalExamAssignmentId: "final-1" },
    };
    const parsed = parseGradeSetup(saved);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) {
      return;
    }
    const choice = chooseGradeEngine(withFinalExamCategory(parsed.data));
    expect(choice.engine).toBe("weighted");
    expect(choice.setup).not.toBeNull();
    if (!choice.setup) {
      return;
    }
    expect(calculateWeightedGrade(choice.setup, assignments)).toEqual({
      status: "calculated",
      percentage: 70,
    });
  });

  it("the save route refuses the old shape when no final is picked", async () => {
    mockSessionFindUnique.mockReset().mockResolvedValue({
      id: "session-1",
      expiresAt: new Date(Date.now() + 60 * 1000),
      user: { id: "user-1", email: "student@example.com" },
    });
    mockCourseFindFirst.mockReset().mockResolvedValue({ id: "course-1" });
    mockAssignmentFindMany.mockReset().mockResolvedValue([{ id: "hw-1" }, { id: "final-1" }]);
    mockGradeSetupUpsert.mockReset().mockResolvedValue({});

    const context = { params: Promise.resolve({ courseId: "course-1" }) };
    const response = await saveGradeSetup(
      new Request("http://localhost/api/courses/course-1/grade-setup", {
        method: "POST",
        headers: { Authorization: "Bearer session-token", "Content-Type": "application/json" },
        body: JSON.stringify({
          categories: [{ name: "Homework", weight: 70 }],
          assignmentMappings: [
            { assignmentId: "hw-1", category: "Homework" },
            { assignmentId: "final-1", category: "Homework" },
          ],
          finalExamWeight: 30,
          cutoffs: { A: 90 },
          // No finalExamAssignmentId: a weight the engines cannot read must not confirm.
          classDetails: {},
        }),
      }),
      context,
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: "Pick which assignment is the final exam, or set the final exam weight to 0.",
    });
    expect(mockGradeSetupUpsert).not.toHaveBeenCalled();
  });
});
