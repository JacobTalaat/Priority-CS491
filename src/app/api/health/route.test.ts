import { beforeEach, describe, expect, it, vi } from "vitest";
import { GET } from "./route";

const { mockQueryRaw, mockEmailConfirmationRequired } = vi.hoisted(() => ({
  mockQueryRaw: vi.fn(),
  mockEmailConfirmationRequired: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({
  prisma: { $queryRaw: mockQueryRaw },
}));

vi.mock("@/lib/supabase", () => ({
  emailConfirmationRequired: mockEmailConfirmationRequired,
}));

describe("GET /api/health", () => {
  beforeEach(() => {
    mockQueryRaw.mockReset();
    mockEmailConfirmationRequired.mockReset();
  });

  it("returns 200 and ok with the email confirmation check when the database answers", async () => {
    mockQueryRaw.mockResolvedValue([{ "?column?": 1 }]);
    mockEmailConfirmationRequired.mockResolvedValue(true);
    const res = await GET();
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({
      status: "ok",
      emailConfirmationRequired: true,
    });
  });

  it("answers null for the check when Supabase could not be asked", async () => {
    mockQueryRaw.mockResolvedValue([{ "?column?": 1 }]);
    mockEmailConfirmationRequired.mockResolvedValue(null);
    const res = await GET();
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({
      status: "ok",
      emailConfirmationRequired: null,
    });
  });

  it("still reports ok when the confirmation check itself throws", async () => {
    mockQueryRaw.mockResolvedValue([{ "?column?": 1 }]);
    mockEmailConfirmationRequired.mockRejectedValue(new Error("boom"));
    const res = await GET();
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({
      status: "ok",
      emailConfirmationRequired: null,
    });
  });

  it("returns 503 and error when the database query throws", async () => {
    mockQueryRaw.mockRejectedValue(new Error("database unavailable"));
    const res = await GET();
    expect(res.status).toBe(503);
    await expect(res.json()).resolves.toEqual({ status: "error" });
  });
});
