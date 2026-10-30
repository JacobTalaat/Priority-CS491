import { describe, expect, it } from "vitest";
import { boundaryTag, dueLabel, insertAt, shareLabel } from "./today-list";

describe("dueLabel", () => {
  it("reads the due date and time in campus time", () => {
    // 03:59 UTC on Oct 31 is 11:59 pm on Oct 30 in New York.
    expect(dueLabel("2026-10-31T03:59:00.000Z", false)).toBe("Due Fri, Oct 30, 11:59 PM");
  });

  it("says overdue work is overdue", () => {
    expect(dueLabel("2026-10-28T03:59:00.000Z", true)).toBe("Overdue, was due Tue, Oct 27, 11:59 PM");
  });

  it("handles work without a usable due date", () => {
    expect(dueLabel(null, false)).toBe("No due date");
    expect(dueLabel("not a date", false)).toBe("No due date");
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

describe("insertAt", () => {
  it("puts an item back at its old position", () => {
    expect(insertAt(["a", "c"], "b", 1)).toEqual(["a", "b", "c"]);
    expect(insertAt(["b", "c"], "a", 0)).toEqual(["a", "b", "c"]);
  });

  it("appends when the list has shrunk below that position", () => {
    expect(insertAt(["a"], "z", 5)).toEqual(["a", "z"]);
    expect(insertAt([], "z", -1)).toEqual(["z"]);
  });
});
