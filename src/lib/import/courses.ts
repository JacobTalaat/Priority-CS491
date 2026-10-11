import { getCanvasToken } from "@/lib/canvas-credentials";
import { fetchAllPages } from "@/lib/canvas-pagination";
import { prisma } from "@/lib/prisma";

const COURSES_PATH = "/api/v1/courses?enrollment_state=active&include[]=term&per_page=100";

type CanvasTerm = { id?: unknown; name?: unknown; start_at?: unknown; end_at?: unknown };

type CanvasCourse = { id?: unknown; name?: unknown; course_code?: unknown; term?: CanvasTerm | null };

function parseDate(value: unknown): Date | null {
  if (typeof value !== "string") {
    return null;
  }
  const ms = Date.parse(value);
  return Number.isNaN(ms) ? null : new Date(ms);
}

export async function importCourses(
  userId: string
): Promise<{ imported: number; skipped: number; courseIds: string[] }> {
  const credentials = await getCanvasToken(userId);
  if (!credentials) {
    throw new Error("Canvas not connected");
  }
  const courses = await fetchAllPages<CanvasCourse>(credentials.baseUrl, credentials.token, COURSES_PATH);
  const now = Date.now();
  let currentTermId: string | null = null;
  let currentStartMs = -Infinity;
  for (const course of courses) {
    const term = course?.term;
    const startMs = typeof term?.start_at === "string" ? Date.parse(term.start_at) : NaN;
    if (Number.isNaN(startMs) || startMs > now) {
      continue;
    }
    if (startMs > currentStartMs) {
      currentStartMs = startMs;
      currentTermId = term && term.id !== undefined && term.id !== null ? String(term.id) : null;
    }
  }
  let imported = 0;
  const courseIds: string[] = [];
  for (const course of courses) {
    const term = course?.term;
    if (currentTermId === null) {
      continue;
    }
    if (course?.id === undefined || course.id === null || typeof course.name !== "string") {
      continue;
    }
    if (!term || term.id === undefined || term.id === null || String(term.id) !== currentTermId) {
      continue;
    }
    const canvasId = String(course.id);
    const data = {
      name: course.name,
      courseCode: typeof course.course_code === "string" ? course.course_code : null,
      term: typeof term.name === "string" ? term.name : null,
      termEndsAt: parseDate(term.end_at),
    };
    const row = await prisma.course.upsert({
      where: { userId_canvasId: { userId, canvasId } },
      create: { userId, canvasId, ...data, isCurrent: true },
      update: { ...data, isCurrent: true },
    });
    courseIds.push(row.id);
    imported += 1;
  }
  await prisma.course.updateMany({
    where: courseIds.length > 0 ? { userId, id: { notIn: courseIds } } : { userId },
    data: { isCurrent: false },
  });
  return { imported, skipped: courses.length - imported, courseIds };
}
