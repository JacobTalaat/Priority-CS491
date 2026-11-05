import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const {
  mockUserFindMany,
  mockNightlyDeliveryCreate,
  mockNightlyDeliveryUpdate,
  mockLoadOpenWork,
  mockSendToUser,
} = vi.hoisted(() => ({
  mockUserFindMany: vi.fn(),
  mockNightlyDeliveryCreate: vi.fn(),
  mockNightlyDeliveryUpdate: vi.fn(),
  mockLoadOpenWork: vi.fn(),
  mockSendToUser: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    user: { findMany: mockUserFindMany },
    nightlyDelivery: { create: mockNightlyDeliveryCreate, update: mockNightlyDeliveryUpdate },
  },
}));

vi.mock("@/lib/ranking-data", () => ({
  loadOpenWork: mockLoadOpenWork,
}));

vi.mock("@/lib/notify", () => ({
  sendToUser: mockSendToUser,
}));

import type { RankedItem } from "@/lib/ranking";

import { runNightlyTick } from "./nightly";

// 20:30 on 2026-10-22 in New York (EDT): after the default 20:00 reminder.
const TICK_INSTANT = new Date("2026-10-23T00:30:00Z");
const DAY = "2026-10-22";

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

// One item due today (Tonight's pick) and two due tomorrow: real messagesFor
// then returns both the Tonight and the Due tomorrow message, with no
// duplicate suppression between them.
function rankedFixture(): RankedItem[] {
  return [
    rankedItem({ assignmentId: "a-today", title: "Problem Set 5", dueDay: "2026-10-22" }),
    rankedItem({ assignmentId: "a-tomorrow-1", title: "Quiz 3", dueDay: "2026-10-23" }),
    rankedItem({ assignmentId: "a-tomorrow-2", title: "Essay", dueDay: "2026-10-23" }),
  ];
}

