import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import vm from "node:vm";
import { beforeEach, describe, expect, it, vi } from "vitest";

// Loads /sw.js the way the browser does: a classic script run against one `self`
// object. importScripts is stubbed to run push-guard.js in the same context, so
// the real payload guard decides navigation targets in these tests too.
const guardSource = readFileSync(
  fileURLToPath(new URL("../../public/push-guard.js", import.meta.url)),
  "utf8",
);
const workerSource = readFileSync(
  fileURLToPath(new URL("../../public/sw.js", import.meta.url)),
  "utf8",
);

type Listener = (event: unknown) => void;

type Worker = {
  listeners: Record<string, Listener>;
  showNotification: ReturnType<typeof vi.fn>;
  openWindow: ReturnType<typeof vi.fn>;
  focus: ReturnType<typeof vi.fn>;
  navigate: ReturnType<typeof vi.fn>;
  matchAll: ReturnType<typeof vi.fn>;
};

function loadWorker(): Worker {
  const listeners: Record<string, Listener> = {};
  const showNotification = vi.fn().mockResolvedValue(undefined);
  const openWindow = vi.fn().mockResolvedValue(undefined);
  const focus = vi.fn().mockResolvedValue(undefined);
  const navigate = vi.fn().mockResolvedValue(undefined);
  const matchAll = vi.fn();

  const sandbox: Record<string, unknown> = {
    self: {
      addEventListener: (name: string, handler: Listener) => {
        listeners[name] = handler;
      },
      registration: { showNotification },
      location: { origin: "https://app.example.edu" },
      clients: { openWindow, matchAll },
    },
    URL,
    importScripts: () => {
      vm.runInContext(guardSource, context);
    },
  };
  const context = vm.createContext(sandbox);

  vm.runInContext(workerSource, context);
  return { listeners, showNotification, openWindow, focus, navigate, matchAll };
}

type Pending = { waitUntil: (promise: Promise<unknown>) => void; promise: Promise<unknown> | null };

function captureWaitUntil(): Pending {
  const pending: Pending = { waitUntil: () => {}, promise: null };
  pending.waitUntil = (promise) => {
    pending.promise = promise as Promise<unknown>;
  };
  return pending;
}

async function firePush(handlers: Record<string, Listener>, payload: unknown) {
  const pending = captureWaitUntil();
  handlers["push"]({
    data:
      payload === "no-data"
        ? null
        : {
            json: () => {
              if (typeof payload === "string" && payload === "bad json") {
                throw new Error("bad json");
              }
              return payload;
            },
          },
    waitUntil: pending.waitUntil,
  });
  await pending.promise;
}

describe("public/sw.js", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("shows the payload's title, body, and a same-origin url", async () => {
    const worker = loadWorker();
    await firePush(worker.listeners, { title: "Tonight", body: "Start with Lab.", url: "/today" });
    expect(worker.showNotification).toHaveBeenCalledWith("Tonight", {
      body: "Start with Lab.",
      data: { url: "/today" },
    });
  });

  it.each([
    "no-data",
    "bad json",
    null,
    "text",
    7,
    ["array"],
  ])("falls back to a default notification for payload %p", async (payload) => {
    const worker = loadWorker();
    await firePush(worker.listeners, payload);
    expect(worker.showNotification).toHaveBeenCalledWith("Priority", {
      body: "Open Priority to see what's new.",
      data: { url: "/today" },
    });
  });

  it("replaces a payload url pointing outside the app with /today", async () => {
    const worker = loadWorker();
    await firePush(worker.listeners, { title: "Tonight", body: "b", url: "https://evil.example.edu/x" });
    expect(worker.showNotification).toHaveBeenCalledWith("Tonight", {
      body: "b",
      data: { url: "/today" },
    });
  });

  it("stops at the default title when the payload's body is not a string", async () => {
    const worker = loadWorker();
    await firePush(worker.listeners, { title: "Tonight", url: "/today" });
    expect(worker.showNotification).toHaveBeenCalledWith("Tonight", {
      body: "Open Priority to see what's new.",
      data: { url: "/today" },
    });
  });

  it("navigates an existing same-origin tab on click", async () => {
    const worker = loadWorker();
    worker.matchAll.mockResolvedValue([
      { url: "https://other.example.edu/today", focus: vi.fn(), navigate: vi.fn() },
      {
        url: "https://app.example.edu/classes",
        focus: worker.focus,
        navigate: worker.navigate,
      },
    ]);
    const pending = captureWaitUntil();
    worker.listeners["notificationclick"]({
      notification: { data: { url: "/today" }, close: vi.fn() },
      waitUntil: pending.waitUntil,
    });
    await pending.promise;
    expect(worker.focus).toHaveBeenCalled();
    expect(worker.navigate).toHaveBeenCalledWith("https://app.example.edu/today");
    expect(worker.openWindow).not.toHaveBeenCalled();
  });

  it("opens a window when no Priority tab is open", async () => {
    const worker = loadWorker();
    worker.matchAll.mockResolvedValue([]);
    const pending = captureWaitUntil();
    worker.listeners["notificationclick"]({
      notification: { data: { url: "/today" }, close: vi.fn() },
      waitUntil: pending.waitUntil,
    });
    await pending.promise;
    expect(worker.openWindow).toHaveBeenCalledWith("https://app.example.edu/today");
  });

  it("opens only the guarded target when no Priority tab is open", async () => {
    const worker = loadWorker();
    worker.matchAll.mockResolvedValue([]);
    const pending = captureWaitUntil();
    worker.listeners["notificationclick"]({
      notification: { data: { url: "https://app.example.edu/today" }, close: vi.fn() },
      waitUntil: pending.waitUntil,
    });
    await pending.promise;
    expect(worker.openWindow).toHaveBeenCalledExactlyOnceWith(
      "https://app.example.edu/today",
    );
  });

  it("opens nothing when no tab is open and the payload url is cross-origin", async () => {
    const worker = loadWorker();
    worker.matchAll.mockResolvedValue([]);
    const pending = captureWaitUntil();
    worker.listeners["notificationclick"]({
      notification: { data: { url: "https://evil.example.edu/y" }, close: vi.fn() },
      waitUntil: pending.waitUntil,
    });
    await pending.promise;
    expect(worker.openWindow).not.toHaveBeenCalled();
  });

  it("opens nothing when no tab is open and the notification carries no url", async () => {
    const worker = loadWorker();
    worker.matchAll.mockResolvedValue([]);
    const pending = captureWaitUntil();
    worker.listeners["notificationclick"]({
      notification: { data: undefined, close: vi.fn() },
      waitUntil: pending.waitUntil,
    });
    await pending.promise;
    expect(worker.openWindow).not.toHaveBeenCalled();
  });

  it("ignores a cross-origin click target and only focuses", async () => {
    const worker = loadWorker();
    worker.matchAll.mockResolvedValue([
      {
        url: "https://app.example.edu/classes",
        focus: worker.focus,
        navigate: worker.navigate,
      },
    ]);
    const pending = captureWaitUntil();
    worker.listeners["notificationclick"]({
      notification: { data: { url: "https://evil.example.edu/y" }, close: vi.fn() },
      waitUntil: pending.waitUntil,
    });
    await pending.promise;
    expect(worker.focus).toHaveBeenCalled();
    expect(worker.navigate).not.toHaveBeenCalled();
    expect(worker.openWindow).not.toHaveBeenCalled();
  });
});
