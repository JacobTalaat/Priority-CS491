import { afterEach, describe, expect, it, vi } from "vitest";
import { readTodayHours, saveTodayHours, todayHoursStorageKey } from "./today-hours";

describe("today-hours", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("uses the New York calendar date for the evening's saved budget", () => {
    expect(todayHoursStorageKey(new Date("2026-11-08T04:30:00.000Z"))).toBe("priority-evening-hours:2026-11-07");
    expect(todayHoursStorageKey(new Date("2026-11-08T05:30:00.000Z"))).toBe("priority-evening-hours:2026-11-08");
  });

  it("saves, reads, and clears tonight's hours", () => {
    const values = new Map<string, string>();
    vi.stubGlobal("window", {
      localStorage: {
        getItem: (key: string) => values.get(key) ?? null,
        setItem: (key: string, value: string) => values.set(key, value),
        removeItem: (key: string) => values.delete(key),
      },
    });

    expect(saveTodayHours(2.5)).toBe(true);
    expect(readTodayHours()).toEqual({ ok: true, hours: 2.5 });
    expect(saveTodayHours(null)).toBe(true);
    expect(readTodayHours()).toEqual({ ok: true, hours: null });
  });

  it("rejects out-of-range stored values and reports unavailable storage", () => {
    const values = new Map<string, string>([[todayHoursStorageKey(), "20"]]);
    vi.stubGlobal("window", {
      localStorage: {
        getItem: (key: string) => values.get(key) ?? null,
        setItem: (key: string, value: string) => values.set(key, value),
        removeItem: (key: string) => values.delete(key),
      },
    });
    expect(readTodayHours()).toEqual({ ok: true, hours: null });

    vi.stubGlobal("window", {
      get localStorage() {
        throw new Error("storage is blocked");
      },
    });
    expect(readTodayHours()).toEqual({ ok: false, hours: null });
    expect(saveTodayHours(2)).toBe(false);
  });
});
