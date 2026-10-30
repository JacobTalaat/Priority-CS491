import { describe, expect, it } from "vitest";
import { classifyUnsupportedRule } from "./unsupported-rule";

describe("classifyUnsupportedRule", () => {
  it("recognises drop rules", () => {
    expect(classifyUnsupportedRule("Drop the lowest")).toBe("drops");
    expect(classifyUnsupportedRule("Your lowest score is dropped")).toBe("drops");
    expect(classifyUnsupportedRule("It DROPS your lowest two")).toBe("drops");
    expect(classifyUnsupportedRule("dropping the lowest quiz")).toBe("drops");
  });

  it("recognises curves", () => {
    expect(classifyUnsupportedRule("curved")).toBe("curves");
    expect(classifyUnsupportedRule("Grades may be placed on a curve")).toBe("curves");
    expect(classifyUnsupportedRule("Scaled to the class average")).toBe("curves");
  });

  it("recognises extra credit", () => {
    expect(classifyUnsupportedRule("extra credit")).toBe("extra-credit");
    expect(classifyUnsupportedRule("Bonus points for attendance")).toBe("extra-credit");
    expect(classifyUnsupportedRule("Extra points may be offered")).toBe("extra-credit");
  });

  it("recognises late penalties", () => {
    expect(classifyUnsupportedRule("late penalty")).toBe("late-penalty");
    expect(classifyUnsupportedRule("10% per day late")).toBe("late-penalty");
    expect(classifyUnsupportedRule("5% a day for each late day")).toBe("late-penalty");
    expect(classifyUnsupportedRule("Late work is not accepted")).toBe("late-penalty");
  });

  it("does not label sentences that mention days without lateness", () => {
    expect(classifyUnsupportedRule("Always check the syllabus a day or more before class")).toBeNull();
    expect(classifyUnsupportedRule("Loses 5% a day")).toBeNull();
    expect(classifyUnsupportedRule("Read one chapter per week")).toBeNull();
  });

  it("matches case-insensitively and across punctuation", () => {
    expect(classifyUnsupportedRule("EXTRA CREDIT!")).toBe("extra-credit");
    expect(classifyUnsupportedRule("Curve:")).toBe("curves");
  });

  it("returns null for rules that name no known family", () => {
    expect(classifyUnsupportedRule("grades reweighted by committee")).toBeNull();
    expect(classifyUnsupportedRule("")).toBeNull();
  });

  it("does not match the families inside unrelated words", () => {
    expect(classifyUnsupportedRule("translated")).toBeNull();
    expect(classifyUnsupportedRule("the class average is expected")).toBeNull();
    expect(classifyUnsupportedRule("a daily warmup")).toBeNull();
  });
});
