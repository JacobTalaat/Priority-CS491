-- Every table lives in the "public" schema, which Supabase exposes through its
-- auto-generated REST API. Enabling row level security with no policies denies
-- that API entirely. A table owner is exempt from RLS unless FORCE ROW LEVEL
-- SECURITY is set, so the application's own Prisma connection is unaffected.
ALTER TABLE "Task" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "User" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Session" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Course" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "AssignmentGroup" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Assignment" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Grade" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "CourseGradeSetup" ENABLE ROW LEVEL SECURITY;
