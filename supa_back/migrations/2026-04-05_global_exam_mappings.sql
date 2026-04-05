-- Global Exam Mappings and Association Tweaks

-- 1. Drop the legacy category_exams table as it is conceptually flawed
drop table if exists category_exams cascade;

-- 2. Programs (Test Series) to Exams
create table if not exists test_series_exams (
  series_id bigint not null references test_series(id) on delete cascade,
  exam_id bigint not null references exams(id) on delete cascade,
  created_at timestamptz default now(),
  primary key (series_id, exam_id)
);

create index if not exists ix_test_series_exams_exam_id on test_series_exams(exam_id);

alter table test_series_exams enable row level security;
drop policy if exists "Enable all for authenticated users on test_series_exams" on test_series_exams;
create policy "Enable all for authenticated users on test_series_exams"
  on test_series_exams for all
  using (auth.role() = 'authenticated');

drop policy if exists "Allow public read test_series_exams" on test_series_exams;
create policy "Allow public read test_series_exams"
  on test_series_exams for select
  using (true);


-- 3. Collections (Challenges) to Exams
create table if not exists collection_exams (
  collection_id bigint not null references collections(id) on delete cascade,
  exam_id bigint not null references exams(id) on delete cascade,
  created_at timestamptz default now(),
  primary key (collection_id, exam_id)
);

create index if not exists ix_collection_exams_exam_id on collection_exams(exam_id);
alter table collection_exams enable row level security;
drop policy if exists "Enable all for authenticated users on collection_exams" on collection_exams;
create policy "Enable all for authenticated users on collection_exams"
  on collection_exams for all
  using (auth.role() = 'authenticated');
  
drop policy if exists "Allow public read collection_exams" on collection_exams;
create policy "Allow public read collection_exams"
  on collection_exams for select
  using (true);


-- 4. Professional Profiles to Exams
create table if not exists profile_exams (
  provider_user_id uuid not null references auth.users(id) on delete cascade,
  exam_id bigint not null references exams(id) on delete cascade,
  created_at timestamptz default now(),
  primary key (provider_user_id, exam_id)
);

create index if not exists ix_profile_exams_exam_id on profile_exams(exam_id);
alter table profile_exams enable row level security;
drop policy if exists "Enable all for authenticated users on profile_exams" on profile_exams;
create policy "Enable all for authenticated users on profile_exams"
  on profile_exams for all
  using (auth.role() = 'authenticated');
drop policy if exists "Allow public read profile_exams" on profile_exams;
create policy "Allow public read profile_exams"
  on profile_exams for select
  using (true);


-- 5. AI Sources and Categories Mappings
-- Add exam_id to category_ai_sources
alter table category_ai_sources add column if not exists exam_id bigint references exams(id) on delete set null;

-- Many to Many mapping for ai sources to categories
create table if not exists category_ai_source_categories (
  source_id bigint not null references category_ai_sources(id) on delete cascade,
  category_id bigint not null references categories(id) on delete cascade,
  created_at timestamptz default now(),
  primary key (source_id, category_id)
);

create index if not exists ix_category_ai_source_categories_category_id on category_ai_source_categories(category_id);
alter table category_ai_source_categories enable row level security;
drop policy if exists "Enable all for authenticated users on category_ai_source_categories" on category_ai_source_categories;
create policy "Enable all for authenticated users on category_ai_source_categories"
  on category_ai_source_categories for all
  using (auth.role() = 'authenticated');


-- Migrate existing categories smoothly to new many-to-many before dropping the col
insert into category_ai_source_categories (source_id, category_id)
select id, category_id from category_ai_sources
where category_id is not null
on conflict do nothing;

-- Same for mains
-- Add exam_id to mains_category_sources
alter table mains_category_sources add column if not exists exam_id bigint references exams(id) on delete set null;

create table if not exists mains_category_source_categories (
  source_id bigint not null references mains_category_sources(id) on delete cascade,
  mains_category_id bigint not null references mains_categories(id) on delete cascade,
  created_at timestamptz default now(),
  primary key (source_id, mains_category_id)
);

create index if not exists ix_mains_category_source_categories_category_id on mains_category_source_categories(mains_category_id);
alter table mains_category_source_categories enable row level security;
drop policy if exists "Enable all for authenticated users on mains_category_source_categories" on mains_category_source_categories;
create policy "Enable all for authenticated users on mains_category_source_categories"
  on mains_category_source_categories for all
  using (auth.role() = 'authenticated');

insert into mains_category_source_categories (source_id, mains_category_id)
select id, mains_category_id from mains_category_sources
where mains_category_id is not null
on conflict do nothing;

-- Note: We must retain the older column names for a little bit to avoid sudden API crashes, 
-- but we'll stop reading from them exclusively.
