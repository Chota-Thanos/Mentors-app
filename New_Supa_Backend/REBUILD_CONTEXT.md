# Mentors-App V2 — Architecture Rebuild Context

> **Last updated:** 2026-04-16  
> **Purpose:** Complete context for any AI session continuing this rebuild.  
> **Workspace root:** `e:\Mentors-app\`

---

## 1. Project Overview

**Mentors-App** is a UPSC preparation platform with:
- GK / Maths / Passage AI quiz generation
- Prelims & Mains test series and programs
- AI Mains answer writing + evaluation
- Mentorship (video/chat sessions)
- Live lectures (Agora)
- Payment and subscription system (Razorpay)
- Creator/Expert content authoring system

### Why a rebuild was needed
The old backend (`supa_back/`) had critical structural issues:
- Fragmented category tables (one per domain)
- No proper payments/revenue/RBAC tables
- `user_id` used raw `auth.users.uuid` everywhere (no `profiles` join layer)
- No typed roles — roles stored informally in metadata
- AI quota not enforced in DB
- No structured program/curriculum model

---

## 2. Repository Structure

```
e:\Mentors-app\
├── supa_back/              ← OLD backend (DO NOT USE for new features)
│   ├── backend/            ← Old FastAPI app (legacy)
│   └── supabase/           ← Old migrations (incompatible schema)
│
├── supa_frontend/          ← ACTIVE Next.js frontend (being migrated)
│   ├── src/
│   │   ├── app/            ← Next.js 15 app router pages
│   │   ├── components/     ← UI components (reusable, no changes needed)
│   │   ├── context/        ← AuthContext, ProfileContext (V2)
│   │   ├── hooks/          ← useSupabase.ts (V2 hooks)
│   │   ├── lib/            ← api.ts, accessControl.ts, supabase clients
│   │   ├── styles/
│   │   └── types/          ← db.ts (V2 schema types)
│   └── .env.local          ← Points to NEW Supabase project + port 8001
│
├── supa_mobile/            ← React Native / Expo mobile app (NOT yet migrated)
│
└── New_Supa_backend/       ← NEW backend (source of truth)
    ├── supabase/
    │   ├── config.toml     ← project_id = "jporltouxpoletzziqgf"
    │   └── migrations/     ← 13 migration files (run in order)
    └── backend/
        ├── .env            ← Fill with real keys (see Section 4)
        ├── .env.example    ← Template
        ├── requirements.txt
        ├── Procfile        ← For Railway/Render deployment
        └── app/
            ├── main.py     ← FastAPI app entry point
            ├── config.py   ← Pydantic settings
            ├── db.py       ← Supabase anon + admin clients
            ├── auth.py     ← JWT → ProfileRow dependency
            ├── ai_engine.py ← Quiz/Mains/Article AI generation
            ├── prompts.py  ← All system prompts
            └── routers/
                ├── ai_quiz.py       ← POST /ai/quiz/generate, /save, /quota
                ├── ai_mains.py      ← POST /ai/mains/generate-question, /evaluate
                ├── ai_articles.py   ← POST /ai/articles/generate, /approve
                ├── payments.py      ← Razorpay order, verify, webhook
                ├── pdfs.py          ← PDF upload/extract, URL scrape
                ├── live.py          ← Agora token, room management
                └── analytics.py     ← Snapshot rebuild, weak areas
