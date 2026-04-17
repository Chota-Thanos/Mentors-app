# Old vs New Backend Endpoint Coverage

_Generated on 2026-04-17 from mounted FastAPI routes in `supa_back` and `New_Supa_Backend`._

## Scope

- Old backend routes were taken only from routers mounted in `supa_back/backend/app/main.py`.
- New backend routes were taken only from routers mounted in `New_Supa_Backend/backend/app/main.py`.
- Coverage is marked `[x]` only when the new backend mounts the same HTTP method on the same exact path, or on the old path after stripping the old global prefixes `/api/v1/premium` or `/api/v1`.
- Renamed or functionally similar routes are listed separately and are not counted as implemented unless the old contract is actually preserved.
- CRUD coverage is method-sensitive. `GET`, `POST`, `PUT`, `PATCH`, and `DELETE` are treated as separate endpoints.

## Summary

- Old mounted endpoints analysed: **225**
- New mounted endpoints analysed: **53**
- Old endpoints implemented in the new backend under the comparison rule above: **28**
- Old endpoints still missing in the new backend under the comparison rule above: **197**
- New-only endpoints with no old mounted counterpart: **29**

### Coverage By Old Mounted Router

| Old mounted router | Old endpoints | [x] Implemented in new | [ ] Missing in new |
| --- | ---: | ---: | ---: |
| Old App Root | 1 | 1 | 0 |
| Premium Router (/api/v1/premium) | 86 | 16 | 70 |
| Premium Compatibility Router (/api/v1) | 42 | 8 | 34 |
| Premium Collections Compatibility Router (/api/v1/premium-collections) | 5 | 0 | 5 |
| Test Series Router (/api/v1/premium) | 91 | 3 | 88 |

### Largest Missing Areas

| Missing area bucket | Missing endpoints | Example old routes |
| --- | ---: | --- |
| /collections/{collection_id} | 15 | `GET /api/v1/premium/collections/{collection_id}`<br>`PUT /api/v1/premium/collections/{collection_id}`<br>`GET /api/v1/premium/collections/{collection_id}/challenges` |
| /mentorship/requests | 14 | `GET /api/v1/premium/mentorship/requests`<br>`POST /api/v1/premium/mentorship/requests`<br>`DELETE /api/v1/premium/mentorship/requests/{request_id}` |
| /programs/{series_id} | 12 | `DELETE /api/v1/premium/programs/{series_id}`<br>`GET /api/v1/premium/programs/{series_id}`<br>`PUT /api/v1/premium/programs/{series_id}` |
| /tests/{test_id} | 10 | `DELETE /api/v1/premium/tests/{test_id}`<br>`GET /api/v1/premium/tests/{test_id}`<br>`PUT /api/v1/premium/tests/{test_id}` |
| /mains/categories | 9 | `GET /api/v1/premium/mains/categories`<br>`POST /api/v1/premium/mains/categories`<br>`DELETE /api/v1/premium/mains/categories/{category_id}` |
| /categories/{category_id} | 7 | `DELETE /api/v1/premium/categories/{category_id}`<br>`PUT /api/v1/premium/categories/{category_id}`<br>`GET /api/v1/premium/categories/{category_id}/ai-sources` |
| /premium-categories/{quiz_type} | 7 | `GET /api/v1/premium-categories/{quiz_type}/`<br>`POST /api/v1/premium-categories/{quiz_type}/`<br>`POST /api/v1/premium-categories/{quiz_type}/bulk-delete/` |
| /mentorship/slots | 6 | `GET /api/v1/premium/mentorship/slots`<br>`POST /api/v1/premium/mentorship/slots`<br>`POST /api/v1/premium/mentorship/slots/batch` |
| /premium-ai-quizzes/example-analyses | 5 | `GET /api/v1/premium-ai-quizzes/example-analyses`<br>`POST /api/v1/premium-ai-quizzes/example-analyses`<br>`DELETE /api/v1/premium-ai-quizzes/example-analyses/{analysis_id}` |
| /discussion/speaker-requests | 5 | `GET /api/v1/premium/discussion/speaker-requests`<br>`POST /api/v1/premium/discussion/speaker-requests/{request_id}/approve`<br>`POST /api/v1/premium/discussion/speaker-requests/{request_id}/reject` |
| /mentorship/integrations | 5 | `GET /api/v1/premium/mentorship/integrations/zoom/callback`<br>`POST /api/v1/premium/mentorship/integrations/zoom/connect`<br>`POST /api/v1/premium/mentorship/integrations/zoom/disconnect` |
| /challenge/{token} | 4 | `GET /api/v1/premium/challenge/{token}`<br>`GET /api/v1/premium/challenge/{token}/attempts/{attempt_id}`<br>`GET /api/v1/premium/challenge/{token}/leaderboard` |
| /mentorship/sessions | 4 | `GET /api/v1/premium/mentorship/sessions`<br>`POST /api/v1/premium/mentorship/sessions/{session_id}/call-context`<br>`POST /api/v1/premium/mentorship/sessions/{session_id}/complete` |
| /admin/users | 3 | `GET /api/v1/premium/admin/users/roles`<br>`GET /api/v1/premium/admin/users/{target_user_id}/role`<br>`PUT /api/v1/premium/admin/users/{target_user_id}/role` |
| /ai/instructions | 3 | `GET /api/v1/premium/ai/instructions`<br>`POST /api/v1/premium/ai/instructions`<br>`PUT /api/v1/premium/ai/instructions/{instruction_id}` |

### Important Renamed Or Split Capabilities Not Counted As Implemented

| Old route | Closest new route | Reason not counted as implemented |
| --- | --- | --- |
| `POST /api/v1/premium/ai/generate` | `POST /ai/quiz/generate` | Likely functional replacement, but not the same mounted path or contract. |
| `POST /api/v1/premium/ai-mains-questions/generate` | `POST /ai/mains/generate-question` | Likely renamed capability, not counted as exact coverage. |
| `POST /api/v1/premium/ai-evaluation/evaluate-mains` | `POST /ai/mains/evaluate` | Related mains evaluation feature exists, but the old endpoint contract was not preserved. |
| `POST /api/v1/premium/programs/{series_id}/payment/order` | `POST /payments/create-order` | Generic payment order route exists in the new backend, but not the old program-scoped route. |
| `POST /api/v1/premium/programs/{series_id}/payment/verify` | `POST /payments/verify` | Generic payment verify route exists in the new backend, but not the old program-scoped route. |
| `POST /api/v1/premium-ai-quizzes/upload-pdf` | `POST /pdfs/upload` | Closest replacement for uploaded PDF ingestion, but path and response contract differ. |
| `GET /api/v1/premium/user/dashboard-analytics` | `GET /analytics/me` | New analytics route exists, but it is not a preserved old endpoint. |

