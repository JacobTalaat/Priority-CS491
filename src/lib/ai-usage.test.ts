import { beforeEach, describe, expect, it, vi } from "vitest";
import { aiUsageDay, getAiUsage, recordAiUsage } from "./ai-usage";

const { mockQueryRaw, mockGroupBy } = vi.hoisted(() => ({
  mockQueryRaw: vi.fn(),
  mockGroupBy: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    $queryRaw: mockQueryRaw,
    aiUsageDay: { groupBy: mockGroupBy },
  },
}));

beforeEach(() => {
  mockQueryRaw.mockReset();
  mockGroupBy.mockReset();
});

function recordSql(): string {
  const call = mockQueryRaw.mock.calls[mockQueryRaw.mock.calls.length - 1];
  expect(call).toBeDefined();
  return (call[0] as unknown as string[]).join(" ");
}

function recordValues(): unknown[] {
  const call = mockQueryRaw.mock.calls[mockQueryRaw.mock.calls.length - 1];
  return call.slice(1);
}

describe("aiUsageDay", () => {
  it("formats a date as the UTC YYYY-MM-DD day", () => {
    expect(aiUsageDay(new Date("2026-10-20T12:00:00Z"))).toBe("2026-10-20");
  });

  it("uses the UTC day, not the local one", () => {
    vi.stubEnv("TZ", "America/New_York");
    try {
      expect(aiUsageDay(new Date("2026-10-31T23:30:00-04:00"))).toBe("2026-11-01");
    } finally {
      vi.unstubAllEnvs();
    }
  });
});

describe("recordAiUsage", () => {
  it("upserts one atomic increment shaped by INSERT ... ON CONFLICT ... EXCLUDED", async () => {
    mockQueryRaw.mockResolvedValue([]);
    await recordAiUsage({
      day: "2026-10-22",
      feature: "syllabus-reader",
      userId: "user-1",
      failed: false,
      inputTokens: 10,
      outputTokens: 5,
      costMicros: 15,
    });
    expect(mockQueryRaw).toHaveBeenCalledTimes(1);
    const sql = recordSql();
    expect(sql).toContain('INSERT INTO "AiUsageDay"');
    expect(sql).toContain('ON CONFLICT ("day", "feature", "userId") DO UPDATE');
    expect(sql).toContain('"calls" = "AiUsageDay"."calls" + EXCLUDED."calls"');
    expect(sql).toContain('"failedCalls" = "AiUsageDay"."failedCalls" + EXCLUDED."failedCalls"');
    expect(sql).toContain('"inputTokens" = "AiUsageDay"."inputTokens" + EXCLUDED."inputTokens"');
    expect(sql).toContain('"outputTokens" = "AiUsageDay"."outputTokens" + EXCLUDED."outputTokens"');
    expect(sql).toContain('"costMicros" = "AiUsageDay"."costMicros" + EXCLUDED."costMicros"');
  });

  it("stores the day, feature, empty-string userId, call count and tokens", async () => {
    mockQueryRaw.mockResolvedValue([]);
    await recordAiUsage({
      day: "2026-10-22",
      feature: "syllabus-reader",
      userId: "user-1",
      failed: false,
      inputTokens: 10,
      outputTokens: 5,
      costMicros: 15,
    });
    expect(recordValues()).toEqual([
      "2026-10-22",
      "syllabus-reader",
      "user-1",
      BigInt(1),
      BigInt(0),
      BigInt(10),
      BigInt(5),
      BigInt(15),
    ]);
  });

  it("stores a missing userId as the empty string", async () => {
    mockQueryRaw.mockResolvedValue([]);
    await recordAiUsage({
      day: "2026-10-22",
      feature: "test",
      userId: null,
      failed: false,
      inputTokens: null,
      outputTokens: null,
      costMicros: 0,
    });
    expect(recordValues()).toEqual([
      "2026-10-22",
      "test",
      "",
      BigInt(1),
      BigInt(0),
      BigInt(0),
      BigInt(0),
      BigInt(0),
    ]);
  });

  it("counts a failed call in failedCalls while always counting calls", async () => {
    mockQueryRaw.mockResolvedValue([]);
    await recordAiUsage({
      day: "2026-10-22",
      feature: "test",
      userId: "user-1",
      failed: true,
      inputTokens: null,
      outputTokens: null,
      costMicros: 7,
    });
    expect(recordValues()).toEqual([
      "2026-10-22",
      "test",
      "user-1",
      BigInt(1),
      BigInt(1),
      BigInt(0),
      BigInt(0),
      BigInt(7),
    ]);
  });
});

describe("getAiUsage", () => {
  it("returns per-day per-feature totals summed across users via groupBy", async () => {
    const rows = [
      {
        day: "2026-10-21",
        feature: "syllabus-reader",
        _sum: {
          calls: BigInt(9),
          failedCalls: BigInt(2),
          inputTokens: BigInt(700),
          outputTokens: BigInt(150),
          costMicros: BigInt(850),
        },
      },
    ];
    mockGroupBy.mockResolvedValue(rows);
    await expect(getAiUsage({ from: "2026-10-01", to: "2026-10-22" })).resolves.toEqual([
      {
        day: "2026-10-21",
        feature: "syllabus-reader",
        calls: BigInt(9),
        failedCalls: BigInt(2),
        inputTokens: BigInt(700),
        outputTokens: BigInt(150),
        costMicros: BigInt(850),
      },
    ]);
    expect(mockGroupBy).toHaveBeenCalledWith({
      by: ["day", "feature"],
      where: { day: { gte: "2026-10-01", lte: "2026-10-22" } },
      _sum: {
        calls: true,
        failedCalls: true,
        inputTokens: true,
        outputTokens: true,
        costMicros: true,
      },
      orderBy: [{ day: "asc" }, { feature: "asc" }],
    });
  });

  it("maps null sums to zero", async () => {
    mockGroupBy.mockResolvedValue([
      {
        day: "2026-10-21",
        feature: "syllabus-reader",
        _sum: {
          calls: null,
          failedCalls: null,
          inputTokens: null,
          outputTokens: null,
          costMicros: null,
        },
      },
    ]);
    await expect(getAiUsage({ from: "2026-10-01", to: "2026-10-22" })).resolves.toEqual([
      {
        day: "2026-10-21",
        feature: "syllabus-reader",
        calls: BigInt(0),
        failedCalls: BigInt(0),
        inputTokens: BigInt(0),
        outputTokens: BigInt(0),
        costMicros: BigInt(0),
      },
    ]);
  });

  it("returns an empty list when the range has no usage", async () => {
    mockGroupBy.mockResolvedValue([]);
    await expect(getAiUsage({ from: "2026-10-01", to: "2026-10-01" })).resolves.toEqual([]);
  });
});
