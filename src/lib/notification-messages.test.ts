import { describe, expect, it } from "vitest";
import { rankOpenWork, type OpenWorkItem, type RankedItem } from "./ranking";
import {
  dueTomorrowMessage,
  gradePostedMessage,
  messagesFor,
  tonightMessage,
} from "./notification-messages";

// 12:30 PM EDT on Wednesday 2026-10-14.
const NOW = new Date("2026-10-14T16:30:00.000Z");

function work(overrides: Partial<OpenWorkItem> & Pick<OpenWorkItem, "assignmentId">): OpenWorkItem {
  return {
    courseId: "course-1",
    courseName: "CS 341",
    title: `Work ${overrides.assignmentId}`,
    dueAt: null,
    share: null,
    hours: null,
    graded: false,
    ...overrides,
  };
}

function ranked(items: OpenWorkItem[], now: Date = NOW): RankedItem[] {
  return rankOpenWork(items, now);
}

const defaultPreferences = {
  notifyTonight: true,
  notifyGradePosted: true,
  notifyDueTomorrow: true,
};

describe("tonightMessage", () => {
  it("names the top item due tomorrow with its course, timing, and share", () => {
    const tomorrow = work({
      assignmentId: "hw-1",
      title: "Problem Set 4",
      dueAt: new Date("2026-10-15T15:00:00-04:00"),
      share: 15,
      hours: 1,
    });

    expect(tonightMessage(ranked([tomorrow]), NOW)).toEqual({
      kind: "tonight",
      title: "Tonight",
      body: "Start with Problem Set 4 (CS 341) — due tomorrow, 15 percent of your grade.",
      url: "/today",
    });
  });

  it("says an item due later tonight is due today", () => {
    const tonight = work({
      assignmentId: "hw-2",
      title: "Lab",
      dueAt: new Date("2026-10-14T23:00:00-04:00"),
      share: 10,
      hours: 1,
    });

    expect(tonightMessage(ranked([tonight]), NOW)?.body).toBe(
      "Start with Lab (CS 341) — due today, 10 percent of your grade.",
    );
  });

  it("flags kept overdue work as overdue", () => {
    const missed = work({
      assignmentId: "hw-3",
      title: "Essay",
      dueAt: new Date("2026-10-12T17:00:00-04:00"),
      share: 10,
      hours: 1,
    });

    expect(tonightMessage(ranked([missed]), NOW)?.body).toBe(
      "Start with Essay (CS 341) — overdue, 10 percent of your grade.",
    );
  });

  it("drops the share clause when the item sits outside the grading math", () => {
    const unmapped = work({
      assignmentId: "hw-4",
      title: "Attendance check",
      dueAt: new Date("2026-10-15T15:00:00-04:00"),
      share: null,
      hours: 1,
    });

    expect(tonightMessage(ranked([unmapped]), NOW)?.body).toBe(
      "Start with Attendance check (CS 341) — due tomorrow.",
    );
  });

  it("returns null when nothing is due today or tomorrow and nothing is overdue", () => {
    const later = work({
      assignmentId: "hw-5",
      title: "Project",
      dueAt: new Date("2026-10-17T15:00:00-04:00"),
      share: 30,
      hours: 1,
    });
    const undated = work({ assignmentId: "hw-6", title: "Paper draft" });

    const message = tonightMessage(ranked([later, undated]), NOW);

    expect(message).toBeNull();
  });

  it("scans the ranked list in order for the first eligible item", () => {
    // rankOpenWork puts sooner days first, but the point of the scan is that
    // the eligibility check does not just take ranked[0] blindly.
    const later = work({
      assignmentId: "a-later",
      title: "Project",
      dueAt: new Date("2026-10-20T15:00:00-04:00"),
      share: 40,
      hours: 1,
    });
    const tomorrow = work({
      assignmentId: "b-tomorrow",
      title: "Quiz 2",
      dueAt: new Date("2026-10-15T15:00:00-04:00"),
      share: 5,
      hours: 1,
    });

    expect(tonightMessage(ranked([tomorrow, later]), NOW)?.body).toBe(
      "Start with Quiz 2 (CS 341) — due tomorrow, 5 percent of your grade.",
    );
  });

  it("splits the day at New York midnight: 11:30 PM is today, 12:30 AM is tomorrow", () => {
    const evening = work({
      assignmentId: "a-evening",
      title: "Problem set",
      dueAt: new Date("2026-10-14T23:30:00-04:00"),
      share: 10,
      hours: 1,
    });
    const pastMidnight = work({
      assignmentId: "b-morning",
      title: "Quiz",
      dueAt: new Date("2026-10-15T00:30:00-04:00"),
      share: 10,
      hours: 1,
    });

    // Still Tuesday evening in New York at 11:30 PM, so the 12:30 AM item is
    // the one due tomorrow.
    const lateNight = new Date("2026-10-15T03:30:00.000Z");
    expect(tonightMessage(ranked([evening], lateNight), lateNight)?.body).toBe(
      "Start with Problem set (CS 341) — due today, 10 percent of your grade.",
    );
    expect(dueTomorrowMessage(ranked([evening, pastMidnight], lateNight), lateNight)?.body).toBe(
      "Quiz (CS 341) is due tomorrow.",
    );
    expect(tonightMessage(ranked([pastMidnight], NOW), NOW)?.body).toBe(
      "Start with Quiz (CS 341) — due tomorrow, 10 percent of your grade.",
    );
  });
});

