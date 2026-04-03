alter table if exists premium_ai_draft_quizzes
  add column if not exists author_id uuid references auth.users(id) on delete cascade;

create index if not exists ix_premium_ai_draft_quizzes_author_id
  on premium_ai_draft_quizzes(author_id);

alter table premium_ai_draft_quizzes enable row level security;

drop policy if exists "Allow read premium ai draft quizzes" on premium_ai_draft_quizzes;
create policy "Allow read premium ai draft quizzes"
  on premium_ai_draft_quizzes for select
  using (auth.uid() = author_id);

drop policy if exists "Allow write premium ai draft quizzes" on premium_ai_draft_quizzes;
create policy "Allow write premium ai draft quizzes"
  on premium_ai_draft_quizzes for insert
  with check (auth.uid() = author_id);

drop policy if exists "Allow update premium ai draft quizzes" on premium_ai_draft_quizzes;
create policy "Allow update premium ai draft quizzes"
  on premium_ai_draft_quizzes for update
  using (auth.uid() = author_id)
  with check (auth.uid() = author_id);

drop policy if exists "Allow delete premium ai draft quizzes" on premium_ai_draft_quizzes;
create policy "Allow delete premium ai draft quizzes"
  on premium_ai_draft_quizzes for delete
  using (auth.uid() = author_id);
