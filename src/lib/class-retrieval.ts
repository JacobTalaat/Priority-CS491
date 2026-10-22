import { prisma } from "@/lib/prisma";

// All dates shown to students use the school's timezone, not the server's.
export const SCHOOL_TIME_ZONE = "America/New_York";

const DEFAULT_LIMIT = 8;
const QUESTION_MAX_CHARS = 500;
const MAX_CHUNK_CHARS = 800;
const MIN_CHUNK_CHARS = 200;
// How strongly a question that names a course lifts that course's documents.
const COURSE_BOOST_FACTOR = 0.5;

// BM25 length-normalisation constants tuned per the usual defaults.
const BM25_K1 = 1.2;
const BM25_B = 0.75;

const STOPWORDS = new Set([
  "a", "an", "the", "is", "are", "was", "were", "be", "been", "being", "do",
  "does", "did", "i", "my", "me", "you", "your", "we", "us", "our", "it",
  "its", "this", "that", "these", "those", "there", "here", "of", "on", "in",
  "at", "to", "for", "and", "or", "but", "with", "as", "by", "what", "when",
  "where", "who", "how", "much", "many", "can", "will", "would", "should",
  "about", "from", "if", "so", "does",
]);

export type RetrievalKind = "syllabus" | "assignment" | "class-details";

export type RetrievalSource =
  | { fileName: string; start: number; end: number }
  | { assignmentId: string; title: string; htmlUrl: string | null }
  | { fields: string[] };

export type RetrievalItem = {
  kind: RetrievalKind;
  courseId: string;
  courseName: string;
  text: string;
  score: number;
  source: RetrievalSource;
};

export type RetrievalDocument = {
  kind: RetrievalKind;
  courseId: string;
  courseName: string;
  courseCode?: string | null;
  // Index this instead of `text` when present, e.g. assignments indexed by
  // word facts only while the returned text keeps dates and numbers.
  searchText?: string;
  text: string;
  source: RetrievalSource;
};

export type SyllabusChunk = {
  text: string;
  start: number;
  end: number;
};

const SCHOOL_DATE_FORMAT = new Intl.DateTimeFormat("en-US", {
  timeZone: SCHOOL_TIME_ZONE,
  weekday: "short",
  month: "short",
  day: "numeric",
  year: "numeric",
  hour: "numeric",
  minute: "2-digit",
  hour12: true,
});

function formatSchoolDateTime(date: Date): string {
  const parts = Object.fromEntries(
    SCHOOL_DATE_FORMAT.formatToParts(date).map((part) => [part.type, part.value]),
  );
  return `${parts.weekday} ${parts.month} ${parts.day} ${parts.year} ${parts.hour}:${parts.minute} ${parts.dayPeriod}`;
}

function foldPlural(word: string): string {
  // Plural clusters fold before the single-s rule.
  if (word.endsWith("zzes") && word.length > 5) {
    return word.slice(0, -3);
  }
  if (
    word.length > 4 &&
    (word.endsWith("ches") || word.endsWith("shes") || word.endsWith("xes"))
  ) {
    return word.slice(0, -2);
  }
  if (word.length <= 3) {
    return word;
  }
  if (word.endsWith("ies") && word.length > 4) {
    return `${word.slice(0, -3)}y`;
  }
  if (
    word.endsWith("s") &&
    !word.endsWith("ss") &&
    !word.endsWith("us") &&
    !word.endsWith("is")
  ) {
    return word.slice(0, -1);
  }
  return word;
}

// Graded/grading/grades have no single suffix-removable stem, so each word
// indexes a small variant set: the folded word plus simple -ed/-ing stems,
// an undoubled consonant variant for words like "submitted", and a relaxed
// "e"-final variant linking graded-family words to "grade".
function foldVariants(word: string): string[] {
  const folded = foldPlural(word);
  const variants = new Set([folded]);
  if (folded.length > 5) {
    if (folded.endsWith("ing")) {
      const stem = folded.slice(0, -3);
      variants.add(stem);
      if (!/[aeiou]$/.test(stem)) {
        variants.add(`${stem}e`);
      }
    } else if (folded.endsWith("ed")) {
      const stem = folded.slice(0, -2);
      variants.add(stem);
      if (stem.length >= 3 && stem[stem.length - 1] === stem[stem.length - 2]) {
        variants.add(stem.slice(0, -1));
      }
      if (!/[aeiou]$/.test(stem)) {
        variants.add(`${stem}e`);
      }
    }
  }
  return [...variants];
}

