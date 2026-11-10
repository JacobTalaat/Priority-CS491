// The Weights page and the grade-setup API turn down the same broken setup: a
// final exam weight above 0 with no Canvas assignment picked as the final. One
// constant keeps both wordings from drifting apart.
export const FINAL_NOT_ON_CANVAS_MESSAGE =
  "Your final isn't a Canvas assignment, so put its weight in a category (for example Final Exam) and set the final exam weight to 0.";