## Detailed Coverage

### Old App Root

| Method | Old endpoint | Status | Matched new endpoint | Match type | Old source | New source |
| --- | --- | --- | --- | --- | --- | --- |
| `GET` | `/` | [x] | `/` | exact | `supa_back/backend/app/main.py:22` | `New_Supa_Backend/backend/app/main.py:51` |

### Premium Router (/api/v1/premium)

| Method | Old endpoint | Status | Matched new endpoint | Match type | Old source | New source |
| --- | --- | --- | --- | --- | --- | --- |
| `GET` | `/api/v1/premium/admin/onboarding/applications` | [x] | `/admin/onboarding/applications` | normalized | `supa_back/backend/app/routers/premium.py:1864` | `New_Supa_Backend/backend/app/routers/compat.py:1072` |
| `PUT` | `/api/v1/premium/admin/onboarding/applications/{application_id}/review` | [x] | `/admin/onboarding/applications/{application_id}/review` | normalized | `supa_back/backend/app/routers/premium.py:1891` | `New_Supa_Backend/backend/app/routers/compat.py:1094` |
| `GET` | `/api/v1/premium/admin/users/roles` | [ ] |  |  | `supa_back/backend/app/routers/premium.py:1518` |  |
| `GET` | `/api/v1/premium/admin/users/{target_user_id}/role` | [ ] |  |  | `supa_back/backend/app/routers/premium.py:1547` |  |
| `PUT` | `/api/v1/premium/admin/users/{target_user_id}/role` | [ ] |  |  | `supa_back/backend/app/routers/premium.py:1565` |  |
| `POST` | `/api/v1/premium/ai-evaluation/evaluate-mains` | [ ] |  |  | `supa_back/backend/app/routers/premium.py:10083` |  |
| `POST` | `/api/v1/premium/ai-evaluation/ocr` | [ ] |  |  | `supa_back/backend/app/routers/premium.py:10069` |  |
| `POST` | `/api/v1/premium/ai-mains-questions/generate` | [ ] |  |  | `supa_back/backend/app/routers/premium.py:10591` |  |
| `GET` | `/api/v1/premium/ai-mains-questions/user` | [ ] |  |  | `supa_back/backend/app/routers/premium.py:10619` |  |
| `GET` | `/api/v1/premium/ai/example-analyses` | [x] | `/ai/example-analyses` | normalized | `supa_back/backend/app/routers/premium.py:10230` | `New_Supa_Backend/backend/app/routers/compat.py:761` |
| `POST` | `/api/v1/premium/ai/example-analyses` | [x] | `/ai/example-analyses` | normalized | `supa_back/backend/app/routers/premium.py:10256` | `New_Supa_Backend/backend/app/routers/compat.py:783` |
| `DELETE` | `/api/v1/premium/ai/example-analyses/{analysis_id}` | [x] | `/ai/example-analyses/{analysis_id}` | normalized | `supa_back/backend/app/routers/premium.py:10340` | `New_Supa_Backend/backend/app/routers/compat.py:863` |
| `GET` | `/api/v1/premium/ai/example-analyses/{analysis_id}` | [ ] |  |  | `supa_back/backend/app/routers/premium.py:10285` |  |
| `PUT` | `/api/v1/premium/ai/example-analyses/{analysis_id}` | [x] | `/ai/example-analyses/{analysis_id}` | normalized | `supa_back/backend/app/routers/premium.py:10301` | `New_Supa_Backend/backend/app/routers/compat.py:818` |
| `POST` | `/api/v1/premium/ai/generate` | [ ] |  |  | `supa_back/backend/app/routers/premium.py:9652` |  |
| `GET` | `/api/v1/premium/ai/instructions` | [ ] |  |  | `supa_back/backend/app/routers/premium.py:9613` |  |
| `POST` | `/api/v1/premium/ai/instructions` | [ ] |  |  | `supa_back/backend/app/routers/premium.py:9627` |  |
| `PUT` | `/api/v1/premium/ai/instructions/{instruction_id}` | [ ] |  |  | `supa_back/backend/app/routers/premium.py:9637` |  |
| `POST` | `/api/v1/premium/ai/style-profile` | [ ] |  |  | `supa_back/backend/app/routers/premium.py:10179` |  |
| `POST` | `/api/v1/premium/ai/style-profile/refine` | [ ] |  |  | `supa_back/backend/app/routers/premium.py:10213` |  |
| `GET` | `/api/v1/premium/categories` | [ ] |  |  | `supa_back/backend/app/routers/premium.py:4835` |  |
| `POST` | `/api/v1/premium/categories` | [ ] |  |  | `supa_back/backend/app/routers/premium.py:4857` |  |
| `DELETE` | `/api/v1/premium/categories/{category_id}` | [ ] |  |  | `supa_back/backend/app/routers/premium.py:4893` |  |
| `PUT` | `/api/v1/premium/categories/{category_id}` | [ ] |  |  | `supa_back/backend/app/routers/premium.py:4870` |  |
| `GET` | `/api/v1/premium/categories/{category_id}/ai-sources` | [ ] |  |  | `supa_back/backend/app/routers/premium.py:4901` |  |
| `POST` | `/api/v1/premium/categories/{category_id}/ai-sources` | [ ] |  |  | `supa_back/backend/app/routers/premium.py:4934` |  |
| `POST` | `/api/v1/premium/categories/{category_id}/ai-sources/upload-pdfs` | [ ] |  |  | `supa_back/backend/app/routers/premium.py:5002` |  |
| `DELETE` | `/api/v1/premium/categories/{category_id}/ai-sources/{source_id}` | [ ] |  |  | `supa_back/backend/app/routers/premium.py:5208` |  |
| `PUT` | `/api/v1/premium/categories/{category_id}/ai-sources/{source_id}` | [ ] |  |  | `supa_back/backend/app/routers/premium.py:5111` |  |
| `GET` | `/api/v1/premium/challenge/{token}` | [ ] |  |  | `supa_back/backend/app/routers/premium.py:9431` |  |
| `GET` | `/api/v1/premium/challenge/{token}/attempts/{attempt_id}` | [ ] |  |  | `supa_back/backend/app/routers/premium.py:9549` |  |
| `GET` | `/api/v1/premium/challenge/{token}/leaderboard` | [ ] |  |  | `supa_back/backend/app/routers/premium.py:9580` |  |
| `POST` | `/api/v1/premium/challenge/{token}/submit` | [ ] |  |  | `supa_back/backend/app/routers/premium.py:9457` |  |
| `GET` | `/api/v1/premium/challenges/public` | [ ] |  |  | `supa_back/backend/app/routers/premium.py:9347` |  |
| `GET` | `/api/v1/premium/collections` | [ ] |  |  | `supa_back/backend/app/routers/premium.py:7867` |  |
| `POST` | `/api/v1/premium/collections` | [ ] |  |  | `supa_back/backend/app/routers/premium.py:7895` |  |
| `GET` | `/api/v1/premium/collections/{collection_id}` | [ ] |  |  | `supa_back/backend/app/routers/premium.py:7946` |  |
| `PUT` | `/api/v1/premium/collections/{collection_id}` | [ ] |  |  | `supa_back/backend/app/routers/premium.py:7959` |  |
| `GET` | `/api/v1/premium/collections/{collection_id}/challenges` | [ ] |  |  | `supa_back/backend/app/routers/premium.py:9267` |  |
| `POST` | `/api/v1/premium/collections/{collection_id}/challenges` | [ ] |  |  | `supa_back/backend/app/routers/premium.py:9178` |  |
| `PATCH` | `/api/v1/premium/collections/{collection_id}/challenges/{challenge_id}` | [ ] |  |  | `supa_back/backend/app/routers/premium.py:9294` |  |
| `GET` | `/api/v1/premium/collections/{collection_id}/items` | [ ] |  |  | `supa_back/backend/app/routers/premium.py:8026` |  |
| `POST` | `/api/v1/premium/collections/{collection_id}/items` | [ ] |  |  | `supa_back/backend/app/routers/premium.py:8031` |  |
| `POST` | `/api/v1/premium/collections/{collection_id}/items/bulk-add` | [ ] |  |  | `supa_back/backend/app/routers/premium.py:8061` |  |
| `GET` | `/api/v1/premium/collections/{collection_id}/mains-test` | [ ] |  |  | `supa_back/backend/app/routers/premium.py:8997` |  |
| `POST` | `/api/v1/premium/collections/{collection_id}/mains-test/score` | [ ] |  |  | `supa_back/backend/app/routers/premium.py:9025` |  |
| `GET` | `/api/v1/premium/collections/{collection_id}/pdf` | [ ] |  |  | `supa_back/backend/app/routers/premium.py:12914` |  |
| `POST` | `/api/v1/premium/collections/{collection_id}/quiz-complaints` | [ ] |  |  | `supa_back/backend/app/routers/premium.py:8778` |  |
| `GET` | `/api/v1/premium/collections/{collection_id}/quiz-complaints/me` | [ ] |  |  | `supa_back/backend/app/routers/premium.py:8881` |  |
| `GET` | `/api/v1/premium/collections/{collection_id}/test` | [ ] |  |  | `supa_back/backend/app/routers/premium.py:8708` |  |
| `POST` | `/api/v1/premium/collections/{collection_id}/test/score` | [ ] |  |  | `supa_back/backend/app/routers/premium.py:8730` |  |
| `GET` | `/api/v1/premium/content` | [x] | `/content` | normalized | `supa_back/backend/app/routers/premium.py:8162` | `New_Supa_Backend/backend/app/routers/compat.py:1551` |
| `POST` | `/api/v1/premium/content` | [ ] |  |  | `supa_back/backend/app/routers/premium.py:8231` |  |
| `GET` | `/api/v1/premium/exams` | [x] | `/exams` | normalized | `supa_back/backend/app/routers/premium.py:4771` | `New_Supa_Backend/backend/app/routers/compat.py:674` |
| `POST` | `/api/v1/premium/exams` | [x] | `/exams` | normalized | `supa_back/backend/app/routers/premium.py:4788` | `New_Supa_Backend/backend/app/routers/compat.py:687` |
| `DELETE` | `/api/v1/premium/exams/{exam_id}` | [x] | `/exams/{exam_id}` | normalized | `supa_back/backend/app/routers/premium.py:4821` | `New_Supa_Backend/backend/app/routers/compat.py:742` |
| `PUT` | `/api/v1/premium/exams/{exam_id}` | [x] | `/exams/{exam_id}` | normalized | `supa_back/backend/app/routers/premium.py:4802` | `New_Supa_Backend/backend/app/routers/compat.py:712` |
| `POST` | `/api/v1/premium/generate-pdf` | [ ] |  |  | `supa_back/backend/app/routers/premium.py:12741` |  |
| `GET` | `/api/v1/premium/mains/categories` | [ ] |  |  | `supa_back/backend/app/routers/premium.py:5233` |  |
| `POST` | `/api/v1/premium/mains/categories` | [ ] |  |  | `supa_back/backend/app/routers/premium.py:5257` |  |
| `DELETE` | `/api/v1/premium/mains/categories/{category_id}` | [ ] |  |  | `supa_back/backend/app/routers/premium.py:5316` |  |
| `PUT` | `/api/v1/premium/mains/categories/{category_id}` | [ ] |  |  | `supa_back/backend/app/routers/premium.py:5279` |  |
| `GET` | `/api/v1/premium/mains/categories/{category_id}/sources` | [ ] |  |  | `supa_back/backend/app/routers/premium.py:5339` |  |
| `POST` | `/api/v1/premium/mains/categories/{category_id}/sources` | [ ] |  |  | `supa_back/backend/app/routers/premium.py:5372` |  |
| `POST` | `/api/v1/premium/mains/categories/{category_id}/sources/upload-pdfs` | [ ] |  |  | `supa_back/backend/app/routers/premium.py:5439` |  |
| `DELETE` | `/api/v1/premium/mains/categories/{category_id}/sources/{source_id}` | [ ] |  |  | `supa_back/backend/app/routers/premium.py:5645` |  |
| `PUT` | `/api/v1/premium/mains/categories/{category_id}/sources/{source_id}` | [ ] |  |  | `supa_back/backend/app/routers/premium.py:5548` |  |
| `GET` | `/api/v1/premium/mains/questions` | [ ] |  |  | `supa_back/backend/app/routers/premium.py:8191` |  |
| `POST` | `/api/v1/premium/mains/questions/parse` | [ ] |  |  | `supa_back/backend/app/routers/premium.py:10605` |  |
| `POST` | `/api/v1/premium/onboarding/applications` | [x] | `/onboarding/applications` | normalized | `supa_back/backend/app/routers/premium.py:1736` | `New_Supa_Backend/backend/app/routers/compat.py:1040` |
| `POST` | `/api/v1/premium/onboarding/applications/draft` | [x] | `/onboarding/applications/draft` | normalized | `supa_back/backend/app/routers/premium.py:1662` | `New_Supa_Backend/backend/app/routers/compat.py:1008` |
| `GET` | `/api/v1/premium/onboarding/applications/me` | [x] | `/onboarding/applications/me` | normalized | `supa_back/backend/app/routers/premium.py:1842` | `New_Supa_Backend/backend/app/routers/compat.py:994` |
| `POST` | `/api/v1/premium/onboarding/assets/upload` | [ ] |  |  | `supa_back/backend/app/routers/premium.py:1582` |  |
| `GET` | `/api/v1/premium/quiz-complaints/creator` | [ ] |  |  | `supa_back/backend/app/routers/premium.py:8913` |  |
| `PATCH` | `/api/v1/premium/quiz-complaints/{complaint_id}` | [ ] |  |  | `supa_back/backend/app/routers/premium.py:8942` |  |
| `POST` | `/api/v1/premium/quizzes/passage` | [ ] |  |  | `supa_back/backend/app/routers/premium.py:8368` |  |
| `GET` | `/api/v1/premium/quizzes/{quiz_kind}` | [ ] |  |  | `supa_back/backend/app/routers/premium.py:8439` |  |
| `POST` | `/api/v1/premium/quizzes/{quiz_kind}/bulk` | [ ] |  |  | `supa_back/backend/app/routers/premium.py:8300` |  |
| `GET` | `/api/v1/premium/user/dashboard-ai-analysis` | [ ] |  |  | `supa_back/backend/app/routers/premium.py:12213` |  |
| `GET` | `/api/v1/premium/user/dashboard-analytics` | [ ] |  |  | `supa_back/backend/app/routers/premium.py:11636` |  |
| `GET` | `/api/v1/premium/user/performance-audit` | [ ] |  |  | `supa_back/backend/app/routers/premium.py:11580` |  |
| `GET` | `/api/v1/premium/user/performance-audit/{content_type}/sources/{source_kind}/categories/{category_id}` | [ ] |  |  | `supa_back/backend/app/routers/premium.py:11592` |  |
| `GET` | `/api/v1/premium/user/progress` | [x] | `/user/progress` | normalized | `supa_back/backend/app/routers/premium.py:12384` | `New_Supa_Backend/backend/app/routers/compat.py:1696` |
| `GET` | `/api/v1/premium/user/quiz-attempt-counts` | [ ] |  |  | `supa_back/backend/app/routers/premium.py:12403` |  |
| `GET` | `/api/v1/premium/user/weak-areas` | [x] | `/user/weak-areas` | normalized | `supa_back/backend/app/routers/premium.py:12451` | `New_Supa_Backend/backend/app/routers/compat.py:1756` |
| `GET` | `/api/v1/premium/user/yearly-attempt-summary` | [ ] |  |  | `supa_back/backend/app/routers/premium.py:12240` |  |