export const QUERY_EXPANSIONS: Record<string, string[]> = {
  hw: ["homework"],
  hws: ["homework"],
  midterm: ["exam"],
  midterms: ["exam"],
  quiz: ["quiz"],
  quizzes: ["quiz"],
  prof: ["instructor"],
  professor: ["instructor"],
  ta: ["assistant"],
};

function tokenize(text: string): string[] {
  const words = text.toLowerCase().match(/[a-z0-9]+/g) ?? [];
  const tokens: string[] = [];
  for (const word of words) {
    if (STOPWORDS.has(word)) {
      continue;
    }
    tokens.push(...foldVariants(word));
  }
  return tokens;
}

function isBlankSpace(char: string): boolean {
  return /\s/.test(char);
}

type TextBlock = { start: number; end: number };

// Collect runs of consecutive non-blank lines, trimmed to their first and last
// non-whitespace characters, so each block is an exact slice of the original.
function splitBlocks(text: string): TextBlock[] {
  const blocks: TextBlock[] = [];
  let current: TextBlock | null = null;
  let lineStart = 0;

  while (lineStart < text.length) {
    let lineEnd = text.indexOf("\n", lineStart);
    const lastLine = lineEnd === -1;
    if (lastLine) {
      lineEnd = text.length;
    }

    let contentEnd = lineEnd;
    if (text[contentEnd - 1] === "\r") {
      contentEnd -= 1;
    }
    let contentStart = lineStart;
    while (contentStart < contentEnd && isBlankSpace(text[contentStart])) {
      contentStart += 1;
    }
    while (contentEnd > contentStart && isBlankSpace(text[contentEnd - 1])) {
      contentEnd -= 1;
    }

    if (contentStart < contentEnd) {
      if (current) {
        current.end = contentEnd;
      } else {
        current = { start: contentStart, end: contentEnd };
      }
    } else if (current) {
      blocks.push(current);
      current = null;
    }

    if (lastLine) {
      break;
    }
    lineStart = lineEnd + 1;
  }

  if (current) {
    blocks.push(current);
  }
  return blocks;
}

// Split a too-long range on the last whitespace inside the window, cutting
// mid-word only when a stretch has no whitespace at all.
function pushSplitChunks(text: string, start: number, end: number, out: SyllabusChunk[]) {
  let chunkStart = start;
  let guard = 0;
  while (end - chunkStart > MAX_CHUNK_CHARS && guard++ < 10000) {
    let cut = chunkStart + MAX_CHUNK_CHARS;
    let foundWhitespace = false;
    for (let i = cut - 1; i > chunkStart; i -= 1) {
      if (isBlankSpace(text[i])) {
        cut = i;
        foundWhitespace = true;
        break;
      }
    }
    if (foundWhitespace) {
      out.push({ text: text.slice(chunkStart, cut), start: chunkStart, end: cut });
      while (cut < end && isBlankSpace(text[cut])) {
        cut += 1;
      }
    } else {
      out.push({ text: text.slice(chunkStart, cut), start: chunkStart, end: cut });
    }
    chunkStart = cut;
  }
  if (end > chunkStart) {
    out.push({ text: text.slice(chunkStart, end), start: chunkStart, end });
  }
}

export function chunkSyllabus(text: string): SyllabusChunk[] {
  const blocks = splitBlocks(text);
  const chunks: SyllabusChunk[] = [];
  let index = 0;

  while (index < blocks.length) {
    const group = { ...blocks[index] };
    index += 1;
    // Tiny blocks are hard to read and rank on their own, so grow the group
    // until it is useful, unless that would overflow the size cap.
    while (
      index < blocks.length &&
      group.end - group.start < MIN_CHUNK_CHARS &&
      blocks[index].end - group.start <= MAX_CHUNK_CHARS
    ) {
      group.end = blocks[index].end;
      index += 1;
    }
    if (group.end - group.start > MAX_CHUNK_CHARS) {
      pushSplitChunks(text, group.start, group.end, chunks);
    } else {
      chunks.push({ text: text.slice(group.start, group.end), start: group.start, end: group.end });
    }
  }

  return chunks;
}

// "CS-341", "CS 341" and "cs341" share an alphanumeric run pattern; the
// lookarounds keep "cs3410" and other supersets from matching.
function courseCodeRegex(courseCode: string): RegExp | null {
  const runs = courseCode.toLowerCase().match(/[a-z0-9]+/g);
  if (!runs || runs.length === 0) {
    return null;
  }
  return new RegExp(`(?<![a-z0-9])${runs.join("[^a-z0-9]*")}(?![a-z0-9])`, "i");
}

