-- Backfill creator_mentor_profiles from already-approved onboarding requests.
-- Safe to run multiple times.

with latest_approved as (
  select distinct on (user_id)
    id,
    user_id,
    desired_role,
    full_name,
    city,
    years_experience,
    about,
    coalesce(reviewed_at, created_at) as approved_at
  from professional_onboarding_requests
  where status = 'approved'
    and desired_role in ('mentor', 'creator')
  order by user_id, coalesce(reviewed_at, created_at) desc, id desc
)
insert into creator_mentor_profiles (
  user_id,
  role,
  display_name,
  headline,
  bio,
  years_experience,
  city,
  is_verified,
  highlights,
  credentials,
  specialization_tags,
  languages,
  is_public,
  is_active,
  meta,
  created_at,
  updated_at
)
select
  l.user_id,
  l.desired_role,
  coalesce(nullif(trim(l.full_name), ''), case when l.desired_role = 'mentor' then 'UPSC Mentor' else 'UPSC Creator' end),
  case when l.desired_role = 'mentor' then 'UPSC Mentor' else 'UPSC Creator' end,
  l.about,
  case
    when l.years_experience is null then null
    when l.years_experience < 0 then null
    when l.years_experience > 60 then 60
    else l.years_experience
  end,
  l.city,
  true,
  '[]'::jsonb,
  '[]'::jsonb,
  '[]'::jsonb,
  '[]'::jsonb,
  true,
  true,
  jsonb_build_object(
    'onboarding_source', 'professional_onboarding',
    'onboarding_application_id', l.id,
    'onboarding_approved_at', l.approved_at
  ),
  now(),
  now()
from latest_approved l
on conflict (user_id) do update
set
  role = excluded.role,
  display_name = coalesce(nullif(trim(creator_mentor_profiles.display_name), ''), excluded.display_name),
  headline = coalesce(nullif(trim(creator_mentor_profiles.headline), ''), excluded.headline),
  bio = coalesce(creator_mentor_profiles.bio, excluded.bio),
  years_experience = coalesce(creator_mentor_profiles.years_experience, excluded.years_experience),
  city = coalesce(creator_mentor_profiles.city, excluded.city),
  is_verified = true,
  is_public = true,
  is_active = true,
  meta = coalesce(creator_mentor_profiles.meta, '{}'::jsonb) || excluded.meta,
  updated_at = now();