describe("dueTomorrowMessage", () => {
  it("names one item with its course", () => {
    const tomorrow = work({
      assignmentId: "hw-1",
      title: "Problem Set 4",
      dueAt: new Date("2026-10-15T15:00:00-04:00"),
      share: 15,
    });

    expect(dueTomorrowMessage(ranked([tomorrow]), NOW)).toEqual({
      kind: "due-tomorrow",
      title: "Due tomorrow",
      body: "Problem Set 4 (CS 341) is due tomorrow.",
      url: "/today",
    });
  });

  it("lists several items by name, joined with and", () => {
    const items = [
      work({ assignmentId: "hw-1", title: "Problem Set 4", dueAt: new Date("2026-10-15T10:00:00-04:00") }),
      work({ assignmentId: "hw-2", title: "Quiz 2", dueAt: new Date("2026-10-15T11:00:00-04:00") }),
      work({ assignmentId: "hw-3", title: "Lab 3", dueAt: new Date("2026-10-15T12:00:00-04:00") }),
    ];

    expect(dueTomorrowMessage(ranked(items), NOW)?.body).toBe(
      "3 things are due tomorrow: Problem Set 4, Quiz 2 and Lab 3.",
    );
  });

  it("caps the list at three names and says how many more", () => {
    const items = [
      work({ assignmentId: "hw-1", title: "Problem Set 4", dueAt: new Date("2026-10-15T09:00:00-04:00") }),
      work({ assignmentId: "hw-2", title: "Quiz 2", dueAt: new Date("2026-10-15T10:00:00-04:00") }),
      work({ assignmentId: "hw-3", title: "Lab 3", dueAt: new Date("2026-10-15T11:00:00-04:00") }),
      work({ assignmentId: "hw-4", title: "Essay", dueAt: new Date("2026-10-15T12:00:00-04:00") }),
      work({ assignmentId: "hw-5", title: "Reading", dueAt: new Date("2026-10-15T13:00:00-04:00") }),
    ];

    expect(dueTomorrowMessage(ranked(items), NOW)?.body).toBe(
      "5 things are due tomorrow: Problem Set 4, Quiz 2, Lab 3 and 2 more.",
    );
  });

  it("returns null when nothing is due tomorrow", () => {
    const today = work({
      assignmentId: "hw-1",
      title: "Problem set",
      dueAt: new Date("2026-10-14T23:30:00-04:00"),
    });
    const later = work({ assignmentId: "hw-2", title: "Project", dueAt: new Date("2026-10-16T10:00:00-04:00") });

    expect(dueTomorrowMessage(ranked([today, later]), NOW)).toBeNull();
    expect(dueTomorrowMessage([], NOW)).toBeNull();
  });

  it("keeps the body under 160 characters by cutting the longest title with an ellipsis", () => {
    const longTitle = "Extra credit reflection about the entire history of computational theory and every proof covered this semester including all the optional reading chapters";
    const items = [
      work({ assignmentId: "hw-1", title: longTitle, dueAt: new Date("2026-10-15T10:00:00-04:00") }),
      work({ assignmentId: "hw-2", title: "Quiz 2", dueAt: new Date("2026-10-15T11:00:00-04:00") }),
      work({ assignmentId: "hw-3", title: "Lab 3", dueAt: new Date("2026-10-15T12:00:00-04:00") }),
    ];

    const message = dueTomorrowMessage(ranked(items), NOW);
    if (!message) {
      throw new Error("expected a message");
    }

    expect(message?.body).toContain("Quiz 2");
    expect(message?.body).toContain("Lab 3");
    expect(message?.body).toContain("…");
    expect(message.body.length).toBeLessThan(160);
  });

  it("keeps a single-item body with a very long title under 160 characters", () => {
    const tomorrow = work({
      assignmentId: "hw-1",
      title: "Extra credit reflection about the entire history of computational theory and every single proof covered this semester including all optional reading chapters and beyond",
      dueAt: new Date("2026-10-15T10:00:00-04:00"),
    });

    const message = dueTomorrowMessage(ranked([tomorrow]), NOW);
    if (!message) {
      throw new Error("expected a message");
    }

    // The ellipsis lands inside the title because the timing text follows it.
    expect(message.body).toContain("…");
    expect(message.body).toContain(" (CS 341) is due tomorrow.");
    expect(message.body.length).toBeLessThan(160);
  });
});

