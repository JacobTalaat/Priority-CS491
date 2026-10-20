CREATE TABLE "CourseSyllabus" (
    "id" TEXT NOT NULL,
    "courseId" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "pageCount" INTEGER NOT NULL,
    "text" TEXT NOT NULL,
    "extractedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CourseSyllabus_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "CourseSyllabus_courseId_key" ON "CourseSyllabus"("courseId");

ALTER TABLE "CourseSyllabus" ADD CONSTRAINT "CourseSyllabus_courseId_fkey" FOREIGN KEY ("courseId") REFERENCES "Course"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "CourseSyllabus" ENABLE ROW LEVEL SECURITY;
