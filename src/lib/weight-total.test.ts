import { describe, expect, it } from "vitest";
import { isCompleteTotal, weightTotalMessage } from "./weight-total";

describe("weightTotalMessage", () => {
  it("says how much is left under 100", () => {
    expect(weightTotalMessage(95)).toBe("Total: 95% of 100%. 5% left.");
  });

  it("confirms exactly 100", () => {
    expect(weightTotalMessage(100)).toBe("Total: 100% of 100%. Adds up.");
  });

  it("says how much is over 100", () => {
    expect(weightTotalMessage(112.5)).toBe("Total: 112.5% of 100%. 12.5% over.");
  });

  it("rounds away floating point noise", () => {
    expect(weightTotalMessage(33.33 + 33.33 + 33.34)).toBe("Total: 100% of 100%. Adds up.");
    expect(weightTotalMessage(0.1 + 0.2)).toBe("Total: 0.3% of 100%. 99.7% left.");
  });

  it("treats a non-number total as 0", () => {
    expect(weightTotalMessage(Number.NaN)).toBe("Total: 0% of 100%. 100% left.");
  });
});

describe("isCompleteTotal", () => {
  it("allows tiny rounding differences", () => {
    expect(isCompleteTotal(100)).toBe(true);
    expect(isCompleteTotal(99.9995)).toBe(true);
    expect(isCompleteTotal(99.9)).toBe(false);
  });
});
