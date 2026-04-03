# Supabase Backend

Backend for the Mentors App monorepo. This layer exposes the API used by both `supa_frontend` and `supa_mobile`.

Project-wide overview: [`../README.md`](../README.md)

## Structure

- `schema.sql`: core schema bootstrap
- `migrations/`: targeted SQL migrations
- `backend/app/main.py`: FastAPI entry point
- `backend/app/models.py`: Pydantic models
- `backend/app/routers/premium.py`: collections, quiz test runner, results, complaints, AI routes
- `backend/app/routers/test_series.py`: test series, mentorship, Zoom integration, prelims discussion/live-class logic
- `backend/app/ai_logic.py`: AI provider logic and parsing behavior
- `backend/app/ai_legacy_prompts.py`: legacy prompt instructions used by some parser paths

## Setup

1. Create backend env vars in `backend/.env`.
2. Install dependencies and run FastAPI.

```powershell
cd e:\Mentors-app\supa_back\backend
pip install -r requirements.txt
uvicorn app.main:app --reload --port 8002
```

## Required Environment Variables

- `SUPABASE_URL`
- `SUPABASE_KEY`
- `OPENAI_API_KEY`
- `GEMINI_API_KEY`
- `API_URL`
- `ZOOM_CLIENT_ID`
- `ZOOM_CLIENT_SECRET`
- `AGORA_APP_ID`
- `AGORA_APP_CERTIFICATE`

## Current Backend Responsibilities

### AI Parsing

- stricter quiz parsing field mapping
- stricter mains field mapping
- non-destructive normalization of parsed question parts

### Test Series

- series CRUD
- series test CRUD
- learner enrollments and access checks
- prelims vs mains behavior separation

### Learner Prelims Flow

- test runner
- score submission
- per-test attempt counts
- result snapshots
- question complaint creation and creator review support

### Prelims Discussions / Live Classes

- series-level final discussion stored in series `meta`
- test-level post-test discussion stored in test `meta`
- supports:
  - `video`
  - `live_zoom`
- `live_zoom` supports:
  - connected Zoom auto-provision
  - manual Zoom link fallback
- class semantics stored in discussion metadata:
  - creator-led class
  - learner joins as listener first
  - speaker access controlled by host approval on Zoom side

### Mentorship

- mentorship requests
- slot scheduling
- evaluation-linked session workflow
- Zoom meeting / Agora room session context

## Important Migrations

- `migrations/2026-03-12_zoom_integrations.sql`
- `migrations/2026-03-24_quiz_question_complaints.sql`

## Important Notes About Calls

- Zoom env vars are only for creator-owned Zoom meeting generation through OAuth.
- Agora env vars power the in-browser mentorship room.
- Creator-specific Zoom meeting generation still requires per-creator Zoom OAuth connection. The app stores those creator tokens in `mentor_zoom_connections`.
