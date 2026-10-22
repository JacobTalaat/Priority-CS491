import { describe, expect, it } from "vitest";
import { reasonFor, withReasons, type ReasonBoundary } from "./item-reason";
import type { RankedItem } from "./ranking";

// 12:30 PM EDT on Wednesday 2026-10-14.
const NOW = new Date("2026-10-14T16:30:00.000Z");

function ranked(overrides: Partial<RankedItem> & { assignmentId: string }): RankedItem {
  return {
    courseId: "course-1",
    courseName: "Algorithms",
    title: `Work ${overrides.assignmentId}`,
    dueAt: null,
    share: null,
    hours: null,
    graded: false,
    dueDay: null,
    overdue: false,
    score: null,
    boundary: null,
    ...overrides,
  };
}

const NY_MIDNIGHT = "2026-10-15T00:00:00-04:00";

describe("reasonFor when buckets", () => {
  it("says how late overdue work is", () => {
    // NOW is Wednesday Oct 14 in New York.
    const late = (dueDay: string) =>
      reasonFor(ranked({ assignmentId: "a", dueAt: new Date(`${dueDay}T09:00:00-04:00`), dueDay, overdue: true }), NOW);
    expect(late("2026-10-14")).toBe("Overdue since earlier today");
    expect(late("2026-10-13")).toBe("Overdue since yesterday");
    expect(late("2026-10-09")).toBe("Overdue since Friday");
  });

  it("never shows a positive estimate as zero minutes", () => {
    expect(reasonFor(ranked({ assignmentId: "a", dueDay: "2026-10-14", hours: 0.01 }), NOW)).toBe(
      "Due today, under 5 minutes",
    );
  });

  it("tells apart estimates the ranking treats differently", () => {
    const one = reasonFor(ranked({ assignmentId: "a", dueDay: "2026-10-15", share: 10, hours: 1.01 }), NOW);
    const oneAndHalf = reasonFor(ranked({ assignmentId: "b", dueDay: "2026-10-15", share: 14, hours: 1.49 }), NOW);
    expect(one).toBe("Due tomorrow, 10 percent of your grade, about 1 hour");
    expect(oneAndHalf).toBe("Due tomorrow, 14 percent of your grade, about 1.5 hours");
  });

  it("says No due date for items without one", () => {
    expect(reasonFor(ranked({ assignmentId: "a" }), NOW)).toBe("No due date");
  });

  it("says Due today for an item due today", () => {
    expect(reasonFor(ranked({ assignmentId: "a", dueDay: "2026-10-14" }), NOW)).toBe("Due today");
  });

  it("splits the day at New York midnight, not at elapsed time", () => {
    // A minute before NY midnight is still today; a minute after is tomorrow,
    // even though both items are equally far from NOW in elapsed time terms.
    const lastMinuteToday = ranked({
      assignmentId: "today",
      dueAt: new Date("2026-10-14T23:59:00-04:00"),
      dueDay: "2026-10-14",
    });
    const firstMinuteTomorrow = ranked({
      assignmentId: "tomorrow",
      dueAt: new Date(NY_MIDNIGHT),
      dueDay: "2026-10-15",
    });

    expect(reasonFor(lastMinuteToday, NOW)).toBe("Due today");
    expect(reasonFor(firstMinuteTomorrow, NOW)).toBe("Due tomorrow");
  });

  it("uses the weekday name two to six days ahead", () => {
    expect(reasonFor(ranked({ assignmentId: "a", dueDay: "2026-10-16" }), NOW)).toBe("Due Friday");
    expect(reasonFor(ranked({ assignmentId: "b", dueDay: "2026-10-19" }), NOW)).toBe("Due Monday");
  });

  it("keeps a five-day-ahead item on a weekday name and switches at seven", () => {
    // Oct 19 is 5 New York calendar days ahead, Oct 20 is 6 (still a weekday
    // name), Oct 21 is 7 and switches to the date format.
    expect(reasonFor(ranked({ assignmentId: "a", dueDay: "2026-10-19" }), NOW)).toBe("Due Monday");
    expect(reasonFor(ranked({ assignmentId: "b", dueDay: "2026-10-20" }), NOW)).toBe("Due Tuesday");
    expect(reasonFor(ranked({ assignmentId: "c", dueDay: "2026-10-21" }), NOW)).toBe("Due Oct 21");
  });
});

