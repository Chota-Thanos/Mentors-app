# Supabase Backend (Phase 1)

This folder contains the **Supabase-Native** backend for the UPSC App. It is designed to replace the legacy SQLAlchemy/Postgres backend incrementally.

## Structure

- **`schema.sql`**: The unified database schema. Run this SQL in your Supabase SQL Editor.
- **`backend/`**: A slim FastAPI service that acts as the API layer.
  - **`app/main.py`**: Entry point.
  - **`app/models.py`**: Pydantic models for the new API.
  - **`app/routers/premium.py`**: Handles Premium Collections & AI Generation.
  - **`app/ai_logic.py`**: Encapsulates AI Provider logic (OpenAI/Gemini).
  - **`app/supabase_client.py`**: Connects to Supabase using `SUPABASE_URL` and `SUPABASE_KEY`.

## Setup

1.  **Database Migration**:
    - Copy the content of `schema.sql`.
    - Paste it into your Supabase Dashboard -> SQL Editor and Run.

2.  **Environment Variables**:
    - Create a `.env` file in `backend/` with:
      ```
      SUPABASE_URL=your_supabase_url
      SUPABASE_KEY=your_supabase_service_role_key
      OPENAI_API_KEY=sk-...
      GEMINI_API_KEY=...
      ```

3.  **Run Backend**:
    ```bash
    cd backend
    pip install -r requirements.txt
    uvicorn app.main:app --reload --port 8002
    ```

## Usage

- **Exams**:
  - `GET/POST/PUT/DELETE /api/v1/premium/exams`
  - Compatibility: `GET/POST/PUT/DELETE /api/v1/exams`
- **Categories**:
  - `GET/POST/PUT/DELETE /api/v1/premium/categories`
  - Compatibility (quiz-type scoped): `GET/POST/PUT/DELETE /api/v1/premium-categories/{premium_gk|premium_maths|premium_passage}/...`
- **Collections**: `GET/POST/PUT /api/v1/premium/collections`
- **Collection Content**: `POST /api/v1/premium/collections/{id}/items`
- **Quiz Posting**:
  - `POST /api/v1/premium/quizzes/gk/bulk`
  - `POST /api/v1/premium/quizzes/maths/bulk`
  - `POST /api/v1/premium/quizzes/passage`
  - Supports legacy premium fields: `supp_question_statement`, `statements_facts`, `question_prompt`, `source_reference`,
    `premium_gk_category_ids` / `premium_maths_category_ids` / `premium_passage_category_ids`, and `alpha_cat_ids`.
- **Collection Test Runner**:
  - `GET /api/v1/premium/collections/{id}/test`
  - `POST /api/v1/premium/collections/{id}/test/score`
- **AI Instructions**: `GET/POST/PUT /api/v1/premium/ai/instructions`
- **AI Generation**: `POST /api/v1/premium/ai/generate`
