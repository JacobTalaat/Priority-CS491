import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockEventFindMany, mockEventUpdateMany, mockUserFindUnique, mockSendToUser } = vi.hoisted(
  () => ({
    mockEventFindMany: vi.fn(),
    mockEventUpdateMany: vi.fn(),
    mockUserFindUnique: vi.fn(),
    mockSendToUser: vi.fn(),
  }),
);

vi.mock("@/lib/prisma", () => ({
  prisma: {
    gradePostedEvent: { findMany: mockEventFindMany, updateMany: mockEventUpdateMany },
    user: { findUnique: mockUserFindUnique },
  },
}));

vi.mock("@/lib/notify", () => ({
  sendToUser: mockSendToUser,
}));

import { gradePostedMessage } from "./notification-messages";
import {
  deliverGradePostedNotifications,
  GRADE_PUSH_FRESH_MS,
} from "./grade-posted-notify";

const USER_ID = "user-1";
const NOW = new Date("2026-11-05T03:00:00.000Z");

type EventRow = {
  id: string;
  score: number;
  postedAt: Date;
  assignment: { title: string; pointsPossible: number; course: { name: string } };
};

function event(
  id: string,
  overrides: { score?: number; postedAt?: Date } = {},
): EventRow {
  const base: EventRow = {
    id,
    score: 8,
    postedAt: new Date(NOW.getTime() - 60_000),
    assignment: { title: "Lab", pointsPossible: 10, course: { name: "CS 101" } },
  };
  return {
    ...base,
    score: overrides.score ?? base.score,
    postedAt: overrides.postedAt ?? base.postedAt,
  };
}

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((settle) => {
    resolve = settle;
  });
  return { promise, resolve };
}

