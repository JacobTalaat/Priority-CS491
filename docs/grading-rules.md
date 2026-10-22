# Supported grading rules

The rules Priority's two grade calculators follow. On `main` they are not shown in the app yet: the route that picks a calculator and returns its result is open PR #50 (PR-048).

## Weighted categories

Used (once #50 merges) when a class has a confirmed setup with at least one category weighted above 0. For each category, Priority adds the points earned and points possible over **graded** assignments only. Each category's percentage counts in proportion to its weight. Categories with nothing graded yet are left out, and the rest are scaled up to fill the grade. So an ungraded exam never acts like a zero: your grade is how you are doing on the work graded so far.

*Example:* Homework 70%, Final Exam 30%. You have 8 of 10 on homework and the final is not graded, so your grade is **80**.

- Category weights plus the final exam weight must total 100 (the save step allows 0.001 for rounding).
- The final exam is **its own category**, with the final mapped to it, and the final exam weight left at 0.
- **Known gap:** the save step still accepts a final exam weight above 0, but the engine never reads it. Once the final is graded, a final mapped into another category counts at that category's weight instead. A Homework 70 / Final 30 course can then show 50 instead of 70.
- Every imported assignment must be mapped to a category before the setup can be saved (the form and the save step both check). The calculator skips any assignment missing from the mappings.

## Points based

Used (once #50 merges) when there is no confirmed setup, or no category weighted above 0: all points earned ÷ all points possible, over graded assignments only.

*Example:* 18/20, 24/30 and 40/50 graded gives 82 of 100, a grade of **82**.

## What counts

- **Ungraded work** is left out. It is not a zero.
- **A graded zero** counts in full.
- **A zero-point assignment** is left out, unless it has a score above zero (see below).

## What returns Unsupported

These apply to every assignment the calculator looks at: all of them for points, and every mapped assignment for weighted, including those in a 0-weight category.

| Situation | Result |
| --- | --- |
| A score above the points possible (extra credit) | Unsupported |
| A negative score | Unsupported |
| A score above zero on a zero-point assignment | Unsupported |
| A computed total or percentage that is not a finite number | Unsupported (a single non-number score is just ignored) |
| No graded work that counts: nothing graded yet, or only work in 0-weight categories or worth 0 points | Insufficient data, which is not an error |

**Rules the syllabus reader flags:** dropping the lowest score, replacement exams, curves, bonus caps and attendance penalties, plus a separate late policy. They are shown on the confirm screen for the student to review, but none of them is saved with the setup or applied by a calculator. Refusing to compute a grade when such a rule exists is open PR #49 (PR-047). Until it merges, the calculators produce a number that ignores the rule.

## Rounding

The calculators round percentages to 10 decimal places, so floating-point noise like 79.99999999999999 comes out as 80. The Weights form shows its running total to 2 decimals.
