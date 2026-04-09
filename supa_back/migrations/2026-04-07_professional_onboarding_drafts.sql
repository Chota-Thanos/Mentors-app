alter table if exists professional_onboarding_requests
  drop constraint if exists ck_professional_onboarding_status;

alter table if exists professional_onboarding_requests
  add constraint ck_professional_onboarding_status
  check (status in ('draft', 'pending', 'approved', 'rejected'));

create unique index if not exists ux_professional_onboarding_single_draft_per_role
  on professional_onboarding_requests(user_id, desired_role)
  where status = 'draft';
