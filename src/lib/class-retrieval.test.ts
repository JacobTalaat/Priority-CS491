import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockCourseFindMany } = vi.hoisted(() => ({
  mockCourseFindMany: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({
  prisma: { course: { findMany: mockCourseFindMany } },
}));

import {
  chunkSyllabus,
  rankPassages,
  retrieveClassContext,
  type RetrievalDocument,
} from "./class-retrieval";
import { SYLLABUS_FIXTURES } from "./__fixtures__/syllabi";

function fixtureByName(name: string) {
  const fixture = SYLLABUS_FIXTURES.find((entry) => entry.name === name);
  if (!fixture) {
    throw new Error(`missing fixture: ${name}`);
  }
  return fixture;
}

function syllabusDocs(fixtureName: string, courseCode?: string): RetrievalDocument[] {
  const fixture = fixtureByName(fixtureName);
  return chunkSyllabus(fixture.syllabusText).map((chunk) => ({
    kind: "syllabus",
    courseId: "course-1",
    courseName: fixture.name,
    courseCode,
    text: chunk.text,
    source: { fileName: "syllabus.pdf", start: chunk.start, end: chunk.end },
  }));
}

function assignmentDoc(overrides: Partial<RetrievalDocument> = {}): RetrievalDocument {
  return {
    kind: "assignment",
    courseId: "course-1",
    courseName: "CS 341 Algorithms",
    courseCode: "CS-341",
    text: "The final exam is cumulative and closed book",
    source: { assignmentId: "a-1", title: "Final Exam", htmlUrl: null },
    ...overrides,
  };
}

function courseRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "course-1",
    name: "Algorithms",
    courseCode: "CS-341",
    syllabus: null,
    assignments: [],
    gradeSetup: null,
    ...overrides,
  };
}

const SELECT = {
  id: true,
  name: true,
  courseCode: true,
  syllabus: { select: { fileName: true, text: true } },
  assignments: {
    select: {
      id: true,
      title: true,
      dueAt: true,
      hasDueDate: true,
      pointsPossible: true,
      htmlUrl: true,
      grade: { select: { score: true } },
    },
  },
  gradeSetup: { select: { classDetails: true } },
};

describe("chunkSyllabus", () => {
  it("returns passages whose offsets slice back to the exact passage", () => {
    for (const fixture of SYLLABUS_FIXTURES) {
      const chunks = chunkSyllabus(fixture.syllabusText);
      expect(chunks.length).toBeGreaterThan(0);
      expect(chunks[0].start).toBe(0);
      expect(chunks[chunks.length - 1].end).toBe(fixture.syllabusText.length);
      for (const chunk of chunks) {
        expect(chunk.text.length).toBeLessThanOrEqual(800);
        expect(fixture.syllabusText.slice(chunk.start, chunk.end)).toBe(chunk.text);
      }
    }
  });

  it("returns nothing for empty or whitespace-only text", () => {
    expect(chunkSyllabus("")).toEqual([]);
    expect(chunkSyllabus("  \n\n   \n")).toEqual([]);
  });

  it("merges tiny blocks into one passage", () => {
    const chunks = chunkSyllabus("a\n\nb");
    expect(chunks).toEqual([{ text: "a\n\nb", start: 0, end: 4 }]);
  });

  it("splits a long block into passages under the cap", () => {
    const text = Array.from({ length: 300 }, (_, i) => `line ${i} explains another grading rule`).join("\n");
    const chunks = chunkSyllabus(text);
    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks[0].start).toBe(0);
    expect(chunks[chunks.length - 1].end).toBe(text.length);
    for (const chunk of chunks) {
      expect(chunk.text.length).toBeLessThanOrEqual(800);
      expect(text.slice(chunk.start, chunk.end)).toBe(chunk.text);
    }
  });

  it("cuts a whitespace-free stretch mid-word rather than dropping it", () => {
    const text = "x".repeat(2000);
    const chunks = chunkSyllabus(text);
    expect(chunks).toEqual([
      { text: "x".repeat(800), start: 0, end: 800 },
      { text: "x".repeat(800), start: 800, end: 1600 },
      { text: "x".repeat(400), start: 1600, end: 2000 },
    ]);
  });
});

