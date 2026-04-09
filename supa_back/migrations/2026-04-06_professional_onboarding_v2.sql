alter table if exists professional_onboarding_requests
  add column if not exists details jsonb not null default '{}'::jsonb;

drop index if exists ux_professional_onboarding_single_pending;

create unique index if not exists ux_professional_onboarding_single_pending_per_role
  on professional_onboarding_requests(user_id, desired_role)
  where status = 'pending';

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values
  (
    'professional-profile-media',
    'professional-profile-media',
    true,
    6291456,
    array['image/jpeg', 'image/png', 'image/webp']::text[]
  ),
  (
    'professional-review-docs',
    'professional-review-docs',
    false,
    12582912,
    array['application/pdf', 'image/jpeg', 'image/png', 'image/webp']::text[]
  )
on conflict (id) do update
set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;
