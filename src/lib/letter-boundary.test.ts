import { describe, expect, it } from "vitest";
import { BOUNDARY_POINTS, letterBoundary } from "./letter-boundary";

describe("letterBoundary", () => {
  it("flags at-risk inside two points of the cutoff the grade holds", () => {
    expect(letterBoundary(91.5, { A: 90 })).toEqual({
      letter: "A",
      cutoff: 90,
      direction: "at-risk",
      distance: 1.5,
    });
  });

  it("counts exactly BOUNDARY_POINTS as close", () => {
    expect(BOUNDARY_POINTS).toBe(2);
    expect(letterBoundary(92, { A: 90 })).toMatchObject({ letter: "A", direction: "at-risk", distance: 2 });
    expect(letterBoundary(92.01, { A: 90 })).toEqual(null);
  });

  it("flags at-risk when the grade sits exactly on the cutoff", () => {
    expect(letterBoundary(90, { A: 90 })).toEqual({
      letter: "A",
      cutoff: 90,
      direction: "at-risk",
      distance: 0,
    });
  });

  it("flags within-reach when the next higher cutoff is two points or less away", () => {
    expect(letterBoundary(88.5, { A: 90 })).toEqual({
      letter: "A",
      cutoff: 90,
      direction: "within-reach",
      distance: 1.5,
    });
  });

  it("prefers at-risk over within-reach when adjacent cutoffs overlap", () => {
    // 91 holds B, is 1 point from dropping to B-, and 1 point from reaching A:
    // losing a letter matters more.
    expect(letterBoundary(91, { "A": 92, "B": 90 })).toEqual({
      letter: "B",
      cutoff: 90,
      direction: "at-risk",
      distance: 1,
    });
  });

  it("ignores the lowest letter for at-risk", () => {
    expect(letterBoundary(1, { A: 90, F: 0 })).toEqual(null);
    expect(letterBoundary(1, { F: 0 })).toEqual(null);
  });

  it("ignores cutoffs that are not finite numbers", () => {
    expect(letterBoundary(89.5, { A: 90, W: Number.NaN, I: Number.POSITIVE_INFINITY })).toEqual({
      letter: "A",
      cutoff: 90,
      direction: "within-reach",
      distance: 0.5,
    });
  });

  it("returns null for an empty set of cutoffs or a non-finite grade", () => {
    expect(letterBoundary(91, {})).toEqual(null);
    expect(letterBoundary(Number.NaN, { A: 90 })).toEqual(null);
  });

  it("uses the highest cutoff the grade meets as the letter currently held", () => {
    // Two cutoffs both met; the higher one is the real letter.
    expect(letterBoundary(84, { "A": 90, "B-": 80, B: 83 })).toEqual({
      letter: "B",
      cutoff: 83,
      direction: "at-risk",
      distance: 1,
    });
  });
});

describe("letterBoundary floating point", () => {
  it("still counts a distance of exactly 2 that floating point computes as 2.000000000000007", () => {
    expect(letterBoundary(64.01, { D: 62.01 })).toMatchObject({ letter: "D", direction: "at-risk" });
    expect(letterBoundary(62.01, { D: 64.01 })).toMatchObject({ letter: "D", direction: "within-reach" });
  });

  it("resolves equal cutoffs by label, not by the order they were stored", () => {
    expect(letterBoundary(91, { B: 90, "A-": 90 })?.letter).toBe(letterBoundary(91, { "A-": 90, B: 90 })?.letter);
  });
});