describe("reasonFor weight", () => {
  it("states the share rounded to the nearest whole percent", () => {
    expect(reasonFor(ranked({ assignmentId: "a", share: 14.6 }), NOW)).toBe("No due date, 15 percent of your grade");
    expect(reasonFor(ranked({ assignmentId: "b", share: 2.4 }), NOW)).toBe("No due date, 2 percent of your grade");
  });

  it("uses under 1 percent when the share rounds away to zero but is real", () => {
    expect(reasonFor(ranked({ assignmentId: "a", share: 0.4 }), NOW)).toBe("No due date, under 1 percent of your grade");
    expect(reasonFor(ranked({ assignmentId: "b", share: 0.5 }), NOW)).toBe("No due date, 1 percent of your grade");
  });

  it("omits the weight when the share is null or rounds to zero for real", () => {
    expect(reasonFor(ranked({ assignmentId: "null" }), NOW)).toBe("No due date");
    expect(reasonFor(ranked({ assignmentId: "zero", share: 0 }), NOW)).toBe("No due date");
  });
});

describe("reasonFor hours", () => {
  it("formats whole hours", () => {
    expect(reasonFor(ranked({ assignmentId: "a", hours: 2 }), NOW)).toBe("No due date, about 2 hours");
    expect(reasonFor(ranked({ assignmentId: "b", hours: 5 }), NOW)).toBe("No due date, about 5 hours");
  });

  it("uses the singular for one hour", () => {
    expect(reasonFor(ranked({ assignmentId: "a", hours: 1 }), NOW)).toBe("No due date, about 1 hour");
  });

  it("rounds sub-hour estimates to the nearest five minutes", () => {
    expect(reasonFor(ranked({ assignmentId: "a", hours: 0.5 }), NOW)).toBe("No due date, about 30 minutes");
    expect(reasonFor(ranked({ assignmentId: "b", hours: 0.25 }), NOW)).toBe("No due date, about 15 minutes");
    expect(reasonFor(ranked({ assignmentId: "c", hours: 0.4 }), NOW)).toBe("No due date, about 25 minutes");
  });

  it("reads almost an hour as about 1 hour, not 60 minutes", () => {
    expect(reasonFor(ranked({ assignmentId: "a", hours: 0.97 }), NOW)).toBe("No due date, about 1 hour");
  });

  it("omits hours when there is no positive estimate", () => {
    expect(reasonFor(ranked({ assignmentId: "null", hours: null }), NOW)).toBe("No due date");
    expect(reasonFor(ranked({ assignmentId: "zero", hours: 0 }), NOW)).toBe("No due date");
    expect(reasonFor(ranked({ assignmentId: "neg", hours: -2 }), NOW)).toBe("No due date");
  });
});

describe("reasonFor boundary", () => {
  const atRisk: ReasonBoundary = { letter: "B+", direction: "at-risk" };
  const withinReach: ReasonBoundary = { letter: "A-", direction: "within-reach" };

  it("appends the risk phrasing with an article by sound", () => {
    expect(reasonFor(ranked({ assignmentId: "a" }), NOW, atRisk)).toBe("No due date, could drop you below a B+");
    expect(reasonFor(ranked({ assignmentId: "b" }), NOW, { ...atRisk, letter: "B" })).toBe("No due date, could drop you below a B");
  });

  it("says an before vowel-sound letters", () => {
    expect(reasonFor(ranked({ assignmentId: "a" }), NOW, { ...atRisk, letter: "A" })).toBe("No due date, could drop you below an A");
    expect(reasonFor(ranked({ assignmentId: "b" }), NOW, { ...atRisk, letter: "A-" })).toBe("No due date, could drop you below an A-");
    expect(reasonFor(ranked({ assignmentId: "c" }), NOW, { ...atRisk, letter: "F" })).toBe("No due date, could drop you below an F");
  });

  it("appends the lift phrasing for within-reach", () => {
    expect(reasonFor(ranked({ assignmentId: "a" }), NOW, withinReach)).toBe("No due date, could lift you to an A-");
    expect(reasonFor(ranked({ assignmentId: "b" }), NOW, { ...withinReach, letter: "B+" })).toBe("No due date, could lift you to a B+");
  });
});

