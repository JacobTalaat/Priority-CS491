// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { mockEnablePush } = vi.hoisted(() => ({ mockEnablePush: vi.fn() }));
vi.mock("@/lib/push-subscribe", () => ({ enablePush: mockEnablePush }));

import { NotificationOffer } from "./notification-offer";

describe("NotificationOffer", () => {
  let container: HTMLElement;
  const actEnvironment = globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean };

  beforeEach(() => {
    actEnvironment.IS_REACT_ACT_ENVIRONMENT = true;
    mockEnablePush.mockReset();
    container = document.createElement("div");
    document.body.appendChild(container);
  });

  afterEach(() => {
    container.remove();
  });

  async function render(onClose = vi.fn()) {
    const root = createRoot(container);
    await act(async () => {
      root.render(<NotificationOffer onClose={onClose} />);
    });
    return root;
  }

  function button(name: string) {
    return [...container.querySelectorAll("button")].find((item) => item.textContent === name)!;
  }

  it("subscribes on Turn on and says notifications are on", async () => {
    mockEnablePush.mockResolvedValue({ ok: true });
    const root = await render();
    await act(async () => {
      button("Turn on notifications").click();
    });
    expect(mockEnablePush).toHaveBeenCalledTimes(1);
    expect(container.textContent).toContain("Notifications are on.");
    await act(async () => root.unmount());
  });

  it("shows why when the browser blocks it and keeps the offer open", async () => {
    mockEnablePush.mockResolvedValue({ ok: false, message: "Notifications are blocked for this site in your browser settings." });
    const root = await render();
    await act(async () => {
      button("Turn on notifications").click();
    });
    expect(container.textContent).toContain("Notifications are blocked");
    expect(button("Turn on notifications")).toBeTruthy();
    await act(async () => root.unmount());
  });

  it("Not now closes it", async () => {
    const onClose = vi.fn();
    const root = await render(onClose);
    await act(async () => {
      button("Not now").click();
    });
    expect(onClose).toHaveBeenCalled();
    await act(async () => root.unmount());
  });
});
