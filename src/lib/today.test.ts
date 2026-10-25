import { describe, expect, it } from "vitest";
import type { TodayAssignment } from "./today-client";
import { assignmentsThatFit, validEveningHours } from "./today";

const assignments: TodayAssignment[] = ["soon", "next", "later"].map((id) => ({
  id,
  title: id,
  dueAt: null,
  hasDueDate: false,
  pointsPossible: 10,
  course: { id: "course-1", name: "Algorithms", courseCode: "CS-341" },
}));

describe("assignmentsThatFit", () => {
  it("keeps every ranked assignment when no hours limit is set", () => {
    expect(assignmentsThatFit(assignments, null)).toEqual(assignments);
  });

  it("trims the ranked list to the assignments that fit whole one-hour estimates", () => {
    expect(assignmentsThatFit(assignments, 2)).toEqual(assignments.slice(0, 2));
    expect(assignmentsThatFit(assignments, 0.5)).toEqual([]);
  });

  it("keeps an empty list empty", () => {
    expect(assignmentsThatFit([], 3)).toEqual([]);
  });
});

describe("validEveningHours", () => {
  it("accepts blank values as no limit and valid half-hour increments", () => {
    expect(validEveningHours("")).toBeNull();
    expect(validEveningHours("  ")).toBeNull();
    expect(validEveningHours("2.5")).toBe(2.5);
  });

  it("rejects invalid and out-of-range values", () => {
    for (const value of ["0", "0.25", "-1", "12.5", "not a number"]) {
      expect(validEveningHours(value)).toBeNull();
    }
  });
});
