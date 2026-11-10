import { describe, expect, it } from "vitest";
import { letterForGrade, letterGrade } from "./letter-grade";

describe("letterGrade", () => {
  it("picks the highest cutoff the percentage reaches", () => {
    const cutoffs = { A: 90, B: 80, C: 70, D: 60, F: 0 };
    expect(letterGrade(93.5, cutoffs)).toBe("A");
    expect(letterGrade(80.4, cutoffs)).toBe("B");
    expect(letterGrade(72, cutoffs)).toBe("C");
    expect(letterGrade(15, cutoffs)).toBe("F");
    expect(letterGrade(0, cutoffs)).toBe("F");
  });

  it("counts an exact boundary as reached, including for the top cutoff", () => {
    const cutoffs = { A: 90, B: 80 };
    expect(letterGrade(80, cutoffs)).toBe("B");
    expect(letterGrade(90, cutoffs)).toBe("A");
  });

  it("returns null when every cutoff sits above the percentage and no cutoff is 0", () => {
    expect(letterGrade(50, { A: 90, B: 80 })).toBeNull();
  });

  it("falls back to the lowest label only when its own cutoff is 0", () => {
    const withF = { A: 90, B: 80, F: 0 };
    expect(letterGrade(50, withF)).toBe("F");
    const withoutF = { A: 90, B: 80 };
    expect(letterGrade(50, withoutF)).toBeNull();
  });

  it("returns null when there are no cutoffs at all", () => {
    expect(letterGrade(95, {})).toBeNull();
  });

  it("ignores cutoff values that are not finite numbers", () => {
    const unsanitized = { A: 80, B: Number.NaN, C: Infinity, D: "70" as unknown as number };
    expect(letterGrade(85, unsanitized)).toBe("A");
    // The stored "70" is not a usable cutoff, so no label applies at 70 or below.
    expect(letterGrade(70, unsanitized)).toBeNull();
  });

  it("answers the same however the cutoffs are stored", () => {
    const cutoffs = { C: 70, D: 60, F: 0, A: 93, B: 85 };
    expect(letterGrade(85, cutoffs)).toBe("B");
    expect(letterGrade(93, cutoffs)).toBe("A");
    expect(letterGrade(70.5, cutoffs)).toBe("C");
    expect(letterGrade(60, cutoffs)).toBe("D");
    expect(letterGrade(10, cutoffs)).toBe("F");
  });

  it("breaks two labels sharing a cutoff by label, not by storage order", () => {
    expect(letterGrade(85, { B: 85, A: 85 })).toBe("A");
    expect(letterGrade(85, { A: 85, B: 85 })).toBe("A");
  });
});

describe("letterForGrade", () => {
  it("returns the letter for a calculated grade", () => {
    expect(letterForGrade({ status: "calculated", percentage: 91.4 }, { "A-": 90 })).toBe("A-");
  });

  it("returns null when the grade is not calculated", () => {
    expect(letterForGrade({ status: "insufficient-data" }, { A: 90 })).toBeNull();
    expect(letterForGrade({ status: "unsupported", reason: "unsupported-rule" }, { A: 90 })).toBeNull();
  });
});
