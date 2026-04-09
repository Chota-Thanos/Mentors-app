alter table if exists premium_ai_example_analyses
  add column if not exists exam_ids jsonb not null default '[]'::jsonb;
