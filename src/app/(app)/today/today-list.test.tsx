// @vitest-environment jsdom
import { act, type ReactElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { mockGetTodayAssignments } = vi.hoisted(() => ({
  mockGetTodayAssignments: vi.fn(),
}));

vi.mock("@/lib/today-client", () => ({
  getTodayAssignments: mockGetTodayAssignments,
}));

import { TodayList } from "./today-list";

const assignments = ["Soon", "Next", "Later"].map((title, index) => ({
  id: `assignment-${index}`,
  title,
  dueAt: `2026-10-${26 + index}T12:00:00.000Z`,
  hasDueDate: true,
  pointsPossible: 20,
  course: { id: "course-1", name: "Algorithms", courseCode: "CS-341" },
}));

async function withMounted(element: ReactElement, test: (container: HTMLElement) => Promise<void>) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  const actEnvironment = globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean };
  const previousActEnvironment = actEnvironment.IS_REACT_ACT_ENVIRONMENT;
  actEnvironment.IS_REACT_ACT_ENVIRONMENT = true;
  try {
    await act(async () => {
      root.render(element);
    });
    await test(container);
  } finally {
    await act(async () => {
      root.unmount();
    });
    actEnvironment.IS_REACT_ACT_ENVIRONMENT = previousActEnvironment;
    container.remove();
  }
}

async function enterHours(input: HTMLInputElement, value: string) {
  await act(async () => {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
    setter?.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.dispatchEvent(new Event("change", { bubbles: true }));
  });
}

describe("TodayList", () => {
  beforeEach(() => {
    const values = new Map<string, string>();
    Object.defineProperty(window, "localStorage", {
      configurable: true,
      value: {
        getItem: (key: string) => values.get(key) ?? null,
        setItem: (key: string, value: string) => values.set(key, value),
        removeItem: (key: string) => values.delete(key),
        clear: () => values.clear(),
      },
    });
  });

  afterEach(() => {
    window.localStorage.clear();
    vi.clearAllMocks();
  });

  it("trims the due-date-ranked assignment list to fit the entered hours", async () => {
    mockGetTodayAssignments.mockResolvedValue({ ok: true, status: 200, data: { assignments } });

    await withMounted(<TodayList />, async (container) => {
      expect(container.textContent).toContain("Soon");
      expect(container.textContent).toContain("Next");
      expect(container.textContent).toContain("Later");

      const input = container.querySelector('input[type="number"]') as HTMLInputElement;
      await enterHours(input, "2");

      expect(container.textContent).toContain("Soon");
      expect(container.textContent).toContain("Next");
      expect(container.textContent).not.toContain("Later");
      expect(container.textContent).toContain("Showing 2 of 3 assignments");
    });
  });

  it("saves the evening hours in local storage and restores them on the next visit", async () => {
    mockGetTodayAssignments.mockResolvedValue({ ok: true, status: 200, data: { assignments } });

    await withMounted(<TodayList />, async (container) => {
      const input = container.querySelector('input[type="number"]') as HTMLInputElement;
      await enterHours(input, "2.5");
      expect(window.localStorage.getItem("priority-evening-hours")).toBe("2.5");
    });

    await withMounted(<TodayList />, async (container) => {
      expect((container.querySelector('input[type="number"]') as HTMLInputElement).value).toBe("2.5");
      expect(container.textContent).toContain("Showing 2 of 3 assignments");
    });
  });
});
