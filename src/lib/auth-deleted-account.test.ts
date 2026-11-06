import { beforeEach, describe, expect, it, vi } from "vitest";

// In-memory User table with the real unique constraints (id, email,
// authUserId) and a set of auth ids Supabase would still report as alive.
const { rows, liveAuth, rowIdCounter, mockVerify, mockAuthUserExists } = vi.hoisted(() => ({
  rows: [] as { id: string; email: string; authUserId: string }[],
  liveAuth: new Set<string>(),
  // Monotonic so a create that fails a constraint still consumes an id, the
  // way a real database sequence does.
  rowIdCounter: { n: 1 },
  mockVerify: vi.fn(),
  mockAuthUserExists: vi.fn(async (id: string): Promise<boolean | null> => liveAuth.has(id)),
}));

vi.mock("@/lib/supabase", () => ({
  verifyAccessToken: mockVerify,
  authUserExists: mockAuthUserExists,
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    user: {
      findUnique: async ({ where }: { where: { authUserId?: string; email?: string; id?: string } }) => {
        if (where.authUserId) {
          return rows.find((r) => r.authUserId === where.authUserId) ?? null;
        }
        if (where.email) {
          return rows.find((r) => r.email === where.email) ?? null;
        }
        return rows.find((r) => r.id === where.id) ?? null;
      },
      create: async ({ data }: { data: { email: string; authUserId: string } }) => {
        const row = { id: `row-${rowIdCounter.n++}`, ...data };
        if (rows.some((r) => r.email === row.email || r.authUserId === row.authUserId)) {
          throw Object.assign(new Error("unique"), { code: "P2002" });
        }
        rows.push(row);
        return row;
      },
      deleteMany: async ({ where }: { where: { id: string; authUserId: string } }) => {
        // Only removes rows matching both fields, like the scoped delete.
        const before = rows.length;
        let i = 0;
        while (i < rows.length) {
          const r = rows[i];
          if (r.id === where.id && r.authUserId === where.authUserId) {
            rows.splice(i, 1);
          } else {
            i += 1;
          }
        }
        return { count: before - rows.length };
      },
    },
  },
}));

import { getUserFromRequest } from "@/lib/auth";

const req = (t: string) => new Request("http://x/api/auth/me", { headers: { Authorization: `Bearer ${t}` } });

describe("audit probe: deleted account + still-valid access token", () => {
  beforeEach(() => {
    rows.length = 0;
    liveAuth.clear();
    mockVerify.mockReset();
    mockAuthUserExists.mockReset();
    mockAuthUserExists.mockImplementation(async (id: string) => liveAuth.has(id));  });

  it("deleted account: the old token creates no ghost row and a re-signup with the email succeeds", async () => {
    // Account deleted: Prisma row and Supabase auth user are gone. getClaims
    // verifies asymmetric JWTs locally, so the old (unexpired) token still
    // verifies; the deleted auth id is not in the live set any more.
    mockVerify.mockImplementation(async (t: string) =>
      t === "old-token"
        ? { authUserId: "auth-OLD", email: "student@njit.edu" }
        : { authUserId: "auth-NEW", email: "student@njit.edu" }
    );

    // Supabase still accepts the deleted account's token, but the row is
    // never recreated, so the email stays free.
    const ghost = await getUserFromRequest(req("old-token"));
    expect(ghost).toBeNull();
    expect(rows).toHaveLength(0);

    // The same student signs up again with the same email -> new Supabase id.
    liveAuth.add("auth-NEW");
    const fresh = await getUserFromRequest(req("new-token"));
    expect(fresh).not.toBeNull();
    expect(
      rows.map((r) => ({ email: r.email, authUserId: r.authUserId }))
    ).toEqual([{ email: "student@njit.edu", authUserId: "auth-NEW" }]);
  });

  it("a ghost row seeded before the fix is removed, not adopted, when the same email signs up again", async () => {
    // From before the fix: the deleted account's token got to create a row,
    // and now the table already holds it when the student comes back.
    mockVerify.mockImplementation(async (t: string) =>
      t === "old-token"
        ? { authUserId: "auth-OLD", email: "student@njit.edu" }
        : { authUserId: "auth-NEW", email: "student@njit.edu" }
    );
    rows.push({ id: "row-1", email: "student@njit.edu", authUserId: "auth-OLD" });
    liveAuth.add("auth-NEW");

    const fresh = await getUserFromRequest(req("new-token"));
    expect(fresh).not.toBeNull();
    expect(rows).toHaveLength(1);
    expect(
      rows.map((r) => ({ email: r.email, authUserId: r.authUserId }))
    ).toEqual([{ email: "student@njit.edu", authUserId: "auth-NEW" }]);
    // A new row was created: its id cannot be the ghost's, so any
    // re-link/adopt implementation of the orphan would fail here.
    expect(rows[0]?.id).not.toBe("row-1");
  });

  it("the post-create check removes a row that slipped past a pre-create all-clear before the auth user was deleted", async () => {
    // The interleaving the two-part fix guards against: the delete route
    // removed the Prisma row, the stale token passed the pre-create check
    // while the auth user still existed, and then the auth user was deleted
    // before the row landed.
    mockVerify.mockImplementation(async () => ({ authUserId: "auth-OLD", email: "student@njit.edu" }));
    mockAuthUserExists.mockImplementationOnce(async () => {
      liveAuth.add("auth-OLD");
      return true;
    });
    mockAuthUserExists.mockImplementationOnce(async () => {
      liveAuth.delete("auth-OLD");
      return false;
    });

    const user = await getUserFromRequest(req("old-token"));
    expect(user).toBeNull();
    expect(rows).toHaveLength(0);
  });

  it("a row is kept when the post-create check cannot reach Supabase", async () => {
    mockVerify.mockImplementation(async () => ({ authUserId: "auth-OLD", email: "student@njit.edu" }));
    mockAuthUserExists
      .mockImplementationOnce(async () => {
        liveAuth.add("auth-OLD");
        return true;
      })
      .mockImplementationOnce(async () => null);

    const user = await getUserFromRequest(req("old-token"));
    expect(user).not.toBeNull();
    expect(rows).toHaveLength(1);
    expect(rows[0]?.authUserId).toBe("auth-OLD");
  });
});
