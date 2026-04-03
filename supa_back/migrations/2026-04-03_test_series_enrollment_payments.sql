alter table test_series_enrollments
  add column if not exists meta jsonb not null default '{}'::jsonb;

create index if not exists ix_test_series_enrollments_status on test_series_enrollments(status);
