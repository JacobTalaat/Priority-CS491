// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { mockGetToday, mockMarkDone, mockUndoItem } = vi.hoisted(() => ({
  mockGetToday: vi.fn(),
  mockMarkDone: vi.fn(),
  mockUndoItem: vi.fn(),
}));

vi.mock("@/lib/today-client", () => ({
  getToday: mockGetToday,
  markDone: mockMarkDone,
  undoItem: mockUndoItem,
}));

import type { TodayItem } from "@/lib/today-client";
import { TodayList, UNDO_MS } from "./today-list";

function item(assignmentId: string, title: string, rank: number): TodayItem {
  return {
    rank,
    assignmentId,
    courseId: "c1",
    courseName: "Algorithms",
    title,
    htmlUrl: null,
    dueAt: "2026-10-31T03:59:00.000Z",
    dueDay: "2026-10-30",
    overdue: false,
    share: 10,
    hours: null,
    estimated: false,
    score: 10,
    reason: "Due tomorrow, 10 percent of your grade",
    boundary: null,
  };
}

const GENERATED_AT = "2026-10-29T20:00:00.000Z";
let container: HTMLDivElement;
let root: ReturnType<typeof createRoot>;

function titles(): string[] {
  return [...container.querySelectorAll("ol[aria-label='Today'] > li")].map(
    // The title is the summary's first line; course and due date follow it.
    (row) => row.querySelector("summary > span")?.textContent ?? "",
  );
}

function button(name: string): HTMLButtonElement {
  const found = [...container.querySelectorAll("button")].find(
    (entry) => entry.textContent === name || entry.getAttribute("aria-label") === name,
  );
  if (!found) {
    throw new Error(`No button ${name}`);
  }
  return found;
}

async function click(element: HTMLElement) {
  await act(async () => {
    element.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
}

beforeEach(async () => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  mockGetToday.mockReset().mockResolvedValue({
    ok: true,
    status: 200,
    data: {
      generatedAt: GENERATED_AT,
      items: [item("a1", "Problem Set 4", 1), item("a2", "Lab 3", 2), item("a3", "Essay", 3)],
      hoursFilter: null,
    },
  });
  mockMarkDone.mockReset().mockResolvedValue({ ok: true, status: 200, data: { assignmentId: "a2", status: "done" } });
  mockUndoItem.mockReset().mockResolvedValue({ ok: true, status: 200, data: { assignmentId: "a2", undone: true } });
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root.render(<TodayList />);
  });
});

afterEach(async () => {
  await act(async () => {
    root.unmount();
  });
  container.remove();
  vi.useRealTimers();
});

