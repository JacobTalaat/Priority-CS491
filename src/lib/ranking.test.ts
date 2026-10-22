import { describe, expect, it } from "vitest";
import { rankOpenWork, type OpenWorkItem } from "./ranking";

// 12:30 PM EDT on Wednesday 2026-10-14.
const NOW = new Date("2026-10-14T16:30:00.000Z");

function item(overrides: Partial<OpenWorkItem> & Pick<OpenWorkItem, "assignmentId">): OpenWorkItem {
  return {
    courseId: "course-1",
    courseName: "Algorithms",
    title: `Work ${overrides.assignmentId}`,
    dueAt: null,
    share: null,
    hours: null,
    graded: false,
    ...overrides,
  };
}

const msPerDay = 24 * 60 * 60 * 1000;

describe("rankOpenWork", () => {
  it("splits the day at New York midnight, not at the UTC date change", () => {
    // Both instants fall on 2026-10-15 in UTC, but in New York the first is
    // still Tuesday evening and the second is Wednesday morning.
    const evening = item({
      assignmentId: "a-evening",
      title: "Problem set",
      dueAt: new Date("2026-10-14T23:30:00-04:00"),
      share: 10,
      hours: 1,
    });
    const morning = item({
      assignmentId: "b-morning",
      title: "Quiz",
      dueAt: new Date("2026-10-15T00:30:00-04:00"),
      share: 50,
      hours: 1,
    });

    const ranked = rankOpenWork([morning, evening], NOW);

    expect(ranked.map((entry) => entry.assignmentId)).toEqual(["a-evening", "b-morning"]);
    expect(ranked.map((entry) => entry.dueDay)).toEqual(["2026-10-14", "2026-10-15"]);
  });

  it("orders dated work by due day, and the bigger share wins within one day", () => {
    const tomorrow = item({
      assignmentId: "hw-tomorrow",
      title: "Lab",
      dueAt: new Date("2026-10-15T20:00:00-04:00"),
      share: 10,
      hours: 1,
    });
    const bigShare = item({
      assignmentId: "hw-big",
      title: "Midterm",
      dueAt: new Date("2026-10-16T09:00:00-04:00"),
      share: 30,
      hours: 1,
    });
    const smallShare = item({
      assignmentId: "hw-small",
      title: "Worksheet",
      dueAt: new Date("2026-10-16T14:00:00-04:00"),
      share: 5,
      hours: 1,
    });

    const ranked = rankOpenWork([smallShare, bigShare, tomorrow], NOW);

    // Tomorrow's day comes first no matter what the shares are; within the
    // later day, the 30% item outranks the 5% item.
    expect(ranked.map((entry) => entry.assignmentId)).toEqual([
      "hw-tomorrow",
      "hw-big",
      "hw-small",
    ]);
  });

  it("divides by hours so a small item that needs little time can rank first", () => {
    const heavy = item({
      assignmentId: "hw-big",
      title: "Exam study",
      dueAt: new Date("2026-10-14T17:00:00-04:00"),
      share: 10,
      hours: 5,
    });
    const quick = item({
      assignmentId: "hw-small",
      title: "Reading quiz",
      dueAt: new Date("2026-10-14T18:00:00-04:00"),
      share: 4,
      hours: 1,
    });

    const ranked = rankOpenWork([heavy, quick], NOW);

    // 10%/5h = a score of 2; 4%/1h = a score of 4, so the quick item wins.
    expect(ranked.map((entry) => entry.assignmentId)).toEqual(["hw-small", "hw-big"]);
    expect(ranked.map((entry) => entry.score)).toEqual([4, 2]);
  });

  it("divides by 1 when there is no usable hours estimate", () => {
    const noHours = item({
      assignmentId: "hw-no-hours",
      title: "Problem set",
      dueAt: new Date("2026-10-14T17:00:00-04:00"),
      share: 10,
      hours: null,
    });
    const zeroHours = item({
      assignmentId: "hw-zero-hours",
      title: "Survey",
      dueAt: new Date("2026-10-14T18:00:00-04:00"),
      share: 6,
      hours: 0,
    });

    const ranked = rankOpenWork([noHours, zeroHours], NOW);

    expect(ranked.map((entry) => entry.score)).toEqual([10, 6]);
  });

  it("ranks a null share after the scored items in the same due day", () => {
    const scored = item({
      assignmentId: "hw-scored",
      title: "Quiz",
      dueAt: new Date("2026-10-14T17:00:00-04:00"),
      share: 2,
      hours: 1,
    });
    const unmapped = item({
      assignmentId: "hw-unmapped",
      title: "Attendance check",
      dueAt: new Date("2026-10-14T16:00:00-04:00"),
      share: null,
      hours: 1,
    });

    const ranked = rankOpenWork([unmapped, scored], NOW);

    expect(ranked.map((entry) => [entry.assignmentId, entry.score])).toEqual([
      ["hw-scored", 2],
      ["hw-unmapped", null],
    ]);
  });

  it("ranks kept overdue work first, oldest first, and drops overdue work older than seven days", () => {
    const overdueSixDays = item({
      assignmentId: "hw-six-days",
      title: "Problem set",
      dueAt: new Date(NOW.getTime() - 6 * msPerDay),
      share: 10,
      hours: 1,
    });
    const dueToday = item({
      assignmentId: "hw-today",
      title: "Lab",
      dueAt: new Date("2026-10-14T20:00:00-04:00"),
      share: 10,
      hours: 1,
    });
    const lateHomework = item({
      assignmentId: "hw-overdue",
      title: "Essay",
      dueAt: new Date("2026-10-13T17:00:00-04:00"),
      share: 10,
      hours: 1,
    });
    const overdueOld = item({
      assignmentId: "hw-old",
      title: "Reading response",
      dueAt: new Date(NOW.getTime() - 8 * msPerDay),
      share: 30,
      hours: 1,
    });

    const ranked = rankOpenWork([dueToday, overdueOld, lateHomework, overdueSixDays], NOW);

    expect(ranked.map((entry) => entry.assignmentId)).toEqual([
      "hw-six-days",
      "hw-overdue",
      "hw-today",
    ]);
    expect(ranked.map((entry) => entry.overdue)).toEqual([true, true, false]);
  });

  it("keeps overdue work within seven New York calendar days of today and drops the rest", () => {
    // NOW is midday New York on 2026-10-14, so anything from Oct 7 is still
    // on the list whatever its hour, and Oct 6 is gone.
    const lastKeptDay = item({
      assignmentId: "hw-oct-7",
      title: "Essay",
      dueAt: new Date("2026-10-07T23:59:00-04:00"),
      share: 10,
      hours: 1,
    });
    const firstDroppedDay = item({
      assignmentId: "hw-oct-6",
      title: "Essay",
      dueAt: new Date("2026-10-06T12:00:00-04:00"),
      share: 10,
      hours: 1,
    });

    const ranked = rankOpenWork([firstDroppedDay, lastKeptDay], NOW);

    expect(ranked.map((entry) => entry.assignmentId)).toEqual(["hw-oct-7"]);
  });

  it("keeps the seven-day window on New York calendar days across a DST change", () => {
    // Noon on Nov 2 in New York, after DST ended the night before; an item
    // from nine calendar days earlier (Oct 26) is inside the window. A naive
    // 7*24-hour cut would land in the Oct 26 evening and drop it.
    const afterDst = new Date("2026-11-02T17:00:00+00:00");
    const nineCalendarDaysBack = item({
      assignmentId: "hw-nine-ny-days",
      title: "Essay",
      dueAt: new Date("2026-10-26T12:00:00-04:00"),
      share: 10,
      hours: 1,
    });

    expect(
      rankOpenWork([nineCalendarDaysBack], afterDst).map((entry) => entry.assignmentId),
    ).toEqual(["hw-nine-ny-days"]);
  });

  it("drops graded items regardless of due date or share", () => {
    const graded = item({
      assignmentId: "hw-graded",
      title: "Quiz",
      dueAt: new Date("2026-10-14T17:00:00-04:00"),
      share: 50,
      hours: 1,
      graded: true,
    });
    const open = item({
      assignmentId: "hw-open",
      title: "Lab",
      dueAt: new Date("2026-10-14T18:00:00-04:00"),
      share: 5,
      hours: 1,
    });

    const ranked = rankOpenWork([graded, open], NOW);

    expect(ranked.map((entry) => entry.assignmentId)).toEqual(["hw-open"]);
  });

  it("puts items without a due date last, ranked by score first", () => {
    const dated = item({
      assignmentId: "hw-dated",
      title: "Lab",
      dueAt: new Date("2026-10-14T17:00:00-04:00"),
      share: 1,
      hours: 1,
    });
    const undatedBig = item({
      assignmentId: "hw-undated-big",
      title: "Paper draft",
      share: 20,
      hours: 10,
    });
    const undatedSmall = item({
      assignmentId: "hw-undated-small",
      title: "Reflection",
      share: 5,
      hours: 5,
    });

    const ranked = rankOpenWork([undatedSmall, dated, undatedBig], NOW);

    expect(ranked.map((entry) => entry.assignmentId)).toEqual([
      "hw-dated",
      "hw-undated-big",
      "hw-undated-small",
    ]);
    expect(ranked[2].dueDay).toBeNull();
  });

  it("breaks every tie with dueAt, then title, then assignmentId", () => {
    const secondsBeside = item({
      assignmentId: "tie-b",
      title: "Worksheet",
      dueAt: new Date("2026-10-14T17:00:00-04:00"),
      share: 10,
      hours: 2,
    });
    const earlierMinute = item({
      assignmentId: "tie-c",
      title: "Worksheet",
      dueAt: new Date("2026-10-14T16:59:00-04:00"),
      share: 10,
      hours: 2,
    });
    const alphabeticFirst = item({
      assignmentId: "tie-a",
      title: "Worksheet",
      dueAt: new Date("2026-10-14T17:00:00-04:00"),
      share: 10,
      hours: 2,
    });

    const shuffleOne = rankOpenWork([secondsBeside, earlierMinute, alphabeticFirst], NOW);
    const shuffleTwo = rankOpenWork([alphabeticFirst, secondsBeside, earlierMinute], NOW);

    expect(shuffleOne).toEqual(shuffleTwo);
    expect(shuffleOne.map((entry) => entry.assignmentId)).toEqual(["tie-c", "tie-a", "tie-b"]);
  });

  it("returns the same total order for any input order", () => {
    const items = [
      item({ assignmentId: "a", title: "Essay", dueAt: new Date(NOW.getTime() - msPerDay), share: 10, hours: 1 }),
      item({ assignmentId: "b", title: "Quiz", dueAt: new Date("2026-10-14T17:00:00-04:00"), share: 30, hours: 1 }),
      item({ assignmentId: "c", title: "Lab", dueAt: new Date("2026-10-15T01:00:00-04:00"), share: 10, hours: 5 }),
      item({ assignmentId: "d", title: "Worksheet", dueAt: new Date("2026-10-15T02:00:00-04:00"), share: null }),
      item({ assignmentId: "e", title: "Paper", share: 20, hours: null }),
      item({ assignmentId: "f", title: "Reading", dueAt: new Date("2026-10-14T23:00:00-04:00"), share: 10, hours: 1 }),
      item({ assignmentId: "g", title: "Graded quiz", dueAt: new Date("2026-10-14T17:00:00-04:00"), share: 40, hours: 1, graded: true }),
    ];

    const first = rankOpenWork(items, NOW);
    const shuffled = rankOpenWork([items[6], items[2], items[0], items[5], items[4], items[1], items[3]], NOW);

    expect(shuffled).toEqual(first);
    // Overdue a and dated b, f share today's New York bucket, so score puts
    // b first and the tie between the two 10-score items falls to dueAt.
    expect(first.map((entry) => entry.assignmentId)).toEqual(["b", "a", "f", "c", "d", "e"]);
  });
});

