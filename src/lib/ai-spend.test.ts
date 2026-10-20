import { beforeEach, describe, expect, it, vi } from "vitest";
import { costMicros, estimateInputTokens, reserveSpend, settleSpend, spendPeriod } from "./ai-spend";

const { mockExecuteRaw, mockQueryRaw } = vi.hoisted(() => ({
  mockExecuteRaw: vi.fn(),
  mockQueryRaw: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({
  prisma: { $queryRaw: mockQueryRaw, $executeRaw: mockExecuteRaw },
}));

beforeEach(() => {
  mockQueryRaw.mockReset();
  mockExecuteRaw.mockReset();
});

describe("spendPeriod", () => {
  it("formats a date as the UTC YYYY-MM period", () => {
    expect(spendPeriod(new Date("2026-10-20T12:00:00Z"))).toBe("2026-10");
  });

  it("uses the UTC month, not the local one", () => {
    vi.stubEnv("TZ", "America/New_York");
    try {
      expect(spendPeriod(new Date("2026-10-31T23:30:00-04:00"))).toBe("2026-11");
    } finally {
      vi.unstubAllEnvs();
    }
  });
});

describe("costMicros", () => {
  it("rounds up to whole micro-dollars", () => {
    expect(costMicros(1, 0, 150000, 0)).toBe(1);
    expect(costMicros(0, 1, 0, 150000)).toBe(1);
    expect(costMicros(7, 0, 150000, 0)).toBe(2);
  });

  it("returns 0 for a free model", () => {
    expect(costMicros(1000, 1000, 0, 0)).toBe(0);
  });

  it("adds input and output costs exactly", () => {
    expect(costMicros(2, 3, 1000000, 1000000)).toBe(5);
    expect(costMicros(1000000, 0, 150000, 0)).toBe(150000);
  });

  it("handles the maximum bounded token counts exactly", () => {
    expect(costMicros(2000000, 32768, 1000, 1000)).toBe(2000 + 33);
    expect(costMicros(2000000, 32768, 1000000, 1000000)).toBe(2000000 + 32768);
  });
});

describe("estimateInputTokens", () => {
  it("counts bytes plus per-message overhead plus a fixed floor", () => {
    expect(estimateInputTokens([{ role: "user", content: "hello" }])).toBe(
      Buffer.byteLength("hello", "utf8") + 16 + 64
    );
  });

  it("sums across messages", () => {
    const messages = [
      { role: "system" as const, content: "sys" },
      { role: "assistant" as const, content: "héllo" },
    ];
    expect(estimateInputTokens(messages)).toBe(
      Buffer.byteLength("sys", "utf8") +
        Buffer.byteLength("héllo", "utf8") +
        2 * 16 +
        64
    );
  });
});

describe("reserveSpend", () => {
  it("passes the period, reserve and cap values to the raw query", async () => {
    mockQueryRaw.mockResolvedValue([{ period: "2026-11" }]);
    const reserved = await reserveSpend({ period: "2026-11", reserveMicros: 5000, capMicros: 10000 });
    expect(reserved).toBe(true);
    expect(mockQueryRaw).toHaveBeenCalledTimes(1);
    const values = mockQueryRaw.mock.calls[0].slice(1);
    expect(values).toEqual([
      "2026-11",
      BigInt(5000),
      BigInt(5000),
      BigInt(10000),
      BigInt(10000)
    ]);
    const sql = mockQueryRaw.mock.calls[0][0].join(" ");
    expect(sql).toContain("ON CONFLICT");
    expect(sql).toContain("RETURNING");
  });

  it("returns false when the insert is skipped or the conflict guard filters it", async () => {
    mockQueryRaw.mockResolvedValue([]);
    await expect(
      reserveSpend({ period: "2026-11", reserveMicros: 5000, capMicros: 1000 })
    ).resolves.toBe(false);
  });

  it("returns true on exactly one row", async () => {
    mockQueryRaw.mockResolvedValue([{ period: "2026-12" }]);
    await expect(
      reserveSpend({ period: "2026-12", reserveMicros: 1, capMicros: 1 })
    ).resolves.toBe(true);
  });
});

describe("settleSpend", () => {
  it("passes the period, reserve and cost values to the update", async () => {
    mockExecuteRaw.mockResolvedValue(1);
    await settleSpend({ period: "2026-11", reserveMicros: 5000, costMicros: 3000 });
    expect(mockExecuteRaw).toHaveBeenCalledTimes(1);
    const values = mockExecuteRaw.mock.calls[0].slice(1);
    expect(values).toEqual([BigInt(5000), BigInt(3000), "2026-11"]);
    const sql = mockExecuteRaw.mock.calls[0][0].join(" ");
    expect(sql).toContain("UPDATE");
  });

  it("throws when the update touches no row", async () => {
    mockExecuteRaw.mockResolvedValue(0);
    await expect(settleSpend({ period: "2026-11", reserveMicros: 5000, costMicros: 3000 })).rejects.toThrow(
      "AI spend settlement updated no row"
    );
  });

  it("throws when the update touches more than one row", async () => {
    mockExecuteRaw.mockResolvedValue(2);
    await expect(settleSpend({ period: "2026-11", reserveMicros: 5000, costMicros: 3000 })).rejects.toThrow(
      "AI spend settlement updated no row"
    );
  });
});
