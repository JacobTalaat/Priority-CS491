import { NextResponse } from "next/server";
import { getUserFromRequest, unauthorized } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { SYLLABUS_MAX_BYTES, readSyllabusPdf } from "@/lib/syllabus-text";

export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ courseId: string }> };

const oversizedMessage = "That PDF is over 10 MB. Try a smaller copy of the syllabus.";

const failureMessages = {
  "not-pdf": "That isn't a PDF. Download the syllabus from Canvas as a PDF and try again.",
  unreadable: "That PDF could not be read. Download a fresh copy of the syllabus and try again.",
  encrypted: "That PDF is password-protected. Upload a copy without a password.",
  "too-many-pages": "That PDF has more than 50 pages. Upload just the syllabus.",
  "no-text":
    "This PDF looks like a scanned image, so Priority can't read its text. Upload a PDF with selectable text, or enter your weights by hand.",
} as const;

export async function POST(request: Request, context: RouteContext) {
  const user = await getUserFromRequest(request);
  if (!user) {
    return unauthorized();
  }

  const contentLength = request.headers.get("content-length");
  if (contentLength && Number(contentLength) > SYLLABUS_MAX_BYTES + 1024 * 1024) {
    return NextResponse.json(
      { error: oversizedMessage },
      { status: 413 },
    );
  }

  const { courseId } = await context.params;
  const course = await prisma.course.findFirst({
    where: { id: courseId, userId: user.id, isCurrent: true },
    select: { id: true },
  });
  if (!course) {
    return NextResponse.json({ error: "Current course not found." }, { status: 404 });
  }

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return NextResponse.json(
      { error: 'Send the syllabus as multipart/form-data with the PDF in a "file" field.' },
      { status: 400 },
    );
  }

  const entry = form.get("file");
  if (entry === null || typeof entry === "string") {
    return NextResponse.json({ error: "Choose your syllabus PDF." }, { status: 400 });
  }

  if (entry.size > SYLLABUS_MAX_BYTES) {
    return NextResponse.json(
      { error: oversizedMessage },
      { status: 413 },
    );
  }
  if (entry.size === 0) {
    return NextResponse.json({ error: "That PDF is empty." }, { status: 400 });
  }

  const read = await readSyllabusPdf(new Uint8Array(await entry.arrayBuffer()));
  if (!read.ok) {
    return NextResponse.json(
      { error: failureMessages[read.reason] },
      { status: read.reason === "not-pdf" ? 400 : 422 },
    );
  }

  const fileName = entry.name.slice(0, 255) || "syllabus.pdf";
  const extractedAt = new Date();
  await prisma.courseSyllabus.upsert({
    where: { courseId: course.id },
    create: {
      courseId: course.id,
      fileName,
      sizeBytes: entry.size,
      pageCount: read.pageCount,
      text: read.text,
      extractedAt,
    },
    update: {
      fileName,
      sizeBytes: entry.size,
      pageCount: read.pageCount,
      text: read.text,
      extractedAt,
    },
  });

  return NextResponse.json({
    syllabus: {
      courseId: course.id,
      fileName,
      sizeBytes: entry.size,
      pageCount: read.pageCount,
      characterCount: read.text.length,
      extractedAt: extractedAt.toISOString(),
    },
  });
}
