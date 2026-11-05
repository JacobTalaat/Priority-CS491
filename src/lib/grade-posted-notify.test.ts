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
import { deliverGradePostedNotifications } from "./grade-posted-notify";

const USER_ID = "user-1";
const NOW = new Date("2026-11-05T03:00:00.000Z");

function event(
  id: string,
  overrides: Partial<{
    score: number;
    assignment: { title: string; pointsPossible: number; course: { name: string } };
  }> = {},
) {
  return {
    id,
    score: 8,
    assignment: { title: "Lab", pointsPossible: 10, course: { name: "CS 101" } },
    ...overrides,
  };
}

describe("deliverGradePostedNotifications", () => {
  beforeEach(() => {
    mockEventFindMany.mockReset().mockResolvedValue([]);
    mockEventUpdateMany.mockReset().mockResolvedValue({ count: 1 });
    mockUserFindUnique.mockReset().mockResolvedValue({ notifyGradePosted: true });
    mockSendToUser.mockReset().mockResolvedValue({ sent: 1, failed: 0, removed: 0 });
  });

  it("loads the unclaimed events for this user oldest first", async () => {
    await deliverGradePostedNotifications(USER_ID, NOW);
    expect(mockUserFindUnique).toHaveBeenCalledWith({
      where: { id: USER_ID },
      select: { notifyGradePosted: true },
    });
    expect(mockEventFindMany).toHaveBeenCalledWith({
      where: { userId: USER_ID, notifiedAt: null },
      orderBy: { postedAt: "asc" },
      select: {
        id: true,
        score: true,
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

  it("sends one message per unclaimed event with the built grade-posted body", async () => {
    const one = event("event-1", {
      score: 88,
      assignment: { title: "Problem Set 3", pointsPossible: 100, course: { name: "CS 341" } },
    });
    const two = event("event-2");
    mockEventFindMany.mockResolvedValue([one, two]);
    const result = await deliverGradePostedNotifications(USER_ID, NOW);
    expect(result).toEqual({ notified: 2, suppressed: 0 });
    expect(mockSendToUser).toHaveBeenCalledTimes(2);
    expect(mockSendToUser).toHaveBeenNthCalledWith(
      1,
      USER_ID,
      gradePostedMessage({
        assignmentTitle: "Problem Set 3",
        courseName: "CS 341",
        score: 88,
        pointsPossible: 100,
      }),
    );
    const [target, message] = mockSendToUser.mock.calls[1];
    expect(target).toBe(USER_ID);
    expect(message).toEqual({
      kind: "grade-posted",
      title: "Grade posted",
      body: "Grade posted: Lab (CS 101) — 8/10.",
      url: "/classes",
    });
  });

  it("claims each event as handled with the notifiedAt time", async () => {
    mockEventFindMany.mockResolvedValue([event("event-1")]);
    await deliverGradePostedNotifications(USER_ID, NOW);
    expect(mockEventUpdateMany).toHaveBeenCalledWith({
      where: { id: "event-1", notifiedAt: null },
      data: { notifiedAt: NOW },
    });
  });

  it("an event another process claimed is skipped without a send", async () => {
    mockEventFindMany.mockResolvedValue([event("event-1")]);
    mockEventUpdateMany.mockResolvedValue({ count: 0 });
    const result = await deliverGradePostedNotifications(USER_ID, NOW);
    expect(result).toEqual({ notified: 0, suppressed: 0 });
    expect(mockSendToUser).not.toHaveBeenCalled();
  });

  it("claims an event for a user with grades-off but never sends it, counting it suppressed", async () => {
    mockUserFindUnique.mockResolvedValue({ notifyGradePosted: false });
    mockEventFindMany.mockResolvedValue([event("event-1")]);
    const result = await deliverGradePostedNotifications(USER_ID, NOW);
    expect(result).toEqual({ notified: 0, suppressed: 1 });
    expect(mockEventUpdateMany).toHaveBeenCalledTimes(1);
    expect(mockEventUpdateMany).toHaveBeenCalledWith({
      where: { id: "event-1", notifiedAt: null },
      data: { notifiedAt: NOW },
    });
    expect(mockSendToUser).not.toHaveBeenCalled();
  });

  it("with no unclaimed events there is nothing claimed and nothing sent", async () => {
    const result = await deliverGradePostedNotifications(USER_ID, NOW);
    expect(result).toEqual({ notified: 0, suppressed: 0 });
    expect(mockEventUpdateMany).not.toHaveBeenCalled();
    expect(mockSendToUser).not.toHaveBeenCalled();
  });
});