### Premium Compatibility Router (/api/v1)

| Method | Old endpoint | Status | Matched new endpoint | Match type | Old source | New source |
| --- | --- | --- | --- | --- | --- | --- |
| `GET` | `/api/v1/admin/premium-ai-settings/` | [x] | `/api/v1/admin/premium-ai-settings/` | exact | `supa_back/backend/app/routers/premium.py:12505` | `New_Supa_Backend/backend/app/routers/compat.py:883` |
| `POST` | `/api/v1/admin/premium-ai-settings/` | [x] | `/api/v1/admin/premium-ai-settings/` | exact | `supa_back/backend/app/routers/premium.py:12520` | `New_Supa_Backend/backend/app/routers/compat.py:899` |
| `DELETE` | `/api/v1/admin/premium-ai-settings/{instruction_id}` | [x] | `/api/v1/admin/premium-ai-settings/{instruction_id}` | exact | `supa_back/backend/app/routers/premium.py:12562` | `New_Supa_Backend/backend/app/routers/compat.py:980` |
| `PUT` | `/api/v1/admin/premium-ai-settings/{instruction_id}` | [x] | `/api/v1/admin/premium-ai-settings/{instruction_id}` | exact | `supa_back/backend/app/routers/premium.py:12539` | `New_Supa_Backend/backend/app/routers/compat.py:936` |
| `GET` | `/api/v1/exams` | [x] | `/exams` | normalized | `supa_back/backend/app/routers/premium.py:4771` | `New_Supa_Backend/backend/app/routers/compat.py:674` |
| `POST` | `/api/v1/exams` | [x] | `/exams` | normalized | `supa_back/backend/app/routers/premium.py:4788` | `New_Supa_Backend/backend/app/routers/compat.py:687` |
| `DELETE` | `/api/v1/exams/{exam_id}` | [x] | `/exams/{exam_id}` | normalized | `supa_back/backend/app/routers/premium.py:4821` | `New_Supa_Backend/backend/app/routers/compat.py:742` |
| `PUT` | `/api/v1/exams/{exam_id}` | [x] | `/exams/{exam_id}` | normalized | `supa_back/backend/app/routers/premium.py:4802` | `New_Supa_Backend/backend/app/routers/compat.py:712` |
| `POST` | `/api/v1/premium-ai-quizzes/convert-draft-to-premium-quiz` | [ ] |  |  | `supa_back/backend/app/routers/premium.py:7800` |  |
| `DELETE` | `/api/v1/premium-ai-quizzes/draft-gk-quizzes/{draft_id}` | [ ] |  |  | `supa_back/backend/app/routers/premium.py:7733` |  |
| `GET` | `/api/v1/premium-ai-quizzes/draft-gk-quizzes/{draft_id}` | [ ] |  |  | `supa_back/backend/app/routers/premium.py:7713` |  |
| `PUT` | `/api/v1/premium-ai-quizzes/draft-gk-quizzes/{draft_id}` | [ ] |  |  | `supa_back/backend/app/routers/premium.py:7723` |  |
| `DELETE` | `/api/v1/premium-ai-quizzes/draft-maths-quizzes/{draft_id}` | [ ] |  |  | `supa_back/backend/app/routers/premium.py:7762` |  |
| `GET` | `/api/v1/premium-ai-quizzes/draft-maths-quizzes/{draft_id}` | [ ] |  |  | `supa_back/backend/app/routers/premium.py:7742` |  |
| `PUT` | `/api/v1/premium-ai-quizzes/draft-maths-quizzes/{draft_id}` | [ ] |  |  | `supa_back/backend/app/routers/premium.py:7752` |  |
| `DELETE` | `/api/v1/premium-ai-quizzes/draft-passage-quizzes/{draft_id}` | [ ] |  |  | `supa_back/backend/app/routers/premium.py:7791` |  |
| `GET` | `/api/v1/premium-ai-quizzes/draft-passage-quizzes/{draft_id}` | [ ] |  |  | `supa_back/backend/app/routers/premium.py:7771` |  |
| `PUT` | `/api/v1/premium-ai-quizzes/draft-passage-quizzes/{draft_id}` | [ ] |  |  | `supa_back/backend/app/routers/premium.py:7781` |  |
| `GET` | `/api/v1/premium-ai-quizzes/draft-quizzes` | [ ] |  |  | `supa_back/backend/app/routers/premium.py:7607` |  |
| `GET` | `/api/v1/premium-ai-quizzes/example-analyses` | [ ] |  |  | `supa_back/backend/app/routers/premium.py:5876` |  |
| `POST` | `/api/v1/premium-ai-quizzes/example-analyses` | [ ] |  |  | `supa_back/backend/app/routers/premium.py:5910` |  |
| `DELETE` | `/api/v1/premium-ai-quizzes/example-analyses/{analysis_id}` | [ ] |  |  | `supa_back/backend/app/routers/premium.py:6000` |  |
| `GET` | `/api/v1/premium-ai-quizzes/example-analyses/{analysis_id}` | [ ] |  |  | `supa_back/backend/app/routers/premium.py:5948` |  |
| `PUT` | `/api/v1/premium-ai-quizzes/example-analyses/{analysis_id}` | [ ] |  |  | `supa_back/backend/app/routers/premium.py:5964` |  |
| `GET` | `/api/v1/premium-ai-quizzes/preview-jobs/{job_id}` | [ ] |  |  | `supa_back/backend/app/routers/premium.py:7443` |  |
| `POST` | `/api/v1/premium-ai-quizzes/preview-jobs/{quiz_kind}` | [ ] |  |  | `supa_back/backend/app/routers/premium.py:7231` |  |
| `POST` | `/api/v1/premium-ai-quizzes/preview/gk` | [ ] |  |  | `supa_back/backend/app/routers/premium.py:7069` |  |
| `POST` | `/api/v1/premium-ai-quizzes/preview/maths` | [ ] |  |  | `supa_back/backend/app/routers/premium.py:7078` |  |
| `POST` | `/api/v1/premium-ai-quizzes/preview/passage` | [ ] |  |  | `supa_back/backend/app/routers/premium.py:7087` |  |
| `POST` | `/api/v1/premium-ai-quizzes/save-draft/gk` | [ ] |  |  | `supa_back/backend/app/routers/premium.py:7559` |  |
| `POST` | `/api/v1/premium-ai-quizzes/save-draft/maths` | [ ] |  |  | `supa_back/backend/app/routers/premium.py:7569` |  |
| `POST` | `/api/v1/premium-ai-quizzes/save-draft/passage` | [ ] |  |  | `supa_back/backend/app/routers/premium.py:7579` |  |
| `POST` | `/api/v1/premium-ai-quizzes/upload-pdf` | [ ] |  |  | `supa_back/backend/app/routers/premium.py:7096` |  |
| `GET` | `/api/v1/premium-ai-quizzes/uploaded-pdfs` | [ ] |  |  | `supa_back/backend/app/routers/premium.py:7167` |  |
| `DELETE` | `/api/v1/premium-ai-quizzes/uploaded-pdfs/{uploaded_pdf_id}` | [ ] |  |  | `supa_back/backend/app/routers/premium.py:7194` |  |
| `GET` | `/api/v1/premium-categories/{quiz_type}/` | [ ] |  |  | `supa_back/backend/app/routers/premium.py:5670` |  |
| `POST` | `/api/v1/premium-categories/{quiz_type}/` | [ ] |  |  | `supa_back/backend/app/routers/premium.py:5689` |  |
| `POST` | `/api/v1/premium-categories/{quiz_type}/bulk-delete/` | [ ] |  |  | `supa_back/backend/app/routers/premium.py:5757` |  |
| `POST` | `/api/v1/premium-categories/{quiz_type}/bulk/` | [ ] |  |  | `supa_back/backend/app/routers/premium.py:5714` |  |
| `DELETE` | `/api/v1/premium-categories/{quiz_type}/{category_id}` | [ ] |  |  | `supa_back/backend/app/routers/premium.py:5841` |  |
| `GET` | `/api/v1/premium-categories/{quiz_type}/{category_id}` | [ ] |  |  | `supa_back/backend/app/routers/premium.py:5800` |  |
| `PUT` | `/api/v1/premium-categories/{quiz_type}/{category_id}` | [ ] |  |  | `supa_back/backend/app/routers/premium.py:5820` |  |

