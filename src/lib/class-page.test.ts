import { describe, expect, it } from "vitest";
import { categoryLine, dueText, formatPercent, gradeSummary, scoreText, shareText } from "./class-page";

describe("gradeSummary", () => {
  it("shows the percentage rounded to one decimal", () => {
    expect(gradeSummary({ status: "calculated", percentage: 87.456 })).toEqual({ headline: "87.5%", detail: null });
  });

  it("explains a class with nothing graded instead of showing 0%", () => {
    expect(gradeSummary({ status: "insufficient-data" })).toEqual({
      headline: "No grade yet",
      detail: "Nothing in this class is graded enough to work out a grade.",
    });
  });

  it("says why a grade can't be worked out", () => {
    expect(gradeSummary({ status: "unsupported", reason: "extra-credit" })).toEqual({
      headline: "Can't work out a grade",
      detail: "A score is above its points possible (extra credit), which Priority can't grade yet.",
    });
  });
});

describe("categoryLine", () => {
  const base = { category: "Homework", weight: 40, pointsEarned: 81, pointsPossible: 100, gradedCount: 2 };

  it("shows the percentage, the points, and what's left", () => {
    expect(categoryLine({ ...base, percentage: 81, ungradedCount: 1 })).toBe("81% · 81 of 100 points · 2 graded, 1 to go");
    expect(categoryLine({ ...base, percentage: 81, ungradedCount: 0 })).toBe("81% · 81 of 100 points · 2 graded");
  });

  it("tells nothing graded apart from an empty category", () => {
    const empty = { ...base, percentage: null, pointsEarned: 0, pointsPossible: 0, gradedCount: 0 };
    expect(categoryLine({ ...empty, ungradedCount: 3 })).toBe("Nothing graded yet · 3 to go");
    expect(categoryLine({ ...empty, ungradedCount: 0 })).toBe("No assignments in this category");
  });
});

describe("scoreText", () => {
  it("shows the score out of the points possible", () => {
    expect(scoreText({ score: 18 }, 20)).toBe("18 / 20");
    expect(scoreText({ score: 17.5 }, 20)).toBe("17.5 / 20");
  });

  it("shows plain points when the assignment has no points possible", () => {
    expect(scoreText({ score: 2 }, 0)).toBe("2 pts");
  });

  it("says not graded when there is no score, including a real 0 not being hidden", () => {
    expect(scoreText(null, 20)).toBe("Not graded");
    expect(scoreText({ score: null }, 20)).toBe("Not graded");
    expect(scoreText({ score: 0 }, 20)).toBe("0 / 20");
  });
});

describe("dueText", () => {
  it("reads the due date in campus time", () => {
    // 03:59 UTC on Oct 12 is 11:59 pm on Oct 11 in New York.
    expect(dueText("2026-10-12T03:59:00Z", true)).toBe("Due Sun, Oct 11");
  });

  it("handles assignments without a due date", () => {
    expect(dueText(null, false)).toBe("No due date");
    expect(dueText("2026-10-12T03:59:00Z", false)).toBe("No due date");
    expect(dueText("not a date", true)).toBe("No due date");
  });
});

describe("shareText and formatPercent", () => {
  it("states an assignment's share of the grade", () => {
    expect(shareText(20)).toBe("Worth 20% of your grade");
    expect(shareText(6.6667)).toBe("Worth 6.7% of your grade");
    expect(shareText(0)).toBe("Worth 0% of your grade");
  });

  it("says nothing for assignments outside the grading math", () => {
    expect(shareText(null)).toBeNull();
    expect(shareText(undefined)).toBeNull();
  });

  it("drops trailing zeros", () => {
    expect(formatPercent(80)).toBe("80%");
  });
});
