alter table mains_test_copy_submissions
  add column if not exists learner_note text;

alter table mains_test_copy_submissions
  add column if not exists provider_user_id uuid references auth.users(id) on delete set null;

alter table mains_test_copy_submissions
  alter column test_collection_id drop not null;

create index if not exists ix_mains_copy_submissions_provider on mains_test_copy_submissions(provider_user_id);

update mains_test_copy_submissions
set learner_note = coalesce(learner_note, provider_note)
where learner_note is null
  and nullif(trim(coalesce(provider_note, '')), '') is not null;

update mains_test_copy_submissions as submission
set provider_user_id = series.provider_user_id
from test_series as series
where submission.series_id = series.id
  and submission.provider_user_id is null;
