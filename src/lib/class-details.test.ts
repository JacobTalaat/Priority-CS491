import { describe, expect, it } from "vitest";
import { detailText, detailValue, formatContacts } from "./class-details";

describe("formatContacts", () => {
  it("joins name, role, and email per contact and separates contacts with semicolons", () => {
    expect(
      formatContacts([
        { name: "Dr. Ruiz", role: "Instructor", email: "eruiz@njit.edu" },
        { name: "Sam Lee", role: "TA", email: "slee@njit.edu" },
      ]),
    ).toBe("Dr. Ruiz (Instructor) eruiz@njit.edu; Sam Lee (TA) slee@njit.edu");
  });

  it("leaves out the parts the syllabus didn't give", () => {
    expect(formatContacts([{ name: null, role: "TA", email: "ta@njit.edu" }])).toBe("(TA) ta@njit.edu");
    expect(formatContacts([{ name: "Dr. Ruiz", role: null, email: null }])).toBe("Dr. Ruiz");
  });

  it("skips contacts with nothing in them", () => {
    expect(formatContacts([{ name: null, role: null, email: " " }, { name: "Dr. Ruiz", role: null, email: null }])).toBe(
      "Dr. Ruiz",
    );
    expect(formatContacts([])).toBe("");
  });
});

describe("detailText", () => {
  it("returns saved text and treats anything else as empty", () => {
    const details = { officeHours: "Tue 2-3 pm", credits: 3, latePolicy: null };
    expect(detailText(details, "officeHours")).toBe("Tue 2-3 pm");
    expect(detailText(details, "credits")).toBe("");
    expect(detailText(details, "latePolicy")).toBe("");
    expect(detailText(details, "contacts")).toBe("");
  });
});

describe("detailValue", () => {
  it("trims text and saves blanks as null", () => {
    expect(detailValue("  Tue 2-3 pm ")).toBe("Tue 2-3 pm");
    expect(detailValue("   ")).toBeNull();
  });
});
