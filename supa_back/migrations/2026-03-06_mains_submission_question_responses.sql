alter table mains_test_copy_submissions
  add column if not exists submission_mode text not null default 'pdf';

alter table mains_test_copy_submissions
  add column if not exists question_responses jsonb not null default '[]'::jsonb;

alter table mains_test_copy_submissions
  alter column answer_pdf_url drop not null;

update mains_test_copy_submissions
set
  submission_mode = case
    when coalesce(jsonb_array_length(question_responses), 0) > 0
      and nullif(trim(coalesce(answer_pdf_url, '')), '') is not null then 'hybrid'
    when coalesce(jsonb_array_length(question_responses), 0) > 0 then 'question_wise'
    else 'pdf'
  end
where submission_mode not in ('pdf', 'question_wise', 'hybrid');

update mains_test_copy_submissions
set question_responses = '[]'::jsonb
where question_responses is null;
