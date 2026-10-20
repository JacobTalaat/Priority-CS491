import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { ClassCard as ClassCardData } from "@/lib/class-cards-client";
import { ClassCard } from "./class-card";

const course: ClassCardData = {
  id: "course-1",
  name: "Algorithms",
  courseCode: "CS-341",
  term: "Fall 2026",
  confirmed: true,
  grade: { status: "calculated", percentage: 84 },
  categoryBreakdown: [],
  nextDue: { title: "Homework 2", dueAt: "2026-11-01T12:00:00.000Z" },
};

describe("ClassCard", () => {
  it("shows the course name, grade, next due item, and confirmed state", () => {
    const html = renderToStaticMarkup(<ClassCard course={course} />);

    expect(html).toContain("Algorithms");
    expect(html).toContain("CS-341 · Fall 2026");
    expect(html).toContain("84%");
    expect(html).toContain("Homework 2");
    expect(html).toContain('dateTime="2026-11-01T12:00:00.000Z"');
    expect(html).toContain("Setup confirmed");
  });

  it("shows Unsupported and an unconfirmed state when no grade setup exists", () => {
    const html = renderToStaticMarkup(
      <ClassCard
        course={{
          ...course,
          confirmed: false,
          grade: { status: "unsupported", reason: "no-confirmed-setup" },
          nextDue: null,
        }}
      />,
    );

    expect(html).toContain("Unsupported");
    expect(html).toContain("No upcoming assignments");
    expect(html).toContain("Setup not confirmed");
  });
});
