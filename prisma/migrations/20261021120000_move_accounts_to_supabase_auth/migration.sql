-- Accounts are now owned by Supabase Auth: the client holds a Supabase access
-- token and the server verifies it, so there is no session table left to look
-- tokens up in and no password hash left to store.
DROP TABLE "Session";

-- The accounts that predate Supabase Auth are throwaway test accounts, so
-- their rows are removed instead of migrated. Their data goes too, through
-- cascade. Without this the new NOT NULL column below could not be added
-- honestly.
DELETE FROM "User";

ALTER TABLE "User" DROP COLUMN "passwordHash";

-- authUserId is the Supabase Auth account's UUID. Unique, so a token can only
-- ever resolve to one row.
ALTER TABLE "User" ADD COLUMN "authUserId" TEXT NOT NULL;

CREATE UNIQUE INDEX "User_authUserId_key" ON "User"("authUserId");
