-- Professional profile reviews (mentors + quiz masters)
-- Safe to run multiple times.

create table if not exists professional_profile_reviews (
  id bigserial primary key,
  target_user_id text not null,
  reviewer_user_id text not null,
  rating smallint not null check (rating between 1 and 5),
  title text,
  comment text,
  is_public boolean not null default true,
  is_active boolean not null default true,
  meta jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (target_user_id, reviewer_user_id)
);

create index if not exists ix_prof_reviews_target_active
  on professional_profile_reviews(target_user_id, is_active, created_at desc);

create index if not exists ix_prof_reviews_reviewer_active
  on professional_profile_reviews(reviewer_user_id, is_active, created_at desc);
