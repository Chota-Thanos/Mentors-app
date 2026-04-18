-- Restore the test_series meta column expected by the expert manage/detail flows.
ALTER TABLE public.test_series
  ADD COLUMN IF NOT EXISTS meta JSONB NOT NULL DEFAULT '{}'::jsonb;