type DeliveryRow = {
  userId: string;
  day: string;
  tonight: boolean;
  dueTomorrow: boolean;
};

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
    mockUserFindMany.mockReset().mockResolvedValue([user()]);
    mockNightlyDeliveryCreate.mockReset().mockImplementation(
      async ({ data }: { data: { userId: string; day: string; tonight: boolean; dueTomorrow: boolean } }) => {
        const row = { ...data };
        deliveries.push(row);
        return { ...row };
      },
    );
    mockNightlyDeliveryUpdate.mockReset().mockImplementation(
      async ({ where, data }: { where: { userId_day: { userId: string; day: string } }; data: { tonight: boolean; dueTomorrow: boolean } }) => {
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
    mockLoadOpenWork.mockReset().mockResolvedValue(rankedFixture());
    mockSendToUser.mockReset().mockResolvedValue({ sent: 1, failed: 0, removed: 0 });
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("answers with the New York day of the tick", async () => {
    const { clock } = makeClock();
    const result = await runNightlyTick(clock);
    expect(result.day).toBe(DAY);
  });

  it("skips a user whose reminder time has not come yet: no claim, no send", async () => {
    mockUserFindMany.mockResolvedValue([user({ nightlyReminderTime: "21:00" })]);
    const { clock } = makeClock();
    const result = await runNightlyTick(clock);
    expect(mockNightlyDeliveryCreate).not.toHaveBeenCalled();
    expect(mockSendToUser).not.toHaveBeenCalled();
    expect(result).toMatchObject({ due: 0, sent: 0, remaining: 0 });
  });

  it("claims, loads the ranked list, sends Tonight and Due tomorrow, and records the flags", async () => {
    const { clock } = makeClock();
    const result = await runNightlyTick(clock);
    expect(mockNightlyDeliveryCreate).toHaveBeenCalledWith({
      data: { userId: "user-a", day: DAY, tonight: false, dueTomorrow: false },
    });
    expect(mockLoadOpenWork).toHaveBeenCalledWith("user-a", TICK_INSTANT);
    expect(mockSendToUser).toHaveBeenCalledTimes(2);
    const titles = mockSendToUser.mock.calls.map(([, message]) => (message as { title: string }).title);
    expect(titles).toEqual(["Tonight", "Due tomorrow"]);
    expect(deliveries[0]).toMatchObject({ userId: "user-a", day: DAY, tonight: true, dueTomorrow: true });
    expect(result).toMatchObject({ due: 1, sent: 2, nothingToSend: 0, skippedLate: 0, remaining: 0 });
  });

  it("filters candidates to users with a preference, a subscription and no delivery today", async () => {
    mockUserFindMany.mockResolvedValue([]);
    const { clock } = makeClock();
    await runNightlyTick(clock);
    const argument = mockUserFindMany.mock.calls[0][0] as {
      where: Record<string, unknown>;
    };
    expect(argument.where).toMatchObject({
      OR: [{ notifyTonight: true }, { notifyDueTomorrow: true }],
      pushSubscriptions: { some: {} },
      nightlyDeliveries: { none: { day: DAY } },
    });
    expect(mockSendToUser).not.toHaveBeenCalled();
    expect(mockNightlyDeliveryCreate).not.toHaveBeenCalled();
  });

  it("moves on silently when an overlapping tick already claimed the user today", async () => {
    mockNightlyDeliveryCreate.mockRejectedValue({ code: "P2002" });
    const { clock } = makeClock();
    const result = await runNightlyTick(clock);
    expect(mockSendToUser).not.toHaveBeenCalled();
    expect(mockNightlyDeliveryUpdate).not.toHaveBeenCalled();
    expect(result.sent).toBe(0);
  });

  it("sends only Tonight when notifyDueTomorrow is off", async () => {
    mockUserFindMany.mockResolvedValue([user({ notifyDueTomorrow: false })]);
    const { clock } = makeClock();
    const result = await runNightlyTick(clock);
    expect(mockSendToUser).toHaveBeenCalledTimes(1);
    expect(mockSendToUser).toHaveBeenCalledWith("user-a", expect.objectContaining({ title: "Tonight" }));
    expect(deliveries[0]).toMatchObject({ tonight: true, dueTomorrow: false });
    expect(result).toMatchObject({ sent: 1 });
  });

  it("claims the day without sending anything when there is no work to name", async () => {
    mockLoadOpenWork.mockResolvedValue([]);
    const { clock } = makeClock();
    const result = await runNightlyTick(clock);
    expect(mockSendToUser).not.toHaveBeenCalled();
    expect(deliveries[0]).toMatchObject({ tonight: false, dueTomorrow: false });
    expect(result).toMatchObject({ sent: 0, nothingToSend: 1 });
  });

  it("claims without sending when the reminder is more than three hours stale", async () => {
    mockUserFindMany.mockResolvedValue([user({ nightlyReminderTime: "17:00" })]);
    const { clock } = makeClock();
    const result = await runNightlyTick(clock);
    expect(deliveries).toHaveLength(1);
    expect(deliveries[0]).toMatchObject({ tonight: false, dueTomorrow: false });
    expect(mockLoadOpenWork).not.toHaveBeenCalled();
    expect(mockSendToUser).not.toHaveBeenCalled();
    expect(result).toMatchObject({ skippedLate: 1, sent: 0, remaining: 0 });
  });

  it("keeps going when one user's send fails, and logs a fixed line", async () => {
    mockUserFindMany.mockResolvedValue([user({ id: "user-bad" }), user({ id: "user-good" })]);
    mockLoadOpenWork.mockImplementation((userId: string) => {
      if (userId === "user-bad") {
        return Promise.reject(new Error("db connection ended"));
      }
      return Promise.resolve(rankedFixture());
    });
    const { clock } = makeClock();
    const result = await runNightlyTick(clock);
    expect(mockSendToUser).not.toHaveBeenCalledWith("user-bad", expect.anything());
    expect(mockSendToUser).toHaveBeenCalledWith("user-good", expect.anything());
    expect(result).toMatchObject({ due: 2, sent: 2, remaining: 0 });
    expect(console.error).toHaveBeenCalledWith("nightly: send failed for one user");
  });

  it("stops starting users after the tick budget and reports the rest as remaining", async () => {
    mockUserFindMany.mockResolvedValue([user({ id: "user-a" }), user({ id: "user-b" }), user({ id: "user-c" })]);
    const { clock, advance } = makeClock();
    // Each user's two sends cost 30 s of the 40 s budget: the third user is never started.
    mockSendToUser.mockImplementation(async () => {
      advance(15_000);
      return { sent: 1, failed: 0, removed: 0 };
    });
    const result = await runNightlyTick(clock);
    expect(deliveries.map((row) => row.userId)).toEqual(["user-a", "user-b"]);
    expect(result).toMatchObject({ due: 3, sent: 4, remaining: 1 });
  });

  it("reads reminder time and now in New York wall clock across a DST boundary", async () => {
    // 2026-11-01 is the fall-back day: 01:30 EDT (05:30Z) and 01:30 EST
    // (06:30Z) read the same wall clock one real hour apart, so a 02:00
    // reminder is not due at either instant even though real time passed it.
    mockUserFindMany.mockResolvedValue([user({ nightlyReminderTime: "02:00" })]);
    const { clock, advance } = makeClock(new Date("2026-11-01T05:30:00Z").getTime());

    const first = await runNightlyTick(clock);
    expect(mockNightlyDeliveryCreate).not.toHaveBeenCalled();
    expect(first).toMatchObject({ day: "2026-11-01", due: 0 });

    advance(60 * 60_000);
    const second = await runNightlyTick(clock);
    expect(mockNightlyDeliveryCreate).not.toHaveBeenCalled();
    expect(second.due).toBe(0);

    // 09:00Z reads 04:00 on the New York wall clock, past the 02:00 reminder
    // by two hours: still inside the late limit, so the day is claimed and the
    // user becomes due; the ranked fixture is empty relative to November, so
    // the tick sends nothing and counts nothingToSend.
    advance(150 * 60_000);
    const third = await runNightlyTick(clock);
    expect(mockNightlyDeliveryCreate).toHaveBeenCalledTimes(1);
    expect(mockSendToUser).not.toHaveBeenCalled();
    expect(third).toMatchObject({ due: 1, nothingToSend: 1, skippedLate: 0 });
  });
});
