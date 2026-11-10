import { describe, expect, it } from "vitest";
import { boundaryTag, dueLabel, shareLabel } from "./today-list";

describe("dueLabel", () => {
  // Thursday Oct 29, 2026, noon in New York.
  const now = new Date("2026-10-29T16:00:00.000Z");

  it("says today and tomorrow in campus time, with the time", () => {
    // 03:59 UTC on Oct 30 is 11:59 pm on Oct 29 in New York: still today there.
    expect(dueLabel("2026-10-30T03:59:00.000Z", false, now)).toBe("Due today, 11:59 PM");
    expect(dueLabel("2026-10-31T03:59:00.000Z", false, now)).toBe("Due tomorrow, 11:59 PM");
  });

  it("uses the weekday within the week and the date further out", () => {
    expect(dueLabel("2026-11-03T04:59:00.000Z", false, now)).toBe("Due Mon, 11:59 PM");
    expect(dueLabel("2026-11-06T04:59:00.000Z", false, now)).toBe("Due Thu, Nov 5");
  });

  it("says overdue work is overdue", () => {
    expect(dueLabel("2026-10-28T03:59:00.000Z", true, now)).toBe("Overdue, was due Tue, Oct 27");
  });

  it("handles work without a usable due date", () => {
    expect(dueLabel(null, false, now)).toBe("No due date");
    expect(dueLabel("not a date", false, now)).toBe("No due date");
  });
});

describe("shareLabel", () => {
  it("rounds to whole percents and keeps a tiny real share visible", () => {
    expect(shareLabel(15)).toBe("15%");
    expect(shareLabel(14.6)).toBe("15%");
    expect(shareLabel(0.4)).toBe("<1%");
  });

  it("shows nothing for work outside the grade", () => {
    expect(shareLabel(null)).toBeNull();
    expect(shareLabel(0)).toBeNull();
    expect(shareLabel(Number.NaN)).toBeNull();
  });
});

describe("boundaryTag", () => {
  it("names the letter at risk or within reach", () => {
    expect(boundaryTag({ letter: "A-", cutoff: 90, direction: "at-risk", distance: 1.2 })).toBe("A- at risk");
    expect(boundaryTag({ letter: "B+", cutoff: 87, direction: "within-reach", distance: 0.5 })).toBe("B+ within reach");
    expect(boundaryTag(null)).toBeNull();
  });
});