describe("gradePostedMessage", () => {
  it("formats a whole-number score with its points possible", () => {
    expect(
      gradePostedMessage({ assignmentTitle: "Problem Set 4", courseName: "CS 341", score: 18, pointsPossible: 20 }),
    ).toEqual({
      kind: "grade-posted",
      title: "Grade posted",
      body: "Grade posted: Problem Set 4 (CS 341) — 18/20.",
      url: "/classes",
    });
  });

  it("keeps decimal scores without adding trailing zeros", () => {
    expect(
      gradePostedMessage({ assignmentTitle: "Problem Set 4", courseName: "CS 341", score: 18.5, pointsPossible: 20 }).body,
    ).toBe("Grade posted: Problem Set 4 (CS 341) — 18.5/20.");
    expect(
      gradePostedMessage({ assignmentTitle: "Quiz 2", courseName: "CS 341", score: 20, pointsPossible: 20 }).body,
    ).toBe("Grade posted: Quiz 2 (CS 341) — 20/20.");
  });

  it("shows just the score when points possible is not a positive number", () => {
    expect(
      gradePostedMessage({ assignmentTitle: "Problem Set 4", courseName: "CS 341", score: 18, pointsPossible: null }).body,
    ).toBe("Grade posted: Problem Set 4 (CS 341) — 18.");
    expect(
      gradePostedMessage({ assignmentTitle: "Problem Set 4", courseName: "CS 341", score: 18, pointsPossible: 0 }).body,
    ).toBe("Grade posted: Problem Set 4 (CS 341) — 18.");
  });

  it("truncates a very long assignment title with an ellipsis", () => {
    const message = gradePostedMessage({
      assignmentTitle:
        "Extra credit reflection about the entire history of computational theory and every single proof covered this semester including optional readings",
      courseName: "CS 341",
      score: 18,
      pointsPossible: 20,
    });

    expect(message.body.startsWith("Grade posted: Extra credit reflection")).toBe(true);
    expect(message.body.endsWith("… (CS 341) — 18/20.")).toBe(true);
    expect(message.body.length).toBeLessThan(160);
  });
});

