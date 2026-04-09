alter table if exists user_ai_mains_questions
  add column if not exists mains_category_ids jsonb not null default '[]'::jsonb;

alter table if exists user_ai_mains_questions
  add column if not exists mains_category_id bigint;

alter table if exists user_ai_mains_questions
  add column if not exists category_ids jsonb not null default '[]'::jsonb;

alter table if exists user_ai_mains_questions
  add column if not exists description text;
