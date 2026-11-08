import { apiRequest } from "./api-client";
import { getToken } from "./session";

export type NotificationPreferences = {
  notifyTonight: boolean;
  notifyGradePosted: boolean;
  notifyDueTomorrow: boolean;
  nightlyReminderTime: string;
};

export function getNotificationPreferences() {
  return apiRequest<NotificationPreferences>("/api/notifications/preferences", { token: getToken() });
}

export function saveNotificationPreferences(preferences: NotificationPreferences) {
  return apiRequest<NotificationPreferences>("/api/notifications/preferences", {
    method: "PATCH",
    token: getToken(),
    body: preferences,
  });
}