describe("rankOpenWork edge rules", () => {
  it("lets a bigger item due tonight outrank small overdue work from today", () => {
    // Overdue work races in today's New York bucket, so share decides against
    // tonight's items instead of beating them on age alone.
    const missedThisMorning = item({
      assignmentId: "a-missed",
      dueAt: new Date("2026-10-14T09:00:00-04:00"),
      share: 2,
    });
    const tonight = item({
      assignmentId: "b-tonight",
      dueAt: new Date("2026-10-14T23:59:00-04:00"),
      share: 30,
    });

    expect(rankOpenWork([tonight, missedThisMorning], NOW).map((ranked) => ranked.assignmentId)).toEqual([
      "b-tonight",
      "a-missed",
    ]);
  });

  it("ranks overdue work above anything due tomorrow or later", () => {
    const missed = item({
      assignmentId: "a-missed",
      dueAt: new Date("2026-10-13T09:00:00-04:00"),
      share: 0.5,
    });
    const tomorrowBig = item({
      assignmentId: "b-big-tomorrow",
      dueAt: new Date("2026-10-15T10:00:00-04:00"),
      share: 40,
    });

    expect(rankOpenWork([tomorrowBig, missed], NOW).map((ranked) => ranked.assignmentId)).toEqual([
      "a-missed",
      "b-big-tomorrow",
    ]);
    expect(rankOpenWork([missed], NOW)[0].overdue).toBe(true);
  });

  it("treats zero or negative hours as no estimate rather than dividing by them", () => {
    const negative = item({ assignmentId: "a", dueAt: new Date("2026-10-15T20:00:00-04:00"), share: 10, hours: -2 });
    const none = item({ assignmentId: "b", dueAt: new Date("2026-10-15T20:00:00-04:00"), share: 10, hours: null });

    const [first, second] = rankOpenWork([negative, none], NOW);
    expect(first.score).toBe(10);
    expect(second.score).toBe(10);
  });
});