```

---

## 3. New Database Schema (13 Migrations)

All migrations are in `New_Supa_backend/supabase/migrations/`. Run in numerical order via Supabase SQL Editor.

| # | File | Tables Created |
|---|------|---------------|
| 1 | `000001_extensions_and_profiles.sql` | `profiles`, helper functions (`is_admin_or_moderator`, `set_updated_at`) |
| 2 | `000002_taxonomy.sql` | `categories`, `exams`, `alpha_categories` |
| 3 | `000003_study_content.sql` | `articles`, `article_sections`, `article_relations` |
| 4 | `000004_quiz_content.sql` | `quizzes`, `passage_quizzes`, `passage_questions`, `mains_questions` |
| 5 | `000005_question_formats_and_ai_config.sql` | `question_formats`, `category_ai_sources`, `uploaded_pdfs` |
| 6 | `000006_ai_test_system.sql` | `ai_tests`, `ai_test_questions`, `ai_usage_quotas`, `ai_generation_usage` |
| 7 | `000007_collections_and_programs.sql` | `premium_collections`, `test_series`, `program_units`, `program_unit_steps`, `reviews` |
| 8 | `000008_live_rooms.sql` | `live_rooms` |
| 9 | `000009_mains_program.sql` | Mains submissions — `mains_test_copy_submissions` |
| 10 | `000010_subscriptions_and_commerce.sql` | `subscription_plans`, `subscriptions`, `payments`, `revenue_splits`, `user_content_access`, `shopping_cart_items` + **full access functions** |
| 11 | `000011_results_and_analytics.sql` | `test_attempts`, `quiz_attempt_answers`, `user_performance_snapshots`, `user_weak_areas` |
| 12 | `000012_creator_system_and_admin.sql` | `creator_profiles`, `creator_exams`, admin tools |
| 13 | `000013_missing_components.sql` | Mentorship, challenge links, quiz complaints, discussion speaker requests, Realtime |

### Key Schema Decisions
- **`user_id` = `profiles.id` (bigint)** everywhere — NOT `auth.users.uuid`
- **Single `categories` table** with `domain` discriminator: `gk | maths | passage | mains | article`
- **Typed roles on `profiles`**: `admin | moderator | prelims_expert | mains_expert | user`
- **`can_access_premium_collection()` / `can_access_test_series()`** — simplified stubs in migration 7, full versions (with subscription + payment checks) reinstalled in migration 10
- **`is_admin_or_moderator()`** — helper function used across all RLS policies
- All tables have RLS enabled with explicit policies

---

## 4. Environment Variables

### New Backend — `New_Supa_backend/backend/.env`
```env
SUPABASE_URL=https://jporltouxpoletzziqgf.supabase.co
SUPABASE_ANON_KEY=<anon key from new project>
SUPABASE_SERVICE_KEY=<service role key from new project>

GEMINI_API_KEY=AIzaSyBuBRiG3ofVHukmJw_VaelJ72g6zFWcgas     # from old .env
OPENAI_API_KEY=sk-proj-VXwWmmu...                            # from old .env
AGORA_APP_ID=adcbce5dd8f449448c8ef1858376bc2e               # from old .env
AGORA_APP_CERTIFICATE=ce5fe3ace077429280f6cba98b2c6e7e       # from old .env

RAZORPAY_KEY_ID=                    # fill when ready
RAZORPAY_KEY_SECRET=                # fill when ready
RAZORPAY_WEBHOOK_SECRET=            # fill when ready

RESEND_API_KEY=                     # fill when ready
EMAIL_FROM=noreply@mentorsapp.in