describe("marking an item done on Today", () => {
  it("removes the item, saves it as done with what was shown, and offers Undo", async () => {
    expect(titles()).toEqual(["Problem Set 4", "Lab 3", "Essay"]);
    await click(button("Mark Lab 3 done"));
    expect(titles()).toEqual(["Problem Set 4", "Essay"]);
    expect(mockMarkDone).toHaveBeenCalledTimes(1);
    const [assignmentId, shown, requestId] = mockMarkDone.mock.calls[0];
    expect(assignmentId).toBe("a2");
    expect(shown).toEqual({ rank: 2, listGeneratedAt: GENERATED_AT });
    expect(typeof requestId).toBe("string");
    expect(container.textContent).toContain("Marked “Lab 3” done.");
    expect(button("Undo")).toBeTruthy();
    // Positions are renumbered so the list never shows a gap.
    expect([...container.querySelectorAll("ol > li > span")].map((rank) => rank.textContent)).toEqual(["1", "2"]);
  });

  it("brings the item back only after the undo saves and the list reloads", async () => {
    let resolveUndo: (value: unknown) => void = () => {};
    mockUndoItem.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveUndo = resolve;
        }),
    );
    await click(button("Mark Lab 3 done"));
    await click(button("Undo"));
    // While the DELETE is still in flight the row must not be back on screen.
    expect(titles()).toEqual(["Problem Set 4", "Essay"]);
    await act(async () => {
      resolveUndo({ ok: true, status: 200, data: { assignmentId: "a2", undone: true } });
    });
    // The quiet reload after the undo is what brings the item back.
    expect(titles()).toEqual(["Problem Set 4", "Lab 3", "Essay"]);
    expect(mockUndoItem).toHaveBeenCalledWith("a2", expect.any(String));
    expect(mockMarkDone.mock.invocationCallOrder[0]).toBeLessThan(mockUndoItem.mock.invocationCallOrder[0]);
    expect(mockGetToday).toHaveBeenCalledTimes(2);
    expect(container.textContent).not.toContain("Marked “Lab 3” done.");
  });

  it("Undo goes away after a few seconds and the item stays done", async () => {
    vi.useFakeTimers();
    await click(button("Mark Lab 3 done"));
    await act(async () => {
      vi.advanceTimersByTime(UNDO_MS);
    });
    expect(container.textContent).not.toContain("Marked “Lab 3” done.");
    expect(titles()).toEqual(["Problem Set 4", "Essay"]);
    expect(mockUndoItem).not.toHaveBeenCalled();
  });

  it("reloads the list and says so when the done can't be saved", async () => {
    mockMarkDone.mockResolvedValue({ ok: false, status: 500, error: "Something went wrong (500). Try again." });
    await click(button("Mark Lab 3 done"));
    expect(titles()).toEqual(["Problem Set 4", "Lab 3", "Essay"]);
    expect(mockGetToday).toHaveBeenCalledTimes(2);
    expect(container.textContent).toContain("Couldn't mark “Lab 3” done. Something went wrong (500). Try again.");
    expect(container.textContent).not.toContain("Marked “Lab 3” done.");
  });

  it("reloads the list when an undo fails, so it shows what was really saved", async () => {
    mockUndoItem.mockResolvedValue({ ok: false, status: 500, error: "Something went wrong (500). Try again." });
    await click(button("Mark Lab 3 done"));
    await click(button("Undo"));
    expect(container.textContent).toContain("Couldn't undo “Lab 3”.");
    expect(mockGetToday).toHaveBeenCalledTimes(2);
  });

  it("does not resurrect a row whose done is still in flight when another done fails", async () => {
    let failA: () => void = () => {};
    let resolveB: (value: unknown) => void = () => {};
    mockMarkDone.mockImplementation((assignmentId: string) => {
      if (assignmentId === "a1") {
        return new Promise((resolve) => {
          failA = () => resolve({ ok: false, status: 500, error: "Something went wrong (500). Try again." });
        });
      }
      return new Promise((resolve) => {
        resolveB = resolve;
      });
    });
    await click(button("Mark Problem Set 4 done"));
    await click(button("Mark Lab 3 done"));
    expect(titles()).toEqual(["Essay"]);
    // A's POST fails while B's is still pending: the reconcile reload brings A
    // back, but the GET still reports B open, so B stays off the list.
    await act(async () => {
      failA();
    });
    expect(titles()).toEqual(["Problem Set 4", "Essay"]);
    await act(async () => {
      resolveB({ ok: true, status: 200, data: { assignmentId: "a2", status: "done" } });
    });
    // B's done succeeded, so it never comes back.
    expect(titles()).toEqual(["Problem Set 4", "Essay"]);
  });

  it("does not resurrect a pending done when the undo of another row reloads", async () => {
    let resolveB: (value: unknown) => void = () => {};
    mockMarkDone.mockImplementation((assignmentId: string) =>
      assignmentId === "a2"
        ? new Promise((resolve) => {
            resolveB = resolve;
          })
        : Promise.resolve({ ok: true, status: 200, data: { assignmentId: "a1", status: "done" } }),
    );
    await click(button("Mark Lab 3 done"));
    await click(button("Mark Problem Set 4 done"));
    await click(button("Undo"));
    // The undo's reload finds Lab 3 still open on the server, but its done is
    // in flight, so the row stays off the list.
    expect(titles()).toEqual(["Problem Set 4", "Essay"]);
    await act(async () => {
      resolveB({ ok: true, status: 200, data: { assignmentId: "a2", status: "done" } });
    });
    expect(titles()).toEqual(["Problem Set 4", "Essay"]);
  });

  it("keeps the list on screen during an undo, open details and all", async () => {
    let resolveUndo: (value: unknown) => void = () => {};
    mockUndoItem.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveUndo = resolve;
        }),
    );
    await click(button("Mark Lab 3 done"));
    const details = container.querySelector("details") as HTMLDetailsElement;
    details.setAttribute("open", "");
    await click(button("Undo"));
    // The quiet reload never flips to the loading state, so the row and its
    // open details stay exactly where they were.
    expect(container.textContent).not.toContain("Loading your list…");
    expect(details.hasAttribute("open")).toBe(true);
    await act(async () => {
      resolveUndo({ ok: true, status: 200, data: { assignmentId: "a2", undone: true } });
    });
    expect(titles()).toEqual(["Problem Set 4", "Lab 3", "Essay"]);
    expect(container.textContent).not.toContain("Loading your list…");
    expect(details.hasAttribute("open")).toBe(true);
  });

  it("keeps the rows and shows the error when the undo's reload fails", async () => {
    mockGetToday.mockResolvedValueOnce({ ok: false, status: 500, error: "Something went wrong (500). Try again." });
    await click(button("Mark Lab 3 done"));
    await click(button("Undo"));
    // The quiet reload failed, so the list stays as it was and the notice speaks.
    expect(titles()).toEqual(["Problem Set 4", "Essay"]);
    expect(container.textContent).toContain("Something went wrong (500). Try again.");
    expect(container.textContent).not.toContain("Loading your list…");
  });

  it("quietly rebuilds the plan after a done succeeds under a budget", async () => {
    // The beforeEach render already consumed the default list, so this test
    // remounts with its own queue: first a plan where Lab 3 does not fit.
    mockGetToday
      .mockReset()
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        data: {
          generatedAt: GENERATED_AT,
          items: [item("a1", "Problem Set 4", 1)],
          hoursFilter: { hours: 2, plannedHours: 1, unestimatedCount: 1, skippedCount: 1 },
        },
      })
      .mockResolvedValue({
        ok: true,
        status: 200,
        data: {
          generatedAt: GENERATED_AT,
          items: [item("a2", "Lab 3", 2)],
          hoursFilter: { hours: 2, plannedHours: 2, unestimatedCount: 1, skippedCount: 0 },
        },
      });
    await act(async () => {
      root.unmount();
    });
    container.remove();
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    await act(async () => {
      root.render(<TodayList />);
    });
    expect(titles()).toEqual(["Problem Set 4"]);

    await click(button("Mark Problem Set 4 done"));
    // The rebuilt plan admits Lab 3, so the old "nothing fits" claim never shows.
    expect(titles()).toEqual(["Lab 3"]);
    expect(container.textContent).not.toContain("Nothing fits");
    expect(container.textContent).not.toContain("Loading your list…");
  });

  it("does not reload after a successful done when no hours filter is active", async () => {
    await click(button("Mark Lab 3 done"));
    expect(titles()).toEqual(["Problem Set 4", "Essay"]);
    expect(mockGetToday).toHaveBeenCalledTimes(1);
  });
});