describe("rankPassages", () => {
  it("finds the late policy passage in a syllabus", () => {
    const results = rankPassages("what is the late policy", syllabusDocs("prompt injection"));
    expect(results.length).toBeGreaterThan(0);
    expect(results[0].text).toContain("Late policy: one week grace");
    for (const item of results) {
      expect(item.score).toBeGreaterThan(0);
    }
  });

  it("finds the office hours passage in a syllabus", () => {
    const results = rankPassages("when are office hours", syllabusDocs("clean weighted"));
    expect(results[0].text).toContain("Office Hours");
  });

  it("ranks a real late policy passage above filler that only shares the stopword debris", () => {
    const real = assignmentDoc({
      courseId: "course-real",
      courseName: "Course Real",
      text: "Late policy: five percent penalty per day.",
      source: { assignmentId: "a-real", title: "Rules", htmlUrl: null },
    });
    const filler = assignmentDoc({
      courseId: "course-filler",
      courseName: "Course Filler",
      text: "late is the is the is the is the is the",
      source: { assignmentId: "a-filler", title: "Debris", htmlUrl: null },
    });
    const results = rankPassages("what is the late policy", [filler, real]);
    expect(results[0].courseId).toBe("course-real");
    expect(results[0].text).toContain("Late policy");
  });

  it("ranks the assignment document above the syllabus for a question about worth", () => {
    const documents = [
      ...syllabusDocs("clean weighted", "CS-341"),
      assignmentDoc({
        text: "Final Exam — CS 341 — no due date — worth 50 points — not graded yet",
        source: { assignmentId: "a-2", title: "Final Exam", htmlUrl: null },
      }),
    ];
    const results = rankPassages("how much is the final worth", documents);
    expect(results[0]).toMatchObject({ kind: "assignment", text: expect.stringContaining("worth 50 points") });
  });

  it("returns nothing when no passage shares terms with the question", () => {
    expect(rankPassages("quantum entanglement lizards", syllabusDocs("clean weighted"))).toEqual([]);
  });

  it("boosts the named course listed second above the unboosted course", () => {
    const other = assignmentDoc({ courseId: "course-other", courseName: "Unnamed Course", courseCode: null });
    // The named course is deliberately LAST in the input order.
    const named = assignmentDoc({ courseId: "course-named" });
    const results = rankPassages("when is the final exam for cs341", [other, named]);
    expect(results[0].courseId).toBe("course-named");
    expect(results).toHaveLength(2);
  });

  it("does not boost cs341 when the question says cs3410", () => {
    const cs341 = assignmentDoc();
    const cs3410 = assignmentDoc({
      courseId: "course-cs3410",
      courseName: "CS 3410 Advanced Agents",
      courseCode: "CS-3410",
    });
    const results = rankPassages("cs3410 final exam", [cs341, cs3410]);
    expect(results[0].courseId).toBe("course-cs3410");
    expect(results).toHaveLength(2);
  });

  it("only boosts a course name when every significant token appears", () => {
    const artHistory = assignmentDoc({
      courseId: "course-art",
      courseName: "Art History",
      courseCode: "ARTH-201",
    });
    const europeanHistory = assignmentDoc({
      courseId: "course-euro",
      courseName: "European History",
      courseCode: "HIST-202",
    });
    const results = rankPassages("what is the final exam policy for european history", [
      europeanHistory,
      artHistory,
    ]);
    expect(results[0].courseId).toBe("course-euro");
    expect(results).toHaveLength(2);
  });

  it("normalises course codes that differ in spacing and dashes", () => {
    const cs = assignmentDoc();
    const math = assignmentDoc({ courseId: "course-2", courseName: "MATH 331 Statistics", courseCode: "MATH-331" });
    const results = rankPassages("cs 341 final exam policy", [cs, math]);
    expect(results[0].courseId).toBe("course-1");
  });

  it("boosts the course mentioned by name", () => {
    const cs = assignmentDoc();
    const math = assignmentDoc({ courseId: "course-2", courseName: "MATH 331 Statistics", courseCode: "MATH-331" });
    const results = rankPassages("what is the final policy for algorithms", [cs, math]);
    expect(results[0].courseId).toBe("course-1");
    expect(results).toHaveLength(2);
  });

  it("caps the question at 500 characters before scoring", () => {
    const unicorn = assignmentDoc({ text: "unicorns and rainbows", courseName: "Rainbows", courseCode: "RB-101" });
    expect(
      rankPassages("late policy " + "z".repeat(488) + " unicorns", [unicorn]),
    ).toEqual([]);
    expect(rankPassages("late policy unicorns", [unicorn])).toHaveLength(1);
  });
});

