CREATE TABLE "AssignmentPlan" (
    "assignmentId" TEXT NOT NULL,
    "steps" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AssignmentPlan_pkey" PRIMARY KEY ("assignmentId")
);

ALTER TABLE "AssignmentPlan" ADD CONSTRAINT "AssignmentPlan_assignmentId_fkey" FOREIGN KEY ("assignmentId") REFERENCES "Assignment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "AssignmentPlan" ENABLE ROW LEVEL SECURITY;
