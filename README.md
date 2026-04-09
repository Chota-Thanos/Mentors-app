# Mentors App

Monorepo for the UPSC mentorship, prelims, mains, and creator tooling stack.

## Repos

- `supa_back`: FastAPI + Supabase backend
- `supa_frontend`: Next.js web app
- `supa_mobile`: Expo mobile client

## Current Product Shape

### Roles

- `Quiz Master`: creates and manages prelims test series, tests, quiz content, quiz complaints, and discussion/class content
- `Mains Mentor`: creates and manages mains series, copy evaluation, mentorship, and session delivery
- `Learner`: discovers series, activates access, attempts tests, reviews results, raises complaints, and joins discussion classes

### Test Series

- Learner flow is now `series-first`, not flat-test-first.
- Users see a list of series first, then open a series to see included tests.
- Prelims series and mains series are intentionally separated in behavior.
- Prelims learner pages do not show mains lifecycle or mentorship-only actions.

### AI Parsing

- Quiz parsing and mains question parsing were tightened so field mapping is verbatim-first.
- `question_statement`, `statements_facts`, and `question_prompt` are no longer loosely reshuffled.
- The frontend preview now reflects backend parsing instead of rewriting parsed quiz fields again.

### Quiz Complaints

- Learners can raise a complaint against a specific prelims question from the result page.
- Complaints are tied to the exact attempt and question.
- Quiz creators review complaints from a dedicated complaints page with `received`, `pending`, and `resolved` states.

### Prelims Discussions / Live Classes

- Prelims series support two discussion modes:
  - `Discussion video`
  - `Live class on Zoom`
- Discussions can be attached:
  - after an individual prelims test
  - after the full series as a wrap-up discussion
- `Live class on Zoom` is treated as a creator-led class, not as mentorship.
- Operational behavior for live classes:
  - creator is the host / primary speaker
  - learners join as listeners first
  - learners request speaking inside Zoom using Zoom controls
  - creator grants speaking from the Zoom side
- This is not yet a custom in-app classroom moderation stack with our own raise-hand queue.

### Zoom Integration

- Zoom API env vars identify the app, but creator-specific meeting creation still requires creator OAuth once.
- `Connect Zoom` is therefore per creator account.
- After a creator connects Zoom, saving a live discussion class can auto-create or update the scheduled Zoom meeting.
- Manual Zoom is still supported as a fallback:
  - creator makes the Zoom class outside the app
  - creator pastes the Zoom link
  - app stores and shows that link to learners

## Important Current Distinctions

### Mentorship vs Discussion Class

- `Mentorship` is a two-sided conversation workflow.
- `Discussion class` is a creator-led broadcast/classroom style workflow.
- Do not reuse mentorship UX or status language on prelims discussion classes.

### Web vs Mobile

- Web is the primary creator workspace.
- Mobile reuses the same backend but does not yet have native Zoom SDK integration.
- Mobile learner pages currently open external links for discussion videos / Zoom join actions where needed.

## Setup Overview

### Backend

```powershell
cd e:\Mentors-app\supa_back\backend
pip install -r requirements.txt
uvicorn app.main:app --reload --port 8002
```

Railway service root for backend: the inner `backend` folder.
In this repo that means `supa_back/backend`, and production start is configured from files inside that folder only.

### Frontend

```powershell
cd e:\Mentors-app\supa_frontend
npm install
npm run dev
```

### Mobile

```powershell
cd e:\Mentors-app\supa_mobile
npm install
npx expo start
```

## Key Environment Notes

### Backend

Expected core env vars include:

- `SUPABASE_URL`
- `SUPABASE_KEY`
- `OPENAI_API_KEY`
- `GEMINI_API_KEY`
- `ZOOM_CLIENT_ID`
- `ZOOM_CLIENT_SECRET`
- `AGORA_APP_ID`
- `AGORA_APP_CERTIFICATE`
- `API_URL`

### Frontend

- `NEXT_PUBLIC_SUPA_BACKEND_URL`
- Supabase web client env vars used by the existing auth client

### Mobile

- `EXPO_PUBLIC_API_URL`
- `EXPO_PUBLIC_SUPABASE_URL`
- `EXPO_PUBLIC_SUPABASE_ANON_KEY`
- `EXPO_PUBLIC_WEB_APP_URL`

## Migrations / Operational Notes

- Quiz complaint system requires the complaint migration in `supa_back/migrations/2026-03-24_quiz_question_complaints.sql`.
- Zoom integration depends on the Zoom integration migration in `supa_back/migrations/2026-03-12_zoom_integrations.sql`.
- Discussion configuration itself is stored in series/test `meta`, so no separate discussion migration was added for the current version.

## Readme Map

- Backend details: [`supa_back/README.md`](./supa_back/README.md)
- Web app details: [`supa_frontend/README.md`](./supa_frontend/README.md)
- Mobile details: [`supa_mobile/README.md`](./supa_mobile/README.md)