// A boost when the question names the course by code, or when every
// significant word of the course name (beyond the code's own runs) appears.
function courseMentionsQuestion(
  document: RetrievalDocument,
  question: string,
  questionTokens: Set<string>,
): boolean {
  if (document.courseCode) {
    const pattern = courseCodeRegex(document.courseCode);
    if (pattern && pattern.test(question)) {
      return true;
    }
  }
  const codeRuns: string[] = document.courseCode
    ? (document.courseCode.toLowerCase().match(/[a-z0-9]+/g) ?? [])
    : [];
  const nameTokens = tokenize(document.courseName).filter(
    (token) => token.length >= 3 && !codeRuns.includes(token),
  );
  return nameTokens.length > 0 && nameTokens.every((token) => questionTokens.has(token));
}

export function rankPassages(
  question: string,
  documents: RetrievalDocument[],
  limit: number = DEFAULT_LIMIT,
): RetrievalItem[] {
  const cappedQuestion = question.slice(0, QUESTION_MAX_CHARS);
  if (limit <= 0 || documents.length === 0) {
    return [];
  }

  const indexed = documents.map((document) => {
    const termFrequencies = new Map<string, number>();
    const textTokens = tokenize(document.searchText ?? document.text);
    for (const token of textTokens) {
      termFrequencies.set(token, (termFrequencies.get(token) ?? 0) + 1);
    }
    return { document, termFrequencies, tokenCount: textTokens.length };
  });

  const documentFrequency = new Map<string, number>();
  for (const entry of indexed) {
    for (const term of entry.termFrequencies.keys()) {
      documentFrequency.set(term, (documentFrequency.get(term) ?? 0) + 1);
    }
  }

  const questionTokens = new Set<string>();
  for (const token of tokenize(cappedQuestion)) {
    questionTokens.add(token);
    // Query shorthand like "hw" or "midterm" also counts for its full word;
    // documents are never expanded.
    for (const extra of QUERY_EXPANSIONS[token] ?? []) {
      questionTokens.add(extra);
    }
  }
  const averageLength = indexed.reduce((total, entry) => total + entry.tokenCount, 0) / indexed.length || 1;

  const scored: RetrievalItem[] = [];
  for (const entry of indexed) {
    let score = 0;
    for (const term of questionTokens) {
      const frequency = entry.termFrequencies.get(term);
      if (!frequency) {
        continue;
      }
      const documentFrequencyForTerm = documentFrequency.get(term) ?? 0;
      const inverseDocumentFrequency = Math.log(
        1 + (indexed.length - documentFrequencyForTerm + 0.5) / (documentFrequencyForTerm + 0.5),
      );
      const normalizedLength = entry.tokenCount / averageLength;
      score +=
        (inverseDocumentFrequency * (frequency * (BM25_K1 + 1))) /
        (frequency + BM25_K1 * (1 - BM25_B + BM25_B * normalizedLength));
    }
    if (score === 0) {
      continue;
    }
    if (courseMentionsQuestion(entry.document, cappedQuestion, questionTokens)) {
      score *= 1 + COURSE_BOOST_FACTOR;
    }
    scored.push({
      kind: entry.document.kind,
      courseId: entry.document.courseId,
      courseName: entry.document.courseName,
      text: entry.document.text,
      score,
      source: entry.document.source,
    });
  }

  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, limit);
}

type CourseRow = {
  id: string;
  name: string;
  courseCode: string | null;
  syllabus: { fileName: string; text: string } | null;
  assignments: {
    id: string;
    title: string;
    dueAt: Date | null;
    hasDueDate: boolean;
    pointsPossible: number;
    htmlUrl: string | null;
    grade: { score: number | null } | null;
  }[];
  gradeSetup: { classDetails: unknown } | null;
};

function syllabusDocuments(course: CourseRow): RetrievalDocument[] {
  const syllabus = course.syllabus;
  if (!syllabus) {
    return [];
  }
  return chunkSyllabus(syllabus.text).map((chunk) => ({
    kind: "syllabus",
    courseId: course.id,
    courseName: course.name,
    courseCode: course.courseCode,
    text: chunk.text,
    source: { fileName: syllabus.fileName, start: chunk.start, end: chunk.end },
  }));
}

