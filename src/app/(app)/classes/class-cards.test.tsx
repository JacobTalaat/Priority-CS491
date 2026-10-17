import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { GradeSetupCourse } from "@/lib/grade-setup-client";
import { ClassCards } from "./class-cards";

const loadedAt = Date.parse("2026-10-16T12:00:00.000Z");

function course(
  id: string,
  name: string,
  details: {
    supported: boolean;
    currentGrade: number | null;
    dueAt: string | null;
    confirmed: boolean;
  },
): GradeSetupCourse & {
  grade: {
    courseId: string;
    supported: boolean;
    currentGrade: number | null;
    categories: [];
    message: string | null;
  };
} {
  return {
    id,
    name,
    courseCode: `${id.toUpperCase()}-101`,
    term: "Fall 2026",
    assignmentGroups: [],
    assignments: details.dueAt
      ? [
          {
            id: `${id}-past-assignment`,
            title: `${name} past item`,
            dueAt: "2026-10-10T23:59:00.000Z",
            assignmentGroup: null,
          },
          { id: `${id}-assignment`, title: `${name} project`, dueAt: details.dueAt, assignmentGroup: null },
          {
            id: `${id}-later-assignment`,
            title: `${name} later project`,
            dueAt: "2026-10-25T23:59:00.000Z",
            assignmentGroup: null,
          },
        ]
      : [],
    gradeSetup: details.confirmed
      ? {
          categories: [{ name: "Homework", weight: 100 }],
          assignmentMappings: [],
          finalExamWeight: 0,
          cutoffs: {},
          classDetails: {},
          confirmedAt: "2026-10-01T00:00:00.000Z",
        }
      : null,
    grade: {
      courseId: id,
      supported: details.supported,
      currentGrade: details.currentGrade,
      categories: [],
      message: null,
    },
  };
}

describe("ClassCards", () => {
  it("renders one card per course with its grade, next due item, and setup status", () => {
    const html = renderToStaticMarkup(
      <ClassCards
        loadedAt={loadedAt}
        courses={[
          course("math", "Discrete Math", {
            supported: true,
            currentGrade: 91.25,
            dueAt: "2026-10-20T23:59:00.000Z",
            confirmed: true,
          }),
          course("art", "Studio Art", {
            supported: false,
            currentGrade: null,
            dueAt: null,
            confirmed: false,
          }),
        ]}
      />,
    );

    expect((html.match(/<article/g) ?? []).length).toBe(2);
    expect(html).toContain("Discrete Math");
    expect(html).toContain("91.3%");
    expect(html).toContain("Discrete Math project");
    expect(html).not.toContain("Discrete Math later project");
    expect(html).not.toContain("Discrete Math past item");
    expect(html).toContain("Confirmed");
    expect(html).toContain("Studio Art");
    expect(html).toContain("Unsupported");
    expect(html).toContain("No upcoming items");
    expect(html).toContain("Not confirmed");
  });
});
