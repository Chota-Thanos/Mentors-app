# New Supa Backend Analysis — 2026-04-17

## What changed in this pass

- Added a compatibility router to `New_Supa_Backend` for frontend paths that were still calling the old premium API surface.
- Added explicit Railway deployment config at `New_Supa_Backend/backend/railway.toml` and `New_Supa_Backend/backend/railpack.json`.

## Endpoints restored on the new backend

- `GET /content`
- `GET /exams`
- `POST /exams`
- `PUT /exams/{id}`
- `DELETE /exams/{id}`
- `GET /ai/example-analyses`
- `POST /ai/example-analyses`
- `PUT /ai/example-analyses/{id}`
- `DELETE /ai/example-analyses/{id}`
- `GET /admin/premium-ai-settings/`
- `POST /admin/premium-ai-settings/`
- `PUT /admin/premium-ai-settings/{id}`
- `DELETE /admin/premium-ai-settings/{id}`
- `GET /api/v1/admin/premium-ai-settings/`
- `POST /api/v1/admin/premium-ai-settings/`
- `PUT /api/v1/admin/premium-ai-settings/{id}`
- `DELETE /api/v1/admin/premium-ai-settings/{id}`
- `GET /onboarding/applications/me`
- `POST /onboarding/applications/draft`
- `POST /onboarding/applications`
- `GET /admin/onboarding/applications`
- `PUT /admin/onboarding/applications/{id}/review`
- `GET /lifecycle/tracking`
- `GET /user/progress`
- `GET /user/weak-areas`
- `GET /users/me/mains-performance-report`
- `GET /moderation/activity-summary`

These were implemented against the new schema only. No table structure was changed.

## Current architecture findings

### 1. API surface mismatch is still the main migration gap

The frontend still calls a large legacy `premiumApi` surface, while `New_Supa_Backend` had only AI, payments, PDFs, live rooms, and analytics mounted. That mismatch is the root cause behind the 404s you reported for:

- `/content`
- `/moderation/activity-summary`
- `/ai/example-analyses`
- `/api/v1/admin/premium-ai-settings/`
- exam create/update/delete flows behind `/exams`
- `/lifecycle/tracking`
- `/admin/onboarding/applications`

### 2. The new database is already the correct source of truth

The schema in `New_Supa_Backend/supabase/migrations` is coherent and should remain unchanged. The right migration strategy is to adapt backend/frontend contracts to the new tables, not to bend the new tables back toward `supa_back`.

Important constraint from the new schema:

- `exams` are top-level filters for series and mentors
- `categories` are global by domain (`gk`, `maths`, `passage`, `mains`, `article`)
- there is no exam-category relation in the new structure

That means the backend can restore missing exam-management and exam-aware API contracts, but it cannot make categories truly exam-linked without a schema migration. This pass intentionally does not do that.

### 3. User performance evaluation is partially wired, not fully surfaced

The new backend already writes AI mains evaluation data into:

- `user_mains_evaluations`
- `mains_test_copy_submissions`
- `mains_test_copy_marks`
- `user_performance_snapshots`
- `user_weak_areas`

What was missing was the compatibility/reporting layer that older frontend screens still expect.

The mains performance report compatibility endpoint is now restored. That covers the reporting surface the current frontend uses, but it does not prove every user evaluation path is complete end-to-end. The newer evaluation-specific routes should still be validated with live data after deploy.

### 4. Exam-management and AI admin screens were present in the frontend but not actually reachable end-to-end

- The admin category manager component already had exam CRUD UI.
- The routed admin page had `showExamManagement={false}`, so there was no visible place to create exams.
- The style-analysis and premium AI settings pages were still calling legacy endpoints that did not exist in the new backend.

This pass restores those backend contracts and exposes exam management on the existing admin taxonomy page.

### 5. Onboarding is now contract-compatible, but the new schema still has a role-model limitation

The frontend onboarding flow assumes creator and mentor approvals are additive.

The new backend schema still stores a single role in `profiles.role`:

- `user`
- `prelims_expert`
- `mains_expert`
- `admin`
- `moderator`

Compatibility routes can now:

- save draft and submitted onboarding applications
- list them for the applicant
- list them for moderators
- approve/reject them

But approval can only map to one expert role at a time in `profiles.role`. That means dual creator+mentor approval is still structurally limited unless the role model changes in a future schema pass.

### 6. There is still a structural content-ID risk

Old code assumed a single `content_items` table with one global ID space.

The new schema splits content across:

- `quizzes`
- `passage_quizzes`
- `mains_questions`

That means any write flow that still assumes a single global `content_item_id` may need a second migration pass. Read flows are now covered for the endpoints restored above.

## Recommended next migration targets

These are still likely to be missing or only partially migrated:

- programs listing and enrollment compatibility
- collections create/manage compatibility
- category listing compatibility
- mentorship/program operator endpoints not yet ported to the new auth/profile model
- any frontend write path that still expects old `content_items` semantics
- a formal exam-category relationship, if that requirement is still mandatory after reviewing the new schema

## Constraint preserved

No schema changes were made in `New_Supa_Backend`. This pass only reconnects missing backend wires on top of the new structure.
