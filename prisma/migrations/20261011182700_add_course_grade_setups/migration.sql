CREATE TABLE "CourseGradeSetup" (
    "id" TEXT NOT NULL,
    "courseId" TEXT NOT NULL,
    "categories" JSONB NOT NULL,
    "assignmentMappings" JSONB NOT NULL,
    "finalExamWeight" DOUBLE PRECISION NOT NULL,
    "cutoffs" JSONB NOT NULL,
    "classDetails" JSONB NOT NULL,
    "confirmedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CourseGradeSetup_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "CourseGradeSetup_courseId_key" ON "CourseGradeSetup"("courseId");

ALTER TABLE "CourseGradeSetup" ADD CONSTRAINT "CourseGradeSetup_courseId_fkey" FOREIGN KEY ("courseId") REFERENCES "Course"("id") ON DELETE CASCADE ON UPDATE CASCADE;
