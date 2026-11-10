import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { mockEnv } = vi.hoisted(() => ({
  mockEnv: { cronSecret: undefined as string | undefined },
}));

vi.mock("@/lib/env", () => ({
  env: {
    // mirrors readEnv: reading cronSecret throws when unset
    get cronSecret() {
      const value = mockEnv.cronSecret;
      if (value === undefined) {
        throw new Error("Missing required environment variable CRON_SECRET");
      }
      return value;
    },
  },
}));

import { checkCronSecret, type CronSecretCheck } from "./cron-secret";

const SECRET = "cron-secret-that-is-at-least-thirty-two-characters-long";

function requestWithHeader(header: string | null) {
  const headers = new Headers();
  if (header !== null) {
    headers.set("Authorization", header);
  }
  return new Request("http://localhost/api/jobs/daily-sync", { method: "GET", headers });
}

function expectUnauthorized(check: CronSecretCheck) {
  expect(check.ok).toBe(false);
  if (check.ok) {
    throw new Error("expected a rejection");
  }
  expect(check.response.status).toBe(401);
}

describe("checkCronSecret", () => {
  beforeEach(() => {
    mockEnv.cronSecret = SECRET;
  });

  afterEach(() => {
    mockEnv.cronSecret = undefined;
  });

  it("accepts an exact Bearer secret", () => {
    expect(checkCronSecret(requestWithHeader(`Bearer ${SECRET}`))).toEqual({ ok: true });
  });

  it("accepts a lowercase bearer scheme", () => {
    expect(checkCronSecret(requestWithHeader(`bearer ${SECRET}`))).toEqual({ ok: true });
  });

  it("rejects a Basic scheme with 401", () => {
    expectUnauthorized(checkCronSecret(requestWithHeader(`Basic ${SECRET}`)));
  });

  it("rejects a Token scheme with 401", () => {
    expectUnauthorized(checkCronSecret(requestWithHeader(`Token ${SECRET}`)));
  });

  it("rejects a bare secret with no scheme", () => {
    expectUnauthorized(checkCronSecret(requestWithHeader(SECRET)));
  });

  it("rejects a wrong secret of the same length", () => {
    expectUnauthorized(checkCronSecret(requestWithHeader(`Bearer ${"x".repeat(SECRET.length)}`)));
  });

  it("rejects a missing authorization header", () => {
    expectUnauthorized(checkCronSecret(requestWithHeader(null)));
  });

  it("answers 503 when the secret was never set up", () => {
    mockEnv.cronSecret = undefined;
    const check = checkCronSecret(requestWithHeader(`Bearer ${SECRET}`));
    expect(check.ok).toBe(false);
    if (check.ok) {
      throw new Error("expected a rejection");
    }
    expect(check.response.status).toBe(503);
  });
});
