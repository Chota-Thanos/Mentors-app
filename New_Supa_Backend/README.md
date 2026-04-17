# New_Supa_backend — UPSC Platform v2 Schema

Complete Supabase PostgreSQL schema for the rebuilt Mentors-App platform.
Run migrations in order inside the Supabase SQL Editor or via `supabase db push`.

---

## Migration Order

| File | Contents |
|---|---|
| `20260416_000001_extensions_and_profiles.sql` | pgcrypto/ltree, profiles, auth trigger, role helpers |
| `20260416_000002_taxonomy.sql` | Exams, unified categories, alpha_categories, free_exams, sources, subjects/topics/subtopics |
| `20260416_000003_study_content.sql` | Articles, sections, relations, blogs, blog_posts, study_pages, timelines |
| `20260416_000004_quiz_content.sql` | GK/Maths quizzes, passage_quizzes + **passage_questions join table**, mains_questions, knowledge_tests |
| `20260416_000005_question_formats_and_ai_config.sql` | Question formats, AI instructions, style profiles, example analyses |
| `20260416_000006_ai_test_system.sql` | AI Tests, questions, attempts, answers, draft quizzes, AI mains questions, usage quotas |
| `20260416_000007_collections_and_programs.sql` | Premium collections, test series (with exam filter), **program_units**, **program_unit_steps** |
| `20260416_000008_live_rooms.sql` | Agora live rooms and interactions |
| `20260416_000009_mains_program.sql` | Mains submissions (with **AI evaluation fields**), mentorship requests |
| `20260416_000010_subscriptions_and_commerce.sql` | Subscription plans (Free/Pro/Expert), subscriptions, **payments**, **revenue_splits**, **user_content_access** |
| `20260416_000011_results_and_analytics.sql` | Test attempts, **quiz_attempt_answers** (no JSONB), **user_performance_snapshots**, **user_weak_areas** |
| `20260416_000012_creator_system_and_admin.sql` | **creator_applications**, admin subpages, user activities |

---

## Key Architectural Decisions

### Category System
- Single `categories` table with `domain` column: `gk | maths | passage | mains | article`
- Multi-level (parent_id self-reference)
- **Exams are NOT in categories** — they filter only test_series and mentors

### Passage Quiz Sub-Questions
- Sub-questions live in `passage_questions` (join table), not JSONB
- `ON DELETE CASCADE` enforces tight coupling — deleting a passage deletes its questions
- Enables per-question analytics

### Mains Evaluation
- AI evaluates fully and automatically (no manual step)
- Evaluation fields on `mains_test_copy_submissions`:
  `ai_score`, `ai_max_score`, `ai_feedback`, `ai_strengths`, `ai_weaknesses`, `ai_structure_score`, `ai_content_score`

### Commerce
- Revenue splits are manual admin action (auto-trigger planned for later)
- 80/20 split: `revenue_splits` records `creator_amount` and `platform_amount`
- `user_content_access` is the unified gating table for all content (series + collections)

### Subscription Tiers
| Tier | Monthly AI Quotas (GK/Maths/Passage/Mains) | Price |
|---|---|---|
| Free | 10/10/5/5 | Free |
| Pro | 100/100/50/30 | ₹399/mo |
| Expert | 999/999/999/200 | ₹799/mo |

### Program Structure (Sectional)
`test_series` → `program_units` → `program_unit_steps` (pdf / live_lecture / test / video / note)

---

## Role Values
| Role | DB Value | Can Do |
|---|---|---|
| Admin | `admin` | Everything |
| Moderator | `moderator` | Review, manage, approve |
| Prelims Expert | `prelims_expert` | Create prelims programs |
| Mains Expert | `mains_expert` | Create mains programs |
| User | `user` | Consume content |
