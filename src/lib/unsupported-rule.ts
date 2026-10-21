export type UnsupportedRuleFamily = "drops" | "curves" | "extra-credit" | "late-penalty";

type RuleFamilyPattern = { family: UnsupportedRuleFamily; keywords: string[] };

// Keyword matching, not parsing: the family only explains WHY a course is unsupported,
// while the presence of any rule at all is what makes the engine refuse.
const RULE_FAMILY_PATTERNS: RuleFamilyPattern[] = [
  { family: "drops", keywords: ["drop", "drops", "dropped", "dropping"] },
  { family: "curves", keywords: ["curve", "curves", "curved", "curving", "scaled"] },
  {
    family: "extra-credit",
    keywords: ["extra credit", "extra points", "bonus points", "bonus credit"],
  },
  {
    family: "late-penalty",
    keywords: [
      "late penalty",
      "late penalties",
      "penalty for late",
      "late work",
      "late submission",
      "late assignment",
      "late quiz",
      "late exam",
      "late deduction",
      "per day late",
      "day late",
      "lateness",
    ],
  },
];

// A bare "per day" or "a day" shows up in ordinary syllabus sentences, so it only reads as
// lateness when a lateness word is also present.
const LATE_DAY_PHRASES = [" per day ", " a day "];
const LATE_DAY_WORDS = ["late", "lateness"];

function normalizeRuleText(text: string): string {
  return ` ${text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()} `;
}

export function classifyUnsupportedRule(rule: string): UnsupportedRuleFamily | null {
  const normalized = normalizeRuleText(rule);
  for (const { family, keywords } of RULE_FAMILY_PATTERNS) {
    if (keywords.some((keyword) => normalized.includes(` ${keyword} `))) {
      return family;
    }
  }
  if (
    LATE_DAY_PHRASES.some((phrase) => normalized.includes(phrase)) &&
    LATE_DAY_WORDS.some((word) => normalized.includes(` ${word} `))
  ) {
    return "late-penalty";
  }
  return null;
}
