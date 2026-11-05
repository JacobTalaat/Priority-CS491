import { describe, expect, it } from "vitest";
import { isAllowedPushEndpoint } from "./push-endpoint";

describe("isAllowedPushEndpoint", () => {
  it("accepts the real push service hosts", () => {
    expect(isAllowedPushEndpoint("https://fcm.googleapis.com/fcm/send/abc")).toBe(true);
    expect(isAllowedPushEndpoint("https://updates.push.services.mozilla.com/wpush/v2/abc")).toBe(true);
    expect(isAllowedPushEndpoint("https://web.push.apple.com/t/abc")).toBe(true);
    expect(isAllowedPushEndpoint("https://wns2-usw3p.notify.windows.com/abc")).toBe(true);
    expect(isAllowedPushEndpoint("https://sn.notify.windows.com/abc")).toBe(true);
  });

  it("rejects lookalike hosts that sit at a label boundary", () => {
    expect(isAllowedPushEndpoint("https://evilpush.apple.com/abc")).toBe(false);
    expect(isAllowedPushEndpoint("https://push.apple.com.evil.com/abc")).toBe(false);
    expect(isAllowedPushEndpoint("https://thefcm.googleapis.com/abc")).toBe(false);
    expect(isAllowedPushEndpoint("https://fcm.googleapis.com.evil.com/abc")).toBe(false);
    expect(isAllowedPushEndpoint("https://push.apple.com/abc")).toBe(false);
    expect(isAllowedPushEndpoint("https://notify.windows.com/abc")).toBe(false);
  });

  it("rejects IP literals, including https ones and IPv6", () => {
    expect(isAllowedPushEndpoint("https://142.250.203.94/fcm/send/abc")).toBe(false);
    expect(isAllowedPushEndpoint("https://10.0.0.1/fcm/send/abc")).toBe(false);
    expect(isAllowedPushEndpoint("https://[::1]/fcm/send/abc")).toBe(false);
  });

  it("rejects ports other than the default 443", () => {
    expect(isAllowedPushEndpoint("https://fcm.googleapis.com:8443/fcm/send/abc")).toBe(false);
  });

  it("rejects credentials embedded in the URL", () => {
    expect(isAllowedPushEndpoint("https://user@fcm.googleapis.com/fcm/send/abc")).toBe(false);
    expect(isAllowedPushEndpoint("https://user:pass@fcm.googleapis.com/fcm/send/abc")).toBe(false);
  });

  it("rejects plain http", () => {
    expect(isAllowedPushEndpoint("http://fcm.googleapis.com/fcm/send/abc")).toBe(false);
  });

  it("accepts an uppercase host because URL lowercases hostnames", () => {
    expect(isAllowedPushEndpoint("https://FCM.GOOGLEAPIS.COM/fcm/send/abc")).toBe(true);
    expect(isAllowedPushEndpoint("https://WEB.PUSH.APPLE.COM/t/abc")).toBe(true);
  });

  it("rejects anything that is not a URL", () => {
    expect(isAllowedPushEndpoint("not a url")).toBe(false);
    expect(isAllowedPushEndpoint("/fcm/send/abc")).toBe(false);
    expect(isAllowedPushEndpoint("")).toBe(false);
  });
});