// Assignments become one-sentence documents so the same lexical ranker covers
// them and syllabus passages.
function assignmentDocumentText(course: CourseRow, assignment: CourseRow["assignments"][number]): string {
  const parts = [
    `${assignment.title} — ${course.courseCode ? course.courseCode.replace(/[-_]+/g, " ") : course.name}`,
  ];
  parts.push(
    assignment.hasDueDate && assignment.dueAt
      ? `due ${formatSchoolDateTime(assignment.dueAt)}`
      : "no due date",
  );
  if (assignment.pointsPossible > 0) {
    parts.push(`worth ${assignment.pointsPossible} points`);
  }
  if (assignment.grade?.score != null) {
    parts.push(`graded ${assignment.grade.score}/${assignment.pointsPossible}`);
  } else {
    parts.push("not graded yet");
  }
  return parts.join(" — ");
}

// The searchable index text keeps word facts (title digits included) but not
// the formatted date or point/score numbers, so no digit in a date or grade
// can match a question like "when is homework 3 due".
function assignmentSearchText(course: CourseRow, assignment: CourseRow["assignments"][number]): string {
  const facts = [assignment.title, course.name];
  if (course.courseCode) {
    facts.push(course.courseCode.replace(/[-_]+/g, " "));
  }
  facts.push("due", "points");
  facts.push(assignment.grade?.score != null ? "graded" : "not graded");
  return facts.join(" ");
}

function assignmentDocuments(course: CourseRow): RetrievalDocument[] {
  return course.assignments.map((assignment) => ({
    kind: "assignment",
    courseId: course.id,
    courseName: course.name,
    courseCode: course.courseCode,
    searchText: assignmentSearchText(course, assignment),
    text: assignmentDocumentText(course, assignment),
    source: {
      assignmentId: assignment.id,
      title: assignment.title,
      htmlUrl: assignment.htmlUrl,
    },
  }));
}

function classDetailKeyToWords(key: string): string {
  return key.replace(/([a-z0-9])([A-Z])/g, "$1 $2").toLowerCase();
}

// Only fields a student would want quoted back are searchable.
const CLASS_DETAIL_FIELDS = new Set([
  "instructor",
  "section",
  "credits",
  "officeHours",
  "latePolicy",
  "contacts",
]);

function classDetailsDocument(course: CourseRow): RetrievalDocument | null {
  const classDetails = course.gradeSetup?.classDetails;
  if (typeof classDetails !== "object" || classDetails === null) {
    return null;
  }
  const lines: string[] = [];
  const fields: string[] = [];
  for (const [key, value] of Object.entries(classDetails)) {
    if (!CLASS_DETAIL_FIELDS.has(key)) {
      continue;
    }
    if (value === null || (typeof value !== "string" && typeof value !== "number")) {
      continue;
    }
    fields.push(key);
    lines.push(`${classDetailKeyToWords(key)}: ${String(value)}`);
  }
  if (lines.length === 0) {
    return null;
  }
  return {
    kind: "class-details",
    courseId: course.id,
    courseName: course.name,
    courseCode: course.courseCode,
    text: lines.join("\n"),
    source: { fields },
  };
}

function courseDocuments(course: CourseRow): RetrievalDocument[] {
  return [...syllabusDocuments(course), ...assignmentDocuments(course), classDetailsDocument(course)].filter(
    (document): document is RetrievalDocument => document !== null,
  );
}

export async function retrieveClassContext({
  userId,
  question,
  courseId,
  limit,
}: {
  userId: string;
  question: string;
  courseId?: string;
  limit?: number;
}): Promise<RetrievalItem[]> {
  const trimmedQuestion = question.trim();
  if (trimmedQuestion.length === 0) {
    return [];
  }

  const where: { userId: string; isCurrent: boolean; id?: string } = { userId, isCurrent: true };
  if (courseId !== undefined) {
    where.id = courseId;
  }

  const courses: CourseRow[] = await prisma.course.findMany({
    where,
    select: {
      id: true,
      name: true,
      courseCode: true,
      syllabus: { select: { fileName: true, text: true } },
      assignments: {
        select: {
          id: true,
          title: true,
          dueAt: true,
          hasDueDate: true,
          pointsPossible: true,
          htmlUrl: true,
          grade: { select: { score: true } },
        },
      },
      gradeSetup: { select: { classDetails: true } },
    },
  });

  return rankPassages(
    trimmedQuestion.slice(0, QUESTION_MAX_CHARS),
    courses.flatMap(courseDocuments),
    limit ?? DEFAULT_LIMIT,
  );
}
