import { describe, expect, it } from "vitest";
import { shouldOfferNotifications } from "./notification-prompt";

const base = { firstConfirm: true, permission: "default" as NotificationPermission, alreadySubscribed: false, dismissed: false };

describe("shouldOfferNotifications", () => {
  it("offers after a first confirm when the browser hasn't been asked yet", () => {
    expect(shouldOfferNotifications(base)).toBe(true);
  });

  it("never offers on an edit, after a dismissal, when already subscribed, or once answered", () => {
    expect(shouldOfferNotifications({ ...base, firstConfirm: false })).toBe(false);
    expect(shouldOfferNotifications({ ...base, dismissed: true })).toBe(false);
    expect(shouldOfferNotifications({ ...base, alreadySubscribed: true })).toBe(false);
    expect(shouldOfferNotifications({ ...base, permission: "granted" })).toBe(false);
    expect(shouldOfferNotifications({ ...base, permission: "denied" })).toBe(false);
    expect(shouldOfferNotifications({ ...base, permission: null })).toBe(false);
  });
});
