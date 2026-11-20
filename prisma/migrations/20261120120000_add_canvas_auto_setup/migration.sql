-- AlterTable
ALTER TABLE "Course" ADD COLUMN "applyGroupWeights" BOOLEAN NOT NULL DEFAULT false;

-- Every setup saved before this change was confirmed by the student by hand.
ALTER TABLE "CourseGradeSetup" ADD COLUMN "source" TEXT NOT NULL DEFAULT 'student';

-- Canvas drop rules the grade engine cannot express.
ALTER TABLE "AssignmentGroup" ADD COLUMN "hasDropRules" BOOLEAN NOT NULL DEFAULT false;
