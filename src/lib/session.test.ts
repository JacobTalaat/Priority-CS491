import { afterEach, describe, expect, it, vi } from "vitest";
import { TOKEN_KEY, clearToken, getToken, setToken } from "./session";

function fakeStorage(): Storage {
  const data = new Map<string, string>();
  return {
    get length() {
      return data.size;
    },
    clear: () => data.clear(),
    getItem: (key) => data.get(key) ?? null,
    key: (index) => [...data.keys()][index] ?? null,
    removeItem: (key) => void data.delete(key),
    setItem: (key, value) => void data.set(key, String(value)),
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("session token", () => {
  it("returns null when nothing is stored", () => {
    vi.stubGlobal("window", { localStorage: fakeStorage() });
    expect(getToken()).toBeNull();
  });

  it("stores, reads, and clears the token", () => {
    const localStorage = fakeStorage();
    vi.stubGlobal("window", { localStorage });

    setToken("abc123");
    expect(localStorage.getItem(TOKEN_KEY)).toBe("abc123");
    expect(getToken()).toBe("abc123");

    clearToken();
    expect(getToken()).toBeNull();
  });

  it("acts logged out on the server where there is no window", () => {
    expect(getToken()).toBeNull();
    expect(() => setToken("abc123")).not.toThrow();
    expect(() => clearToken()).not.toThrow();
  });

  it("does not throw when storage is blocked", () => {
    const blocked = {
      getItem: () => {
        throw new Error("SecurityError");
      },
      setItem: () => {
        throw new Error("QuotaExceededError");
      },
      removeItem: () => {
        throw new Error("SecurityError");
      },
    };
    vi.stubGlobal("window", { localStorage: blocked });
    expect(getToken()).toBeNull();
    expect(() => setToken("abc123")).not.toThrow();
    expect(() => clearToken()).not.toThrow();
  });
});
