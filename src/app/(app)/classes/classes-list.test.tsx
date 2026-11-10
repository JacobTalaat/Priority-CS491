// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createRoot } from "react-dom/client";
import { act } from "react";

const { mockGetImportedCourses, mockSyncNow, mockGetCourseGrade, mockLogEvent } = vi.hoisted(() => ({
  mockGetImportedCourses: vi.fn(),
  mockSyncNow: vi.fn(),
  mockGetCourseGrade: vi.fn(),
  mockLogEvent: vi.fn(),
}));

vi.mock("@/lib/canvas-client", () => ({
  getImportedCourses: mockGetImportedCourses,
  syncNow: mockSyncNow,
  canvasErrorMessage: (result: { status: number; error: string }) =>
    result.status === 401 ? "session expired" : result.error,
}));

vi.mock("@/lib/course-client", () => ({
  getCourseGrade: mockGetCourseGrade,
}));

vi.mock("@/lib/usage", () => ({
  logEvent: mockLogEvent,
}));

import type { ImportedCourse, ImportedCoursesResponse } from "@/lib/canvas-client";
import type { CourseGradeResponse } from "@/lib/course-client";
import { ClassesList } from "./classes-list";

const courses: ImportedCourse[] = [
  { id: "c1", name: "Algorithms", courseCode: "CS-341", term: "Fall 2026", termEndsAt: null },
  { id: "c2", name: "Databases", courseCode: "CS-331", term: "Fall 2026", termEndsAt: null },
];

const connected: ImportedCoursesResponse = { connected: true, courses };

function gradeResponse(overrides: Partial<CourseGradeResponse> = {}): CourseGradeResponse {
  return {
    setupConfirmed: true,
    engine: "weighted",
    letter: "A-",
    grade: { status: "calculated", percentage: 91.4 },
    breakdown: [],
    finalExam: { status: "no-final" },
    shares: [],
    ...overrides,
  };
}

function cards(container: HTMLElement): HTMLElement[] {
  return [...container.querySelectorAll("li")];
}

function buttonNamed(container: HTMLElement, name: string): HTMLButtonElement {
  const button = [...container.querySelectorAll("button")].find((item) => item.textContent === name);
  if (!button) {
    throw new Error(`No button named ${name}`);
  }
  return button;
}

// The initial load and the per-card grade requests settle asynchronously, so the
// assertions in the tests wait for the cards to leave their loading ellipsis.
function cardsLoaded(container: HTMLElement): boolean {
  return !container.textContent?.includes("…");
}

async function waitFor(condition: () => boolean) {
  await act(async () => {
    await vi.waitFor(() => {
      if (!condition()) {
        throw new Error("condition not met");
      }
    });
  });
}

