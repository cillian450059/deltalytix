-- Supabase Storage Setup
-- Run this once against your Supabase project via:
--   Project → SQL Editor → paste and run
-- or via psql / prisma db execute.
--
-- This is idempotent (ON CONFLICT DO NOTHING) so it is safe to re-run.

-- ─── trade-images bucket ────────────────────────────────────────────────────
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'trade-images',
  'trade-images',
  true,
  5242880,  -- 5 MB
  ARRAY['image/jpeg', 'image/jpg', 'image/png', 'image/webp']
)
ON CONFLICT (id) DO NOTHING;

-- Allow authenticated users to upload their own files
CREATE POLICY IF NOT EXISTS "Authenticated users can upload trade images"
  ON storage.objects FOR INSERT
  TO authenticated
  WITH CHECK (bucket_id = 'trade-images');

-- Allow public read access (bucket is public)
CREATE POLICY IF NOT EXISTS "Public read access for trade images"
  ON storage.objects FOR SELECT
  TO public
  USING (bucket_id = 'trade-images');

-- Allow users to delete their own files
CREATE POLICY IF NOT EXISTS "Users can delete their own trade images"
  ON storage.objects FOR DELETE
  TO authenticated
  USING (bucket_id = 'trade-images' AND (storage.foldername(name))[1] = auth.uid()::text);