### Premium Collections Compatibility Router (/api/v1/premium-collections)

| Method | Old endpoint | Status | Matched new endpoint | Match type | Old source | New source |
| --- | --- | --- | --- | --- | --- | --- |
| `GET` | `/api/v1/premium-collections/` | [ ] |  |  | `supa_back/backend/app/routers/premium_compat.py:124` |  |
| `POST` | `/api/v1/premium-collections/` | [ ] |  |  | `supa_back/backend/app/routers/premium_compat.py:169` |  |
| `GET` | `/api/v1/premium-collections/by-subpage/{slug}` | [ ] |  |  | `supa_back/backend/app/routers/premium_compat.py:130` |  |
| `GET` | `/api/v1/premium-collections/{collection_id}` | [ ] |  |  | `supa_back/backend/app/routers/premium_compat.py:143` |  |
| `PUT` | `/api/v1/premium-collections/{collection_id}` | [ ] |  |  | `supa_back/backend/app/routers/premium_compat.py:206` |  |

### Test Series Router (/api/v1/premium)

| Method | Old endpoint | Status | Matched new endpoint | Match type | Old source | New source |
| --- | --- | --- | --- | --- | --- | --- |
| `GET` | `/api/v1/premium/copy-submissions/{submission_id}` | [ ] |  |  | `supa_back/backend/app/routers/test_series.py:6135` |  |
| `PUT` | `/api/v1/premium/copy-submissions/{submission_id}/checked-copy` | [ ] |  |  | `supa_back/backend/app/routers/test_series.py:6234` |  |
| `PUT` | `/api/v1/premium/copy-submissions/{submission_id}/eta` | [ ] |  |  | `supa_back/backend/app/routers/test_series.py:6169` |  |
| `POST` | `/api/v1/premium/discussion/live-status` | [ ] |  |  | `supa_back/backend/app/routers/test_series.py:5014` |  |
| `GET` | `/api/v1/premium/discussion/messages` | [ ] |  |  | `supa_back/backend/app/routers/test_series.py:5237` |  |
| `POST` | `/api/v1/premium/discussion/messages` | [ ] |  |  | `supa_back/backend/app/routers/test_series.py:5276` |  |
| `GET` | `/api/v1/premium/discussion/speaker-requests` | [ ] |  |  | `supa_back/backend/app/routers/test_series.py:5124` |  |
| `POST` | `/api/v1/premium/discussion/speaker-requests/{request_id}/approve` | [ ] |  |  | `supa_back/backend/app/routers/test_series.py:5388` |  |
| `POST` | `/api/v1/premium/discussion/speaker-requests/{request_id}/reject` | [ ] |  |  | `supa_back/backend/app/routers/test_series.py:5402` |  |
| `POST` | `/api/v1/premium/discussion/speaker-requests/{request_id}/remove` | [ ] |  |  | `supa_back/backend/app/routers/test_series.py:5416` |  |
| `POST` | `/api/v1/premium/discussion/speaker-requests/{request_id}/withdraw` | [ ] |  |  | `supa_back/backend/app/routers/test_series.py:5430` |  |
| `GET` | `/api/v1/premium/lifecycle/tracking` | [x] | `/lifecycle/tracking` | normalized | `supa_back/backend/app/routers/test_series.py:6668` | `New_Supa_Backend/backend/app/routers/compat.py:1135` |
| `GET` | `/api/v1/premium/mentors/public` | [ ] |  |  | `supa_back/backend/app/routers/test_series.py:9596` |  |
| `POST` | `/api/v1/premium/mentors/{provider_user_id}/copy-submissions` | [ ] |  |  | `supa_back/backend/app/routers/test_series.py:6027` |  |
| `POST` | `/api/v1/premium/mentorship/entitlements/grant` | [ ] |  |  | `supa_back/backend/app/routers/test_series.py:7515` |  |
| `GET` | `/api/v1/premium/mentorship/entitlements/me` | [ ] |  |  | `supa_back/backend/app/routers/test_series.py:7541` |  |
| `GET` | `/api/v1/premium/mentorship/integrations/zoom/callback` | [ ] |  |  | `supa_back/backend/app/routers/test_series.py:10497` |  |
| `POST` | `/api/v1/premium/mentorship/integrations/zoom/connect` | [ ] |  |  | `supa_back/backend/app/routers/test_series.py:10413` |  |
| `POST` | `/api/v1/premium/mentorship/integrations/zoom/disconnect` | [ ] |  |  | `supa_back/backend/app/routers/test_series.py:10559` |  |
| `POST` | `/api/v1/premium/mentorship/integrations/zoom/exchange` | [ ] |  |  | `supa_back/backend/app/routers/test_series.py:10432` |  |
| `GET` | `/api/v1/premium/mentorship/integrations/zoom/status` | [ ] |  |  | `supa_back/backend/app/routers/test_series.py:10366` |  |
| `GET` | `/api/v1/premium/mentorship/mentors/status` | [ ] |  |  | `supa_back/backend/app/routers/test_series.py:6613` |  |
| `GET` | `/api/v1/premium/mentorship/requests` | [ ] |  |  | `supa_back/backend/app/routers/test_series.py:8213` |  |
| `POST` | `/api/v1/premium/mentorship/requests` | [ ] |  |  | `supa_back/backend/app/routers/test_series.py:7855` |  |
| `DELETE` | `/api/v1/premium/mentorship/requests/{request_id}` | [ ] |  |  | `supa_back/backend/app/routers/test_series.py:9126` |  |
| `POST` | `/api/v1/premium/mentorship/requests/{request_id}/accept-slot` | [ ] |  |  | `supa_back/backend/app/routers/test_series.py:8537` |  |
| `GET` | `/api/v1/premium/mentorship/requests/{request_id}/messages` | [ ] |  |  | `supa_back/backend/app/routers/test_series.py:8317` |  |
| `POST` | `/api/v1/premium/mentorship/requests/{request_id}/messages` | [ ] |  |  | `supa_back/backend/app/routers/test_series.py:8404` |  |
| `POST` | `/api/v1/premium/mentorship/requests/{request_id}/messages/read` | [ ] |  |  | `supa_back/backend/app/routers/test_series.py:8342` |  |
| `POST` | `/api/v1/premium/mentorship/requests/{request_id}/offer-slots` | [ ] |  |  | `supa_back/backend/app/routers/test_series.py:8435` |  |
| `POST` | `/api/v1/premium/mentorship/requests/{request_id}/pay` | [ ] |  |  | `supa_back/backend/app/routers/test_series.py:9365` |  |
| `POST` | `/api/v1/premium/mentorship/requests/{request_id}/payment/order` | [ ] |  |  | `supa_back/backend/app/routers/test_series.py:9194` |  |
| `POST` | `/api/v1/premium/mentorship/requests/{request_id}/payment/verify` | [ ] |  |  | `supa_back/backend/app/routers/test_series.py:9298` |  |
| `POST` | `/api/v1/premium/mentorship/requests/{request_id}/schedule` | [ ] |  |  | `supa_back/backend/app/routers/test_series.py:8639` |  |
| `POST` | `/api/v1/premium/mentorship/requests/{request_id}/start-now` | [ ] |  |  | `supa_back/backend/app/routers/test_series.py:8708` |  |
| `PUT` | `/api/v1/premium/mentorship/requests/{request_id}/status` | [ ] |  |  | `supa_back/backend/app/routers/test_series.py:8972` |  |
| `GET` | `/api/v1/premium/mentorship/sessions` | [ ] |  |  | `supa_back/backend/app/routers/test_series.py:9404` |  |
| `POST` | `/api/v1/premium/mentorship/sessions/{session_id}/call-context` | [ ] |  |  | `supa_back/backend/app/routers/test_series.py:10582` |  |
| `POST` | `/api/v1/premium/mentorship/sessions/{session_id}/complete` | [ ] |  |  | `supa_back/backend/app/routers/test_series.py:10709` |  |
| `POST` | `/api/v1/premium/mentorship/sessions/{session_id}/recreate-provider-session` | [ ] |  |  | `supa_back/backend/app/routers/test_series.py:10662` |  |
| `GET` | `/api/v1/premium/mentorship/slots` | [ ] |  |  | `supa_back/backend/app/routers/test_series.py:7672` |  |
| `POST` | `/api/v1/premium/mentorship/slots` | [ ] |  |  | `supa_back/backend/app/routers/test_series.py:7557` |  |
| `POST` | `/api/v1/premium/mentorship/slots/batch` | [ ] |  |  | `supa_back/backend/app/routers/test_series.py:7606` |  |
| `POST` | `/api/v1/premium/mentorship/slots/deactivate-batch` | [ ] |  |  | `supa_back/backend/app/routers/test_series.py:7785` |  |
| `DELETE` | `/api/v1/premium/mentorship/slots/{slot_id}` | [ ] |  |  | `supa_back/backend/app/routers/test_series.py:7832` |  |
| `PUT` | `/api/v1/premium/mentorship/slots/{slot_id}` | [ ] |  |  | `supa_back/backend/app/routers/test_series.py:7737` |  |
| `GET` | `/api/v1/premium/moderation/activity-summary` | [x] | `/moderation/activity-summary` | normalized | `supa_back/backend/app/routers/test_series.py:6568` | `New_Supa_Backend/backend/app/routers/compat.py:1910` |
| `GET` | `/api/v1/premium/profiles/me` | [ ] |  |  | `supa_back/backend/app/routers/test_series.py:9876` |  |
| `PUT` | `/api/v1/premium/profiles/me` | [ ] |  |  | `supa_back/backend/app/routers/test_series.py:9904` |  |
| `GET` | `/api/v1/premium/profiles/me/series-options` | [ ] |  |  | `supa_back/backend/app/routers/test_series.py:9846` |  |
| `GET` | `/api/v1/premium/profiles/public` | [ ] |  |  | `supa_back/backend/app/routers/test_series.py:9528` |  |
| `GET` | `/api/v1/premium/profiles/{target_user_id}/detail` | [ ] |  |  | `supa_back/backend/app/routers/test_series.py:9613` |  |
| `GET` | `/api/v1/premium/profiles/{target_user_id}/reviews` | [ ] |  |  | `supa_back/backend/app/routers/test_series.py:9723` |  |
| `POST` | `/api/v1/premium/profiles/{target_user_id}/reviews` | [ ] |  |  | `supa_back/backend/app/routers/test_series.py:9758` |  |
| `GET` | `/api/v1/premium/programs` | [ ] |  |  | `supa_back/backend/app/routers/test_series.py:4184` |  |
| `POST` | `/api/v1/premium/programs` | [ ] |  |  | `supa_back/backend/app/routers/test_series.py:4235` |  |
| `GET` | `/api/v1/premium/programs-discovery/series` | [ ] |  |  | `supa_back/backend/app/routers/test_series.py:4603` |  |
| `GET` | `/api/v1/premium/programs-discovery/tests` | [ ] |  |  | `supa_back/backend/app/routers/test_series.py:4468` |  |
| `POST` | `/api/v1/premium/programs/items/{item_id}/discussion-context` | [ ] |  |  | `supa_back/backend/app/routers/test_series.py:4989` |  |
| `POST` | `/api/v1/premium/programs/items/{item_id}/discussion-request-to-speak` | [ ] |  |  | `supa_back/backend/app/routers/test_series.py:5222` |  |
| `GET` | `/api/v1/premium/programs/my/enrollments` | [ ] |  |  | `supa_back/backend/app/routers/test_series.py:5964` |  |
| `DELETE` | `/api/v1/premium/programs/program-items/{item_id}` | [ ] |  |  | `supa_back/backend/app/routers/test_series.py:5606` |  |
| `PUT` | `/api/v1/premium/programs/program-items/{item_id}` | [ ] |  |  | `supa_back/backend/app/routers/test_series.py:5540` |  |
| `GET` | `/api/v1/premium/programs/{series_id:int}/enrollments` | [ ] |  |  | `supa_back/backend/app/routers/test_series.py:5944` |  |
| `DELETE` | `/api/v1/premium/programs/{series_id}` | [ ] |  |  | `supa_back/backend/app/routers/test_series.py:4387` |  |
| `GET` | `/api/v1/premium/programs/{series_id}` | [ ] |  |  | `supa_back/backend/app/routers/test_series.py:4297` |  |
| `PUT` | `/api/v1/premium/programs/{series_id}` | [ ] |  |  | `supa_back/backend/app/routers/test_series.py:4318` |  |
| `POST` | `/api/v1/premium/programs/{series_id}/discussion-context` | [ ] |  |  | `supa_back/backend/app/routers/test_series.py:4944` |  |
| `POST` | `/api/v1/premium/programs/{series_id}/discussion-request-to-speak` | [ ] |  |  | `supa_back/backend/app/routers/test_series.py:5206` |  |
| `POST` | `/api/v1/premium/programs/{series_id}/enroll` | [ ] |  |  | `supa_back/backend/app/routers/test_series.py:5730` |  |
| `POST` | `/api/v1/premium/programs/{series_id}/payment/order` | [ ] |  |  | `supa_back/backend/app/routers/test_series.py:5763` |  |
| `POST` | `/api/v1/premium/programs/{series_id}/payment/verify` | [ ] |  |  | `supa_back/backend/app/routers/test_series.py:5866` |  |
| `GET` | `/api/v1/premium/programs/{series_id}/program-items` | [ ] |  |  | `supa_back/backend/app/routers/test_series.py:4451` |  |
| `POST` | `/api/v1/premium/programs/{series_id}/program-items` | [ ] |  |  | `supa_back/backend/app/routers/test_series.py:4818` |  |
| `GET` | `/api/v1/premium/programs/{series_id}/tests` | [ ] |  |  | `supa_back/backend/app/routers/test_series.py:4415` |  |
| `POST` | `/api/v1/premium/programs/{series_id}/tests` | [ ] |  |  | `supa_back/backend/app/routers/test_series.py:4741` |  |
| `GET` | `/api/v1/premium/provider/dashboard-summary` | [ ] |  |  | `supa_back/backend/app/routers/test_series.py:6471` |  |
| `GET` | `/api/v1/premium/subscriptions/me` | [ ] |  |  | `supa_back/backend/app/routers/test_series.py:9471` |  |
| `GET` | `/api/v1/premium/subscriptions/plans` | [ ] |  |  | `supa_back/backend/app/routers/test_series.py:9437` |  |
| `DELETE` | `/api/v1/premium/tests/{test_id}` | [ ] |  |  | `supa_back/backend/app/routers/test_series.py:5578` |  |
| `GET` | `/api/v1/premium/tests/{test_id}` | [ ] |  |  | `supa_back/backend/app/routers/test_series.py:4855` |  |
| `PUT` | `/api/v1/premium/tests/{test_id}` | [ ] |  |  | `supa_back/backend/app/routers/test_series.py:5444` |  |
| `GET` | `/api/v1/premium/tests/{test_id}/copy-submissions` | [ ] |  |  | `supa_back/backend/app/routers/test_series.py:6117` |  |
| `POST` | `/api/v1/premium/tests/{test_id}/copy-submissions` | [ ] |  |  | `supa_back/backend/app/routers/test_series.py:5980` |  |
| `POST` | `/api/v1/premium/tests/{test_id}/discussion-context` | [ ] |  |  | `supa_back/backend/app/routers/test_series.py:4967` |  |
| `POST` | `/api/v1/premium/tests/{test_id}/discussion-request-to-speak` | [ ] |  |  | `supa_back/backend/app/routers/test_series.py:5322` |  |
| `DELETE` | `/api/v1/premium/tests/{test_id}/items/{collection_item_id}` | [ ] |  |  | `supa_back/backend/app/routers/test_series.py:5708` |  |
| `PUT` | `/api/v1/premium/tests/{test_id}/items/{collection_item_id}` | [ ] |  |  | `supa_back/backend/app/routers/test_series.py:5634` |  |
| `PUT` | `/api/v1/premium/tests/{test_id}/items/{collection_item_id}/content` | [ ] |  |  | `supa_back/backend/app/routers/test_series.py:5661` |  |
| `GET` | `/api/v1/premium/users/me/mains-performance-report` | [x] | `/users/me/mains-performance-report` | normalized | `supa_back/backend/app/routers/test_series.py:6368` | `New_Supa_Backend/backend/app/routers/compat.py:1805` |
| `POST` | `/api/v1/premium/webhooks/zoom` | [ ] |  |  | `supa_back/backend/app/routers/test_series.py:10803` |  |

