"""
AI Mains Router
POST /ai/mains/generate-question   — generate a mains practice question
POST /ai/mains/evaluate            — AI evaluates a student's answer
POST /ai/mains/evaluate-submission — evaluate a program submission (auto-triggered)
"""

from fastapi import APIRouter, Depends, HTTPException, status, BackgroundTasks
from pydantic import BaseModel, Field

from ..auth import ProfileRow, require_auth
from ..db import get_admin_client
from ..ai_engine import generate_mains_question, evaluate_mains_answer

router = APIRouter(prefix="/ai/mains", tags=["AI Mains"])


# ── Schemas ────────────────────────────────────────────────────────────────────

from pydantic import ConfigDict

class MainsGenerateRequest(BaseModel):
    model_config = ConfigDict(protected_namespaces=())
    
    source_text: str
    category_id: int | None = None
    word_limit: int = Field(default=250, ge=100, le=1000)
    language: str = Field(default="en", pattern="^(en|hi)$")
    save: bool = False  # persist to ai_mains_questions
    provider: str | None = None
    model: str | None = None


class MainsEvaluateRequest(BaseModel):
    model_config = ConfigDict(protected_namespaces=())
    
    question_text: str
    answer_text: str
    word_limit: int = 250
    model_answer: str | None = None
    save: bool = False  # persist to user_mains_evaluations
    question_id: int | None = None  # link to ai_mains_questions row
    provider: str | None = None
    model: str | None = None


class MainsEvaluateSubmissionRequest(BaseModel):
    submission_id: int
    provider: str | None = None
    model: str | None = None


# ── Background task ────────────────────────────────────────────────────────────

async def _evaluate_and_save_submission(submission_id: int, provider: str | None, model: str | None):
    """Background task: fetch submission, call AI, write result back."""
    admin = get_admin_client()

    # Fetch submission
    sub_resp = (
        admin.table("mains_test_copy_submissions")
        .select("*, mains_questions(question_text, model_answer, word_limit)")
        .eq("id", submission_id)
        .single()
        .execute()
    )
    if not sub_resp.data:
        return

    sub = sub_resp.data
    q = sub.get("mains_questions") or {}

    question_text = q.get("question_text", "")
    answer_text = sub.get("answer_text", "")
    word_limit = q.get("word_limit", 250)
    model_answer = q.get("model_answer")

    if not question_text or not answer_text:
        return

    result = await evaluate_mains_answer(
        question_text=question_text,
        answer_text=answer_text,
        word_limit=word_limit,
        model_answer=model_answer,
        provider=provider,
        model=model,
    )

    # Write AI evaluation back to submission
    from datetime import datetime, timezone
    admin.table("mains_test_copy_submissions").update({
        "status": "evaluated",
        "evaluator_type": "ai",
        "ai_score": result["ai_score"],
        "ai_max_score": result["ai_max_score"],
        "ai_feedback": result["ai_feedback"],
        "ai_strengths": result["ai_strengths"],
        "ai_weaknesses": result["ai_weaknesses"],
        "ai_structure_score": result["ai_structure_score"],
        "ai_content_score": result["ai_content_score"],
        "ai_evaluated_at": datetime.now(timezone.utc).isoformat(),
        "evaluated_at": datetime.now(timezone.utc).isoformat(),
    }).eq("id", submission_id).execute()


# ── Routes ─────────────────────────────────────────────────────────────────────

@router.post("/generate-question")
async def mains_generate(
    body: MainsGenerateRequest,
    profile: ProfileRow = Depends(require_auth),
):
    """Generate a UPSC Mains practice question from source text."""
    admin = get_admin_client()

    # Quota check
    from .ai_quiz import _check_and_increment_quota
    quota = _check_and_increment_quota(profile.id, "mains")
    if not quota["allowed"]:
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail=f"Monthly mains AI quota reached ({quota['limit']}). Upgrade your plan.",
        )

    # Fetch category label if given
    category_label = None
    if body.category_id:
        cat = admin.table("categories").select("name").eq("id", body.category_id).single().execute()
        category_label = (cat.data or {}).get("name")

    result = await generate_mains_question(
        source_text=body.source_text,
        category_label=category_label,
        word_limit=body.word_limit,
        language=body.language,
        provider=body.provider,
        model=body.model,
    )

    if not result:
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail="AI generation failed. Please try again.",
        )

    # Optionally save
    saved_id = None
    if body.save:
        saved = admin.table("ai_mains_questions").insert({
            "user_id": profile.id,
            "question_text": result.get("question_text", body.source_text),
            "answer_approach": result.get("answer_approach", ""),
            "model_answer": result.get("model_answer", ""),
            "word_limit": body.word_limit,
            "category_id": body.category_id,
            "is_saved": True,
        }).execute()
        saved_id = (saved.data or [{}])[0].get("id")

    return {**result, "saved_id": saved_id, "quota": quota}


@router.post("/evaluate")
async def mains_evaluate(
    body: MainsEvaluateRequest,
    profile: ProfileRow = Depends(require_auth),
):
    """AI evaluates a student's free-form mains answer."""
    admin = get_admin_client()

    result = await evaluate_mains_answer(
        question_text=body.question_text,
        answer_text=body.answer_text,
        word_limit=body.word_limit,
        model_answer=body.model_answer,
        provider=body.provider,
        model=body.model,
    )

    # Log usage
    admin.table("ai_generation_usage").insert({
        "user_id": profile.id,
        "bucket": "mains_evaluation",
        "payload": {"word_limit": body.word_limit},
    }).execute()

    # Optionally save
    saved_id = None
    if body.save:
        saved = admin.table("user_mains_evaluations").insert({
            "user_id": profile.id,
            "question_id": body.question_id,
            "question_text": body.question_text,
            "answer_text": body.answer_text,
            "word_count": len(body.answer_text.split()),
            **result,
        }).execute()
        saved_id = (saved.data or [{}])[0].get("id")

    return {**result, "saved_id": saved_id}


@router.post("/evaluate-submission")
async def evaluate_submission(
    body: MainsEvaluateSubmissionRequest,
    background_tasks: BackgroundTasks,
    profile: ProfileRow = Depends(require_auth),
):
    """
    Trigger AI evaluation of a mains program submission.
    Only the submitting user or series creator can trigger this.
    Evaluation runs in the background.
    """
    admin = get_admin_client()

    # Verify access
    sub = (
        admin.table("mains_test_copy_submissions")
        .select("user_id, status, series_id")
        .eq("id", body.submission_id)
        .single()
        .execute()
    )
    if not sub.data:
        raise HTTPException(status_code=404, detail="Submission not found")

    sub_data = sub.data
    is_owner = sub_data["user_id"] == profile.id
    is_series_creator = False
    if sub_data.get("series_id"):
        sc = (
            admin.table("test_series")
            .select("creator_id")
            .eq("id", sub_data["series_id"])
            .single()
            .execute()
        )
        is_series_creator = (sc.data or {}).get("creator_id") == profile.id

    if not (is_owner or is_series_creator or profile.is_moderator):
        raise HTTPException(status_code=403, detail="Access denied")

    if sub_data["status"] == "evaluated":
        raise HTTPException(status_code=409, detail="Submission already evaluated")

    # Mark as under_review immediately
    admin.table("mains_test_copy_submissions").update({
        "status": "under_review"
    }).eq("id", body.submission_id).execute()

    # Run evaluation in background
    background_tasks.add_task(
        _evaluate_and_save_submission,
        body.submission_id,
        body.provider,
        body.model,
    )

    return {"message": "Evaluation started", "submission_id": body.submission_id}
