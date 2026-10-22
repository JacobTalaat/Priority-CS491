// @vitest-environment jsdom
import { Buffer } from "node:buffer";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  mockGetToken: vi.fn(),
  mockGetSubscription: vi.fn(),
  mockSubscribe: vi.fn(),
  mockRegister: vi.fn(),
  mockGetRegistration: vi.fn(),
  mockRequestPermission: vi.fn(),
}));

vi.mock("@/lib/session", () => ({
  getToken: mocks.mockGetToken,
}));

import { PushNotifications } from "./push-notifications";

const ENDPOINT = "https://fcm.googleapis.com/fcm/send/browser-1";

// A real-looking server key; the fake subscriptions below hand matching or
// non-matching bytes back, which decides whether the old order is reused.
const SERVER_PUBLIC_KEY_BYTES = new Uint8Array(65).fill(4);

type FakePushSubscription = {
  applicationServerKey: Uint8Array;
  endpoint: string;
  toJSON: () => unknown;
  unsubscribe: () => Promise<boolean>;
};

function fakeSubscription(
  applicationServerKey: Uint8Array | null,
  endpoint = ENDPOINT,
): FakePushSubscription {
  return {
    applicationServerKey: applicationServerKey ?? new Uint8Array(0),
    endpoint,
    toJSON: () => ({
      endpoint,
      keys: { p256dh: Buffer.alloc(65, 4).toString("base64url"), auth: Buffer.alloc(16, 5).toString("base64url") },
    }),
    unsubscribe: vi.fn().mockResolvedValue(true),
  };
}

