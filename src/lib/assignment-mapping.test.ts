import { describe, expect, it } from "vitest";
import { mappingSummary, unmappedAssignmentIds } from "./assignment-mapping";

const assignments = [{ id: "a1" }, { id: "a2" }, { id: "a3" }];

describe("unmappedAssignmentIds", () => {
  it("lists assignments with no category", () => {
    expect(unmappedAssignmentIds(assignments, { a1: "Homework" }, ["Homework", "Exams"])).toEqual(["a2", "a3"]);
  });

  it("treats an empty choice as unmapped", () => {
    expect(unmappedAssignmentIds(assignments, { a1: "", a2: "Exams", a3: "Exams" }, ["Exams"])).toEqual(["a1"]);
  });

  it("treats a category that no longer exists as unmapped", () => {
    expect(
      unmappedAssignmentIds(assignments, { a1: "Homework", a2: "Quizzes", a3: "Exams" }, ["Homework", "Exams"]),
    ).toEqual(["a2"]);
  });

  it("ignores blank category names", () => {
    expect(unmappedAssignmentIds([{ id: "a1" }], { a1: " " }, ["  "])).toEqual(["a1"]);
  });

  it("is empty when every assignment has a real category", () => {
    expect(
      unmappedAssignmentIds(assignments, { a1: "Homework", a2: "Exams", a3: "Exams" }, ["Homework", "Exams"]),
    ).toEqual([]);
  });
});

describe("mappingSummary", () => {
  it("counts what's left with the right grammar", () => {
    expect(mappingSummary(12, 3)).toBe("3 of 12 assignments still need a category.");
    expect(mappingSummary(12, 1)).toBe("1 of 12 assignments still needs a category.");
    expect(mappingSummary(1, 1)).toBe("1 of 1 assignment still needs a category.");
  });

  it("confirms when everything is mapped", () => {
    expect(mappingSummary(12, 0)).toBe("All 12 assignments have a category.");
    expect(mappingSummary(1, 0)).toBe("All 1 assignment has a category.");
  });
});
