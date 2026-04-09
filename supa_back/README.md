# Supabase Backend

Backend for the Mentors App monorepo. This layer exposes the API used by both `supa_frontend` and `supa_mobile`.

Project-wide overview: [`../README.md`](../README.md)

## Structure

- `schema.sql`: core schema bootstrap
- `migrations/`: targeted SQL migrations
- `backend/app/main.py`: FastAPI entry point
- `backend/app/models.py`: Pydantic models
- `backend/app/routers/premium.py`: collections, quiz test runner, results, complaints, AI routes
- `backend/app/routers/test_series.py`: programs, mentorship, Zoom integration, prelims discussion/live-class logic
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

## Railway Deployment (Backend)

Use `supa_back/backend` as the Railway service root directory.

- Build uses `requirements.txt`
- Start uses `gunicorn` via both `Procfile` and `railway.toml`
- `railpack.json` is included for explicit Railpack provider detection

Fallback root support:

- If Railway service root is `supa_back` (not `supa_back/backend`), deployment still works via:
  - `supa_back/railpack.json`
  - `supa_back/railway.toml`
  - `supa_back/Procfile`

Default production start command:

```bash
gunicorn app.main:app -k uvicorn.workers.UvicornWorker --bind 0.0.0.0:$PORT --workers ${WEB_CONCURRENCY:-2} --timeout ${GUNICORN_TIMEOUT:-120}
```

Note: `gunicorn` is for Linux deploy targets (Railway). For local Windows development, continue to run `uvicorn` directly.

Recommended Railway variables:

- `PORT` (set automatically by Railway)
- `WEB_CONCURRENCY` (optional, default `2`)
- `GUNICORN_TIMEOUT` (optional, default `120`)
- `PYTHON_VERSION=3.11` (optional if Railway respects `.python-version`)

## Required Environment Variables

- `SUPABASE_URL`
- `SUPABASE_KEY`
- `SUPABASE_SERVICE_ROLE_KEY` (recommended for admin-auth assisted routes)
- `OPENAI_API_KEY`
- `GEMINI_API_KEY`
- `API_URL`
- `AGORA_APP_ID`
- `AGORA_APP_CERTIFICATE`

Legacy-only (optional unless still using Zoom routes):

- `ZOOM_CLIENT_ID`
- `ZOOM_CLIENT_SECRET`
- `ZOOM_WEBHOOK_SECRET`

## Current Backend Responsibilities

### AI Parsing

- stricter quiz parsing field mapping
- stricter mains field mapping
- non-destructive normalization of parsed question parts

### Programs

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