FRONTEND_URL=http://localhost:3000
ENVIRONMENT=development
SECRET_KEY=<any 32 char random string>
```

### Frontend — `supa_frontend/.env.local`
```env
NEXT_PUBLIC_SUPABASE_URL=https://jporltouxpoletzziqgf.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=REPLACE_WITH_NEW_ANON_KEY   # ← still needs filling
NEXT_PUBLIC_SITE_URL=http://localhost:3000
NEXT_PUBLIC_API_URL=auto
NEXT_PUBLIC_SUPA_BACKEND_PORT=8001
```

> ⚠️ **`NEXT_PUBLIC_SUPABASE_ANON_KEY` must be updated** to the new project's anon key.

---

## 5. How to Run

### New Backend
```powershell
cd e:\Mentors-app\New_Supa_backend\backend
uvicorn app.main:app --reload --port 8001
# Swagger docs: http://localhost:8001/docs
```

### Frontend
```powershell
cd e:\Mentors-app\supa_frontend
npm run dev
# App: http://localhost:3000
```

---

## 6. Frontend Migration — What Was Done

### New files created in `supa_frontend/`

| File | Purpose |
|------|---------|
| `src/types/db.ts` | Full TypeScript interfaces for all V2 tables |
| `src/lib/api.ts` | API client for FastAPI backend — auto-injects Bearer JWT. Covers: `aiQuizApi`, `aiMainsApi`, `aiArticlesApi`, `pdfsApi`, `paymentsApi`, `liveApi`, `analyticsApi` |
| `src/context/ProfileContext.tsx` | Resolves Supabase auth session → `profiles` row. Provides `useProfile()` hook with `profileId`, `role`, `isAdmin`, `isCreator` etc. |
| `src/hooks/useSupabase.ts` | Typed data hooks: `useCategories`, `useExams`, `useCollection`, `useTestSeries`, `useMyCollections`, `useMySubscription`, `useMyPayments`, `useHasAccess`, `useMyPerformance`, `useMyWeakAreas`, etc. |

### Updated files

| File | What changed |
|------|-------------|
| `src/app/layout.tsx` | Added `<ProfileProvider>` between `AuthProvider` and `ExamProvider` |
| `src/lib/accessControl.ts` | Rewritten for V2 roles + backward-compatible legacy aliases for all old function names (`isAdminLike`, `isQuizMasterLike`, etc.) |
| `src/lib/backendUrl.ts` | Default port changed 8002 → 8001 |
| `.env.local` | Points to new Supabase project + port 8001 |

### Key Pattern Change: How to query data in V2

**Old pattern (broken with new schema):**
```ts
// ❌ Old — uses auth UUID directly as FK
const { data } = await supabase
  .from('collections')                    // table renamed
  .eq('user_id', session.user.id)         // was UUID, now bigint
```

**New pattern:**
```ts
// ✅ New — uses profileId (bigint) from ProfileContext
const { profileId } = useProfile();
const { data } = await supabase
  .from('premium_collections')            // new table name
  .eq('creator_id', profileId)            // profileId is bigint
