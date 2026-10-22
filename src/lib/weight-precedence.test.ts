import { describe, expect, it } from "vitest";
import {
  canvasWeightsAvailable,
  resolveWeightPrecedence,
  syllabusReadMessage,
  type CanvasAssignment,
  type CanvasGroup,
  type WeightedCategory,
} from "./weight-precedence";

function currentForm(
  overrides: Partial<{
    categories: WeightedCategory[];
    assignmentMappings: Record<string, string>;
    finalExamWeight: string;
  }> = {},
) {
  return {
    categories: [
      { name: "Homework", weight: "40" },
      { name: "Projects", weight: "60" },
    ],
    assignmentMappings: { a1: "Homework", a2: "Projects" },
    finalExamWeight: "0",
    ...overrides,
  };
}

const completeCanvas: CanvasGroup[] = [
  { name: "Homework", groupWeight: 40 },
  { name: "Projects", groupWeight: 60 },
];

// The realistic partially weighted course: formForCourse only made a category for the
// weighted group, so the Exams category the syllabus must fill does not exist yet.
const freshFormForPartialCanvas = currentForm({
  categories: [{ name: "Homework", weight: "40" }],
  assignmentMappings: { a1: "Homework", a2: "" },
  finalExamWeight: "60",
});

describe("canvasWeightsAvailable", () => {
  it("its definition is unchanged: every group weighted and the weights total 100", () => {
    expect(canvasWeightsAvailable(completeCanvas)).toBe(true);
    // The definition is unchanged, so a 0-weight group still "counts" here even though it
    // says nothing about the professor's weights; that gate only picks the default view.
    expect(canvasWeightsAvailable([
      { name: "Homework", groupWeight: 40 },
      { name: "Exams", groupWeight: 0 },
      { name: "Projects", groupWeight: 60 },
    ])).toBe(true);
    expect(canvasWeightsAvailable([{ name: "Homework", groupWeight: 90 }])).toBe(false);
    expect(canvasWeightsAvailable([])).toBe(false);
  });
});

describe("resolveWeightPrecedence when Canvas gives no weights (null or 0)", () => {
  it("all-zero Canvas groups: the syllabus replaces categories, exactly as before the ticket", () => {
    const result = resolveWeightPrecedence({
      current: currentForm({
        categories: [{ name: "Homework", weight: "0" }],
        assignmentMappings: { a1: " homework " },
        finalExamWeight: "20",
      }),
      // The syllabus names a category Canvas does not ("Problem Sets"), so replacing the
      // categories and filling Canvas's groups by name give different forms.
      suggestedCategories: [
        { name: "Problem Sets", weight: 70 },
        { name: "Exams", weight: 30 },
      ],
      suggestedFinalExamWeight: 0,
      canvasGroups: [
        { name: "Homework", groupWeight: 0 },
        { name: "Exams", groupWeight: 0 },
      ],
      canvasAssignments: [{ id: "a1", groupName: "Homework" }],
    });
    expect(result.categories).toEqual([
      { name: "Problem Sets", weight: "70" },
      { name: "Exams", weight: "30" },
    ]);
    // a1 was mapped to Homework, which the syllabus does not name, so it is left for the
    // student to map, as before this ticket.
    expect(result.assignmentMappings).toEqual({});
    expect(result.finalExamWeight).toBe("0");
    expect(result.canvasKept).toBe(false);
  });

  it("no Canvas groups at all still behaves exactly as before", () => {
    const result = resolveWeightPrecedence({
      current: currentForm({ assignmentMappings: { a1: " homework ", a2: "Ghost" } }),
      suggestedCategories: [{ name: "Homework", weight: 100 }],
      suggestedFinalExamWeight: 0,
      canvasGroups: [],
      canvasAssignments: [],
    });
    expect(result.categories).toEqual([{ name: "Homework", weight: "100" }]);
    expect(result.assignmentMappings).toEqual({ a1: "Homework" });
    expect(result.finalExamWeight).toBe("0");
    expect(result.canvasKept).toBe(false);
  });
});

