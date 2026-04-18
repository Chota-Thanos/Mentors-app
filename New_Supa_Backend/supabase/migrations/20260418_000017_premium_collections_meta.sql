-- Restore the premium_collections meta column expected by program test creation flows.
ALTER TABLE public.premium_collections
  ADD COLUMN IF NOT EXISTS meta JSONB NOT NULL DEFAULT '{}'::jsonb;

NOTIFY pgrst, 'reload schema';
