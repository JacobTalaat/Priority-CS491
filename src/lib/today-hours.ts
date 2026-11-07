const STORAGE_KEY_PREFIX = "priority-evening-hours";
const MIN_HOURS = 0.5;
const MAX_HOURS = 12;

export function todayHoursStorageKey(date = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const values = Object.fromEntries(parts.map(({ type, value }) => [type, value]));
  return `${STORAGE_KEY_PREFIX}:${values.year}-${values.month}-${values.day}`;
}

export function isValidTodayHours(hours: number): boolean {
  return Number.isFinite(hours) && hours >= MIN_HOURS && hours <= MAX_HOURS;
}

export function readTodayHours(): { ok: true; hours: number | null } | { ok: false; hours: null } {
  try {
    if (typeof window === "undefined") {
      return { ok: true, hours: null };
    }
    const saved = window.localStorage.getItem(todayHoursStorageKey());
    if (saved === null) {
      return { ok: true, hours: null };
    }
    const hours = Number(saved);
    return { ok: true, hours: isValidTodayHours(hours) ? hours : null };
  } catch {
    return { ok: false, hours: null };
  }
}

export function saveTodayHours(hours: number | null): boolean {
  try {
    if (typeof window === "undefined") {
      return false;
    }
    const key = todayHoursStorageKey();
    if (hours === null) {
      window.localStorage.removeItem(key);
    } else {
      if (!isValidTodayHours(hours)) {
        return false;
      }
      window.localStorage.setItem(key, String(hours));
    }
    return true;
  } catch {
    return false;
  }
}
