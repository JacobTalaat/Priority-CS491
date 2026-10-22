import { createHash } from "node:crypto";
import { describe, expect, it, vi, beforeEach } from "vitest";

import { Prisma } from "@/generated/prisma/client";

const { mockAskLogCreate, mockAskLogFindMany } = vi.hoisted(() => ({
  mockAskLogCreate: vi.fn(),
  mockAskLogFindMany: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    askLog: { create: mockAskLogCreate, findMany: mockAskLogFindMany },
  },
}));

import { getAskLog, logAskOutcome } from "./ask-log";

function foundResult() {
  return {
    ok: true as const,
    found: true as const,
    answer: "Homework 3 is due Friday.",
    sources: SOURCES,
  };
}

const SOURCES = [
      {
        kind: "assignment" as const,
        courseId: "course-2",
        courseName: "Data Structures",
        source: { assignmentId: "assignment-1", title: "Homework 3", htmlUrl: null },
        quote: "due Fri Oct 23, 2026 11:59 PM",
      },
      {
        kind: "syllabus" as const,
        courseId: "course-1",
        courseName: "Algorithms",
        source: { fileName: "syllabus.pdf", start: 0, end: 45 },
        quote: "cumulative and closed book",
      },
];

function storedRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "log-1",
    userId: "user-1",
    question: "When is homework 3 due?",
    outcome: "not-found",
    answer: null,
    found: false,
    sourceCount: 0,
    courseId: null,
    sources: null,
    createdAt: new Date("2026-10-22T12:00:00Z"),
    ...overrides,
  };
}

describe("logAskOutcome", () => {
  beforeEach(() => {
    mockAskLogCreate.mockReset().mockResolvedValue({});
  });

  it("stores a found outcome with the answer, the exact sources, and the course scope", async () => {
    await logAskOutcome({
      userId: "user-1",
      question: "  when is hw 3 due  ",
      courseId: "course-2",
      result: foundResult(),
    });
    const { sources } = foundResult();
    expect(mockAskLogCreate).toHaveBeenCalledWith({
      data: {
        userId: "user-1",
        question: "when is hw 3 due",
        outcome: "found",
        answer: "Homework 3 is due Friday.",
        found: true,
        sourceCount: 2,
        courseId: "course-2",
        sources,
      },
    });
    // The exact array returned to the student is stored, not a reshaped copy.
    expect(mockAskLogCreate.mock.calls[0][0].data.sources).toBe(SOURCES);
  });

  it("stores a not-found outcome with a null answer and zero sources", async () => {
    await logAskOutcome({
      userId: "user-1",
      question: "what is the meaning of life",
      result: { ok: true, found: false },
    });
    expect(mockAskLogCreate).toHaveBeenCalledWith({
      data: {
        userId: "user-1",
        question: "what is the meaning of life",
        outcome: "not-found",
        answer: null,
        found: false,
        sourceCount: 0,
        courseId: null,
        sources: Prisma.DbNull,
      },
    });
  });

  it("stores failed and cap-reached outcomes with a null answer", async () => {
    for (const [reason, outcome] of [
      ["failed", "failed"],
      ["cap-reached", "cap-reached"],
    ] as const) {
      mockAskLogCreate.mockClear();
      await logAskOutcome({ userId: "user-1", question: "why", result: { ok: false, reason } });
      expect(mockAskLogCreate).toHaveBeenCalledWith({
        data: {
          userId: "user-1",
          question: "why",
          outcome,
          answer: null,
          found: false,
          sourceCount: 0,
          courseId: null,
          sources: Prisma.DbNull,
        },
      });
    }
  });

  it("skips questions that never reached the answering step", async () => {
    await logAskOutcome({
      userId: "user-1",
      question: "   ",
      result: { ok: false, reason: "invalid-question" },
    });
    expect(mockAskLogCreate).not.toHaveBeenCalled();
  });

  it("swallows a logging failure behind a fixed console error with no question text", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    mockAskLogCreate.mockRejectedValue(new Error("connection refused"));
    await expect(
      logAskOutcome({ userId: "user-1", question: "secret question", result: foundResult() })
    ).resolves.toBeUndefined();
    expect(errorSpy).toHaveBeenCalledTimes(1);
    expect(errorSpy).toHaveBeenCalledWith("Failed to store ask question log");
    errorSpy.mockRestore();
  });
});

describe("getAskLog", () => {
  beforeEach(() => {
    mockAskLogFindMany.mockReset().mockResolvedValue([
      storedRow({
        outcome: "found",
        answer: "Homework 3 is due Friday.",
        found: true,
        sourceCount: 1,
        courseId: "course-2",
        sources: foundResult().sources,
      }),
    ]);
  });

  it("returns study rows keyed by an anonymised hash of the student id", async () => {
    const rows = await getAskLog({ from: new Date("2026-10-01"), to: new Date("2026-10-31") });
    expect(mockAskLogFindMany).toHaveBeenCalledWith({
      where: { createdAt: { gte: new Date("2026-10-01"), lte: new Date("2026-10-31") } },
      orderBy: { createdAt: "desc" },
    });
    expect(rows).toEqual([
      {
        studentKey: `asklog-${createHash("sha256").update("user-1").digest("hex")}`,
        question: "When is homework 3 due?",
        outcome: "found",
        answer: "Homework 3 is due Friday.",
        found: true,
        sourceCount: 1,
        courseId: "course-2",
        sources: foundResult().sources,
        createdAt: new Date("2026-10-22T12:00:00Z"),
      },
    ]);
  });

  it("never includes the student id or any identifying fields", async () => {
    const rows = await getAskLog();
    expect(rows).toHaveLength(1);
    expect(JSON.stringify(rows)).not.toContain("user-1");
    for (const row of rows) {
      expect(Object.keys(row).sort()).toEqual([
        "answer",
        "courseId",
        "createdAt",
        "found",
        "outcome",
        "question",
        "sourceCount",
        "sources",
        "studentKey",
      ]);
    }
  });

  it("uses an open-ended window when a bound is missing", async () => {
    await getAskLog({ from: new Date("2026-10-01") });
    expect(mockAskLogFindMany).toHaveBeenCalledWith({
      where: { createdAt: { gte: new Date("2026-10-01") } },
      orderBy: { createdAt: "desc" },
    });
    await getAskLog({});
    expect(mockAskLogFindMany).toHaveBeenLastCalledWith({
      where: {},
      orderBy: { createdAt: "desc" },
    });
  });

  it("hashes each of the returned students with the fixed prefix", async () => {
    mockAskLogFindMany.mockResolvedValue([
      storedRow({ id: "log-1", userId: "user-1" }),
      storedRow({ id: "log-2", userId: "user-2" }),
    ]);
    const rows = await getAskLog();
    expect(new Set(rows.map((row) => row.studentKey))).toEqual(
      new Set([
        `asklog-${createHash("sha256").update("user-1").digest("hex")}`,
        `asklog-${createHash("sha256").update("user-2").digest("hex")}`,
      ])
    );
  });
});

describe("AskLog schema cascade", () => {
  it("declares that a student's ask log is deleted with their account", async () => {
    const { readFile } = await import("node:fs/promises");
    const schema = await readFile(new URL("../../prisma/schema.prisma", import.meta.url), "utf8");
    const model = schema.match(/model AskLog \{[\s\S]*?\n\}/);
    expect(model).not.toBeNull();
    expect(model?.[0]).toContain("fields: [userId], references: [id], onDelete: Cascade");
  });
});
