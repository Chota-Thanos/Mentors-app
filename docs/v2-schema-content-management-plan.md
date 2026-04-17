# V2 Schema Content Management Plan

This project must treat the V2 Supabase schema and `New_Supa_Backend` as the source of truth. The old `supa_back` database shape is reference-only for behavior, not a structure to restore.

## Non-Negotiable Rules

- Do not recreate old generic `collections`, `collection_items`, or `content_items` flows in new work.
- Use `premium_collections` for creator-owned tests.
- Use `premium_collection_items` as the only test-to-question link table.
- Use `quizzes` for GK and Maths questions.
- Use `passage_quizzes` plus `passage_questions` for passage tests.
- Use `mains_questions` for creator-authored mains questions.
- Use `ai_mains_questions` only for user AI-generation history/workspace output.
- Use `categories` with `domain` values `gk`, `maths`, `passage`, and `mains`.
- Use `profiles.id` as every application `user_id`/creator/author FK. Never use `auth.users.id` directly in V2 data tables.
- Role checks must read `profiles.role`, not `auth.user.app_metadata.role`.
- Backend routes are only for domain services that need server execution: AI, PDF extraction, payments, live rooms, analytics, and secured service operations.
- CRUD against regular V2 tables should be Supabase queries unless the operation requires server-only credentials or external services.

## Creator Role Surfaces

Prelims creators (`prelims_expert`, plus admin/moderator) must have access to:

- `/programs/create`
- `/programs`
- `/collections`
- `/collections/create`
- `/collections/[id]/question-methods`
- `/quiz-master/ai-quiz`
- `/quiz/create`
- `/quiz-master/complaints`

Mains creators (`mains_expert`, plus admin/moderator) must have access to:

- `/programs/create`
- `/programs`
- `/collections`
- `/mains/evaluate?mode=mains_mentor`
- `/mains/questions`
- `/collections/[id]/question-methods` for mains tests
- `/mentorship/manage`

## Mapping From Old Behavior To V2 Tables

| Old behavior | V2 structure |
| --- | --- |
| Test/collection row | `premium_collections` |
| Test item ordering | `premium_collection_items.order_index` |
| GK/Maths quiz item | `quizzes` plus `quiz_categories` |
| Passage item | `passage_quizzes`, `passage_questions`, `passage_quiz_categories` |
| Mains question item | `mains_questions` |
| AI example format | `ai_example_analyses` |
| Uploaded PDF source | `uploaded_pdfs` |
| User generated mains history | `ai_mains_questions` |
| Creator/admin role | `profiles.role` |

## Migration Checklist

- Every content-management page must query `premium_collections`, not `collections`.
- Every add/remove operation must insert/delete `premium_collection_items`, not `collection_items`.
- Every question edit must update the concrete question table (`quizzes`, `passage_questions`, or `mains_questions`), not a JSON snapshot table.
- Every page with role gates must resolve `profiles.role`.
- Every new API call must be checked against `New_Supa_Backend`; do not call old `/api/v1/premium-*` routes.
- When old behavior is needed, port the behavior onto V2 tables, not the old schema.