describe("PushNotifications", () => {
  let container: HTMLElement;
  let root: Root;
  let fetchCalls: { url: string; init: RequestInit | undefined }[];
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    mocks.mockGetToken.mockReset().mockReturnValue("session-token");
    mocks.mockRequestPermission.mockReset();
    mocks.mockGetSubscription.mockReset();
    mocks.mockSubscribe.mockReset();
    mocks.mockRegister.mockReset();
    mocks.mockGetRegistration.mockReset();
    window.Notification = {
      permission: "default",
      requestPermission: mocks.mockRequestPermission,
    } as unknown as typeof Notification;
    window.PushManager = class {} as unknown as typeof PushManager;
    Object.defineProperty(window.navigator, "serviceWorker", {
      configurable: true,
      value: {
        register: mocks.mockRegister,
        ready: Promise.resolve({
          pushManager: {
            getSubscription: mocks.mockGetSubscription,
            subscribe: mocks.mockSubscribe,
          },
        }),
        getRegistration: mocks.mockGetRegistration,
      },
    });
    container = document.createElement("div");
    document.body.appendChild(container);
    fetchCalls = [];
    fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      fetchCalls.push({ url: String(input), init });
      const url = String(input);
      const body = url.endsWith("/public-key")
        ? { publicKey: Buffer.from(SERVER_PUBLIC_KEY_BYTES).toString("base64url") }
        : url.endsWith("/subscriptions")
          ? { subscribed: true }
          : { sent: 1, failed: 0, removed: 0 };
      return new Response(JSON.stringify(body), { status: 200 });
    });
    vi.stubGlobal("fetch", fetchMock);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => {
      root.unmount();
    });
    container.remove();
    vi.unstubAllGlobals();
  });

  function findButton(label: string): HTMLButtonElement | null {
    const buttons = [...container.querySelectorAll("button")];
    return buttons.find((button) => button.textContent?.includes(label)) ?? null;
  }

  async function clickButton(label: string) {
    const button = findButton(label);
    expect(button).not.toBeNull();
    await act(async () => {
      button?.click();
    });
  }

  it("sends the Authorization header when subscribing and when sending a test push", async () => {
    mocks.mockRequestPermission.mockResolvedValue("granted");
    mocks.mockGetRegistration.mockResolvedValue(undefined);
    mocks.mockRegister.mockResolvedValue({});
    mocks.mockGetSubscription.mockResolvedValue(null);
    mocks.mockSubscribe.mockResolvedValue(fakeSubscription(SERVER_PUBLIC_KEY_BYTES));

    await act(async () => {
      root.render(<PushNotifications />);
    });
    await clickButton("Turn on notifications");

    // Even the read-only public-key ask is the student's: the route reads the
    // session and the browser may never subscribe to an unverified key.
    const keyCall = fetchCalls.find((call) => call.url === "/api/push/public-key");
    expect(keyCall).toBeDefined();
    expect(new Headers(keyCall?.init?.headers as HeadersInit).get("Authorization")).toBe(
      "Bearer session-token",
    );

    // The subscription save must be the student's, not an anonymous check.
    const saveCall = fetchCalls.find((call) => call.url === "/api/push/subscriptions");
    expect(saveCall).toBeDefined();
    expect(new Headers(saveCall?.init?.headers as HeadersInit).get("Authorization")).toBe(
      "Bearer session-token",
    );

    await clickButton("Send a test notification");
    const testCall = fetchCalls.find((call) => call.url === "/api/push/test");
    expect(testCall).toBeDefined();
    expect(new Headers(testCall?.init?.headers as HeadersInit).get("Authorization")).toBe(
      "Bearer session-token",
    );
  });

  it("starts in the enabled state when the browser already holds a subscription", async () => {
    mocks.mockGetRegistration.mockResolvedValue({
      pushManager: { getSubscription: mocks.mockGetSubscription },
    });
    mocks.mockGetSubscription.mockResolvedValue(fakeSubscription(SERVER_PUBLIC_KEY_BYTES));

    await act(async () => {
      root.render(<PushNotifications />);
    });

    // Reading on mount never prompts for permission.
    expect(mocks.mockRequestPermission).not.toHaveBeenCalled();
    expect(findButton("Turn off notifications")).not.toBeNull();
    expect(findButton("Turn on notifications")).toBeNull();
  });

  it("re-subscribes and removes the saved subscription when the server key rotated", async () => {
    mocks.mockRequestPermission.mockResolvedValue("granted");
    mocks.mockGetRegistration.mockResolvedValue(undefined);
    mocks.mockRegister.mockResolvedValue({});
    const stale = fakeSubscription(new Uint8Array(65).fill(7));
    // First read (mount state / subscribe step) finds the stale subscription,
    // then the fresh subscribe happens against the rotated key.
    mocks.mockGetSubscription.mockResolvedValue(stale);
    mocks.mockSubscribe.mockResolvedValue(fakeSubscription(SERVER_PUBLIC_KEY_BYTES));

    await act(async () => {
      root.render(<PushNotifications />);
    });
    await clickButton("Turn on notifications");

    const deleteCall = fetchCalls.find((call) => call.url === "/api/push/subscriptions");
    expect(deleteCall?.init?.method).toBe("DELETE");
    expect(JSON.parse(String(deleteCall?.init?.body))).toEqual({ endpoint: ENDPOINT });
    expect(stale.unsubscribe).toHaveBeenCalled();
    expect(mocks.mockSubscribe).toHaveBeenCalled();
  });

  it("removes the saved subscription when turning notifications off", async () => {
    mocks.mockGetRegistration.mockResolvedValue({
      pushManager: { getSubscription: mocks.mockGetSubscription },
    });
    const enabled = fakeSubscription(SERVER_PUBLIC_KEY_BYTES);
    mocks.mockGetSubscription.mockResolvedValue(enabled);

    await act(async () => {
      root.render(<PushNotifications />);
    });
    await clickButton("Turn off notifications");

    const deleteCall = fetchCalls.find(
      (call) => call.url === "/api/push/subscriptions" && call.init?.method === "DELETE",
    );
    expect(deleteCall).toBeDefined();
    expect(JSON.parse(String(deleteCall?.init?.body))).toEqual({ endpoint: ENDPOINT });
    expect(enabled.unsubscribe).toHaveBeenCalled();
    expect(findButton("Turn on notifications")).not.toBeNull();
  });

  it("shows the straight denial message and never calls the API when permission is denied", async () => {
    mocks.mockRequestPermission.mockResolvedValue("denied");
    mocks.mockGetRegistration.mockResolvedValue(undefined);

    await act(async () => {
      root.render(<PushNotifications />);
    });
    await clickButton("Turn on notifications");

    expect(container.textContent).toContain(
      "Notifications are blocked for this site in your browser settings.",
    );
    expect(fetchCalls).toEqual([]);
  });
});
