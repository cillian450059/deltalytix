-- Enable Row-Level Security on all tables in the public schema.
-- All data access goes through Prisma (direct DB connection / service role),
-- which bypasses RLS automatically. Enabling RLS here blocks the Supabase
-- anon key from reading or writing any table directly via the REST/JS client.
--
-- Uses a dynamic loop so the migration is idempotent and shadow-DB safe:
-- tables that don't exist yet are simply skipped.

DO $$
DECLARE
  t record;
BEGIN
  FOR t IN
    SELECT tablename
    FROM pg_tables
    WHERE schemaname = 'public'
  LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t.tablename);
  END LOOP;
END $$;