## New-Only Mounted Endpoints

| Method | New endpoint | New source |
| --- | --- | --- |
| `GET` | `/admin/premium-ai-settings/` | `New_Supa_Backend/backend/app/routers/compat.py:883` |
| `POST` | `/admin/premium-ai-settings/` | `New_Supa_Backend/backend/app/routers/compat.py:899` |
| `DELETE` | `/admin/premium-ai-settings/{instruction_id}` | `New_Supa_Backend/backend/app/routers/compat.py:980` |
| `PUT` | `/admin/premium-ai-settings/{instruction_id}` | `New_Supa_Backend/backend/app/routers/compat.py:936` |
| `POST` | `/ai/articles/approve` | `New_Supa_Backend/backend/app/routers/ai_articles.py:86` |
| `GET` | `/ai/articles/drafts` | `New_Supa_Backend/backend/app/routers/ai_articles.py:138` |
| `POST` | `/ai/articles/generate` | `New_Supa_Backend/backend/app/routers/ai_articles.py:38` |
| `POST` | `/ai/mains/evaluate` | `New_Supa_Backend/backend/app/routers/ai_mains.py:164` |
| `POST` | `/ai/mains/evaluate-submission` | `New_Supa_Backend/backend/app/routers/ai_mains.py:204` |
| `POST` | `/ai/mains/generate-question` | `New_Supa_Backend/backend/app/routers/ai_mains.py:109` |
| `POST` | `/ai/quiz/generate` | `New_Supa_Backend/backend/app/routers/ai_quiz.py:113` |
| `GET` | `/ai/quiz/quota` | `New_Supa_Backend/backend/app/routers/ai_quiz.py:242` |
| `POST` | `/ai/quiz/save` | `New_Supa_Backend/backend/app/routers/ai_quiz.py:193` |
| `GET` | `/analytics/me` | `New_Supa_Backend/backend/app/routers/analytics.py:114` |
| `POST` | `/analytics/rebuild-snapshot` | `New_Supa_Backend/backend/app/routers/analytics.py:98` |
| `GET` | `/analytics/weak-areas` | `New_Supa_Backend/backend/app/routers/analytics.py:128` |
| `GET` | `/health` | `New_Supa_Backend/backend/app/main.py:61` |
| `POST` | `/live/rooms` | `New_Supa_Backend/backend/app/routers/live.py:110` |
| `GET` | `/live/rooms/{room_id}` | `New_Supa_Backend/backend/app/routers/live.py:164` |
| `PATCH` | `/live/rooms/{room_id}/status` | `New_Supa_Backend/backend/app/routers/live.py:137` |
| `POST` | `/live/token` | `New_Supa_Backend/backend/app/routers/live.py:66` |
| `POST` | `/payments/create-order` | `New_Supa_Backend/backend/app/routers/payments.py:91` |
| `GET` | `/payments/history` | `New_Supa_Backend/backend/app/routers/payments.py:263` |
| `POST` | `/payments/verify` | `New_Supa_Backend/backend/app/routers/payments.py:169` |
| `POST` | `/payments/webhook` | `New_Supa_Backend/backend/app/routers/payments.py:231` |
| `POST` | `/pdfs/extract-url` | `New_Supa_Backend/backend/app/routers/pdfs.py:196` |
| `POST` | `/pdfs/upload` | `New_Supa_Backend/backend/app/routers/pdfs.py:108` |
| `DELETE` | `/pdfs/{pdf_id}` | `New_Supa_Backend/backend/app/routers/pdfs.py:181` |
| `GET` | `/pdfs/{pdf_id}` | `New_Supa_Backend/backend/app/routers/pdfs.py:163` |

## Router Inputs Used For The Report

- `supa_back/backend/app/main.py`
- `supa_back/backend/app/routers/premium.py`
- `supa_back/backend/app/routers/premium_compat.py`
- `supa_back/backend/app/routers/test_series.py`
- `New_Supa_Backend/backend/app/main.py`
- Mounted routers transitively included therefrom
