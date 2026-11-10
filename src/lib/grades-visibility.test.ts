// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useShowGrades } from "./grades-visibility";

// A minimal component so the hook can run under a real renderer.
function Harness() {
  const [showGrades, toggle] = useShowGrades();
  return createElement(
    "div",
    null,
    createElement("p", null, showGrades ? "shown" : "hidden"),
    createElement("button", { type: "button", onClick: toggle }, "toggle"),
  );
}

describe("useShowGrades", () => {
  let container: HTMLDivElement;
  let root: Root;

  async function mount() {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    await act(async () => {
      root.render(createElement(Harness));
    });
  }

  function showing(): boolean {
    return container.querySelector("p")?.textContent === "shown";
  }

  async function toggle() {
    await act(async () => {
      (container.querySelector("button") as HTMLButtonElement).dispatchEvent(
        new MouseEvent("click", { bubbles: true }),
      );
    });
  }

  beforeEach(() => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    localStorage.clear();
  });

  afterEach(async () => {
    await act(async () => {
      root.unmount();
    });
    container.remove();
  });

  it("starts showing grades when nothing is saved", async () => {
    await mount();
    expect(showing()).toBe(true);
  });

  it("toggles the choice into localStorage and back", async () => {
    await mount();
    await toggle();
    expect(showing()).toBe(false);
    expect(localStorage.getItem("priority.classes.showGrades")).toBe("false");
    await toggle();
    expect(showing()).toBe(true);
    expect(localStorage.getItem("priority.classes.showGrades")).toBe("true");
  });

  it("restores a saved hidden choice on mount", async () => {
    localStorage.setItem("priority.classes.showGrades", "false");
    await mount();
    expect(showing()).toBe(false);
  });

  it("still shows grades when reading localStorage throws", async () => {
    const getItem = vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    try {
      await mount();
      expect(showing()).toBe(true);
    } finally {
      getItem.mockRestore();
    }
  });

  it("keeps the choice applied even when writing localStorage throws", async () => {
    await mount();
    const setItem = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    try {
      await toggle();
      expect(showing()).toBe(false);
    } finally {
      setItem.mockRestore();
    }
  });

  it("re-reads the saved choice when another tab changes it", async () => {
    await mount();
    localStorage.setItem("priority.classes.showGrades", "false");
    await act(async () => {
      window.dispatchEvent(new StorageEvent("storage"));
    });
    expect(showing()).toBe(false);
  });
});
