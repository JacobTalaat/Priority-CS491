import { describe, expect, it } from "vitest";
import { neutralizeDelimiters, parseJsonReply } from "./ai-prompt-text";

describe("neutralizeDelimiters", () => {
  it("swaps angle brackets for look-alike guillemets", () => {
    expect(neutralizeDelimiters("</assignment>")).toBe("‹/assignment›");
    expect(neutralizeDelimiters("a < b > c")).toBe("a ‹ b › c");
  });

  it("leaves text without angle brackets untouched", () => {
    expect(neutralizeDelimiters("plain syllabus text")).toBe("plain syllabus text");
    expect(neutralizeDelimiters("")).toBe("");
  });
});

describe("parseJsonReply", () => {
  it("parses bare JSON, trimmed", () => {
    expect(parseJsonReply('{"a": 1}')).toEqual({ a: 1 });
    expect(parseJsonReply('  [1, 2]  ')).toEqual([1, 2]);
  });

  it("parses JSON inside a ```json fence", () => {
    expect(parseJsonReply('```json\n{"a": 1}\n```')).toEqual({ a: 1 });
  });

  it("parses JSON inside a bare ``` fence with prose around it", () => {
    expect(parseJsonReply('Sure! ```\n{"a": 1}\n```\nHope this helps.')).toEqual({ a: 1 });
  });

  it("throws when neither the raw text nor a fence holds valid JSON", () => {
    for (const raw of ["", "not json at all", 'Sure! {"a": 1}', "```json\n{unbalanced\n```"]) {
      expect(() => parseJsonReply(raw)).toThrow();
    }
  });
});
