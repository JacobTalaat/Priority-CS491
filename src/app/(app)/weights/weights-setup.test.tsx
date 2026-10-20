import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

const { mockGetCourses, mockUploadProps } = vi.hoisted(() => ({
  mockGetCourses: vi.fn(),
  mockUploadProps: vi.fn(),
}));

vi.mock("@/lib/grade-setup-client", () => ({
  getGradeSetupCourses: mockGetCourses,
  saveGradeSetup: vi.fn(),
}));

// Captured rather than rendered so the test can inspect and invoke the props WeightsSetup
// passes down, including onRead, without a DOM.
vi.mock("@/components/syllabus/syllabus-upload", () => ({
  SyllabusUpload: (props: Record<string, unknown>) => {
    mockUploadProps(props);
    return null;
  },
}));

import type { GradeSetupCourse } from "@/lib/grade-setup-client";
import type { SyllabusSuggestions } from "@/lib/syllabus-client";
import {
  applySyllabusRead,
  applySyllabusSuggestions,
  WeightsSetup,
  type FormState,
} from "./weights-setup";

const course: GradeSetupCourse = {
  id: "c1",
  name: "Algorithms",
  courseCode: "CS-341",
  term: "Fall 2026",
  assignmentGroups: [],
  assignments: [
    { id: "a1", title: "Homework 1", assignmentGroup: { name: "Homework", groupWeight: null } },
    { id: "a2", title: "Project 1", assignmentGroup: { name: "Ghost", groupWeight: null } },
  ],
  gradeSetup: null,
};

function renderWeightsSetup(): void {
  renderToStaticMarkup(<WeightsSetup initialCourses={[course]} />);
}

function currentForm(): FormState {
  return {
    categories: [{ name: "Homework", weight: "100" }],
    assignmentMappings: { a1: "Homework" },
    finalExamWeight: "20",
    cutoffs: { A: "93", B: "80", C: "70", D: "60", F: "0" },
    instructor: "",
    section: "002",
    credits: "3",
  };
}

const fullSuggestions: SyllabusSuggestions = {
  categories: [
    { name: "Homework", weight: 30 },
    { name: "Midterm", weight: 30 },
    { name: "Problem Sets", weight: 20 },
  ],
  finalExamWeight: 20,
  cutoffs: { A: 93, B: 83 },
  latePolicy: "Late work loses 2 points per day.",
  officeHours: "Tue 2-3 pm",
  contacts: [{ name: "Dr. Ruiz", role: "Instructor", email: "eruiz@njit.edu" }],
  unsupportedRules: ["The lowest quiz score is dropped before averaging the quizzes."],
};

describe("applySyllabusSuggestions", () => {
  it("fills categories, final exam weight, and cutoffs so the weights total 100", () => {
    const next = applySyllabusSuggestions(currentForm(), fullSuggestions);
    expect(next.categories).toEqual([
      { name: "Homework", weight: "30" },
      { name: "Midterm", weight: "30" },
      { name: "Problem Sets", weight: "20" },
    ]);
    expect(next.finalExamWeight).toBe("20");
    expect(next.cutoffs).toEqual({ A: "93", B: "83", C: "70", D: "60", F: "0" });
    expect(
      next.categories.reduce((sum, category) => sum + Number(category.weight), 0) +
        Number(next.finalExamWeight)
    ).toBe(100);
  });

  it("merges suggested cutoffs over the current ones instead of wiping untouched labels", () => {
    const partial: SyllabusSuggestions = {
      ...fullSuggestions,
      cutoffs: { A: 93 },
      categories: [{ name: "Homework", weight: 100 }],
      finalExamWeight: 0,
    };
    const next = applySyllabusSuggestions(currentForm(), partial);
    expect(next.cutoffs).toEqual({ A: "93", B: "80", C: "70", D: "60", F: "0" });
  });

  it("keeps a cutoff the suggestion added that the form did not have yet", () => {
    const withAPlus: SyllabusSuggestions = { ...fullSuggestions, cutoffs: { "A+": 97 } };
    const next = applySyllabusSuggestions(currentForm(), withAPlus);
    expect(next.cutoffs["A+"]).toBe("97");
    expect(next.cutoffs.A).toBe("93");
  });

  it("leaves a suggested category weight empty when the AI could not read it", () => {
    const next = applySyllabusSuggestions(currentForm(), {
      ...fullSuggestions,
      categories: [{ name: "Homework", weight: null }],
    });
    expect(next.categories).toEqual([{ name: "Homework", weight: "" }]);
    // An empty weight is not a number to the form (its numberValue treats "" as NaN), so
    // confirming stays blocked until the student fills it.
    const weight = next.categories[0].weight;
    expect(weight === "" ? Number.NaN : Number(weight)).toBeNaN();
  });

  it("keeps the form's final exam weight and cutoffs when the syllabus did not state them", () => {
    const next = applySyllabusSuggestions(currentForm(), {
      ...fullSuggestions,
      finalExamWeight: null,
      cutoffs: {},
      categories: [{ name: "Homework", weight: 50 }],
    });
    expect(next.finalExamWeight).toBe("20");
    expect(next.cutoffs).toEqual({ A: "93", B: "80", C: "70", D: "60", F: "0" });
  });

  it("keeps a mapping whose suggested category exists and rewrites it to the exact name", () => {
    const before = {
      ...currentForm(),
      categories: [
        { name: "Homework", weight: "100" },
        { name: "Ghost", weight: "0" },
      ],
      assignmentMappings: { a1: "  homework ", a2: "Ghost" },
    };
    const next = applySyllabusSuggestions(before, fullSuggestions);
    expect(next.assignmentMappings).toEqual({ a1: "Homework" });
  });

  it("keeps every mapping untouched when the suggestion has no categories", () => {
    const before = {
      ...currentForm(),
      categories: [
        { name: "Homework", weight: "100" },
        { name: "Ghost", weight: "0" },
      ],
      assignmentMappings: { a1: "Homework", a2: "Ghost" },
    };
    const next = applySyllabusSuggestions(before, { ...fullSuggestions, categories: [] });
    expect(next.categories).toEqual(before.categories);
    expect(next.assignmentMappings).toEqual(before.assignmentMappings);
  });

  it("fills an empty instructor from an instructor contact and never overwrites a typed one", () => {
    const filled = applySyllabusSuggestions(currentForm(), fullSuggestions);
    expect(filled.instructor).toBe("Dr. Ruiz");

    const typed = applySyllabusSuggestions(
      { ...currentForm(), instructor: "Prof. Ortega" },
      fullSuggestions,
    );
    expect(typed.instructor).toBe("Prof. Ortega");

    const noContact = applySyllabusSuggestions(currentForm(), { ...fullSuggestions, contacts: [] });
    expect(noContact.instructor).toBe("");
  });

  it("does not touch section or credits", () => {
    const next = applySyllabusSuggestions(currentForm(), fullSuggestions);
    expect(next.section).toBe("002");
    expect(next.credits).toBe("3");
  });
});