describe("deliverGradePostedNotifications", () => {
  beforeEach(() => {
    mockEventFindMany.mockReset().mockResolvedValue([]);
    mockEventUpdateMany.mockReset().mockResolvedValue({ count: 1 });
    mockUserFindUnique.mockReset().mockResolvedValue({ notifyGradePosted: true });
    mockSendToUser.mockReset().mockResolvedValue({ sent: 1, failed: 0, removed: 0 });
  });

  it("loads this user's unclaimed events newest first", async () => {
    await deliverGradePostedNotifications(USER_ID, NOW);
    expect(mockUserFindUnique).toHaveBeenCalledWith({
      where: { id: USER_ID },
      select: { notifyGradePosted: true },
    });
    expect(mockEventFindMany).toHaveBeenCalledWith({
      where: { userId: USER_ID, notifiedAt: null },
      orderBy: { postedAt: "desc" },
      select: {
        id: true,
        score: true,
        postedAt: true,
        assignment: {
          select: {
            title: true,
            pointsPossible: true,
            course: { select: { name: true } },
          },
        },
      },
    });
    expect(mockEventUpdateMany).not.toHaveBeenCalled();
    expect(mockSendToUser).not.toHaveBeenCalled();
  });

  it("claims every pending event before any send starts", async () => {
    const order: string[] = [];
    mockEventFindMany.mockResolvedValue([event("event-1"), event("event-2"), event("event-3")]);
    mockEventUpdateMany.mockImplementation(async ({ where }: { where: { id: string } }) => {
      order.push(`claim:${where.id}`);
      return { count: 1 };
    });
    mockSendToUser.mockImplementation(async () => {
      order.push("send");
      return { sent: 1, failed: 0, removed: 0 };
    });
    const result = await deliverGradePostedNotifications(USER_ID, NOW);
    expect(order.slice(0, 3)).toEqual(["claim:event-1", "claim:event-2", "claim:event-3"]);
    expect(order.slice(3)).toEqual(["send", "send", "send"]);
    expect(result).toEqual({ attempted: 3, suppressed: 0 });
  });

  it("does not send while a claim is still undecided", async () => {
    const gate = deferred();
    mockEventFindMany.mockResolvedValue([event("event-1"), event("event-2")]);
    mockEventUpdateMany
      .mockImplementationOnce(async () => {
        await gate.promise;
        return { count: 1 };
      })
      .mockResolvedValue({ count: 1 });
    let settled = false;
    const run = deliverGradePostedNotifications(USER_ID, NOW).then((result) => {
      settled = true;
      return result;
    });
    await Promise.resolve();
    expect(mockSendToUser).not.toHaveBeenCalled();
    gate.resolve();
    const result = await run;
    expect(settled).toBe(true);
    expect(result.attempted).toBe(2);
    expect(mockSendToUser).toHaveBeenCalledTimes(2);
  });

  it("an event another process claimed is dropped and never sent", async () => {
    mockEventFindMany.mockResolvedValue([event("event-1"), event("event-2")]);
    mockEventUpdateMany.mockImplementation(async ({ where }: { where: { id: string } }) => {
      return where.id === "event-1" ? { count: 0 } : { count: 1 };
    });
    const result = await deliverGradePostedNotifications(USER_ID, NOW);
    expect(result).toEqual({ attempted: 1, suppressed: 0 });
    expect(mockSendToUser).toHaveBeenCalledTimes(1);
    expect(mockSendToUser.mock.calls[0][1]).toEqual(
      gradePostedMessage({
        assignmentTitle: "Lab",
        courseName: "CS 101",
        score: 8,
        pointsPossible: 10,
      }),
    );
  });

  it("a stale event is claimed as handled but never sent", async () => {
    const stale = event("old", { postedAt: new Date(NOW.getTime() - GRADE_PUSH_FRESH_MS - 1) });
    mockEventFindMany.mockResolvedValue([stale]);
    const result = await deliverGradePostedNotifications(USER_ID, NOW);
    expect(mockEventUpdateMany).toHaveBeenCalledWith({
      where: { id: "old", notifiedAt: null },
      data: { notifiedAt: NOW },
    });
    expect(result).toEqual({ attempted: 0, suppressed: 1 });
    expect(mockSendToUser).not.toHaveBeenCalled();
  });

  it("a burst of five fresh events claims all five and sends only the three newest", async () => {
    const events = ["one", "two", "three", "four", "five"].map((id, index) =>
      event(id, { score: index + 1, postedAt: new Date(NOW.getTime() - 60_000 * (index + 1)) }),
    );
    mockEventFindMany.mockResolvedValue(events);
    const result = await deliverGradePostedNotifications(USER_ID, NOW);
    expect(mockEventUpdateMany).toHaveBeenCalledTimes(5);
    for (const row of events) {
      expect(mockEventUpdateMany).toHaveBeenCalledWith({
        where: { id: row.id, notifiedAt: null },
        data: { notifiedAt: NOW },
      });
    }
    expect(mockSendToUser).toHaveBeenCalledTimes(3);
    expect(mockSendToUser.mock.calls.map((call) => call[1])).toEqual(
      events.slice(0, 3).map((row) =>
        gradePostedMessage({
          assignmentTitle: "Lab",
          courseName: "CS 101",
          score: row.score,
          pointsPossible: 10,
        }),
      ),
    );
    expect(result).toEqual({ attempted: 3, suppressed: 2 });
  });

  it("starts every send before any of them resolves", async () => {
    const first = deferred();
    const second = deferred();
    const gates = [first, second];
    let started = 0;
    mockEventFindMany.mockResolvedValue([event("event-1"), event("event-2")]);
    mockSendToUser.mockImplementation(async () => {
      started += 1;
      await gates.shift()!.promise;
      return { sent: 1, failed: 0, removed: 0 };
    });
    const run = deliverGradePostedNotifications(USER_ID, NOW);
    for (let tick = 0; tick < 50; tick += 1) {
      await Promise.resolve();
    }
    expect(started).toBe(2);
    expect(mockSendToUser).toHaveBeenCalledTimes(2);
    first.resolve();
    second.resolve();
    await run;
  });

  it("claims all events for a user with grades-off but sends none", async () => {
    mockUserFindUnique.mockResolvedValue({ notifyGradePosted: false });
    mockEventFindMany.mockResolvedValue([event("event-1"), event("event-2")]);
    const result = await deliverGradePostedNotifications(USER_ID, NOW);
    expect(result).toEqual({ attempted: 0, suppressed: 2 });
    expect(mockEventUpdateMany).toHaveBeenCalledTimes(2);
    expect(mockEventUpdateMany).toHaveBeenCalledWith({
      where: { id: "event-2", notifiedAt: null },
      data: { notifiedAt: NOW },
    });
    expect(mockSendToUser).not.toHaveBeenCalled();
  });

  it("with no unclaimed events there is nothing claimed and nothing sent", async () => {
    const result = await deliverGradePostedNotifications(USER_ID, NOW);
    expect(result).toEqual({ attempted: 0, suppressed: 0 });
    expect(mockEventUpdateMany).not.toHaveBeenCalled();
    expect(mockSendToUser).not.toHaveBeenCalled();
  });

  it("a grade exactly at the 12 hour cutoff still counts as fresh", async () => {
    const boundary = event("edge", { postedAt: new Date(NOW.getTime() - GRADE_PUSH_FRESH_MS) });
    mockEventFindMany.mockResolvedValue([boundary]);
    const result = await deliverGradePostedNotifications(USER_ID, NOW);
    expect(result).toEqual({ attempted: 1, suppressed: 0 });
    expect(mockSendToUser).toHaveBeenCalledTimes(1);
  });
});