describe("resolveWeightPrecedence with Canvas weights", () => {
  const partialCanvas: CanvasGroup[] = [
    { name: "Homework", groupWeight: 40 },
    { name: "Exams", groupWeight: null },
  ];
  const mixedCanvas: CanvasGroup[] = [
    { name: "Homework", groupWeight: 40 },
    { name: "Exams", groupWeight: 0 },
  ];
  const freshAssignments: CanvasAssignment[] = [
    { id: "a1", groupName: "Homework" },
    { id: "a2", groupName: "Exams" },
  ];

  it("a fresh partial form: Canvas keeps Homework 40 and the syllabus fills Exams 60", () => {
    const result = resolveWeightPrecedence({
      current: freshFormForPartialCanvas,
      suggestedCategories: [
        { name: "Homework", weight: 30 },
        { name: "Exams", weight: 60 },
      ],
      suggestedFinalExamWeight: null,
      canvasGroups: partialCanvas,
      canvasAssignments: freshAssignments,
    });
    expect(result.categories).toEqual([
      { name: "Homework", weight: "40" },
      { name: "Exams", weight: "60" },
    ]);
    // Mappings follow the Canvas groups.
    expect(result.assignmentMappings).toEqual({ a1: "Homework", a2: "Exams" });
    // The syllabus gave no final exam weight, so the remainder over the rebuilt categories
    // is recomputed (100 - 40 - 60) — the old stale "60" would double count Exams.
    expect(result.finalExamWeight).toBe("0");
    // The rebuilt categories and the recomputed final exam still land on 100.
    expect(
      result.categories.reduce((sum, category) => sum + Number(category.weight), 0) +
        Number(result.finalExamWeight)
    ).toBe(100);
    expect(result.canvasKept).toBe(true);
  });

  it("a syllabus category without a Canvas group is not added", () => {
    const result = resolveWeightPrecedence({
      current: freshFormForPartialCanvas,
      suggestedCategories: [
        { name: "Exams", weight: 60 },
        { name: "Labs", weight: 20 },
      ],
      suggestedFinalExamWeight: null,
      canvasGroups: partialCanvas,
      canvasAssignments: freshAssignments,
    });
    expect(result.categories).toEqual([
      { name: "Homework", weight: "40" },
      { name: "Exams", weight: "60" },
    ]);
    expect(result.canvasKept).toBe(true);
  });

  it("a 0-weight group in a partially weighted course is filled by a matching syllabus weight", () => {
    const result = resolveWeightPrecedence({
      current: currentForm({
        categories: [{ name: "Homework", weight: "40" }],
        finalExamWeight: "60",
      }),
      suggestedCategories: [{ name: "Exams", weight: 30 }],
      suggestedFinalExamWeight: null,
      canvasGroups: mixedCanvas,
      canvasAssignments: [
        { id: "a1", groupName: "Homework" },
        { id: "a2", groupName: "Exams" },
      ],
    });
    expect(result.categories).toEqual([
      { name: "Homework", weight: "40" },
      { name: "Exams", weight: "30" },
    ]);
    // The syllabus gave no final exam weight. A guessed remainder would sit outside the
    // categories where no grade engine reads it, so the field is 0 and the form's running
    // total (70%) shows the student what is missing.
    expect(result.finalExamWeight).toBe("0");
    // The syllabus filled a Canvas hole, so nothing was kept against it.
    expect(result.canvasKept).toBe(false);
  });

  it("an unfilled 0-weight group keeps showing 0 instead of a blank", () => {
    const result = resolveWeightPrecedence({
      current: currentForm({
        categories: [{ name: "Homework", weight: "40" }],
        finalExamWeight: "60",
      }),
      suggestedCategories: [{ name: "Homework", weight: 40 }],
      suggestedFinalExamWeight: null,
      canvasGroups: mixedCanvas,
      canvasAssignments: [{ id: "a1", groupName: "Homework" }],
    });
    expect(result.categories).toEqual([
      { name: "Homework", weight: "40" },
      { name: "Exams", weight: "0" },
    ]);
    // Never the stale remainder the form was opened with.
    expect(result.finalExamWeight).toBe("0");
    expect(result.canvasKept).toBe(false);
  });

  it("a group Canvas gave no weight for stays blank when the syllabus is silent on it too", () => {
    const result = resolveWeightPrecedence({
      current: currentForm({
        categories: [{ name: "Homework", weight: "40" }],
        finalExamWeight: "60",
      }),
      suggestedCategories: [{ name: "Homework", weight: 40 }],
      suggestedFinalExamWeight: null,
      canvasGroups: partialCanvas,
      canvasAssignments: [{ id: "a1", groupName: "Homework" }],
    });
    expect(result.categories).toEqual([
      { name: "Homework", weight: "40" },
      { name: "Exams", weight: "" },
    ]);
    expect(result.canvasKept).toBe(false);
  });

  it("a complete Canvas set rebuilds its own weights even over saved form weights, and the exam field resets to 0", () => {
    const result = resolveWeightPrecedence({
      current: currentForm({
        categories: [
          { name: "Homework", weight: "20" },
          { name: "Projects", weight: "80" },
        ],
        finalExamWeight: "0",
      }),
      suggestedCategories: [
        { name: "Homework", weight: 40 },
        { name: "Projects", weight: 60 },
      ],
      suggestedFinalExamWeight: 0,
      canvasGroups: completeCanvas,
      canvasAssignments: freshAssignments,
    });
    // The applied weights are Canvas's, whether the form held saved 20/80 or anything else.
    expect(result.categories).toEqual([
      { name: "Homework", weight: "40" },
      { name: "Projects", weight: "60" },
    ]);
    expect(result.assignmentMappings).toEqual({ a1: "Homework", a2: "Projects" });
    // The final exam sits inside a Canvas group when the Canvas weights total 100.
    expect(result.finalExamWeight).toBe("0");
    // The syllabus also said 40/60, so it agreed and no Canvas-won message shows.
    expect(result.canvasKept).toBe(false);
  });

  it("a complete Canvas set announces Canvas won when the syllabus suggests different weights", () => {
    const result = resolveWeightPrecedence({
      current: currentForm(),
      suggestedCategories: [
        { name: "Homework", weight: 70 },
        { name: "Projects", weight: 30 },
      ],
      suggestedFinalExamWeight: 20,
      canvasGroups: completeCanvas,
      canvasAssignments: freshAssignments,
    });
    expect(result.categories).toEqual([
      { name: "Homework", weight: "40" },
      { name: "Projects", weight: "60" },
    ]);
    expect(result.finalExamWeight).toBe("0");
    expect(result.canvasKept).toBe(true);
  });

  it("a dropped syllabus category alone is enough to announce Canvas won", () => {
    const result = resolveWeightPrecedence({
      current: currentForm(),
      suggestedCategories: [
        { name: "Homework", weight: 40 },
        { name: "Labs", weight: 60 },
      ],
      suggestedFinalExamWeight: 0,
      canvasGroups: completeCanvas,
      canvasAssignments: freshAssignments,
    });
    expect(result.canvasKept).toBe(true);
  });

  it("even a group Canvas left null shows 0 once the Canvas weights total 100", () => {
    const result = resolveWeightPrecedence({
      current: currentForm(),
      suggestedCategories: [{ name: "Exams", weight: 25 }],
      suggestedFinalExamWeight: 25,
      canvasGroups: [
        { name: "Homework", groupWeight: 40 },
        { name: "Exams", groupWeight: null },
        { name: "Projects", groupWeight: 60 },
      ],
      canvasAssignments: [{ id: "a1", groupName: "Exams" }],
    });
    expect(result.categories).toEqual([
      { name: "Homework", weight: "40" },
      { name: "Exams", weight: "0" },
      { name: "Projects", weight: "60" },
    ]);
    expect(result.assignmentMappings).toEqual({ a1: "Exams" });
    expect(result.finalExamWeight).toBe("0");
    // Canvas is complete and the syllabus proposed a positive final exam weight on top of
    // it — that override alone says Canvas won.
    expect(result.canvasKept).toBe(true);
  });

  it("a final exam weight named by the syllabus overrides the recomputed remainder when Canvas is partial", () => {
    const result = resolveWeightPrecedence({
      current: freshFormForPartialCanvas,
      suggestedCategories: [{ name: "Exams", weight: 50 }],
      suggestedFinalExamWeight: 10,
      canvasGroups: partialCanvas,
      canvasAssignments: freshAssignments,
    });
    expect(result.categories).toEqual([
      { name: "Homework", weight: "40" },
      { name: "Exams", weight: "50" },
    ]);
    expect(result.finalExamWeight).toBe("10");
    expect(
      result.categories.reduce((sum, category) => sum + Number(category.weight), 0) +
        Number(result.finalExamWeight)
    ).toBe(100);
    expect(result.canvasKept).toBe(false);
  });

  it("a complete 40/0/60 Canvas set stays exactly 40/0/60, ignoring a syllabus that reweights the 0 group", () => {
    const groupsAndAssignments = {
      canvasGroups: [
        { name: "Homework", groupWeight: 40 },
        { name: "Imported Assignments", groupWeight: 0 },
        { name: "Projects", groupWeight: 60 },
      ],
      canvasAssignments: [
        { id: "a1", groupName: "Homework" },
        { id: "a2", groupName: "Imported Assignments" },
        { id: "a3", groupName: "Projects" },
      ],
    };
    const result = resolveWeightPrecedence({
      current: currentForm(),
      suggestedCategories: [
        { name: "Imported Assignments", weight: 10 },
        { name: "Labs", weight: 90 },
      ],
      suggestedFinalExamWeight: null,
      ...groupsAndAssignments,
    });
    // Canvas's weights total 100, so they are authoritative: no syllabus fill anywhere.
    expect(result.categories).toEqual([
      { name: "Homework", weight: "40" },
      { name: "Imported Assignments", weight: "0" },
      { name: "Projects", weight: "60" },
    ]);
    expect(result.assignmentMappings).toEqual({ a1: "Homework", a2: "Imported Assignments", a3: "Projects" });
    expect(result.finalExamWeight).toBe("0");
    // The 0 group is not "Canvas weighing" it, so only the dropped Labs triggered Canvas won.
    expect(result.canvasKept).toBe(true);
  });

  it("distinct Canvas groups sharing a name merge into one category weighted by the sum", () => {
    const result = resolveWeightPrecedence({
      current: currentForm({ finalExamWeight: "100" }),
      suggestedCategories: [],
      suggestedFinalExamWeight: null,
      canvasGroups: [
        { name: "Homework", groupWeight: 40 },
        { name: " homework ", groupWeight: 60 },
      ],
      canvasAssignments: [
        { id: "a1", groupName: "Homework" },
        { id: "a2", groupName: "Homework" },
      ],
    });
    // One category, named after the first occurrence, both groups' assignments mapped to it.
    expect(result.categories).toEqual([{ name: "Homework", weight: "100" }]);
    expect(result.assignmentMappings).toEqual({ a1: "Homework", a2: "Homework" });
    // The merged positive weights total 100, so Canvas is complete and the exam resets to 0.
    expect(result.finalExamWeight).toBe("0");
    expect(result.canvasKept).toBe(false);
  });

  it("a complete Canvas set announces Canvas won on a final-exam-only disagreement", () => {
    const result = resolveWeightPrecedence({
      current: currentForm(),
      suggestedCategories: [
        { name: "Homework", weight: 40 },
        { name: "Projects", weight: 60 },
      ],
      suggestedFinalExamWeight: 20,
      canvasGroups: completeCanvas,
      canvasAssignments: freshAssignments,
    });
    expect(result.categories).toEqual([
      { name: "Homework", weight: "40" },
      { name: "Projects", weight: "60" },
    ]);
    expect(result.finalExamWeight).toBe("0");
    expect(result.canvasKept).toBe(true);
  });

  it("an assignment without a Canvas group keeps its mapping while that category exists, else goes unmapped", () => {
    const result = resolveWeightPrecedence({
      current: currentForm({
        assignmentMappings: { a2: "Projects", a3: "Ghost" },
      }),
      suggestedCategories: [],
      suggestedFinalExamWeight: null,
      canvasGroups: completeCanvas,
      canvasAssignments: [
        { id: "a1", groupName: null },
        { id: "a2", groupName: null },
        { id: "a3", groupName: "Projects" },
      ],
    });
    // a2's Projects category survives the rebuild, so its mapping is kept.
    expect(result.assignmentMappings).toEqual({ a1: "", a2: "Projects", a3: "Projects" });
  });

  it("a final exam weight named by the syllabus fills in when Canvas does not total 100", () => {
    const result = resolveWeightPrecedence({
      current: freshFormForPartialCanvas,
      suggestedCategories: [{ name: "Exams", weight: 60 }],
      suggestedFinalExamWeight: 0,
      canvasGroups: partialCanvas,
      canvasAssignments: freshAssignments,
    });
    expect(result.finalExamWeight).toBe("0");
  });
});

describe("syllabusReadMessage", () => {
  it("says plainly what Canvas kept and what the syllabus filled in", () => {
    expect(syllabusReadMessage(true)).toBe(
      "Your professor's Canvas weights were kept. The syllabus filled in the rest. Nothing is saved until you confirm them.",
    );
    expect(syllabusReadMessage(false)).toBe(
      "The AI's suggestions are filled in below. Nothing is saved until you confirm them.",
    );
  });
});