describe("messagesFor", () => {
  const tomorrow = work({
    assignmentId: "hw-1",
    title: "Problem Set 4",
    dueAt: new Date("2026-10-15T10:00:00-04:00"),
    share: 15,
  });
  // A second item due tomorrow keeps the evening messages non-redundant, since
  // a lone due-tomorrow item named by Tonight suppresses its own reminder.
  const secondTomorrow = work({
    assignmentId: "hw-2",
    title: "Quiz 2",
    dueAt: new Date("2026-10-15T11:00:00-04:00"),
    share: 5,
  });
  const gradePosted = { assignmentTitle: "Problem Set 4", courseName: "CS 341", score: 18, pointsPossible: 20 };
  const inputs = { ranked: ranked([tomorrow, secondTomorrow]), now: NOW, gradePosted };

  it("builds all three messages when every toggle is on", () => {
    expect(messagesFor(defaultPreferences, inputs).map((message) => message.kind)).toEqual([
      "tonight",
      "due-tomorrow",
      "grade-posted",
    ]);
  });

  it("respects each toggle individually", () => {
    const noTonight = messagesFor({ ...defaultPreferences, notifyTonight: false }, inputs);
    expect(noTonight.map((message) => message.kind)).toEqual(["due-tomorrow", "grade-posted"]);

    const noDueTomorrow = messagesFor({ ...defaultPreferences, notifyDueTomorrow: false }, inputs);
    expect(noDueTomorrow.map((message) => message.kind)).toEqual(["tonight", "grade-posted"]);

    const noGradePosted = messagesFor({ ...defaultPreferences, notifyGradePosted: false }, inputs);
    expect(noGradePosted.map((message) => message.kind)).toEqual(["tonight", "due-tomorrow"]);

    expect(messagesFor({ notifyTonight: false, notifyGradePosted: false, notifyDueTomorrow: false }, inputs)).toEqual([]);
  });

  it("skips a kind with nothing to say even when its toggle is on", () => {
    const later = work({ assignmentId: "hw-9", title: "Project", dueAt: new Date("2026-10-20T10:00:00-04:00") });
    const quiet = { ranked: ranked([later]), now: NOW, gradePosted: null };

    expect(messagesFor(defaultPreferences, quiet)).toEqual([]);
  });
});

describe("evening message duplicate suppression", () => {
  const singleTomorrow = work({
    assignmentId: "hw-1",
    title: "Problem Set 4",
    dueAt: new Date("2026-10-15T10:00:00-04:00"),
    share: 15,
  });

  it("sends only the Tonight message when its pick is the only item due tomorrow", () => {
    const messages = messagesFor(defaultPreferences, {
      ranked: ranked([singleTomorrow]),
      now: NOW,
      gradePosted: null,
    });

    expect(messages.map((message) => message.kind)).toEqual(["tonight"]);
    expect(messages[0].body).toBe(
      "Start with Problem Set 4 (CS 341) — due tomorrow, 15 percent of your grade.",
    );
  });

  it("sends both evening messages when two items are due tomorrow", () => {
    const second = work({
      assignmentId: "hw-2",
      title: "Quiz 2",
      dueAt: new Date("2026-10-15T11:00:00-04:00"),
    });

    const messages = messagesFor(defaultPreferences, {
      ranked: ranked([singleTomorrow, second]),
      now: NOW,
      gradePosted: null,
    });

    expect(messages.map((message) => message.kind)).toEqual(["tonight", "due-tomorrow"]);
    expect(messages[1].body).toBe("2 things are due tomorrow: Problem Set 4 and Quiz 2.");
  });

  it("still sends Due tomorrow for the single item when Tonight is toggled off", () => {
    const messages = messagesFor(
      { notifyTonight: false, notifyGradePosted: true, notifyDueTomorrow: true },
      { ranked: ranked([singleTomorrow]), now: NOW, gradePosted: null },
    );

    expect(messages.map((message) => message.kind)).toEqual(["due-tomorrow"]);
    expect(messages[0].body).toBe("Problem Set 4 (CS 341) is due tomorrow.");
  });

  it("still sends Due tomorrow when Tonight names overdue work instead", () => {
    const missed = work({
      assignmentId: "hw-0",
      title: "Essay",
      dueAt: new Date("2026-10-13T09:00:00-04:00"),
      share: 10,
    });

    const messages = messagesFor(defaultPreferences, {
      ranked: ranked([singleTomorrow, missed]),
      now: NOW,
      gradePosted: null,
    });

    expect(messages.map((message) => message.kind)).toEqual(["tonight", "due-tomorrow"]);
    expect(messages[0].body).toBe("Start with Essay (CS 341) — overdue, 10 percent of your grade.");
    expect(messages[1].body).toBe("Problem Set 4 (CS 341) is due tomorrow.");
  });
});