// Mounts into a real DOM so a test can click the toggle, and always unmounts afterwards.
async function withMounted(element: React.ReactElement, test: (container: HTMLElement) => Promise<void>) {
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

async function click(element: HTMLElement) {
  await act(async () => {
    element.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
}

beforeEach(() => {
  mockGetImportedCourses.mockReset();
  mockSyncNow.mockReset();
  mockGetCourseGrade.mockReset();
  mockLogEvent.mockReset();
  localStorage.clear();
});

describe("ClassesList grid", () => {
  it("renders one linked card per course with its name and code/term meta line", async () => {
    mockGetImportedCourses.mockResolvedValue({ ok: true, status: 200, data: connected });
    mockGetCourseGrade.mockResolvedValue({ ok: true, status: 200, data: gradeResponse() });
    await withMounted(<ClassesList />, async (container) => {
      await waitFor(() => cardsLoaded(container));
      const links = [...container.querySelectorAll("a")].filter((link) =>
        link.getAttribute("href")?.startsWith("/classes/"),
      );
      expect(links).toHaveLength(2);
      expect(links[0]!.getAttribute("href")).toBe("/classes/c1");
      expect(links[1]!.getAttribute("href")).toBe("/classes/c2");
      expect(links[0]!.textContent).toContain("Algorithms");
      expect(links[1]!.textContent).toContain("Databases");
      expect(links[0]!.textContent).toContain("CS-341 · Fall 2026");
      expect(links[1]!.textContent).toContain("CS-331 · Fall 2026");
    });
  });

  it("shows the percentage and the letter when the grade is calculated", async () => {
    mockGetImportedCourses.mockResolvedValue({ ok: true, status: 200, data: connected });
    mockGetCourseGrade.mockResolvedValue({
      ok: true,
      status: 200,
      data: gradeResponse({ grade: { status: "calculated", percentage: 91.4 }, letter: "A-" }),
    });
    await withMounted(<ClassesList />, async (container) => {
      await waitFor(() => cardsLoaded(container));
      expect(container.textContent).toContain("91.4%");
      expect(container.textContent).toContain("A-");
    });
  });

  it("omits the letter when the grade carries none", async () => {
    mockGetImportedCourses.mockResolvedValue({ ok: true, status: 200, data: connected });
    mockGetCourseGrade.mockResolvedValue({
      ok: true,
      status: 200,
      data: gradeResponse({ grade: { status: "calculated", percentage: 75 }, letter: null }),
    });
    await withMounted(<ClassesList />, async (container) => {
      await waitFor(() => cardsLoaded(container));
      expect(container.textContent).toContain("75%");
      expect(container.textContent).not.toContain("A-");
    });
  });

  it("shows the class page wording for a class with nothing graded yet", async () => {
    mockGetImportedCourses.mockResolvedValue({ ok: true, status: 200, data: connected });
    mockGetCourseGrade.mockResolvedValue({
      ok: true,
      status: 200,
      data: gradeResponse({ grade: { status: "insufficient-data" }, letter: null }),
    });
    await withMounted(<ClassesList />, async (container) => {
      await waitFor(() => cardsLoaded(container));
      expect(container.textContent).toContain("No grade yet");
    });
  });

  it("shows the class page wording for a class with a rule the engine can't grade", async () => {
    mockGetImportedCourses.mockResolvedValue({ ok: true, status: 200, data: connected });
    mockGetCourseGrade.mockResolvedValue({
      ok: true,
      status: 200,
      data: gradeResponse({ grade: { status: "unsupported", reason: "unsupported-rule" }, letter: null }),
    });
    await withMounted(<ClassesList />, async (container) => {
      await waitFor(() => cardsLoaded(container));
      expect(container.textContent).toContain("Can’t work out a grade");
    });
  });

  it("isolates a failing grade request to its own card as Grade unavailable", async () => {
    mockGetImportedCourses.mockResolvedValue({ ok: true, status: 200, data: connected });
    mockGetCourseGrade.mockImplementation((courseId: string) =>
      courseId === "c1"
        ? Promise.resolve({ ok: false, status: 500, error: "Something went wrong (500). Try again." })
        : Promise.resolve({ ok: true, status: 200, data: gradeResponse() }),
    );
    await withMounted(<ClassesList />, async (container) => {
      await waitFor(() => cardsLoaded(container));
      expect(mockGetCourseGrade).toHaveBeenCalledTimes(2);
      expect(cards(container)[0]!.textContent).toContain("Grade unavailable");
      expect(cards(container)[0]!.textContent).not.toContain("A-");
      expect(cards(container)[1]!.textContent).toContain("A-");
      expect(cards(container)[1]!.textContent).toContain("91.4%");
    });
  });

  it("waits with a skeleton on every card while the grade requests are in flight", async () => {
    const released: (() => void)[] = [];
    mockGetImportedCourses.mockResolvedValue({ ok: true, status: 200, data: connected });
    mockGetCourseGrade.mockImplementation(() => {
      return new Promise((resolve) => {
        released.push(() => resolve({ ok: true, status: 200, data: gradeResponse() }));
      });
    });
    await withMounted(<ClassesList />, async (container) => {
      expect(cards(container)).toHaveLength(2);
      expect(container.textContent).toContain("…");
      expect(container.textContent).not.toContain("91.4%");
      await act(async () => {
        for (const release of released) {
          release();
        }
      });
      await waitFor(() => cardsLoaded(container));
      expect(container.textContent).toContain("91.4%");
      expect(container.textContent).toContain("A-");
    });
  });

  it("reloads the courses and their grades after Sync classes succeeds", async () => {
    mockGetImportedCourses.mockResolvedValue({ ok: true, status: 200, data: connected });
    mockGetCourseGrade.mockResolvedValue({ ok: true, status: 200, data: gradeResponse() });
    mockSyncNow.mockResolvedValue({
      ok: true,
      status: 200,
      data: { lastSyncedAt: "2026-11-09T10:00:00.000Z", courses: 2, assignmentGroups: 0, assignments: 0, grades: 0 },
    });
    await withMounted(<ClassesList />, async (container) => {
      await waitFor(() => cardsLoaded(container));
      expect(mockGetImportedCourses).toHaveBeenCalledTimes(1);
      expect(mockGetCourseGrade).toHaveBeenCalledTimes(2);
      await click(buttonNamed(container, "Sync classes"));
      await act(async () => {
        await vi.waitFor(() => {
          if (mockGetImportedCourses.mock.calls.length < 2) {
            throw new Error("courses not reloaded");
          }
        });
      });
      expect(mockGetCourseGrade).toHaveBeenCalledTimes(4);
      expect(mockGetCourseGrade.mock.calls.slice(2).map((call) => call[0])).toEqual(["c1", "c2"]);
    });
  });

  it("leaves the sync result as an error when Sync classes fails", async () => {
    mockGetImportedCourses.mockResolvedValue({ ok: true, status: 200, data: connected });
    mockGetCourseGrade.mockResolvedValue({ ok: true, status: 200, data: gradeResponse() });
    mockSyncNow.mockResolvedValue({ ok: false, status: 500, error: "Canvas rejected this token." });
    await withMounted(<ClassesList />, async (container) => {
      await waitFor(() => cardsLoaded(container));
      await click(buttonNamed(container, "Sync classes"));
      expect(container.textContent).toContain("Canvas rejected this token.");
      expect(mockGetImportedCourses).toHaveBeenCalledTimes(1);
    });
  });
});

describe("ClassesList show-grades toggle", () => {
  beforeEach(() => {
    mockGetImportedCourses.mockResolvedValue({ ok: true, status: 200, data: connected });
    mockGetCourseGrade.mockResolvedValue({ ok: true, status: 200, data: gradeResponse() });
  });

  it("is offered unpressed with grades shown", async () => {
    await withMounted(<ClassesList />, async (container) => {
      await waitFor(() => cardsLoaded(container));
      const button = buttonNamed(container, "Hide grades");
      expect(button.getAttribute("aria-pressed")).toBe("false");
      expect(container.textContent).toContain("91.4%");
      expect(container.textContent).not.toContain("Grade hidden");
    });
  });

  it("hides the numbers and renders a neutral placeholder instead", async () => {
    await withMounted(<ClassesList />, async (container) => {
      await waitFor(() => cardsLoaded(container));
      await click(buttonNamed(container, "Hide grades"));
      expect(buttonNamed(container, "Show grades").getAttribute("aria-pressed")).toBe("true");
      expect(container.textContent).not.toContain("91.4%");
      expect(container.textContent).not.toContain("A-");
      expect(container.textContent).toContain("Grade hidden");
      expect(cards(container).every((card) => card.textContent?.includes("Grade hidden"))).toBe(true);
    });
  });

  it("saves the choice to localStorage", async () => {
    await withMounted(<ClassesList />, async (container) => {
      await waitFor(() => cardsLoaded(container));
      await click(buttonNamed(container, "Hide grades"));
      expect(localStorage.getItem("priority.classes.showGrades")).toBe("false");
      await click(buttonNamed(container, "Show grades"));
      expect(localStorage.getItem("priority.classes.showGrades")).toBe("true");
    });
  });

  it("restores the hidden choice on mount", async () => {
    localStorage.setItem("priority.classes.showGrades", "false");
    await withMounted(<ClassesList />, async (container) => {
      await waitFor(() => cardsLoaded(container));
      expect(container.textContent).not.toContain("91.4%");
      expect(container.textContent).toContain("Grade hidden");
      expect(buttonNamed(container, "Show grades").getAttribute("aria-pressed")).toBe("true");
    });
  });

  it("still shows grades when reading localStorage throws", async () => {
    const getItem = vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    try {
      await withMounted(<ClassesList />, async (container) => {
        await waitFor(() => cardsLoaded(container));
        expect(container.textContent).toContain("91.4%");
        expect(container.textContent).toContain("A-");
        expect(container.textContent).not.toContain("Grade hidden");
      });
    } finally {
      getItem.mockRestore();
    }
  });

  it("keeps the choice applied even when writing localStorage throws", async () => {
    const setItem = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    try {
      await withMounted(<ClassesList />, async (container) => {
        await waitFor(() => cardsLoaded(container));
        await click(buttonNamed(container, "Hide grades"));
        expect(container.textContent).toContain("Grade hidden");
        expect(buttonNamed(container, "Show grades").getAttribute("aria-pressed")).toBe("true");
      });
    } finally {
      setItem.mockRestore();
    }
  });
});
