import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  mockApiRequest: vi.fn(),
  mockGetToken: vi.fn(),
}));

vi.mock("./api-client", () => ({
  apiRequest: mocks.mockApiRequest,
}));

vi.mock("./session", () => ({
  getToken: mocks.mockGetToken,
}));

import {
  getNotificationPreferences,
  saveNotificationPreferences,
} from "./notification-preferences-client";
import type { NotificationPreferences } from "./notification-preferences-client";

const preferences: NotificationPreferences = {
  notifyTonight: false,
  notifyGradePosted: true,
  notifyDueTomorrow: false,
  nightlyReminderTime: "21:30",
};

describe("notification preferences client", () => {
  beforeEach(() => {
    mocks.mockApiRequest.mockReset();
    mocks.mockGetToken.mockReset().mockReturnValue("session-token");
  });

  it("loads the signed-in student's preferences", () => {
    getNotificationPreferences();

    expect(mocks.mockApiRequest).toHaveBeenCalledWith("/api/notifications/preferences", {
      token: "session-token",
    });
  });

  it("saves all notification settings with PATCH", () => {
    saveNotificationPreferences(preferences);

    expect(mocks.mockApiRequest).toHaveBeenCalledWith(
      "/api/notifications/preferences",
      {
        method: "PATCH",
        token: "session-token",
        body: preferences,
      },
    );
  });
});