describe("reasonFor example", () => {
  it("matches the ticket example exactly", () => {
    const item = ranked({
      assignmentId: "a",
      dueDay: "2026-10-15",
      share: 15,
    });

    expect(reasonFor(item, NOW)).toBe("Due tomorrow, 15 percent of your grade");
  });

  it("builds all four parts in order", () => {
    const item = ranked({
      assignmentId: "a",
      dueDay: "2026-10-14",
      share: 15,
      hours: 1.5,
    });

    expect(reasonFor(item, NOW)).toBe("Due today, 15 percent of your grade, about 1.5 hours");
  });

  it("capitalises only the first word and names, with no trailing period", () => {
    const item = ranked({
      assignmentId: "a",
      dueDay: "2026-10-21",
      share: 15,
      hours: 2,
    });

    expect(reasonFor(item, NOW)).toBe("Due Oct 21, 15 percent of your grade, about 2 hours");
  });
});

describe("withReasons", () => {
  it("gives every item a reason and keeps the items themselves intact", () => {
    const items = [
      ranked({ assignmentId: "a", dueDay: "2026-10-13", overdue: true, share: 10, hours: 1, score: 10 }),
      ranked({ assignmentId: "b", dueDay: "2026-10-15", share: 15 }),
      ranked({ assignmentId: "c" }),
      ranked({ assignmentId: "d", dueDay: "2026-10-30", share: 0.4, hours: 0.5 }),
    ];

    const withReasonsItems = withReasons(items, NOW);

    expect(withReasonsItems).toHaveLength(items.length);
    for (const entry of withReasonsItems) {
      expect(entry.reason).toBeTruthy();
      const source = items.find((item) => item.assignmentId === entry.assignmentId);
      expect(entry).toMatchObject(source ?? {});
    }
    expect(withReasonsItems.map((entry) => entry.reason)).toEqual([
      "Overdue since yesterday, 10 percent of your grade, about 1 hour",
      "Due tomorrow, 15 percent of your grade",
      "No due date",
      "Due Oct 30, under 1 percent of your grade, about 30 minutes",
    ]);
  });

  it("attaches boundaries by assignmentId from the map, and none when absent", () => {
    const items = [
      ranked({ assignmentId: "risky", share: 15 }),
      ranked({ assignmentId: "plain", share: 15 }),
    ];

    const withReasonsItems = withReasons(items, NOW, new Map([
      ["risky", { letter: "B", direction: "at-risk" }],
    ]));

    expect(withReasonsItems[0].reason).toBe("No due date, 15 percent of your grade, could drop you below a B");
    expect(withReasonsItems[1].reason).toBe("No due date, 15 percent of your grade");
  });

  it("prefers a boundary attached to the item over the map", () => {
    const item = ranked({ assignmentId: "a", share: 15 });

    const [entry] = withReasons(
      [{ ...item, boundary: { letter: "A-", cutoff: 90, direction: "within-reach", distance: 1.1 } }],
      NOW,
    );

    expect(entry.reason).toBe("No due date, 15 percent of your grade, could lift you to an A-");
  });

  it("accepts work straight out of rankOpenWork", () => {
    const item = ranked({
      assignmentId: "a",
      dueAt: new Date("2026-10-15T20:00:00-04:00"),
      dueDay: "2026-10-15",
      share: 10,
      hours: 2,
      score: 5,
    });

    expect(reasonFor(item, NOW)).toBe("Due tomorrow, 10 percent of your grade, about 2 hours");
  });
});

describe("reasonFor near New York midnight", () => {
  it("counts days from today in New York, even when it is already tomorrow in UTC", () => {
    // 11:30 PM EDT on Oct 14 is 03:30 UTC on Oct 15.
    const lateEvening = new Date("2026-10-14T23:30:00-04:00");
    const dueTomorrowInNewYork = ranked({
      assignmentId: "a",
      dueAt: new Date("2026-10-15T20:00:00-04:00"),
      dueDay: "2026-10-15",
    });
    expect(reasonFor(dueTomorrowInNewYork, lateEvening)).toBe("Due tomorrow");
  });
});