describe("course names are capped before titles are fitted", () => {
  // 41 distinct words would be tedious; distinct letters make the cut visible.
  const letters = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";

  it("leaves a course name of exactly 40 code points untouched", () => {
    const name40 = letters.slice(0, 40);
    const message = gradePostedMessage({
      assignmentTitle: "Problem Set 4",
      courseName: name40,
      score: 18,
      pointsPossible: 20,
    });

    expect(message.body).toContain(name40);
  });

  it("caps a 41-code-point course name at 40 code points plus an ellipsis", () => {
    const name41 = `${letters.slice(0, 41)}`; // A..z plus one more distinct letter
    const message = gradePostedMessage({
      assignmentTitle: "Problem Set 4",
      courseName: name41,
      score: 18,
      pointsPossible: 20,
    });

    expect(message.body).toContain(`${name41.slice(0, 39)}…`);
    expect(message.body).not.toContain(name41.slice(0, 40));
  });

  it("keeps a 200-character course name from crushing the title out of the Tonight body", () => {
    const longCourse = "Advanced Computational Systems across Distributed Architectures and Operating Environments Lecture Section ".repeat(2).trim();
    const title = "Problem Set 4 covers everything from the first lecture to the final exam deadline";
    const item = work({
      assignmentId: "hw-long-course",
      title,
      courseName: longCourse,
      dueAt: new Date("2026-10-15T15:00:00-04:00"),
      share: 15,
      hours: 1,
    });

    const message = tonightMessage(ranked([item]), NOW);
    if (!message) {
      throw new Error("expected a message");
    }

    expect(Array.from(message.body).length).toBeLessThan(160);
    // Without the course-name cap the whole budget would go to the course and
    // the title would shrink to a bare ellipsis.
    expect(message.body.startsWith(`Start with ${title.slice(0, 40)}`)).toBe(true);
  });

  it("keeps every evening and grade body under 160 code points with a 200-character course name", () => {
    const longCourse = "Advanced Computational Systems across Distributed Architectures and Operating Environments Lecture Section ".repeat(2).trim();
    const course = { courseName: longCourse };
    const one = work({
      assignmentId: "hw-a",
      title: "Problem Set 4",
      ...course,
      dueAt: new Date("2026-10-15T10:00:00-04:00"),
    });
    const two = work({
      assignmentId: "hw-b",
      title: "Quiz 2 covers chapters one through four",
      ...course,
      dueAt: new Date("2026-10-15T11:00:00-04:00"),
    });
    const three = work({
      assignmentId: "hw-c",
      title: "Lab 3 measurement write-up",
      ...course,
      dueAt: new Date("2026-10-15T12:00:00-04:00"),
    });

    const tonight = tonightMessage(ranked([one, two, three]), NOW);
    const dueSingle = dueTomorrowMessage(ranked([one]), NOW);
    const dueSeveral = dueTomorrowMessage(ranked([one, two, three]), NOW);
    const grade = gradePostedMessage({
      assignmentTitle: "Problem Set 4",
      courseName: longCourse,
      score: 18,
      pointsPossible: 20,
    });
    if (!tonight || !dueSingle || !dueSeveral) {
      throw new Error("expected messages");
    }

    for (const body of [tonight.body, dueSingle.body, dueSeveral.body, grade.body]) {
      expect(Array.from(body).length).toBeLessThan(160);
    }
  });
});