describe("applySyllabusRead", () => {
  it("returns null for a course that is no longer selected", () => {
    expect(applySyllabusRead("course-a", "course-b", currentForm(), fullSuggestions)).toBeNull();
    expect(applySyllabusRead("course-a", "course-a", currentForm(), fullSuggestions)).not.toBeNull();
    expect(applySyllabusRead("", "course-a", currentForm(), fullSuggestions)).toBeNull();
  });

  it("hands over the review-only parts of the read, including the instructor contact", () => {
    const read = applySyllabusRead("c1", "c1", currentForm(), fullSuggestions);
    expect(read).not.toBeNull();
    expect(read!.extras).toEqual({
      unsupportedRules: ["The lowest quiz score is dropped before averaging the quizzes."],
      latePolicy: "Late work loses 2 points per day.",
      officeHours: "Tue 2-3 pm",
      contacts: [{ name: "Dr. Ruiz", role: "Instructor", email: "eruiz@njit.edu" }],
    });
  });

  it("shows every suggested contact in the review list whether or not the instructor was typed", () => {
    const typed = { ...currentForm(), instructor: "Prof. Ortega" };
    const read = applySyllabusRead("c1", "c1", typed, fullSuggestions);
    expect(read!.extras?.contacts).toEqual(fullSuggestions.contacts);
    const empty = applySyllabusRead("c1", "c1", currentForm(), fullSuggestions);
    expect(empty!.extras?.contacts).toEqual(fullSuggestions.contacts);

    const silent = applySyllabusRead("c1", "c1", currentForm(), {
      ...fullSuggestions,
      unsupportedRules: [],
      latePolicy: null,
      officeHours: null,
      contacts: [],
    });
    expect(silent!.extras).toBeNull();
  });
});

describe("WeightsSetup wiring to SyllabusUpload", () => {
  beforeEach(() => {
    mockGetCourses.mockReset();
    mockUploadProps.mockReset();
  });

  it("renders the AI panel with the selected course and an onRead handler that applies to the form", () => {
    renderWeightsSetup();
    expect(mockUploadProps).toHaveBeenCalled();
    const props = mockUploadProps.mock.calls[0][0] as Record<string, unknown>;
    expect(typeof props.onRead).toBe("function");
    expect(props.course).toBe(course);
    // Invoke the real handler: a read for a course that is no longer selected is dropped,
    // and the course that is selected passes through the full mapping. The state change
    // itself is assertable only through applySyllabusRead (no DOM in this test setup), but
    // running the handler end to end proves the wiring resolves.
    const onRead = props.onRead as (courseId: string, suggestions: SyllabusSuggestions) => void;
    expect(() => onRead("c-other", fullSuggestions)).not.toThrow();
    expect(() => onRead("c1", fullSuggestions)).not.toThrow();
  });
});
