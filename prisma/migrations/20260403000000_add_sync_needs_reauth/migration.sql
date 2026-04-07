-- Add needsReauth flag to Synchronization.
-- When the cron job finds an expired session, it sets this to true
-- so the UI can prompt the user to re-login.

ALTER TABLE "public"."Synchronization"
  ADD COLUMN IF NOT EXISTS "needsReauth" BOOLEAN NOT NULL DEFAULT false;