describe("emoji titles are never cut through a surrogate pair", () => {
  // A lone surrogate would show up as a code point inside 0xD800-0xDFFF.
  function wellFormed(body: string): boolean {
    return Array.from(body).every((character) => {
      const code = character.codePointAt(0) ?? 0;
      return code < 0xd800 || code > 0xdfff;
    });
  }

  // A pure emoji run starts on an even UTF-16 unit, and the fitted cut always
  // lands on an even unit, so a unit-based cut would survive it unsplit. The
  // odd-length ASCII prefix shifts every pair onto an odd unit, where a
  // unit-based cut at the fitted position must split one in half.
  const emojiTitles = [
    "📚".repeat(131),
    "📚".repeat(130),
    "X".repeat(39) + "📚".repeat(130),
  ];

  it("truncates the Tonight body of an emoji title whole and under the limit", () => {
    for (const title of emojiTitles) {
      const item = work({
        assignmentId: "hw-emoji",
        title,
        dueAt: new Date("2026-10-15T15:00:00-04:00"),
        share: 15,
        hours: 1,
      });

      const message = tonightMessage(ranked([item]), NOW);
      if (!message) {
        throw new Error("expected a message");
      }

      expect(wellFormed(message.body)).toBe(true);
      expect(Array.from(message.body).length).toBeLessThan(160);
      expect(message.body).toContain("…");
      expect(message.body).toContain("(CS 341) — due tomorrow, 15 percent of your grade.");
    }
  });

  it("truncates the Grade posted body of an emoji title whole and under the limit", () => {
    for (const assignmentTitle of emojiTitles) {
      const message = gradePostedMessage({
        assignmentTitle,
        courseName: "CS 341",
        score: 18,
        pointsPossible: 20,
      });

      expect(wellFormed(message.body)).toBe(true);
      expect(Array.from(message.body).length).toBeLessThan(160);
      expect(message.body).toContain("…");
      expect(message.body).toContain("— 18/20.");
    }
  });

  it("truncates Due tomorrow bodies with emoji titles whole and under the limit", () => {
    for (const title of emojiTitles) {
      const one = work({
        assignmentId: "hw-emoji-1",
        title,
        dueAt: new Date("2026-10-15T10:00:00-04:00"),
      });
      const two = work({
        assignmentId: "hw-emoji-2",
        title: "Quiz 2",
        dueAt: new Date("2026-10-15T11:00:00-04:00"),
      });

      const single = dueTomorrowMessage(ranked([one]), NOW);
      const several = dueTomorrowMessage(ranked([one, two]), NOW);
      if (!single || !several) {
        throw new Error("expected messages");
      }

      for (const body of [single.body, several.body]) {
        expect(wellFormed(body)).toBe(true);
        expect(Array.from(body).length).toBeLessThan(160);
      }
    }
  });
});

describe("message numbers never show a floating-point tail", () => {
  it("rounds a share to a whole percent in the Tonight message", () => {
    const message = tonightMessage(
      ranked([work({ assignmentId: "a", title: "Lab 3", dueAt: new Date("2026-10-14T23:59:00-04:00"), share: 100 / 7 })]),
      NOW,
    );
    expect(message?.body).toBe("Start with Lab 3 (CS 341) — due today, 14 percent of your grade.");
  });

  it("says under 1 percent instead of 0 for a tiny share", () => {
    const message = tonightMessage(
      ranked([work({ assignmentId: "a", title: "Lab 3", dueAt: new Date("2026-10-14T23:59:00-04:00"), share: 0.4 })]),
      NOW,
    );
    expect(message?.body).toBe("Start with Lab 3 (CS 341) — due today, under 1 percent of your grade.");
  });

  it("shows a computed score to at most two decimals", () => {
    expect(
      gradePostedMessage({ assignmentTitle: "Quiz 2", courseName: "CS 341", score: 55 / 3, pointsPossible: 20 }).body,
    ).toBe("Grade posted: Quiz 2 (CS 341) — 18.33/20.");
  });
});
