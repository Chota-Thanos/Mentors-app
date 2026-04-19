-- ==============================================================================
-- ADD META COLUMN TO PROFILES
-- ==============================================================================

-- Adding the meta JSONB column back to the profiles table to prevent PostgREST 
-- cache issues and support legacy queries that still expect this column.
ALTER TABLE public.profiles
ADD COLUMN IF NOT EXISTS meta JSONB DEFAULT '{}'::jsonb;

-- Notify PostgREST to reload its schema cache
NOTIFY pgrst, 'reload schema';
