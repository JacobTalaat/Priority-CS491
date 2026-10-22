import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { SyllabusUpload } from "./syllabus-upload";

const course = { id: "c1", name: "Guided Design in Software Engineering", courseCode: "CS 490-102" };

describe("SyllabusUpload", () => {
  const html = renderToStaticMarkup(<SyllabusUpload course={course} />);

  it("names the class the syllabus is for", () => {
    expect(html).toMatch(/<h2[^>]*>Read the CS 490-102 syllabus<\/h2>/);
  });

  it("falls back to the class name without a course code", () => {
    expect(renderToStaticMarkup(<SyllabusUpload course={{ ...course, courseCode: null }} />)).toContain(
      "Read the Guided Design in Software Engineering syllabus",
    );
  });

  it("shows the AI disclosure and ties it to the form", () => {
    expect(html).toContain("Uses AI.");
    expect(html).toContain("sends it to an AI service");
    expect(html).toContain("It can make mistakes");
    expect(html).toContain("not saved until you check and");
    expect(html).toMatch(/<form[^>]*aria-describedby="[^"]*-disclosure"/);
  });

  it("has a labeled PDF-only file field", () => {
    expect(html).toMatch(/<label[^>]*>Syllabus PDF<\/label>/);
    expect(html).toContain('accept="application/pdf,.pdf"');
  });

  it("starts with an enabled Read syllabus button", () => {
    expect(html).toMatch(/<button[^>]*type="submit"[^>]*>Read syllabus<\/button>/);
    expect(html).not.toContain('aria-busy="true"');
  });
});
