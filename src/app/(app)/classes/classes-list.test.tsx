// @vitest-environment jsdom
import { act, type ReactElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ApiResult } from "@/lib/api-client";
import type { ImportedCoursesResponse } from "@/lib/canvas-client";

const { mockGetImportedCourses } = vi.hoisted(() => ({
  mockGetImportedCourses: vi.fn(),
}));

vi.mock("@/lib/canvas-client", () => ({
  canvasErrorMessage: vi.fn(),
  getImportedCourses: mockGetImportedCourses,
  syncNow: vi.fn(),
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

  it("announces that classes are loading", async () => {
    mockGetImportedCourses.mockReturnValue(new Promise(() => {}));

    await withMounted(<ClassesList />, async (container) => {
      expect(container.querySelector('[role="status"]')?.textContent).toContain("Loading your classes…");
    });
  });

  it.each([true, false])("shows the empty state and Canvas link when connected is %s", async (connected) => {
    const result: ApiResult<ImportedCoursesResponse> = {
      ok: true,
      status: 200,
      data: { connected, courses: [] },
    };
    mockGetImportedCourses.mockResolvedValue(result);

    await withMounted(<ClassesList />, async (container) => {
      expect(container.textContent).toContain("No classes yet");
      const link = container.querySelector('a[href="/settings"]');
      expect(link?.textContent).toBe("Connect Canvas");
      expect(container.textContent).toContain(
        connected ? "Sync Canvas to import the courses in your current term." : "Connect Canvas to import",
      );
    });
  });
});
