// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import type { Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { mockAskClasses } = vi.hoisted(() => ({ mockAskClasses: vi.fn() }));
vi.mock("@/lib/ask-client", () => ({ askClasses: mockAskClasses }));

import { AskMyClasses, EXAMPLE_QUESTIONS } from "./ask-my-classes";

describe("AskMyClasses", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    mockAskClasses.mockReset();
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  it("shows three example questions and submits the selected question", async () => {
    mockAskClasses.mockResolvedValue({
      ok: true,
      status: 200,
      data: { found: false, message: "Priority couldn't find that in your syllabus or Canvas data." },
    });

    await act(async () => {
      root.render(<AskMyClasses />);
    });

    const examples = new Set<string>(EXAMPLE_QUESTIONS);
    const buttons = Array.from(container.querySelectorAll("button")).filter(
      (button) => button.textContent !== null && examples.has(button.textContent),
    );
    expect(buttons.map((button) => button.textContent)).toEqual([...EXAMPLE_QUESTIONS]);

    await act(async () => {
      buttons[0].dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(mockAskClasses).toHaveBeenCalledExactlyOnceWith(EXAMPLE_QUESTIONS[0]);
    expect(container.textContent).toContain("Priority couldn't find that in your syllabus or Canvas data.");
  });
});
