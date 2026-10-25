// @vitest-environment jsdom
import { act, type ReactElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

const { mockGetImportedCourses, mockGetGradeSetupCourses } = vi.hoisted(() => ({
  mockGetImportedCourses: vi.fn(),
  mockGetGradeSetupCourses: vi.fn(),
}));

vi.mock("@/lib/canvas-client", () => ({
  canvasErrorMessage: vi.fn(),
  getImportedCourses: mockGetImportedCourses,
  syncNow: vi.fn(),
}));

vi.mock("@/lib/grade-setup-client", () => ({
  getGradeSetupCourses: mockGetGradeSetupCourses,
}));

vi.mock("@/lib/usage", () => ({
  logEvent: vi.fn(),
}));

import { ClassesList } from "./classes-list";

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

describe("ClassesList", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  function setCourseResults(connected: boolean, courseIds: string[], confirmedIds: string[] = []) {
    mockGetImportedCourses.mockResolvedValue({
      ok: true,
      status: 200,
      data: {
        connected,
        courses: courseIds.map((id) => ({
          id,
          name: `Class ${id}`,
          courseCode: `CS-${id}`,
          term: "Fall 2026",
          termEndsAt: null,
        })),
      },
    });
    mockGetGradeSetupCourses.mockResolvedValue({
      ok: true,
      status: 200,
      data: {
        courses: courseIds.map((id) => ({
          id,
          name: `Class ${id}`,
          courseCode: `CS-${id}`,
          term: "Fall 2026",
          assignmentGroups: [],
          assignments: [],
          gradeSetup: confirmedIds.includes(id) ? { confirmedAt: "2026-10-20T12:00:00.000Z" } : null,
        })),
      },
    });
  }

  it("announces that classes are loading", async () => {
    mockGetImportedCourses.mockReturnValue(new Promise(() => {}));
    mockGetGradeSetupCourses.mockReturnValue(new Promise(() => {}));

    await withMounted(<ClassesList />, async (container) => {
      expect(container.querySelector('[role="status"]')?.textContent).toContain("Loading your classes…");
    });
  });

  it.each([true, false])("shows the empty state and Canvas link when connected is %s", async (connected) => {
    setCourseResults(connected, []);

    await withMounted(<ClassesList />, async (container) => {
      expect(container.textContent).toContain("No classes yet");
      const link = container.querySelector('a[href="/settings"]');
      expect(link?.textContent).toBe("Connect Canvas");
      expect(container.textContent).toContain(
        connected ? "Sync Canvas to import the courses in your current term." : "Connect Canvas to import",
      );
    });
  });

  it("shows setup status and links each class to its own setup", async () => {
    setCourseResults(true, ["1", "2"], ["1"]);

    await withMounted(<ClassesList />, async (container) => {
      const classOneLink = container.querySelector('a[href="/weights?course=1"]');
      const classTwoLink = container.querySelector('a[href="/weights?course=2"]');
      expect(classOneLink?.textContent).toContain("Confirmed");
      expect(classTwoLink?.textContent).toContain("Not confirmed");
    });
  });
});