```

---

## 7. What Remains To Be Done

### 7.1 — Immediate Blockers
- [ ] Fill `NEXT_PUBLIC_SUPABASE_ANON_KEY` in `supa_frontend/.env.local`
- [ ] Run all 13 migrations in Supabase SQL Editor (new project) in order 1→13
- [ ] Add missing tables to migrations that backend routers reference:
  - `ai_article_style_guides` (used by `ai_articles.py`)
  - `ai_article_drafts` (used by `ai_articles.py`)
  - `user_mains_evaluations` (used by `ai_mains.py`)
  - `ai_mains_questions` (used by `ai_mains.py`)
  - RPC `get_user_answers_for_snapshot` (used by `analytics.py`)

### 7.2 — Frontend Pages (per section)

#### Auth & Profile
- [ ] `src/app/onboarding/` — create `profiles` row on first login
- [ ] `src/app/profile/` — update profile fetch to new `profiles` table

#### Quiz & Collections
- [ ] `src/app/collections/` — rename `collections` → `premium_collections`
- [ ] `src/app/quiz/` — `quiz_kind` → `quiz_domain`
- [ ] `src/app/ai-quiz-generator/` — wire to `aiQuizApi` from `src/lib/api.ts`
- [ ] `src/app/premium-workspace/` — update all collection queries

#### Test Series & Programs
- [ ] `src/app/programs/` — update to `test_series` + `program_units` + `program_unit_steps`
- [ ] `src/app/quiz-master/` — update to `prelims_expert` role check

#### Mains System
- [ ] `src/app/mains/` — update to `mains_questions` + `mains_test_copy_submissions`
- [ ] `src/app/mains-mentor/` — `mains_expert` role check
- [ ] Wire mains evaluation to `aiMainsApi.evaluate()` / `aiMainsApi.evaluateSubmission()`

#### Commerce
- [ ] `src/app/subscriptions/` — update to `subscription_plans` + `subscriptions`
- [ ] `src/app/my-purchases/` — update to `user_content_access`
- [ ] Razorpay checkout — wire to `paymentsApi.createOrder()` + `paymentsApi.verify()`
- [ ] `src/lib/razorpayCheckout.ts` — update to use `paymentsApi` from `api.ts`

#### Mentorship
- [ ] `src/app/mentors/` — update creator_profile queries
- [ ] `src/app/mentorship/` — update `mentorship_requests` + `mentorship_sessions`
- [ ] `src/lib/mentorAvailability.ts` — update slot queries

#### Live Lectures
- [ ] `src/app/discussion/` — wire Agora token to `liveApi.getToken()`
- [ ] `src/lib/testSeriesDiscussion.ts` — update `live_rooms` table queries

#### Admin
- [ ] All admin pages — update table names + role checks
- [ ] Revenue splits dashboard — new feature to build

#### Analytics
- [ ] `src/app/my-results/` — update to `user_performance_snapshots` + `user_weak_areas`
- [ ] Call `analyticsApi.rebuildSnapshot()` after each quiz attempt completion

### 7.3 — Mobile App (`supa_mobile/`)
- [ ] Update Supabase client URL/key
- [ ] Update all queries to use `profiles.id` instead of auth UUID
- [ ] Wire Agora token to new `liveApi`

### 7.4 — Deployment
- [ ] Deploy backend to Railway or Render
- [ ] Update frontend `.env.local` with production backend URL
- [ ] Deploy frontend to Vercel

---

## 8. Critical Rules for Future Sessions

1. **Never use `supa_back/`** for new features — read it only when porting legacy logic.
2. **`New_Supa_backend/`** is the single source of truth for schema and backend.
3. **All `user_id` fields in DB queries are `profiles.id` (bigint)** — get from `useProfile().profileId`, NOT `session.user.id`.
4. **Backend runs on port 8001** — old backend was on 8002.
5. **New Supabase project**: `jporltouxpoletzziqgf` — old was `nbwdulgbpmyqecpvipfi`.
6. **New roles**: `admin | moderator | prelims_expert | mains_expert | user`
   - Old `quiz_master` / `provider` → now `prelims_expert`
   - Old `mentor` / `mains_mentor` → now `mains_expert`
7. **`accessControl.ts` has two sections** — V2 functions (use for new code) + legacy aliases (for backward compat, do not remove yet).
8. **`src/lib/api.ts`** is the only place to call FastAPI endpoints — never use raw `fetch()` to the backend from pages.
9. **`useProfile()`** gives the resolved profile row — always prefer it over `useAuth()` alone.

---

## 9. Table Name Mapping (Old → New)

| Old Table | New Table | Notes |
|-----------|-----------|-------|
| `collections` | `premium_collections` | |
| `collection_items` | `premium_collection_items` | |
| `quiz` | `quizzes` | `quiz_kind` → `quiz_domain` |
| `mains_categories` | `categories` (domain='mains') | Unified |
| `gk_categories` | `categories` (domain='gk') | Unified |
| `maths_categories` | `categories` (domain='maths') | Unified |
| `passage_categories` | `categories` (domain='passage') | Unified |
| `series` / `programs` | `test_series` | |
| `program_sections` | `program_units` | |
| `section_items` | `program_unit_steps` | |
| `user_purchases` | `user_content_access` | |
| `transactions` | `payments` | |
| `creator_splits` | `revenue_splits` | |
| `user_stats` | `user_performance_snapshots` | |
| `weak_topics` | `user_weak_areas` | |
| `ai_quizzes` | `ai_tests` | |
| `ai_quiz_questions` | `ai_test_questions` | |
| `generation_log` | `ai_generation_usage` | |
