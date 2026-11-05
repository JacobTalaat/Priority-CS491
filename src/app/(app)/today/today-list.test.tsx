import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { TodayItem } from "@/lib/today-client";
import { TodayItems } from "./today-list";

function item(overrides: Partial<TodayItem>): TodayItem {
  return {
    rank: 1,
    assignmentId: "a1",
    courseId: "c1",
    courseName: "Algorithms",
    title: "Problem Set 4",
    dueAt: "2026-10-31T03:59:00.000Z",
    dueDay: "2026-10-30",
    overdue: false,
    share: 15,
    hours: null,
    estimated: false,
    score: 15,
    reason: "Due tomorrow, 15 percent of your grade",
    boundary: null,
    ...overrides,
  };
}

describe("TodayItems", () => {
  it("shows course, title, due date, share, and reason for each item, in the order given", () => {
    const html = renderToStaticMarkup(
      <TodayItems
        items={[
          item({}),
          item({ rank: 2, assignmentId: "a2", title: "Lab 3", courseName: "Databases", share: 4, reason: "Due Saturday, 4 percent of your grade" }),
        ]}
      />,
    );
    expect(html).toMatch(/<ol[^>]*aria-label="Today"/);
    expect(html.indexOf("Problem Set 4")).toBeLessThan(html.indexOf("Lab 3"));
    expect(html).toContain("Algorithms");
    expect(html).toContain("Due Fri, Oct 30, 11:59 PM");
    expect(html).toContain("Due tomorrow, 15 percent of your grade");
    expect(html).toContain(">15%<");
    expect(html).toContain(">4%<");
    expect(html).toContain("of grade");
  });

  it("shows the boundary flag as a tag", () => {
    const html = renderToStaticMarkup(
      <TodayItems
        items={[
          item({ boundary: { letter: "A-", cutoff: 90, direction: "at-risk", distance: 1 } }),
          item({ rank: 2, assignmentId: "a2", boundary: { letter: "B+", cutoff: 87, direction: "within-reach", distance: 0.5 } }),
        ]}
      />,
    );
    expect(html).toContain("A- at risk");
    expect(html).toContain("B+ within reach");
  });

  it("marks overdue work and leaves out the share badge when there is no share", () => {
    const html = renderToStaticMarkup(
      <TodayItems items={[item({ overdue: true, dueAt: "2026-10-28T03:59:00.000Z", share: null })]} />,
    );
    expect(html).toContain("Overdue, was due Tue, Oct 27, 11:59 PM");
    expect(html).not.toContain("of grade");
  });

  it("says so when there is nothing on the list", () => {
    expect(renderToStaticMarkup(<TodayItems items={[]} />)).toContain("Nothing on your list right now.");
  });
});
