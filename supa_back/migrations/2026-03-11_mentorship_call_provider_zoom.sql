-- Mentorship call provider support (Zoom + custom links)

alter table mentorship_slots
  add column if not exists call_provider text not null default 'custom';

alter table mentorship_sessions
  add column if not exists call_provider text not null default 'custom';

update mentorship_slots
set call_provider = 'zoom'
where (
    nullif(trim(coalesce(call_provider, '')), '') is null
    or lower(call_provider) = 'custom'
  )
  and lower(coalesce(meeting_link, '')) like '%zoom%';

update mentorship_sessions
set call_provider = 'zoom'
where (
    nullif(trim(coalesce(call_provider, '')), '') is null
    or lower(call_provider) = 'custom'
  )
  and lower(coalesce(meeting_link, '')) like '%zoom%';

alter table mentorship_slots
  drop constraint if exists ck_mentorship_slots_call_provider;

alter table mentorship_slots
  add constraint ck_mentorship_slots_call_provider
  check (call_provider in ('custom', 'zoom'));

alter table mentorship_sessions
  drop constraint if exists ck_mentorship_sessions_call_provider;

alter table mentorship_sessions
  add constraint ck_mentorship_sessions_call_provider
  check (call_provider in ('custom', 'zoom'));

create index if not exists ix_mentorship_slots_call_provider on mentorship_slots(call_provider);
create index if not exists ix_mentorship_sessions_call_provider on mentorship_sessions(call_provider);