describe("retrieveClassContext", () => {
  beforeEach(() => {
    mockCourseFindMany.mockReset().mockResolvedValue([]);
  });

  it("answers an empty or whitespace question without touching the database", async () => {
    await expect(retrieveClassContext({ userId: "user-1", question: "   " })).resolves.toEqual([]);
    expect(mockCourseFindMany).not.toHaveBeenCalled();
  });

  it("loads only the user's current courses, optionally one of them", async () => {
    await retrieveClassContext({ userId: "user-1", question: "late policy" });
    expect(mockCourseFindMany).toHaveBeenCalledWith({
      where: { userId: "user-1", isCurrent: true },
      select: SELECT,
    });

    await retrieveClassContext({ userId: "user-1", question: "late policy", courseId: "course-9" });
    expect(mockCourseFindMany).toHaveBeenLastCalledWith({
      where: { userId: "user-1", isCurrent: true, id: "course-9" },
      select: SELECT,
    });
  });

  it("states an assignment's facts in words on the school timezone", async () => {
    // 2026-10-14T03:59Z is Oct 13, 11:59 PM in America/New_York.
    mockCourseFindMany.mockResolvedValue([
      courseRow({
        syllabus: { fileName: "algorithms-syllabus.pdf", text: fixtureByName("clean weighted").syllabusText },
        assignments: [
          {
            id: "a-1",
            title: "Homework 3",
            dueAt: new Date("2026-10-14T03:59:00Z"),
            hasDueDate: true,
            pointsPossible: 20,
            htmlUrl: "https://canvas.example.edu/courses/1/assignments/1",
            grade: { score: 18 },
          },
        ],
      }),
    ]);

    const results = await retrieveClassContext({ userId: "user-1", question: "when is homework 3 due" });
    expect(results[0]).toMatchObject({
      kind: "assignment",
      courseId: "course-1",
      courseName: "Algorithms",
      source: {
        assignmentId: "a-1",
        title: "Homework 3",
        htmlUrl: "https://canvas.example.edu/courses/1/assignments/1",
      },
    });
    // Assert the New York calendar parts instead of one exact formatted string
    // so ICU variant formatting cannot break the test.
    // 2026-10-14T03:59Z is Oct 13, 11:59 PM in America/New_York.
    const text = results[0].text;
    for (const part of ["Homework 3", "CS 341", "due", "Oct", "13", "2026", "11:59", "worth 20 points", "graded 18/20"]) {
      expect(text).toContain(part);
    }
    expect(typeof results[0].score).toBe("number");
  });

  it("says no due date and not graded yet when the facts are missing", async () => {
    mockCourseFindMany.mockResolvedValue([
      courseRow({
        assignments: [
          {
            id: "a-2",
            title: "Reading Quiz 1",
            dueAt: null,
            hasDueDate: false,
            pointsPossible: 0,
            htmlUrl: null,
            grade: null,
          },
        ],
      }),
    ]);

    const results = await retrieveClassContext({ userId: "user-1", question: "reading quiz 1" });
    expect(results[0]).toMatchObject({
      kind: "assignment",
      text: "Reading Quiz 1 — CS 341 — no due date — not graded yet",
      source: { assignmentId: "a-2", title: "Reading Quiz 1", htmlUrl: null },
    });
  });

  it("returns the saved class details with the field names as the source", async () => {
    mockCourseFindMany.mockResolvedValue([
      courseRow({
        name: "Expository Writing",
        courseCode: "ENGL-101",
        syllabus: { fileName: "writing-syllabus.pdf", text: fixtureByName("points based").syllabusText },
        gradeSetup: { classDetails: { officeHours: "Friday 1-2 pm", instructor: "Dr. Dana Fox" } },
      }),
    ]);

    const results = await retrieveClassContext({ userId: "user-1", question: "when are office hours" });
    expect(results[0]).toMatchObject({
      kind: "class-details",
      courseId: "course-1",
      text: "office hours: Friday 1-2 pm\ninstructor: Dr. Dana Fox",
      source: { fields: ["officeHours", "instructor"] },
    });
  });

  it("skips null class detail fields", async () => {
    mockCourseFindMany.mockResolvedValue([
      courseRow({
        assignments: [
          {
            id: "a-3",
            title: "Survey",
            dueAt: null,
            hasDueDate: false,
            pointsPossible: 0,
            htmlUrl: null,
            grade: null,
          },
        ],
        gradeSetup: { classDetails: { officeHours: null, instructor: "Dr. Dana Fox" } },
      }),
    ]);

    const results = await retrieveClassContext({ userId: "user-1", question: "instructor" });
    expect(results[0]).toMatchObject({
      text: "instructor: Dr. Dana Fox",
      source: { fields: ["instructor"] },
    });
  });

  it("returns at most the requested number of items", async () => {
    mockCourseFindMany.mockResolvedValue([
      courseRow({
        assignments: Array.from({ length: 3 }, (_, i) => ({
          id: `a-${i}`,
          title: `Quiz ${i + 1}`,
          dueAt: null,
          hasDueDate: false,
          pointsPossible: 5,
          htmlUrl: null,
          grade: null,
        })),
      }),
    ]);

    const results = await retrieveClassContext({ userId: "user-1", question: "quiz", limit: 2 });
    expect(results).toHaveLength(2);
    for (const item of results) {
      expect(item.kind).toBe("assignment");
    }
  });

  it("defaults to eight items", async () => {
    mockCourseFindMany.mockResolvedValue([
      courseRow({
        assignments: Array.from({ length: 12 }, (_, i) => ({
          id: `a-${i}`,
          title: `Quiz ${i + 1}`,
          dueAt: null,
          hasDueDate: false,
          pointsPossible: 5,
          htmlUrl: null,
          grade: null,
        })),
      }),
    ]);

    const results = await retrieveClassContext({ userId: "user-1", question: "quiz" });
    expect(results).toHaveLength(8);
  });

  it("re-slices the stored syllabus exactly for every returned syllabus item", async () => {
    const storedText = fixtureByName("points based").syllabusText;
    mockCourseFindMany.mockResolvedValue([
      courseRow({
        name: "Expository Writing",
        courseCode: "ENGL-101",
        syllabus: { fileName: "writing-syllabus.pdf", text: storedText },
      }),
    ]);

    const results = await retrieveClassContext({ userId: "user-1", question: "grades earned paper points" });
    const syllabusItems = results.filter((item) => item.kind === "syllabus");
    expect(syllabusItems.length).toBeGreaterThan(0);
    for (const item of syllabusItems) {
      const source = item.source as { fileName: string; start: number; end: number };
      expect(storedText.slice(source.start, source.end)).toBe(item.text);
    }
  });

  it("ranks hw 3 above items whose dates or points merely contain a 3", async () => {
    mockCourseFindMany.mockResolvedValue([
      courseRow({
        assignments: [
          {
            id: "quiz-2",
            title: "Quiz 2",
            dueAt: new Date("2027-03-03T19:59:00-05:00"),
            hasDueDate: true,
            pointsPossible: 3,
            htmlUrl: null,
            grade: null,
          },
          {
            id: "lab-a",
            title: "Lab A",
            dueAt: null,
            hasDueDate: false,
            pointsPossible: 3,
            htmlUrl: null,
            grade: null,
          },
          {
            id: "hw-3",
            title: "Homework 3",
            dueAt: new Date("2026-10-14T03:59:00Z"),
            hasDueDate: true,
            pointsPossible: 20,
            htmlUrl: null,
            grade: null,
          },
        ],
      }),
    ]);

    const results = await retrieveClassContext({ userId: "user-1", question: "when is hw 3 due" });
    expect(results[0]).toMatchObject({
      kind: "assignment",
      text: expect.stringContaining("Homework 3"),
    });
  });

  it("expands hw to homework on its own, without help from a number in the title", async () => {
    mockCourseFindMany.mockResolvedValue([
      courseRow({
        assignments: [
          { id: "quiz-1", title: "Quiz 1", dueAt: null, hasDueDate: false, pointsPossible: 10, htmlUrl: null, grade: null },
          { id: "hw-1", title: "Homework 1", dueAt: null, hasDueDate: false, pointsPossible: 10, htmlUrl: null, grade: null },
        ],
      }),
    ]);

    const results = await retrieveClassContext({ userId: "user-1", question: "hw" });
    expect(results[0]).toMatchObject({ kind: "assignment", text: expect.stringContaining("Homework 1") });
  });

  it("does not match an assignment on a number that only appears in its date or points", async () => {
    mockCourseFindMany.mockResolvedValue([
      courseRow({
        assignments: [
          {
            id: "lab-a",
            title: "Lab A",
            dueAt: new Date("2027-03-03T19:59:00-05:00"),
            hasDueDate: true,
            pointsPossible: 37,
            htmlUrl: null,
            grade: null,
          },
        ],
      }),
    ]);

    // 2027 is only in the due date and 37 only in the points: neither is searchable, so the
    // question finds nothing rather than a confident wrong match.
    await expect(retrieveClassContext({ userId: "user-1", question: "2027" })).resolves.toEqual([]);
    await expect(retrieveClassContext({ userId: "user-1", question: "37" })).resolves.toEqual([]);
  });

  it("answers a grade question with graded assignments of the named course", async () => {
    mockCourseFindMany.mockResolvedValue([
      courseRow({
        assignments: [
          {
            id: "hw-1",
            title: "Homework 1",
            dueAt: null,
            hasDueDate: false,
            pointsPossible: 20,
            htmlUrl: null,
            grade: { score: 18 },
          },
          {
            id: "hw-2",
            title: "Homework 2",
            dueAt: null,
            hasDueDate: false,
            pointsPossible: 20,
            htmlUrl: null,
            grade: null,
          },
        ],
      }),
    ]);

    const results = await retrieveClassContext({
      userId: "user-1",
      question: "what's my grade in algorithms for homework 1",
    });
    expect(results[0]).toMatchObject({
      kind: "assignment",
      courseId: "course-1",
      text: expect.stringContaining("graded 18/20"),
    });
    for (const item of results) {
      expect(item.courseId).toBe("course-1");
    }
  });

  it("finds the midterm either as the Exam 1 assignment or the syllabus line", async () => {
    mockCourseFindMany.mockResolvedValue([
      courseRow({
        syllabus: {
          fileName: "algorithms-syllabus.pdf",
          text: "Algorithms syllabus\nMidterm exam is in week 7.",
        },
        assignments: [
          {
            id: "exam-1",
            title: "Exam 1",
            dueAt: null,
            hasDueDate: false,
            pointsPossible: 100,
            htmlUrl: null,
            grade: null,
          },
        ],
      }),
    ]);

    const results = await retrieveClassContext({ userId: "user-1", question: "when's the midterm" });
    const top = results[0];
    const findsMidterm =
      (top.kind === "syllabus" && top.text.toLowerCase().includes("midterm")) ||
      (top.kind === "assignment" && (top.source as { title: string }).title === "Exam 1");
    expect(findsMidterm).toBe(true);
  });

  it("never indexes internal class detail keys like finalExamAssignmentId", async () => {
    mockCourseFindMany.mockResolvedValue([
      courseRow({
        name: "Expository Writing",
        courseCode: "ENGL-101",
        gradeSetup: {
          classDetails: {
            instructor: "Dr. Dana Fox",
            finalExamAssignmentId: "internal-clerk-id-1",
          },
        },
      }),
    ]);

    const results = await retrieveClassContext({ userId: "user-1", question: "who is my instructor" });
    expect(results[0]).toMatchObject({
      kind: "class-details",
      source: { fields: ["instructor"] },
    });
    expect(JSON.stringify(results)).not.toContain("finalExamAssignmentId");
    expect(JSON.stringify(results)).not.toContain("internal-clerk-id-1");
  });
});
