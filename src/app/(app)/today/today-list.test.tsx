// @vitest-environment jsdom
import { act } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createRoot } from "react-dom/client";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockGetToday, mockReadTodayHours, mockSaveTodayHours } = vi.hoisted(() => ({
  mockGetToday: vi.fn(),
  mockReadTodayHours: vi.fn(),
  mockSaveTodayHours: vi.fn(),
}));

vi.mock("@/lib/today-client", () => ({
  getToday: mockGetToday,
  markDone: vi.fn(),
  undoItem: vi.fn(),
}));

vi.mock("@/lib/today-hours", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/today-hours")>()),
  readTodayHours: mockReadTodayHours,
  saveTodayHours: mockSaveTodayHours,
}));

import type { TodayItem } from "@/lib/today-client";
import { TodayItems, TodayList } from "./today-list";

const GENERATED_AT = "2026-10-29T20:00:00.000Z";

function item(overrides: Partial<TodayItem>): TodayItem {
  return {
    rank: 1,
    assignmentId: "a1",
    courseId: "c1",
    courseName: "Algorithms",
    title: "Problem Set 4",
    htmlUrl: null,
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

// Thursday Oct 29, 2026, noon in New York, so the due labels don't depend on the clock.
const NOW = new Date("2026-10-29T16:00:00.000Z");

describe("TodayItems", () => {
  it("shows course, title, due date, share, and reason for each item, in the order given", () => {
    const html = renderToStaticMarkup(
      <TodayItems
        items={[
          item({}),
          item({ rank: 2, assignmentId: "a2", title: "Lab 3", courseName: "Databases", share: 4, reason: "Due Saturday, 4 percent of your grade" }),
        ]}
        now={NOW}
      />,
    );
    expect(html).toMatch(/<ol[^>]*aria-label="Today"/);
    expect(html.indexOf("Problem Set 4")).toBeLessThan(html.indexOf("Lab 3"));
    expect(html).toContain("Algorithms");
    expect(html).toContain("Due tomorrow, 11:59 PM");
    expect(html).toContain("Due tomorrow, 15 percent of your grade");
    expect(html).toContain(">15%<");
    expect(html).toContain(">4%<");
    expect(html).toContain("Weight share");
    expect(html).toContain("of grade");
  });

  it("keeps course, due date and the boundary flag visible without opening the row", () => {
    const html = renderToStaticMarkup(
      <TodayItems items={[item({ boundary: { letter: "A-", cutoff: 90, direction: "at-risk", distance: 1 } })]} now={NOW} />,
    );
    const summary = html.match(/<summary[^>]*>(.*?)<\/summary>/)?.[1] ?? "";
    expect(summary).toContain("Problem Set 4");
    expect(summary).toContain("Algorithms");
    expect(summary).toContain("Due tomorrow, 11:59 PM");
    expect(summary).toContain("A- at risk");
    // The reason and the Canvas link open underneath.
    expect(summary).not.toContain("percent of your grade");
  });

  it("shows a safe Open in Canvas link in the item details", () => {
    const html = renderToStaticMarkup(
      <TodayItems
        items={[
          item({ htmlUrl: "https://canvas.example.edu/courses/1/assignments/1" }),
          item({ assignmentId: "a2", htmlUrl: "javascript:alert(1)" }),
        ]}
      />,
    );
    expect(html).toContain('href="https://canvas.example.edu/courses/1/assignments/1"');
    expect(html).toContain(">Open in Canvas</a>");
    expect(html).toContain('rel="noopener noreferrer"');
    expect(html).not.toContain("javascript:");
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
      <TodayItems items={[item({ overdue: true, dueAt: "2026-10-28T03:59:00.000Z", share: null })]} now={NOW} />,
    );
    expect(html).toContain("Overdue, was due Tue, Oct 27");
    expect(html).not.toContain("of grade");
  });

  it("shows a friendly empty state and links to classes when there are no open items", () => {
    const html = renderToStaticMarkup(<TodayItems items={[]} />);
    expect(html).toContain("You&#x27;re all caught up!");
    expect(html).toContain("There are no open items right now.");
    expect(html).toContain('href="/classes"');
    expect(html).toContain("View classes");
    expect(html).not.toContain("<ol");
  });
});

describe("TodayList", () => {
  beforeEach(() => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    mockReadTodayHours.mockReset().mockReturnValue({ ok: true, hours: null });
    mockSaveTodayHours.mockReset().mockReturnValue(true);
    mockGetToday.mockReset().mockResolvedValue({
      ok: true,
      status: 200,
      data: { generatedAt: GENERATED_AT, items: [item({})], hoursFilter: null },
    });
  });

  it("offers an hours input and save action before loading the list", () => {
    const html = renderToStaticMarkup(<TodayList />);

    expect(html).toContain('type="number"');
    expect(html).toContain('min="0.5"');
    expect(html).toContain('max="12"');
    expect(html).toContain("Hours available tonight");
    expect(html).toContain("Each item counts as 1 hour unless it has an estimate.");
    expect(html).toContain("Show what fits");
  });

  async function renderLoadedList() {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    await act(async () => {
      root.render(<TodayList />);
    });
    return {
      container,
      unmount: async () => {
        await act(async () => {
          root.unmount();
        });
        container.remove();
      },
    };
  }

  it("shows a nothing-fits state, not the caught-up state, when the budget leaves open work off the list", async () => {
    mockGetToday.mockResolvedValue({
      ok: true,
      status: 200,
      data: {
        generatedAt: GENERATED_AT,
        items: [],
        hoursFilter: { hours: 1.5, plannedHours: 0, unestimatedCount: 0, skippedCount: 3 },
      },
    });
    const view = await renderLoadedList();
    expect(view.container.textContent).toContain("Nothing fits in 1.5 hours");
    expect(view.container.textContent).toContain(
      "Your open work is still there. Try more hours, or clear the box to see everything.",
    );
    expect(view.container.textContent).not.toContain("all caught up");
    await view.unmount();
  });

  it("keeps the caught-up state when the budget left nothing out and no work is open", async () => {
    mockGetToday.mockResolvedValue({
      ok: true,
      status: 200,
      data: {
        generatedAt: GENERATED_AT,
        items: [],
        hoursFilter: { hours: 2, plannedHours: 0, unestimatedCount: 0, skippedCount: 0 },
      },
    });
    const view = await renderLoadedList();
    expect(view.container.textContent).toContain("all caught up");
    expect(view.container.textContent).not.toContain("Nothing fits");
    await view.unmount();
  });

  it("Show all work clears the box and the saved hours and reloads the full list", async () => {
    mockReadTodayHours.mockReturnValue({ ok: true, hours: 1.5 });
    mockGetToday
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        data: {
          generatedAt: GENERATED_AT,
          items: [],
          hoursFilter: { hours: 1.5, plannedHours: 0, unestimatedCount: 0, skippedCount: 1 },
        },
      })
      .mockResolvedValue({
        ok: true,
        status: 200,
        data: { generatedAt: GENERATED_AT, items: [item({})], hoursFilter: null },
      });
    const view = await renderLoadedList();
    expect(view.container.textContent).toContain("Nothing fits in 1.5 hours");

    const showAll = [...view.container.querySelectorAll("button")].find(
      (entry) => entry.textContent === "Show all work",
    );
    expect(showAll).toBeTruthy();
    await act(async () => {
      showAll!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(mockSaveTodayHours).toHaveBeenCalledWith(null);
    expect(mockGetToday).toHaveBeenLastCalledWith(null);
    expect(view.container.textContent).toContain("Problem Set 4");
    expect(view.container.textContent).not.toContain("Nothing fits");
    expect((view.container.querySelector("input") as HTMLInputElement).value).toBe("");
    await view.unmount();
  });

  it("explains the 1-hour default in the summary while unestimated items are on the plan", async () => {
    mockGetToday.mockResolvedValue({
      ok: true,
      status: 200,
      data: {
        generatedAt: GENERATED_AT,
        items: [item({ estimated: false })],
        hoursFilter: { hours: 2, plannedHours: 1, unestimatedCount: 1, skippedCount: 0 },
      },
    });
    const view = await renderLoadedList();
    expect(view.container.textContent).toContain("Showing work that fits in 2 hours tonight.");
    expect(view.container.textContent).toContain("Items without a time estimate count as 1 hour.");
    await view.unmount();
  });

  it("leaves the 1-hour note out when every planned item has an estimate", async () => {
    mockGetToday.mockResolvedValue({
      ok: true,
      status: 200,
      data: {
        generatedAt: GENERATED_AT,
        items: [item({ estimated: true, hours: 2 })],
        hoursFilter: { hours: 2, plannedHours: 2, unestimatedCount: 0, skippedCount: 0 },
      },
    });
    const view = await renderLoadedList();
    expect(view.container.textContent).toContain("Showing work that fits in 2 hours tonight.");
    expect(view.container.textContent).not.toContain("Items without a time estimate count as 1 hour.");
    await view.unmount();
  });
});
