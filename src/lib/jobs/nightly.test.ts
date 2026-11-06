import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const {
  mockUserFindMany,
  mockDeliveryCreate,
  mockDeliveryUpdate,
  mockDeliveryDeleteMany,
  mockDeliveryFindMany,
  mockLoadOpenWork,
  mockSendToUser,
  mockCourseFindMany,
  mockItemStateFindMany,
} = vi.hoisted(() => ({
  mockUserFindMany: vi.fn(),
  mockDeliveryCreate: vi.fn(),
  mockDeliveryUpdate: vi.fn(),
  mockDeliveryDeleteMany: vi.fn(),
  mockDeliveryFindMany: vi.fn(),
  mockLoadOpenWork: vi.fn(),
  mockSendToUser: vi.fn(),
  mockCourseFindMany: vi.fn(),
  mockItemStateFindMany: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    user: { findMany: mockUserFindMany },
    nightlyDelivery: {
      findMany: mockDeliveryFindMany,
      create: mockDeliveryCreate,
      update: mockDeliveryUpdate,
      deleteMany: mockDeliveryDeleteMany,
    },
    course: { findMany: mockCourseFindMany },
    itemState: { findMany: mockItemStateFindMany },
  },
}));

vi.mock("@/lib/ranking-data", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/ranking-data")>();
  return {
    // A test which sets no loader mock (returns undefined) exercises the real
    // ranking-data loader against the course/itemState prisma mocks.
    loadOpenWork: (userId: string, now: Date) =>
      mockLoadOpenWork(userId, now) ?? actual.loadOpenWork(userId, now),
  };
});

vi.mock("@/lib/notify", () => ({
  sendToUser: mockSendToUser,
}));

import type { RankedItem } from "@/lib/ranking";

import { NIGHTLY_PUSH_TTL_SECONDS, runNightlyTick } from "./nightly";
import { nyWallTimeToInstant } from "@/lib/ny-time";

// 20:30 on 2026-10-22 in New York (EDT): after the default 20:00 reminder.
const DAY = "2026-10-22";
const TICK_INSTANT = new Date("2026-10-23T00:30:00Z");
const NIGHTLY_TTL_OPTION = { ttlSeconds: NIGHTLY_PUSH_TTL_SECONDS };

type UserRow = {
  id: string;
  notifyTonight: boolean;
  notifyDueTomorrow: boolean;
  nightlyReminderTime: string;
};

function user(overrides: Partial<UserRow> = {}): UserRow {
  return {
    id: "user-a",
    notifyTonight: true,
    notifyDueTomorrow: true,
    nightlyReminderTime: "20:00",
    ...overrides,
  };
}

function rankedItem(overrides: Partial<RankedItem> = {}): RankedItem {
  return {
    assignmentId: "a-1",
    courseId: "course-1",
    courseName: "CS 101",
    title: "Problem Set 5",
    dueAt: null,
    share: 10,
    hours: null,
    graded: false,
    dueDay: "2026-10-22",
    overdue: false,
    score: null,
    boundary: null,
    ...overrides,
  };
}

// One item due on the occurrence evening (Tonight's pick) and two due the
// following New York day: real messagesFor then returns both the Tonight and
// the Due tomorrow message, with no duplicate suppression between them.
function rankedFixture(tonightDueDay: string, tomorrowDueDay: string): RankedItem[] {
  return [
    rankedItem({ assignmentId: "a-tonight", title: "Problem Set 5", dueDay: tonightDueDay }),
    rankedItem({ assignmentId: "a-tomorrow-1", title: "Quiz 3", dueDay: tomorrowDueDay }),
    rankedItem({ assignmentId: "a-tomorrow-2", title: "Essay", dueDay: tomorrowDueDay }),
  ];
}

type DeliveryRow = {
  userId: string;
  day: string;
  tonight: boolean;
  dueTomorrow: boolean;
  sentAt?: Date;
};

function delivery(userId: string, day: string): { userId: string; day: string } {
  return { userId, day };
}

// The where clause the tick must release a claim with: guarded by the flags
// read as false, so it can never match a row that already records a delivery.
function deliveryReleaseWhere(userId: string, day: string) {
  return { where: { userId, day, tonight: false, dueTomorrow: false } };
}

