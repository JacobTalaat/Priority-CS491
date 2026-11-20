import { describe, expect, it } from "vitest";
import { buildCanvasSetup } from "./canvas-auto-setup";

const GROUPS = [
  { name: "Homework", groupWeight: 40, hasDropRules: false },
  { name: "Projects", groupWeight: 60, hasDropRules: false },
];

function input(overrides: Partial<Parameters<typeof buildCanvasSetup>[0]> = {}) {
  return {
    applyGroupWeights: true,
    groups: GROUPS,
    assignments: [
      { id: "a1", groupName: "Homework" },
      { id: "a2", groupName: "Projects" },
    ],
    ...overrides,
  };
}

describe("buildCanvasSetup", () => {
  it("builds the Canvas weights as a confirmable setup", () => {
    expect(buildCanvasSetup(input())).toEqual({
      categories: [
        { name: "Homework", weight: 40 },
        { name: "Projects", weight: 60 },
      ],
      assignmentMappings: [
        { assignmentId: "a1", category: "Homework" },
        { assignmentId: "a2", category: "Projects" },
      ],
      finalExamWeight: 0,
      cutoffs: {},
      classDetails: {},
      unsupportedRules: [],
    });
  });

  it("returns null when two groups share a trimmed, case-insensitive name", () => {
    expect(
      buildCanvasSetup(
        input({
          groups: [
            { name: "Homework", groupWeight: 50, hasDropRules: false },
            { name: " homework ", groupWeight: 50, hasDropRules: false },
          ],
          // Only "Homework" is used, so the duplicate-name check is the only
          // thing that can return null.
          assignments: [
            { id: "a1", groupName: "Homework" },
            { id: "a2", groupName: " homework " },
          ],
        }),
      ),
    ).toBeNull();
  });

  it("returns null when a group carries a drop rule the engine cannot apply", () => {
    expect(
      buildCanvasSetup(
        input({
          groups: [
            { name: "Homework", groupWeight: 40, hasDropRules: true },
            { name: "Projects", groupWeight: 60, hasDropRules: false },
          ],
        }),
      ),
    ).toBeNull();
  });

  it("keeps a weight-0 group at 0 so the total still reaches 100", () => {
    expect(
      buildCanvasSetup(
        input({
          groups: [
            { name: "Homework", groupWeight: 40, hasDropRules: false },
            { name: "Imported Assignments", groupWeight: 0, hasDropRules: false },
            { name: "Projects", groupWeight: 60, hasDropRules: false },
          ],
          assignments: [
            { id: "a1", groupName: "Homework" },
            { id: "a2", groupName: "Imported Assignments" },
            { id: "a3", groupName: "Projects" },
          ],
        }),
      )?.categories,
    ).toEqual([
      { name: "Homework", weight: 40 },
      { name: "Imported Assignments", weight: 0 },
      { name: "Projects", weight: 60 },
    ]);
  });

  it("allows a course with no assignments yet", () => {
    expect(buildCanvasSetup(input({ assignments: [] }))?.assignmentMappings).toEqual([]);
  });

  it("returns null when Canvas does not apply group weights", () => {
    expect(buildCanvasSetup(input({ applyGroupWeights: false }))).toBeNull();
  });

  it("returns null when the weights total 99", () => {
    expect(
      buildCanvasSetup(
        input({
          groups: [
            { name: "Homework", groupWeight: 39, hasDropRules: false },
            { name: "Projects", groupWeight: 60, hasDropRules: false },
          ],
        }),
      ),
    ).toBeNull();
  });

  it("returns null when a group has no weight", () => {
    expect(
      buildCanvasSetup(
        input({
          groups: [
            { name: "Homework", groupWeight: null, hasDropRules: false },
            { name: "Projects", groupWeight: 60, hasDropRules: false },
          ],
        }),
      ),
    ).toBeNull();
  });

  it("returns null when an assignment has no group", () => {
    expect(buildCanvasSetup(input({ assignments: [{ id: "a1", groupName: null }] }))).toBeNull();
  });

  it("returns null when an assignment names a group that does not exist", () => {
    expect(
      buildCanvasSetup(
        input({
          assignments: [
            { id: "a1", groupName: "Homework" },
            { id: "a2", groupName: "Ghost" },
          ],
        }),
      ),
    ).toBeNull();
  });
});
