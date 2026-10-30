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
    (row) => row.querySelector("p")?.textContent ?? "",
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

  it("Undo puts the item back where it was and undoes it after the done has saved", async () => {
    await click(button("Mark Lab 3 done"));
    await click(button("Undo"));
    expect(titles()).toEqual(["Problem Set 4", "Lab 3", "Essay"]);
    expect(mockUndoItem).toHaveBeenCalledWith("a2", expect.any(String));
    expect(mockMarkDone.mock.invocationCallOrder[0]).toBeLessThan(mockUndoItem.mock.invocationCallOrder[0]);
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

  it("puts the item back and says so when the done can't be saved", async () => {
    mockMarkDone.mockResolvedValue({ ok: false, status: 500, error: "Something went wrong (500). Try again." });
    await click(button("Mark Lab 3 done"));
    expect(titles()).toEqual(["Problem Set 4", "Lab 3", "Essay"]);
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
});
