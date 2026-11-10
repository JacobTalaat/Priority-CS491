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

// Drives the hours form: a budgeted submit is a loud reload.
async function submitHours(value: string) {
  const input = container.querySelector("input") as HTMLInputElement;
  const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
  await act(async () => {
    setValue?.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
    (container.querySelector("form") as HTMLFormElement).dispatchEvent(
      new Event("submit", { bubbles: true, cancelable: true }),
    );
  });
}

// Remounts the list so a test-owned GET queue serves the initial load: the
// beforeEach render has already consumed the shared default response.
async function remount() {
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
}

// A budgeted plan response: every item is unestimated, so each counts 1 hour.
function budgetPlan(items: TodayItem[], skippedCount: number) {
  return {
    ok: true as const,
    status: 200,
    data: {
      generatedAt: GENERATED_AT,
      items,
      hoursFilter: {
        hours: 2,
        plannedHours: items.length,
        unestimatedCount: items.length,
        skippedCount,
      },
    },
  };
}

// Server truth once Lab 3 (a2) is done and nothing else changed.
function withoutLab3() {
  return {
    ok: true as const,
    status: 200,
    data: {
      generatedAt: GENERATED_AT,
      items: [item("a1", "Problem Set 4", 1), item("a3", "Essay", 3)],
      hoursFilter: null,
    },
  };
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
    // Every done settle reconciles, so the GET after the save reports the
    // post-done truth.
    mockGetToday.mockResolvedValueOnce(withoutLab3());
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
    // Guards the undo ordering: no re-insert before the DELETE resolves, and
    // no row until the reconcile GET has applied.
    let resolveUndo: (value: unknown) => void = () => {};
    let resolveGet: (value: unknown) => void = () => {};
    mockUndoItem.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveUndo = resolve;
        }),
    );
    mockGetToday
      // The done's own reconcile lands first, then the undo's reconcile hangs.
      .mockResolvedValueOnce(withoutLab3())
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            resolveGet = resolve;
          }),
      );
    await click(button("Mark Lab 3 done"));
    await click(button("Undo"));
    // While the DELETE is still in flight the row must not be back on screen.
    expect(titles()).toEqual(["Problem Set 4", "Essay"]);
    await act(async () => {
      resolveUndo({ ok: true, status: 200, data: { assignmentId: "a2", undone: true } });
    });
    // The reconcile GET is still pending: the row is still off the list.
    expect(titles()).toEqual(["Problem Set 4", "Essay"]);
    await act(async () => {
      resolveGet({
        ok: true,
        status: 200,
        data: {
          generatedAt: GENERATED_AT,
          items: [item("a1", "Problem Set 4", 1), item("a2", "Lab 3", 2), item("a3", "Essay", 3)],
          hoursFilter: null,
        },
      });
    });
    expect(titles()).toEqual(["Problem Set 4", "Lab 3", "Essay"]);
    expect(mockUndoItem).toHaveBeenCalledWith("a2", expect.any(String));
    expect(mockMarkDone.mock.invocationCallOrder[0]).toBeLessThan(mockUndoItem.mock.invocationCallOrder[0]);
    expect(mockGetToday).toHaveBeenCalledTimes(3);
    expect(container.textContent).not.toContain("Marked “Lab 3” done.");
  });

  it("Undo goes away after a few seconds and the item stays done", async () => {
    vi.useFakeTimers();
    mockGetToday.mockResolvedValueOnce(withoutLab3());
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
    mockGetToday.mockResolvedValueOnce(withoutLab3());
    await click(button("Mark Lab 3 done"));
    await click(button("Undo"));
    expect(container.textContent).toContain("Couldn't undo “Lab 3”.");
    expect(mockGetToday).toHaveBeenCalledTimes(3);
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
    // A's failure reconcile still reads the server with both rows open; once
    // B's done saves, later GETs report the post-done truth.
    mockGetToday
      .mockResolvedValue({
        ok: true,
        status: 200,
        data: {
          generatedAt: GENERATED_AT,
          items: [item("a1", "Problem Set 4", 1), item("a3", "Essay", 3)],
          hoursFilter: null,
        },
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        data: {
          generatedAt: GENERATED_AT,
          items: [item("a1", "Problem Set 4", 1), item("a2", "Lab 3", 2), item("a3", "Essay", 3)],
          hoursFilter: null,
        },
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
    // The reconciles while B's done is pending still read it as open; after it
    // saves, the GETs report the post-done truth.
    mockGetToday
      .mockResolvedValue({
        ok: true,
        status: 200,
        data: {
          generatedAt: GENERATED_AT,
          items: [item("a1", "Problem Set 4", 1), item("a3", "Essay", 3)],
          hoursFilter: null,
        },
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        data: {
          generatedAt: GENERATED_AT,
          items: [item("a1", "Problem Set 4", 1), item("a2", "Lab 3", 2), item("a3", "Essay", 3)],
          hoursFilter: null,
        },
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        data: {
          generatedAt: GENERATED_AT,
          items: [item("a1", "Problem Set 4", 1), item("a2", "Lab 3", 2), item("a3", "Essay", 3)],
          hoursFilter: null,
        },
      });
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
    // Guards the quiet reload: a loud reload would unmount the rows, flashing
    // the loading state and dropping the open details and keyboard focus.
    let resolveUndo: (value: unknown) => void = () => {};
    let resolveGet: (value: unknown) => void = () => {};
    mockUndoItem.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveUndo = resolve;
        }),
    );
    // The done's own reconcile lands first; the undo's reconcile GET is
    // deferred so the in-flight state is really observed.
    mockGetToday
      .mockResolvedValueOnce(withoutLab3())
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            resolveGet = resolve;
          }),
      );
    await click(button("Mark Lab 3 done"));
    const details = container.querySelector("details") as HTMLDetailsElement;
    details.setAttribute("open", "");
    const doneButton = button("Mark Problem Set 4 done");
    doneButton.focus();
    await click(button("Undo"));
    // The DELETE is deferred: no row back yet, and no loading state.
    expect(titles()).toEqual(["Problem Set 4", "Essay"]);
    expect(container.textContent).not.toContain("Loading your list…");
    expect(document.contains(details)).toBe(true);
    expect(details.hasAttribute("open")).toBe(true);
    expect(document.activeElement).toBe(doneButton);
    await act(async () => {
      resolveUndo({ ok: true, status: 200, data: { assignmentId: "a2", undone: true } });
    });
    // The reconcile GET is still pending: still quiet, still the same nodes.
    expect(mockGetToday).toHaveBeenCalledTimes(3);
    expect(titles()).toEqual(["Problem Set 4", "Essay"]);
    expect(container.textContent).not.toContain("Loading your list…");
    expect(document.contains(details)).toBe(true);
    expect(details.hasAttribute("open")).toBe(true);
    expect(document.activeElement).toBe(doneButton);
    await act(async () => {
      resolveGet({
        ok: true,
        status: 200,
        data: {
          generatedAt: GENERATED_AT,
          items: [item("a1", "Problem Set 4", 1), item("a2", "Lab 3", 2), item("a3", "Essay", 3)],
          hoursFilter: null,
        },
      });
    });
    // The row came back through the SAME DOM node: details open, focus intact.
    expect(titles()).toEqual(["Problem Set 4", "Lab 3", "Essay"]);
    expect(container.textContent).not.toContain("Loading your list…");
    expect(document.contains(details)).toBe(true);
    expect(details.hasAttribute("open")).toBe(true);
    expect(document.activeElement).toBe(doneButton);
  });

  it("keeps the rows, offers Reload list, and shows the error when the undo's reload fails", async () => {
    // Guards the quiet failure path: the list stays and the notice carries the
    // way out instead of the page flipping to the error state.
    mockGetToday
      .mockResolvedValueOnce(withoutLab3())
      .mockResolvedValueOnce({ ok: false, status: 500, error: "Something went wrong (500). Try again." });
    await click(button("Mark Lab 3 done"));
    await click(button("Undo"));
    // The quiet reload failed, so the list stays as it was and the notice speaks.
    expect(titles()).toEqual(["Problem Set 4", "Essay"]);
    expect(container.textContent).toContain("Couldn't refresh your list.");
    expect(button("Reload list")).toBeTruthy();
    expect(container.textContent).not.toContain("Loading your list…");
  });

  it("shows Updating your plan while a budgeted done is pending, then the fresh plan", async () => {
    // Guards rule 2: while a budgeted done has not been reconciled, neither
    // empty state may render from the stale plan.
    mockGetToday
      .mockReset()
      .mockResolvedValueOnce(budgetPlan([item("a1", "Problem Set 4", 1)], 1))
      .mockResolvedValue(budgetPlan([item("a2", "Lab 3", 2)], 0));
    await remount();
    expect(titles()).toEqual(["Problem Set 4"]);

    let resolveDone: (value: unknown) => void = () => {};
    mockMarkDone.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveDone = resolve;
        }),
    );
    await click(button("Mark Problem Set 4 done"));
    // While the POST is pending, the stale plan must not claim anything.
    expect(container.textContent).not.toContain("Nothing fits");
    expect(container.textContent).not.toContain("all caught up");
    expect(container.textContent).toContain("Updating your plan…");

    await act(async () => {
      resolveDone({ ok: true, status: 200, data: { assignmentId: "a1", status: "done" } });
    });
    // The reconcile GET landed: the fresh plan admits Lab 3.
    expect(titles()).toEqual(["Lab 3"]);
    expect(container.textContent).not.toContain("Nothing fits");
    expect(container.textContent).not.toContain("Updating your plan…");
    expect(container.textContent).not.toContain("Loading your list…");
  });

  it("shows a Reload list error and no empty state when the budgeted reconcile fails", async () => {
    // Guards rules 2 and 4 together: the failed reconcile replaces the
    // "Updating your plan…" line and never falls back to the stale empty state.
    mockGetToday
      .mockReset()
      .mockResolvedValueOnce(budgetPlan([item("a1", "Problem Set 4", 1)], 1))
      .mockResolvedValue({ ok: false, status: 500, error: "Something went wrong (500). Try again." });
    await remount();

    await click(button("Mark Problem Set 4 done"));
    expect(container.textContent).toContain("Couldn't refresh your list.");
    expect(button("Reload list")).toBeTruthy();
    expect(container.textContent).not.toContain("Nothing fits");
    expect(container.textContent).not.toContain("Updating your plan…");
  });

  it("Reload list performs a loud reload and clears the error on success", async () => {
    // Guards rule 4: the button is a loud reload, and a success clears the error.
    mockGetToday
      .mockReset()
      .mockResolvedValueOnce(budgetPlan([item("a1", "Problem Set 4", 1)], 1))
      .mockResolvedValueOnce({ ok: false, status: 500, error: "Something went wrong (500). Try again." })
      .mockResolvedValue(budgetPlan([item("a2", "Lab 3", 2)], 0));
    await remount();

    await click(button("Mark Problem Set 4 done"));
    expect(container.textContent).toContain("Couldn't refresh your list.");
    await click(button("Reload list"));
    expect(titles()).toEqual(["Lab 3"]);
    expect(container.textContent).not.toContain("Couldn't refresh your list.");
    expect(container.textContent).not.toContain("Nothing fits");
  });

  it("skips a quiet reload while a loud one is in flight instead of breaking it", async () => {
    // Guards rule 3: the quiet reload must neither run against the loud GET
    // nor invalidate its response, which would leave the page loading forever.
    let resolveLoud: (value: unknown) => void = () => {};
    mockGetToday
      .mockReset()
      // The done's own reconcile lands first (the done already saved).
      .mockResolvedValueOnce(withoutLab3())
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            resolveLoud = resolve;
          }),
      )
      // Any quiet GET that did run against the skip would fail here.
      .mockResolvedValue({ ok: false, status: 500, error: "Something went wrong (500). Try again." });
    await click(button("Mark Lab 3 done"));
    await submitHours("");
    // The loud reload owns the loading state.
    expect(container.textContent).toContain("Loading your list…");
    await click(button("Undo"));
    // The undo's reconcile was skipped, not fetched: only the done's reconcile
    // and the loud GET have run.
    expect(mockGetToday).toHaveBeenCalledTimes(2);
    await act(async () => {
      resolveLoud({
        ok: true,
        status: 200,
        data: {
          generatedAt: GENERATED_AT,
          items: [item("a1", "Problem Set 4", 1), item("a3", "Essay", 3)],
          hoursFilter: null,
        },
      });
    });
    // The loud response was applied: the page is not stuck in loading.
    expect(titles()).toEqual(["Problem Set 4", "Essay"]);
    expect(container.textContent).not.toContain("Loading your list…");
    // The owed reconcile re-ran and failed quietly; the list is kept.
    expect(container.textContent).toContain("Couldn't refresh your list.");
    expect(button("Reload list")).toBeTruthy();
  });

  it("never shows a row whose done saved while a GET was in flight (no budget)", async () => {
    // Guards rule 1: a GET that started before a save settled must not
    // resurrect the saved row, even when it reports the item still open.
    let resolveDone: (value: unknown) => void = () => {};
    let resolveGet: (value: unknown) => void = () => {};
    mockMarkDone.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveDone = resolve;
        }),
    );
    mockGetToday
      // Later GETs report the post-done truth, as the server would.
      .mockResolvedValue(withoutLab3())
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            resolveGet = resolve;
          }),
      );
    await click(button("Mark Lab 3 done"));
    // A user reload (Show what fits with an empty box) starts the loud GET.
    await submitHours("");
    await act(async () => {
      resolveDone({ ok: true, status: 200, data: { assignmentId: "a2", status: "done" } });
    });
    await act(async () => {
      resolveGet({
        ok: true,
        status: 200,
        data: {
          generatedAt: GENERATED_AT,
          items: [item("a1", "Problem Set 4", 1), item("a2", "Lab 3", 2), item("a3", "Essay", 3)],
          hoursFilter: null,
        },
      });
    });
    expect(titles()).toEqual(["Problem Set 4", "Essay"]);
  });

  it("never shows a row whose done saved while a GET was in flight (budget)", async () => {
    // Guards rule 1 under a budget: the skipped reconcile re-runs after the
    // loud GET and the saved row stays off the list the whole time.
    let resolveDone: (value: unknown) => void = () => {};
    let resolveGet: (value: unknown) => void = () => {};
    mockMarkDone.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveDone = resolve;
        }),
    );
    mockGetToday
      .mockReset()
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            resolveGet = resolve;
          }),
      )
      .mockResolvedValue(budgetPlan([item("a1", "Problem Set 4", 1), item("a3", "Essay", 3)], 0));
    await click(button("Mark Lab 3 done"));
    // Budget the plan so the deferred GET reports Lab 3 as fitting again.
    await submitHours("2");
    await act(async () => {
      resolveDone({ ok: true, status: 200, data: { assignmentId: "a2", status: "done" } });
    });
    await act(async () => {
      resolveGet(
        budgetPlan([item("a1", "Problem Set 4", 1), item("a2", "Lab 3", 2), item("a3", "Essay", 3)], 0),
      );
    });
    expect(titles()).toEqual(["Problem Set 4", "Essay"]);
  });

  it("quietly reconciles after a done even when no hours filter is active", async () => {
    // Guards R1: every done settle schedules a quiet reconcile — the plan on
    // screen must come from the server, with no loading flash.
    mockGetToday.mockResolvedValueOnce(withoutLab3());
    await click(button("Mark Lab 3 done"));
    expect(titles()).toEqual(["Problem Set 4", "Essay"]);
    expect(mockGetToday).toHaveBeenCalledTimes(2);
    expect(container.textContent).not.toContain("Loading your list…");
  });

  it("reconciles a no-budget done that a budget submit overtook", async () => {
    // Guards R1+R2: the done's quiet reconcile runs even though no budget was
    // active at click time, so the budgeted plan built while the POST was
    // pending cannot stick as a false "Nothing fits".
    let resolveDone: (value: unknown) => void = () => {};
    let resolveGet: (value: unknown) => void = () => {};
    let resolveOwed: (value: unknown) => void = () => {};
    mockMarkDone.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveDone = resolve;
        }),
    );
    mockGetToday
      .mockReset()
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            resolveGet = resolve;
          }),
      )
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            resolveOwed = resolve;
          }),
      )
      .mockResolvedValue(budgetPlan([item("a2", "Lab 3", 2)], 0));
    await click(button("Mark Problem Set 4 done"));
    // A 1-hour budget is submitted while the done POST is pending; its GET
    // picks Problem Set 4 and skips Lab 3.
    await submitHours("1");
    await act(async () => {
      resolveDone({ ok: true, status: 200, data: { assignmentId: "a1", status: "done" } });
    });
    await act(async () => {
      resolveGet(budgetPlan([item("a1", "Problem Set 4", 1)], 1));
    });
    // The picked row is filtered (its done saved), the plan is stale, and the
    // owed reconcile is in flight: no "Nothing fits" may stick.
    expect(titles()).toEqual([]);
    expect(container.textContent).toContain("Updating your plan…");
    expect(container.textContent).not.toContain("Nothing fits");
    await act(async () => {
      resolveOwed(budgetPlan([item("a2", "Lab 3", 2)], 0));
    });
    // The owed reconcile lands: Lab 3 now fits in the freed hour.
    expect(titles()).toEqual(["Lab 3"]);
    expect(container.textContent).not.toContain("Updating your plan…");
  });

  it("reconciles after the last done settles even when the budget was cleared mid-flight", async () => {
    // Guards R1+R2: the last done settles with no budget active, but the plan
    // is still stale from the budgeted click — only its reconcile clears
    // "Updating your plan…", so settling must always schedule one.
    mockGetToday
      .mockReset()
      .mockResolvedValueOnce(budgetPlan([item("a1", "Problem Set 4", 1), item("a2", "Lab 3", 2)], 0))
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        data: {
          generatedAt: GENERATED_AT,
          items: [item("a1", "Problem Set 4", 1), item("a2", "Lab 3", 2)],
          hoursFilter: null,
        },
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        data: { generatedAt: GENERATED_AT, items: [item("a2", "Lab 3", 2)], hoursFilter: null },
      })
      .mockResolvedValue({
        ok: true,
        status: 200,
        data: { generatedAt: GENERATED_AT, items: [], hoursFilter: null },
      });
    await remount();
    let resolveA: (value: unknown) => void = () => {};
    let resolveB: (value: unknown) => void = () => {};
    mockMarkDone.mockImplementation((assignmentId: string) =>
      assignmentId === "a1"
        ? new Promise((resolve) => {
            resolveA = resolve;
          })
        : new Promise((resolve) => {
            resolveB = resolve;
          }),
    );
    await click(button("Mark Problem Set 4 done"));
    await submitHours("");
    await click(button("Mark Lab 3 done"));
    await act(async () => {
      resolveA({ ok: true, status: 200, data: { assignmentId: "a1", status: "done" } });
    });
    // A's reconcile landed while B is still pending: the plan is not current.
    expect(container.textContent).toContain("Updating your plan…");
    expect(container.textContent).not.toContain("all caught up");
    await act(async () => {
      resolveB({ ok: true, status: 200, data: { assignmentId: "a2", status: "done" } });
    });
    // B's reconcile is plan-current, so the line clears and the caught-up
    // state finally speaks for the server.
    expect(container.textContent).not.toContain("Updating your plan…");
    expect(container.textContent).toContain("all caught up");
  });

  it("re-runs the owed reconcile even when the last loud reload is obsolete", async () => {
    // Guards R3: a loud reload that finishes obsolete (response discarded)
    // must still trigger the owed quiet reconcile once loudInFlight drops to 0.
    let resolveDone: (value: unknown) => void = () => {};
    let resolveLoud1: (value: unknown) => void = () => {};
    let resolveLoud2: (value: unknown) => void = () => {};
    mockMarkDone.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveDone = resolve;
        }),
    );
    mockGetToday
      .mockReset()
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            resolveLoud1 = resolve;
          }),
      )
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            resolveLoud2 = resolve;
          }),
      )
      .mockResolvedValue(budgetPlan([item("a2", "Lab 3", 2)], 1));
    await click(button("Mark Problem Set 4 done"));
    await submitHours("1");
    await submitHours("1");
    await act(async () => {
      resolveDone({ ok: true, status: 200, data: { assignmentId: "a1", status: "done" } });
    });
    // Both louds are in flight, so the done's reconcile is owed.
    await act(async () => {
      resolveLoud2(budgetPlan([item("a1", "Problem Set 4", 1)], 2));
    });
    // Loud 2 applies (the newest loud); its refired reconcile skips again
    // while loud 1 is still in flight.
    expect(titles()).toEqual([]);
    expect(container.textContent).toContain("Updating your plan…");
    await act(async () => {
      resolveLoud1(budgetPlan([item("a1", "Problem Set 4", 1)], 2));
    });
    // Loud 1 is discarded, but the owed reconcile still runs: the fresh plan
    // admits Lab 3 in the freed hour.
    expect(titles()).toEqual(["Lab 3"]);
    expect(container.textContent).not.toContain("Updating your plan…");
    expect(container.textContent).not.toContain("Nothing fits");
  });

  it("disables Reload list while a loud reload is in flight", async () => {
    // Guards R3's double-click guard: a loud reload cannot be started twice.
    mockGetToday
      .mockReset()
      .mockResolvedValueOnce(budgetPlan([item("a1", "Problem Set 4", 1)], 1))
      .mockResolvedValueOnce({ ok: false, status: 500, error: "Something went wrong (500). Try again." })
      .mockResolvedValue(budgetPlan([item("a2", "Lab 3", 2)], 0));
    await remount();
    await click(button("Mark Problem Set 4 done"));
    expect(button("Reload list")).toBeTruthy();

    let resolveLoud: (value: unknown) => void = () => {};
    mockGetToday.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveLoud = resolve;
        }),
    );
    await submitHours("2");
    expect(button("Reload list").disabled).toBe(true);
    await act(async () => {
      resolveLoud(budgetPlan([item("a2", "Lab 3", 2)], 0));
    });
    expect(container.textContent).not.toContain("Couldn't refresh your list.");
  });
});
