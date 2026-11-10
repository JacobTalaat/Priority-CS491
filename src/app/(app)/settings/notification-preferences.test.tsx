// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  mockGetPreferences: vi.fn(),
  mockSavePreferences: vi.fn(),
}));

vi.mock("@/lib/notification-preferences-client", () => ({
  getNotificationPreferences: mocks.mockGetPreferences,
  saveNotificationPreferences: mocks.mockSavePreferences,
}));

import type { NotificationPreferences } from "@/lib/notification-preferences-client";
import { NotificationPreferences as NotificationPreferencesPanel } from "./notification-preferences";

const preferences: NotificationPreferences = {
  notifyTonight: true,
  notifyGradePosted: true,
  notifyDueTomorrow: true,
  nightlyReminderTime: "20:00",
};

describe("NotificationPreferences", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    mocks.mockGetPreferences.mockReset().mockResolvedValue({
      ok: true,
      status: 200,
      data: preferences,
    });
    mocks.mockSavePreferences.mockReset().mockImplementation(async (value: NotificationPreferences) => ({
      ok: true,
      status: 200,
      data: value,
    }));
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  });

  afterEach(async () => {
    await act(async () => {
      root.unmount();
    });
    container.remove();
  });

  async function renderPanel() {
    await act(async () => {
      root.render(<NotificationPreferencesPanel />);
    });
  }

  it("loads three notification toggles and the saved Tonight time", async () => {
    await renderPanel();

    expect(container.querySelectorAll('input[type="checkbox"]')).toHaveLength(3);
    expect(container.querySelector<HTMLInputElement>('input[name="notifyTonight"]')?.checked).toBe(true);
    expect(container.querySelector<HTMLInputElement>('input[name="notifyDueTomorrow"]')?.checked).toBe(true);
    expect(container.querySelector<HTMLInputElement>('input[name="notifyGradePosted"]')?.checked).toBe(true);
    expect(container.querySelector<HTMLInputElement>('input[name="nightlyReminderTime"]')?.value).toBe("20:00");
    expect(mocks.mockGetPreferences).toHaveBeenCalledTimes(1);
  });

  it("saves all notification selections and the chosen time through the preferences API", async () => {
    await renderPanel();

    const tonight = container.querySelector<HTMLInputElement>('input[name="notifyTonight"]');
    const dueTomorrow = container.querySelector<HTMLInputElement>('input[name="notifyDueTomorrow"]');
    const time = container.querySelector<HTMLInputElement>('input[name="nightlyReminderTime"]');
    expect(tonight).not.toBeNull();
    expect(dueTomorrow).not.toBeNull();
    expect(time).not.toBeNull();

    await act(async () => {
      dueTomorrow?.click();
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
      setter?.call(time, "21:30");
      time?.dispatchEvent(new Event("input", { bubbles: true }));
    });

    const saveButton = [...container.querySelectorAll("button")].find(
      (button) => button.textContent?.includes("Save preferences"),
    );
    expect(saveButton?.disabled).toBe(false);
    await act(async () => {
      saveButton?.click();
    });

    expect(mocks.mockSavePreferences).toHaveBeenCalledWith({
      ...preferences,
      notifyDueTomorrow: false,
      nightlyReminderTime: "21:30",
    });
    expect(container.textContent).toContain("Notification preferences saved.");
    expect(container.querySelector("button")?.disabled).toBe(true);
  });

  it("shows a clear error and keeps edits when saving fails", async () => {
    mocks.mockSavePreferences.mockResolvedValue({
      ok: false,
      status: 503,
      error: "Could not save your preferences.",
    });
    await renderPanel();

    const gradePosted = container.querySelector<HTMLInputElement>('input[name="notifyGradePosted"]');
    await act(async () => {
      gradePosted?.click();
    });
    const saveButton = [...container.querySelectorAll("button")].find(
      (button) => button.textContent?.includes("Save preferences"),
    );
    await act(async () => {
      saveButton?.click();
    });

    expect(container.textContent).toContain("Could not save your preferences.");
    expect(gradePosted?.checked).toBe(false);
  });

  it("keeps the reminder time editable while only Due tomorrow is on", async () => {
    mocks.mockGetPreferences.mockResolvedValue({
      ok: true,
      status: 200,
      data: { ...preferences, notifyTonight: false },
    });
    await renderPanel();

    expect(container.querySelector<HTMLInputElement>('input[name="nightlyReminderTime"]')?.disabled).toBe(false);
  });

  it("disables the reminder time when both nightly reminders are off", async () => {
    mocks.mockGetPreferences.mockResolvedValue({
      ok: true,
      status: 200,
      data: { ...preferences, notifyTonight: false, notifyDueTomorrow: false },
    });
    await renderPanel();

    expect(container.querySelector<HTMLInputElement>('input[name="nightlyReminderTime"]')?.disabled).toBe(true);
  });

  it("keeps Save disabled while the reminder time is empty, even after edits", async () => {
    mocks.mockGetPreferences.mockResolvedValue({
      ok: true,
      status: 200,
      data: { ...preferences, nightlyReminderTime: "" },
    });
    await renderPanel();

    const saveButton = [...container.querySelectorAll("button")].find(
      (button) => button.textContent?.includes("Save preferences"),
    );
    expect(saveButton?.disabled).toBe(true);

    const gradePosted = container.querySelector<HTMLInputElement>('input[name="notifyGradePosted"]');
    await act(async () => {
      gradePosted?.click();
    });
    expect(saveButton?.disabled).toBe(true);
  });
});