// Mirrors a Prisma deleteMany over the in-memory rows: only rows matching
// every field of the where clause are removed, so a guarded delete leaves a
// row that records a delivery alone.
function installDeliveryDeleteMany(rows: DeliveryRow[]) {
  mockDeliveryDeleteMany.mockReset().mockImplementation(
    async ({ where }: { where: { userId: string; day: string; tonight: boolean; dueTomorrow: boolean } }) => {
      let count = 0;
      for (let i = rows.length - 1; i >= 0; i -= 1) {
        const row = rows[i];
        if (
          row.userId === where.userId &&
          row.day === where.day &&
          row.tonight === where.tonight &&
          row.dueTomorrow === where.dueTomorrow
        ) {
          rows.splice(i, 1);
          count += 1;
        }
      }
      return { count };
    },
  );
}

function makeClock(startMs = TICK_INSTANT.getTime()) {
  let millis = startMs;
  const clock = () => new Date(millis);
  const advance = (ms: number) => {
    millis += ms;
  };
  return { clock, advance };
}

describe("runNightlyTick", () => {
  const deliveries: DeliveryRow[] = [];

  beforeEach(() => {
    deliveries.length = 0;
    installDeliveryDeleteMany(deliveries);
    mockUserFindMany.mockReset().mockResolvedValue([user()]);
    mockDeliveryFindMany.mockReset().mockResolvedValue([]);
    mockDeliveryCreate.mockReset().mockImplementation(
      async ({ data }: { data: { userId: string; day: string; tonight: boolean; dueTomorrow: boolean } }) => {
        const row = { ...data, sentAt: new Date() };
        deliveries.push(row);
        return { ...row };
      },
    );
    mockDeliveryUpdate.mockReset().mockImplementation(
      async ({
        where,
        data,
      }: {
        where: { userId_day: { userId: string; day: string } };
        data: { tonight: boolean; dueTomorrow: boolean };
      }) => {
        const row = deliveries.find(
          (candidate) =>
            candidate.userId === where.userId_day.userId && candidate.day === where.userId_day.day,
        );
        if (!row) {
          throw new Error("missing delivery");
        }
        row.tonight = data.tonight;
        row.dueTomorrow = data.dueTomorrow;
        return { ...row };
      },
    );
    mockLoadOpenWork.mockReset().mockResolvedValue(rankedFixture("2026-10-22", "2026-10-23"));
    mockSendToUser.mockReset().mockResolvedValue({ sent: 1, failed: 0, removed: 0 });
    vi.spyOn(console, "error").mockImplementation(() => {});
    // The tick shuffles the owed order; this value makes Fisher-Yates a no-op
    // (j always equals the current index), so tests keep readable id order.
    vi.spyOn(Math, "random").mockReturnValue(0.999999);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("answers with the New York day of the tick", async () => {
    const { clock } = makeClock();
    const result = await runNightlyTick(clock);
    expect(result.day).toBe(DAY);
  });

  it("claims, loads the ranked list, sends Tonight and Due tomorrow, and records the flags", async () => {
    const { clock } = makeClock();
    const result = await runNightlyTick(clock);
    expect(mockDeliveryCreate).toHaveBeenCalledWith({
      data: { userId: "user-a", day: DAY, tonight: false, dueTomorrow: false },
    });
    // Messages are computed as of tonight's 20:00 occurrence, not the tick instant.
    expect(mockLoadOpenWork).toHaveBeenCalledWith("user-a", new Date("2026-10-23T00:00:00Z"));
    expect(mockSendToUser).toHaveBeenCalledTimes(2);
    const titles = mockSendToUser.mock.calls.map(([, message]) => (message as { title: string }).title);
    expect(titles).toEqual(["Tonight", "Due tomorrow"]);
    expect(deliveries[0]).toMatchObject({ userId: "user-a", day: DAY, tonight: true, dueTomorrow: true });
    expect(result).toMatchObject({ due: 1, sent: 2, nothingToSend: 0, skippedLate: 0, remaining: 0 });
  });

  it("passes the short nightly TTL to every send", async () => {
    const { clock } = makeClock();
    const result = await runNightlyTick(clock);
    for (const call of mockSendToUser.mock.calls) {
      expect(call[2]).toEqual(NIGHTLY_TTL_OPTION);
    }
    expect(result.sent).toBeGreaterThan(0);
  });

  it("claims before either send goes out", async () => {
    const { clock } = makeClock();
    await runNightlyTick(clock);
    const claimedAt = mockDeliveryCreate.mock.invocationCallOrder[0];
    const firstSentAt = Math.min(...mockSendToUser.mock.invocationCallOrder);
    expect(claimedAt).toBeLessThan(firstSentAt);
  });

  it("lets a user whose reminder struck just before midnight ride the next tick", async () => {
    // 00:05 on 2026-10-23 in New York, a 23:45 reminder: tonight's occurrence
    // has not struck, so the reminder owed is yesterday 23:45, keyed to
    // 2026-10-22, only 20 minutes stale — delivered now, never dropped.
    mockUserFindMany.mockResolvedValue([user({ nightlyReminderTime: "23:45" })]);
    mockLoadOpenWork.mockResolvedValue(rankedFixture("2026-10-22", "2026-10-23"));
    const { clock } = makeClock(new Date("2026-10-23T04:05:00Z").getTime());
    const result = await runNightlyTick(clock);
    expect(mockDeliveryCreate).toHaveBeenCalledWith({
      data: { userId: "user-a", day: "2026-10-22", tonight: false, dueTomorrow: false },
    });
    // Messages are computed as of yesterday 23:45, so an item due on the
    // 00:05 tick's New York day is reported as due tomorrow.
    expect(mockLoadOpenWork).toHaveBeenCalledWith("user-a", new Date("2026-10-23T03:45:00Z"));
    const titles = mockSendToUser.mock.calls.map(([, message]) => (message as { title: string }).title);
    expect(titles).toEqual(["Tonight", "Due tomorrow"]);
    expect(result).toMatchObject({ day: "2026-10-23", due: 1, sent: 2, remaining: 0 });
  });

  it("claims without sending when today's occurrence is more than three hours stale", async () => {
    // 23:30 New York against a 20:00 reminder: 210 minutes old.
    mockUserFindMany.mockResolvedValue([user({ nightlyReminderTime: "20:00" })]);
    const { clock } = makeClock(new Date("2026-10-23T03:30:00Z").getTime());
    const result = await runNightlyTick(clock);
    expect(deliveries).toHaveLength(1);
    expect(deliveries[0]).toMatchObject({ userId: "user-a", day: DAY, tonight: false, dueTomorrow: false });
    expect(mockLoadOpenWork).not.toHaveBeenCalled();
    expect(mockSendToUser).not.toHaveBeenCalled();
    // Too late to be useful, but still claimed: not retried tonight.
    expect(mockDeliveryDeleteMany).not.toHaveBeenCalled();
    expect(result).toMatchObject({ skippedLate: 1, sent: 0, remaining: 0 });
  });

  it("resolves a spring-forward skipped reminder to the hour after the gap", async () => {
    // 2026-03-08 springs 02:00 EST to 03:00 EDT, so a 02:30 reminder never
    // happens on the wall clock; it is treated as 03:30 EDT (07:30Z). A tick
    // fifteen real minutes later is 15 minutes late, not three hours.
    mockUserFindMany.mockResolvedValue([user({ nightlyReminderTime: "02:30" })]);
    mockLoadOpenWork.mockResolvedValue(rankedFixture("2026-03-08", "2026-03-09"));
    const { clock } = makeClock(new Date("2026-03-08T07:45:00Z").getTime());
    const result = await runNightlyTick(clock);
    expect(mockDeliveryCreate).toHaveBeenCalledWith({
      data: { userId: "user-a", day: "2026-03-08", tonight: false, dueTomorrow: false },
    });
    expect(mockSendToUser).toHaveBeenCalledTimes(2);
    expect(result).toMatchObject({ day: "2026-03-08", due: 1, sent: 2, skippedLate: 0 });
  });

  it("picks the earlier (EDT) occurrence for a time the fall-back repeats", async () => {
    // 2026-11-01 repeats 01:30 (EDT then EST); the reminder means the first
    // one, 05:30Z, so a 05:45Z tick is fifteen minutes late — not yesterday.
    mockUserFindMany.mockResolvedValue([user({ nightlyReminderTime: "01:30" })]);
    mockLoadOpenWork.mockResolvedValue(rankedFixture("2026-11-01", "2026-11-02"));
    const { clock } = makeClock(new Date("2026-11-01T05:45:00Z").getTime());
    const result = await runNightlyTick(clock);
    expect(mockDeliveryCreate).toHaveBeenCalledWith({
      data: { userId: "user-a", day: "2026-11-01", tonight: false, dueTomorrow: false },
    });
    expect(mockSendToUser).toHaveBeenCalledTimes(2);
    expect(result).toMatchObject({ day: "2026-11-01", due: 1, sent: 2, skippedLate: 0 });
  });

  it("filters candidates to users with a preference and a subscription", async () => {
    mockUserFindMany.mockResolvedValue([]);
    const { clock } = makeClock();
    await runNightlyTick(clock);
    const argument = mockUserFindMany.mock.calls[0][0] as {
      where: Record<string, unknown>;
    };
    expect(argument.where).toMatchObject({
      OR: [{ notifyTonight: true }, { notifyDueTomorrow: true }],
      pushSubscriptions: { some: {} },
    });
    expect(mockSendToUser).not.toHaveBeenCalled();
    expect(mockDeliveryCreate).not.toHaveBeenCalled();
  });

  it("skips a user whose occurrence day is already claimed", async () => {
    mockUserFindMany.mockResolvedValue([user({ nightlyReminderTime: "21:00" })]);
    mockDeliveryFindMany.mockResolvedValue([delivery("user-a", "2026-10-21")]);
    const { clock } = makeClock();
    const result = await runNightlyTick(clock);
    // No today-or-yesterday occurrence: 21:00 today has not struck and yesterday
    // was already claimed, so nothing is sent and nothing is claimed.
    expect(mockDeliveryFindMany).toHaveBeenCalledWith({
      where: { day: { in: [DAY, "2026-10-21"] } },
      select: { userId: true, day: true },
    });
    expect(mockDeliveryCreate).not.toHaveBeenCalled();
    expect(mockSendToUser).not.toHaveBeenCalled();
    expect(result).toMatchObject({ due: 0, sent: 0, remaining: 0 });
  });

  it("moves on silently when an overlapping tick already claimed the user today", async () => {
    mockDeliveryCreate.mockRejectedValue({ code: "P2002" });
    const { clock } = makeClock();
    const result = await runNightlyTick(clock);
    expect(mockSendToUser).not.toHaveBeenCalled();
    expect(mockDeliveryUpdate).not.toHaveBeenCalled();
    expect(result.sent).toBe(0);
    // The other tick is handling the user right now, so nobody is left here.
    expect(result.remaining).toBe(0);
  });

  it("sends only Tonight when notifyDueTomorrow is off", async () => {
    mockUserFindMany.mockResolvedValue([user({ notifyDueTomorrow: false })]);
    const { clock } = makeClock();
    const result = await runNightlyTick(clock);
    expect(mockSendToUser).toHaveBeenCalledTimes(1);
    expect(mockSendToUser).toHaveBeenCalledWith(
      "user-a",
      expect.objectContaining({ title: "Tonight" }),
      NIGHTLY_TTL_OPTION,
    );
    expect(deliveries[0]).toMatchObject({ tonight: true, dueTomorrow: false });
    expect(result).toMatchObject({ sent: 1 });
  });

  it("claims the day without sending anything when there is no work to name", async () => {
    mockLoadOpenWork.mockResolvedValue([]);
    const { clock } = makeClock();
    const result = await runNightlyTick(clock);
    expect(mockSendToUser).not.toHaveBeenCalled();
    expect(deliveries[0]).toMatchObject({ tonight: false, dueTomorrow: false });
    // Nothing to say is still a handled night: no retry later on.
    expect(mockDeliveryDeleteMany).not.toHaveBeenCalled();
    expect(result).toMatchObject({ sent: 0, nothingToSend: 1 });
  });

  it("keeps going when one user's send fails, and logs a fixed line", async () => {
    mockUserFindMany.mockResolvedValue([user({ id: "user-bad" }), user({ id: "user-good" })]);
    mockLoadOpenWork.mockImplementation((userId: string) => {
      if (userId === "user-bad") {
        return Promise.reject(new Error("db connection ended"));
      }
      return Promise.resolve(rankedFixture("2026-10-22", "2026-10-23"));
    });
    const { clock } = makeClock();
    const result = await runNightlyTick(clock);
    expect(mockSendToUser).not.toHaveBeenCalledWith("user-bad", expect.anything(), expect.anything());
    expect(mockSendToUser).toHaveBeenCalledWith("user-good", expect.anything(), expect.anything());
    // Nothing was delivered for user-bad, so their claim went back.
    expect(deliveries.find((row) => row.userId === "user-bad")).toBeUndefined();
    expect(mockDeliveryDeleteMany).toHaveBeenCalledWith(deliveryReleaseWhere("user-bad", DAY));
    expect(result).toMatchObject({ due: 2, sent: 2, failed: 1, remaining: 0 });
    expect(console.error).toHaveBeenCalledWith("nightly: send failed for one user");
  });

  it("stops starting users once the 30-second budget has elapsed", async () => {
    mockUserFindMany.mockResolvedValue([user({ id: "user-a" }), user({ id: "user-b" }), user({ id: "user-c" })]);
    const { clock, advance } = makeClock();
    // Each user's two sends cost 30 s of the whole budget, so the second user
    // is only ever considered at the 30 s mark: no user is STARTED at or after
    // 30 s, and two of the three are still owed tonight.
    mockSendToUser.mockImplementation(async () => {
      advance(15_000);
      return { sent: 1, failed: 0, removed: 0 };
    });
    const result = await runNightlyTick(clock);
    expect(deliveries.map((row) => row.userId)).toEqual(["user-a"]);
    expect(result).toMatchObject({ due: 3, sent: 2, remaining: 2 });
  });

  it("gives up on a load that hangs, keeps the claim, and moves on", async () => {
    vi.useFakeTimers();
    try {
      mockUserFindMany.mockResolvedValue([user({ id: "user-slow" }), user({ id: "user-good" })]);
      mockLoadOpenWork.mockImplementation((userId: string) => {
        if (userId === "user-slow") {
          return new Promise<RankedItem[]>(() => {
            // Never settles.
          });
        }
        return Promise.resolve(rankedFixture("2026-10-22", "2026-10-23"));
      });
      const { clock } = makeClock();
      const tickPromise = runNightlyTick(clock);
      await vi.advanceTimersByTimeAsync(10_000);
      const result = await tickPromise;
      expect(mockSendToUser).not.toHaveBeenCalledWith("user-slow", expect.anything(), expect.anything());
      expect(mockSendToUser).toHaveBeenCalledWith("user-good", expect.anything(), expect.anything());
      // A hung load delivered nothing, so the claim was released instead of kept.
      expect(deliveries.find((row) => row.userId === "user-slow")).toBeUndefined();
      expect(mockDeliveryDeleteMany).toHaveBeenCalledWith(deliveryReleaseWhere("user-slow", DAY));
      expect(result).toMatchObject({ due: 2, sent: 2, failed: 1, remaining: 0 });
      expect(console.error).toHaveBeenCalledWith("nightly: send failed for one user");
    } finally {
      vi.useRealTimers();
    }
  });

  it("starts both sends in parallel instead of one after the other", async () => {
    type Resolver = (value: { sent: number; failed: number; removed: number }) => void;
    const resolvers: Resolver[] = [];
    mockSendToUser.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolvers.push(resolve);
        }),
    );
    const { clock } = makeClock();
    const tickPromise = runNightlyTick(clock);
    await vi.waitFor(() => expect(mockSendToUser).toHaveBeenCalledTimes(2));
    // Neither send has resolved yet, and both have already been started.
    for (const resolve of resolvers) {
      resolve({ sent: 1, failed: 0, removed: 0 });
    }
    const result = await tickPromise;
    expect(result).toMatchObject({ sent: 2, failed: 0 });
  });

  it("gives the whole night back when every send fails to deliver", async () => {
    mockSendToUser.mockResolvedValue({ sent: 0, failed: 1, removed: 0 });
    const { clock } = makeClock();
    const result = await runNightlyTick(clock);
    expect(mockDeliveryDeleteMany).toHaveBeenCalledWith(deliveryReleaseWhere("user-a", DAY));
    expect(mockDeliveryUpdate).not.toHaveBeenCalled();
    expect(deliveries).toHaveLength(0);
    expect(result).toMatchObject({ sent: 0, failed: 2 });
  });

  it("gives the claim back when nothing was delivered and retries the whole bundle on a later tick", async () => {
    const { clock, advance } = makeClock();
    mockSendToUser
      .mockResolvedValueOnce({ sent: 0, failed: 1, removed: 0 })
      .mockResolvedValueOnce({ sent: 0, failed: 1, removed: 0 })
      .mockResolvedValueOnce({ sent: 1, failed: 0, removed: 0 })
      .mockResolvedValueOnce({ sent: 1, failed: 0, removed: 0 });
    const first = await runNightlyTick(clock);
    expect(first).toMatchObject({ sent: 0, failed: 2 });
    expect(deliveries).toHaveLength(0);
    // A retry sees whatever rows survived the first tick.
    mockDeliveryFindMany.mockImplementation(async () =>
      deliveries.map((row) => delivery(row.userId, row.day)),
    );
    advance(5 * 60_000);
    const second = await runNightlyTick(clock);
    expect(second).toMatchObject({ due: 1, sent: 2, failed: 0, remaining: 0 });
    expect(deliveries[0]).toMatchObject({ userId: "user-a", day: DAY, tonight: true, dueTomorrow: true });
  });

  it("gives the claim back after a hung load and retries the user on a later tick", async () => {
    vi.useFakeTimers();
    try {
      mockUserFindMany.mockResolvedValue([user({ id: "user-slow" })]);
      mockLoadOpenWork
        .mockImplementationOnce(() => new Promise<RankedItem[]>(() => {
          // Never settles.
        }))
        .mockResolvedValue(rankedFixture("2026-10-22", "2026-10-23"));
      const { clock, advance } = makeClock();
      const firstPromise = runNightlyTick(clock);
      await vi.advanceTimersByTimeAsync(10_000);
      const first = await firstPromise;
      expect(first).toMatchObject({ failed: 1 });
      expect(deliveries).toHaveLength(0);
      mockDeliveryFindMany.mockImplementation(async () =>
        deliveries.map((row) => delivery(row.userId, row.day)),
      );
      advance(5 * 60_000);
      const second = await runNightlyTick(clock);
      expect(second).toMatchObject({ failed: 0, sent: 2, remaining: 0 });
      expect(deliveries[0]).toMatchObject({ userId: "user-slow", day: DAY, tonight: true, dueTomorrow: true });
    } finally {
      vi.useRealTimers();
    }
  });

  it("keeps a partial delivery's claim so the delivered push is never sent twice", async () => {
    mockSendToUser.mockImplementation((_userId: string, message: { kind: string }) =>
      message.kind === "tonight"
        ? Promise.resolve({ sent: 1, failed: 0, removed: 0 })
        : Promise.resolve({ sent: 0, failed: 1, removed: 0 }),
    );
    const { clock, advance } = makeClock();
    const first = await runNightlyTick(clock);
    expect(first).toMatchObject({ sent: 1, failed: 1 });
    expect(deliveries[0]).toMatchObject({ userId: "user-a", day: DAY, tonight: true, dueTomorrow: false });
    expect(mockDeliveryDeleteMany).not.toHaveBeenCalled();
    mockDeliveryFindMany.mockImplementation(async () =>
      deliveries.map((row) => delivery(row.userId, row.day)),
    );
    advance(5 * 60_000);
    const sendsBefore = mockSendToUser.mock.calls.length;
    const second = await runNightlyTick(clock);
    // The kept claim covers the partial night: the Due tomorrow push is
    // dropped rather than re-sent alongside a duplicate Tonight push.
    expect(mockSendToUser.mock.calls).toHaveLength(sendsBefore);
    expect(second).toMatchObject({ due: 0, sent: 0, remaining: 0 });
  });

  it("never re-sends a night that was fully delivered", async () => {
    const { clock, advance } = makeClock();
    const first = await runNightlyTick(clock);
    expect(first).toMatchObject({ sent: 2 });
    expect(mockDeliveryDeleteMany).not.toHaveBeenCalled();
    mockDeliveryFindMany.mockImplementation(async () =>
      deliveries.map((row) => delivery(row.userId, row.day)),
    );
    advance(5 * 60_000);
    await runNightlyTick(clock);
    expect(mockSendToUser).toHaveBeenCalledTimes(2);
  });

  it("keeps the claim when one send rejects but its sibling was delivered", async () => {
    mockSendToUser.mockImplementation((_userId: string, message: { kind: string }) =>
      message.kind === "tonight"
        ? Promise.reject(new Error("push gateway down"))
        : Promise.resolve({ sent: 1, failed: 0, removed: 0 }),
    );
    const { clock } = makeClock();
    const result = await runNightlyTick(clock);
    expect(result).toMatchObject({ sent: 1, failed: 1 });
    expect(deliveries[0]).toMatchObject({ userId: "user-a", day: DAY, tonight: false, dueTomorrow: true });
    expect(mockDeliveryDeleteMany).not.toHaveBeenCalled();
  });

  it("keeps going when releasing a failed attempt itself errors", async () => {
    mockUserFindMany.mockResolvedValue([user({ id: "user-bad" }), user({ id: "user-good" })]);
    mockSendToUser.mockResolvedValue({ sent: 0, failed: 1, removed: 0 });
    mockDeliveryDeleteMany.mockRejectedValueOnce(new Error("delete raced a writer"));
    const { clock } = makeClock();
    const result = await runNightlyTick(clock);
    // Worst case is the old behaviour: the failed night stays claimed.
    expect(deliveries.find((row) => row.userId === "user-bad")).toBeDefined();
    expect(deliveries.find((row) => row.userId === "user-good")).toBeUndefined();
    expect(result).toMatchObject({ due: 2, sent: 0, failed: 4, remaining: 0 });
    expect(console.error).toHaveBeenCalledWith("nightly: could not release claim for one user");
  });

  it("fails the whole tick when the claim create fails for a reason other than an overlap", async () => {
    mockDeliveryCreate.mockRejectedValue(
      Object.assign(new Error("connection reset"), { code: "P1001" }),
    );
    const { clock } = makeClock();
    await expect(runNightlyTick(clock)).rejects.toThrow("connection reset");
    expect(mockSendToUser).not.toHaveBeenCalled();
    expect(mockLoadOpenWork).not.toHaveBeenCalled();
  });

  it("keeps the claim with the flag set when a message reaches two subscriptions", async () => {
    mockSendToUser.mockResolvedValue({ sent: 2, failed: 0, removed: 0 });
    const { clock } = makeClock();
    const result = await runNightlyTick(clock);
    expect(deliveries[0]).toMatchObject({ userId: "user-a", day: DAY, tonight: true, dueTomorrow: true });
    expect(mockDeliveryDeleteMany).not.toHaveBeenCalled();
    expect(result).toMatchObject({ sent: 2, failed: 0 });
  });

  it("never releases the claim when the post-delivery bookkeeping update fails", async () => {
    mockDeliveryUpdate.mockRejectedValueOnce(new Error("connection reset"));
    const { clock } = makeClock();
    const result = await runNightlyTick(clock);
    // The pushes went out: the claim must survive the bookkeeping crash, not
    // be released for a retry that would deliver them again. The flags never
    // got written, but the row's existence is what holds the night.
    expect(mockDeliveryDeleteMany).not.toHaveBeenCalled();
    expect(deliveries).toHaveLength(1);
    expect(deliveries[0]).toMatchObject({ userId: "user-a", day: DAY });
    expect(result).toMatchObject({ sent: 2, failed: 0 });
  });

  it("releases a midnight-carried night under the occurrence's previous day", async () => {
    // 00:05 on the 23rd in New York, a 23:45 reminder: the reminder is keyed
    // to the 22nd, so that is the day whose claim gets released.
    mockUserFindMany.mockResolvedValue([user({ nightlyReminderTime: "23:45" })]);
    mockSendToUser.mockResolvedValue({ sent: 0, failed: 1, removed: 0 });
    const { clock } = makeClock(new Date("2026-10-23T04:05:00Z").getTime());
    const result = await runNightlyTick(clock);
    expect(result.day).toBe("2026-10-23");
    expect(mockDeliveryDeleteMany).toHaveBeenCalledWith(deliveryReleaseWhere("user-a", "2026-10-22"));
    expect(deliveries).toHaveLength(0);
  });

  it("shuffles the owed order so stuck retries cannot starve healthy students", async () => {
    vi.useFakeTimers({ now: TICK_INSTANT });
    try {
      // Loads hang for a, b and c; only d ever loads. In raw id order the
      // three hung loads eat the whole 30 s budget, so d never starts.
      mockUserFindMany.mockResolvedValue([
        user({ id: "user-a" }),
        user({ id: "user-b" }),
        user({ id: "user-c" }),
        user({ id: "user-d" }),
      ]);
      mockLoadOpenWork.mockImplementation((userId: string) =>
        userId === "user-d"
          ? Promise.resolve(rankedFixture("2026-10-22", "2026-10-23"))
          : new Promise<RankedItem[]>(() => {
              // Never settles.
            }),
      );
      const firstPromise = runNightlyTick();
      await vi.advanceTimersByTimeAsync(40_000);
      const first = await firstPromise;
      expect(first).toMatchObject({ due: 4, sent: 0, failed: 3, remaining: 1 });
      expect(mockSendToUser).not.toHaveBeenCalled();
      expect(deliveries).toHaveLength(0);
      // A retry sees whatever rows survived the first tick.
      mockDeliveryFindMany.mockImplementation(async () =>
        deliveries.map((row) => delivery(row.userId, row.day)),
      );
      // A zero makes Fisher-Yates give every slot index 0, moving d early
      // enough to reach the budget this tick.
      vi.spyOn(Math, "random").mockReturnValue(0);
      await vi.advanceTimersByTime(5 * 60_000);
      const secondPromise = runNightlyTick();
      await vi.advanceTimersByTimeAsync(40_000);
      const second = await secondPromise;
      expect(mockSendToUser).toHaveBeenCalledWith("user-d", expect.anything(), expect.anything());
      expect(second).toMatchObject({ sent: 2, failed: 3, remaining: 0 });
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("runNightlyTick against the real loadOpenWork", () => {
  const deliveries: DeliveryRow[] = [];

  beforeEach(() => {
    deliveries.length = 0;
    installDeliveryDeleteMany(deliveries);
    // Reset to unconfigured: falls through the mock to the real loader.
    mockLoadOpenWork.mockReset();
    mockUserFindMany.mockReset();
    mockDeliveryFindMany.mockReset().mockResolvedValue([]);
    mockDeliveryCreate.mockReset().mockImplementation(
      async ({ data }: { data: { userId: string; day: string; tonight: boolean; dueTomorrow: boolean } }) => {
        const row = { ...data };
        deliveries.push(row);
        return { ...row };
      },
    );
    mockDeliveryUpdate.mockReset().mockResolvedValue({});
    mockSendToUser.mockReset().mockResolvedValue({ sent: 1, failed: 0, removed: 0 });
    vi.spyOn(console, "error").mockImplementation(() => {});
    // Same no-op shuffle value as the other suite, for the same reason.
    vi.spyOn(Math, "random").mockReturnValue(0.999999);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("reports work due at 01:00 on the next New York day as due tomorrow", async () => {
    // 00:05 on 2026-10-23 in New York, a 23:45 reminder carried past midnight:
    // the item is due at 01:00 on the 23rd, which at the occurrence instant
    // (23:45 on the 22nd) is tomorrow, not today.
    mockUserFindMany.mockResolvedValue([user({ nightlyReminderTime: "23:45" })]);
    mockCourseFindMany.mockResolvedValue([
      {
        id: "course-1",
        name: "CS 101",
        gradeSetup: null,
        assignments: [
          {
            id: "a-1",
            title: "Problem Set 5",
            dueAt: new Date("2026-10-23T05:00:00Z"),
            hasDueDate: true,
            pointsPossible: 10,
            grade: null,
          },
          {
            id: "a-2",
            title: "Quiz 3",
            dueAt: new Date("2026-10-23T07:00:00Z"),
            hasDueDate: true,
            pointsPossible: 10,
            grade: null,
          },
        ],
      },
    ]);
    mockItemStateFindMany.mockResolvedValue([]);
    const { clock } = makeClock(new Date("2026-10-23T04:05:00Z").getTime());
    const result = await runNightlyTick(clock);
    expect(mockDeliveryCreate).toHaveBeenCalledWith({
      data: { userId: "user-a", day: "2026-10-22", tonight: false, dueTomorrow: false },
    });
    expect(mockSendToUser).toHaveBeenCalledTimes(2);
    const titles = mockSendToUser.mock.calls.map(([, message]) => (message as { title: string }).title);
    const bodies = mockSendToUser.mock.calls.map(([, message]) => (message as { body: string }).body);
    expect(titles.slice(1)).toEqual(["Due tomorrow"]);
    expect(bodies[1]).toContain("Problem Set 5");
    expect(bodies[1]).toContain("Quiz 3");
    // No message calls the due day "today": that reading belongs to the 00:05
    // tick, not the 23:45 evening the student asked about.
    for (const body of bodies) {
      expect(body).not.toContain("due today");
    }
    expect(result).toMatchObject({ day: "2026-10-23", due: 1, sent: 2, remaining: 0 });
  });
});

describe("nyWallTimeToInstant", () => {
  it("converts a normal summer wall time through EDT", () => {
    expect(nyWallTimeToInstant("2026-10-22", "20:00").toISOString()).toBe("2026-10-23T00:00:00.000Z");
  });

  it("converts a normal winter wall time through EST", () => {
    expect(nyWallTimeToInstant("2026-01-20", "20:00").toISOString()).toBe("2026-01-21T01:00:00.000Z");
  });

  it("resolves a time inside the spring-forward gap to one wall-hour later", () => {
    // 02:30 does not exist on 2026-03-08; per the pick it means 03:30 EDT,
    // which is the same instant a normal 03:30 ask resolves to.
    expect(nyWallTimeToInstant("2026-03-08", "02:30").toISOString()).toBe(
      nyWallTimeToInstant("2026-03-08", "03:30").toISOString(),
    );
    expect(nyWallTimeToInstant("2026-03-08", "02:30").toISOString()).toBe("2026-03-08T07:30:00.000Z");
  });

  it("resolves a time the fall-back repeats to the earlier (EDT) instant", () => {
    expect(nyWallTimeToInstant("2026-11-01", "01:30").toISOString()).toBe("2026-11-01T05:30:00.000Z");
  });
});
