"""
AI Quiz Generation Router
POST /ai/quiz/generate     — generate GK / Maths / Passage questions
POST /ai/quiz/save         — save generated questions as an ai_test
GET  /ai/quiz/quota        — get current user's quota
"""

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field
from datetime import date

from ..auth import ProfileRow, require_auth
from ..db import get_admin_client
from ..ai_engine import generate_quiz

router = APIRouter(prefix="/ai/quiz", tags=["AI Quiz"])


# ── Schemas ────────────────────────────────────────────────────────────────────

class QuizGenerateRequest(BaseModel):
    domain: str = Field(..., pattern="^(gk|maths|passage)$")
    source_type: str = Field(..., pattern="^(text|url|pdf|category)$")
    source_text: str | None = None
    source_url: str | None = None
    source_pdf_id: int | None = None
    category_ids: list[int] | None = None
    count: int = Field(default=10, ge=1, le=50)
    language: str = Field(default="en", pattern="^(en|hi)$")
    user_instructions: str | None = None
    recent_questions: list[str] | None = None
    format_id: int | None = None
    provider: str | None = None
    model: str | None = None


class SaveAiTestRequest(BaseModel):
    title: str
    domain: str
    questions: list[dict]
    is_public: bool = False
    source_type: str | None = None
    source_text: str | None = None
    category_ids: list[int] | None = None


# ── Quota helpers ──────────────────────────────────────────────────────────────

PLAN_QUOTAS = {
    "free":   {"gk": 10, "maths": 10, "passage": 5, "mains": 5},
    "pro":    {"gk": 100, "maths": 100, "passage": 50, "mains": 30},
    "expert": {"gk": 999, "maths": 999, "passage": 999, "mains": 200},
}


def _get_plan(profile_id: int) -> str:
    admin = get_admin_client()
    resp = (
        admin.table("subscriptions")
        .select("plan")
        .eq("user_id", profile_id)
        .eq("status", "active")
        .order("created_at", desc=True)
        .limit(1)
        .execute()
    )
    if resp.data:
        return resp.data[0].get("plan", "free")
    return "free"


def _check_and_increment_quota(profile_id: int, domain: str) -> dict:
    """Returns {"allowed": bool, "used": int, "limit": int}."""
    admin = get_admin_client()
    plan = _get_plan(profile_id)
    limit = PLAN_QUOTAS.get(plan, PLAN_QUOTAS["free"]).get(domain, 10)
    period = date.today().replace(day=1).isoformat()

    # Upsert quota row
    resp = (
        admin.table("ai_usage_quotas")
        .select("id,used_count,limit_count")
        .eq("user_id", profile_id)
        .eq("quiz_domain", domain)
        .eq("period_start", period)
        .execute()
    )

    if resp.data:
        row = resp.data[0]
        used = row["used_count"]
        if used >= limit:
            return {"allowed": False, "used": used, "limit": limit}
        # Increment
        admin.table("ai_usage_quotas").update(
            {"used_count": used + 1, "limit_count": limit}
        ).eq("id", row["id"]).execute()
        return {"allowed": True, "used": used + 1, "limit": limit}
    else:
        # First use this month
        admin.table("ai_usage_quotas").insert({
            "user_id": profile_id,
            "quiz_domain": domain,
            "period_start": period,
            "used_count": 1,
            "limit_count": limit,
        }).execute()
        return {"allowed": True, "used": 1, "limit": limit}


# ── Routes ─────────────────────────────────────────────────────────────────────

@router.post("/generate")
async def generate_quiz_endpoint(
    body: QuizGenerateRequest,
    profile: ProfileRow = Depends(require_auth),
):
    """Generate AI quiz questions. Checks and decrements monthly quota."""
    # Quota check
    quota = _check_and_increment_quota(profile.id, body.domain)
    if not quota["allowed"]:
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail=f"Monthly AI quota reached ({quota['limit']} for {body.domain}). Upgrade your plan.",
        )

    # Resolve source text
    source_text = body.source_text or ""
    if body.source_type == "pdf" and body.source_pdf_id:
        admin = get_admin_client()
        pdf = admin.table("uploaded_pdfs").select("extracted_text").eq("id", body.source_pdf_id).single().execute()
        source_text = (pdf.data or {}).get("extracted_text", "")
    elif body.source_type == "category" and body.category_ids:
        # Fetch AI sources for these categories
        admin = get_admin_client()
        source_resp = (
            admin.table("category_ai_source_categories")
            .select("category_ai_sources(source_text, source_content_html, source_url)")
            .in_("category_id", body.category_ids)
            .execute()
        )
        texts = []
        for row in (source_resp.data or []):
            src = row.get("category_ai_sources") or {}
            texts.append(src.get("source_text") or src.get("source_content_html") or "")
        source_text = "\n\n".join(t for t in texts if t)

    if not source_text.strip():
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="Could not resolve source content for generation.",
        )

    # Fetch format/instruction if specified
    system_prompt_override = None
    if body.format_id:
        admin = get_admin_client()
        fmt = admin.table("question_formats").select("style_profile").eq("id", body.format_id).single().execute()
        if fmt.data:
            system_prompt_override = (fmt.data.get("style_profile") or {}).get("system_prompt")

    questions = await generate_quiz(
        domain=body.domain,
        source_text=source_text,
        count=body.count,
        language=body.language,
        user_instructions=body.user_instructions,
        recent_questions=body.recent_questions,
        system_prompt_override=system_prompt_override,
        provider=body.provider,
        model=body.model,
    )

    # Log usage
    admin = get_admin_client()
    admin.table("ai_generation_usage").insert({
        "user_id": profile.id,
        "bucket": f"{body.domain}_quiz",
        "payload": {
            "domain": body.domain,
            "count": body.count,
            "source_type": body.source_type,
        },
    }).execute()

    return {
        "questions": questions,
        "quota": quota,
        "count": len(questions),
    }


@router.post("/save")
async def save_ai_test(
    body: SaveAiTestRequest,
    profile: ProfileRow = Depends(require_auth),
):
    """Save a generated test as a named ai_test with questions."""
    admin = get_admin_client()

    # Create ai_test record
    test_resp = admin.table("ai_tests").insert({
        "user_id": profile.id,
        "title": body.title,
        "quiz_domain": body.domain,
        "source_type": body.source_type,
        "source_text": body.source_text,
        "is_public": body.is_public,
    }).execute()

    test_id = test_resp.data[0]["id"]

    # Insert category links
    if body.category_ids:
        admin.table("ai_test_categories").insert([
            {"ai_test_id": test_id, "category_id": cid}
            for cid in body.category_ids
        ]).execute()

    # Insert questions
    question_rows = []
    for idx, q in enumerate(body.questions):
        question_rows.append({
            "ai_test_id": test_id,
            "quiz_domain": body.domain,
            "question_statement": q.get("question_statement", ""),
            "supp_question_statement": q.get("supp_question_statement"),
            "statements_facts": q.get("statements_facts", []),
            "question_prompt": q.get("question_prompt"),
            "options": q.get("options", []),
            "correct_answer": q.get("correct_answer", ""),
            "explanation": q.get("explanation_text"),
            "display_order": idx,
        })

    if question_rows:
        admin.table("ai_test_questions").insert(question_rows).execute()

    return {"id": test_id, "title": body.title, "question_count": len(question_rows)}


@router.get("/quota")
async def get_quota(profile: ProfileRow = Depends(require_auth)):
    """Get the current user's AI generation quota for all domains."""
    admin = get_admin_client()
    period = date.today().replace(day=1).isoformat()
    plan = _get_plan(profile.id)
    plan_quota = PLAN_QUOTAS.get(plan, PLAN_QUOTAS["free"])

    resp = (
        admin.table("ai_usage_quotas")
        .select("quiz_domain,used_count,limit_count")
        .eq("user_id", profile.id)
        .eq("period_start", period)
        .execute()
    )

    used_map = {row["quiz_domain"]: row["used_count"] for row in (resp.data or [])}

    return {
        "plan": plan,
        "period": period,
        "domains": {
            domain: {
                "used": used_map.get(domain, 0),
                "limit": plan_quota.get(domain, 0),
                "remaining": max(0, plan_quota.get(domain, 0) - used_map.get(domain, 0)),
            }
            for domain in ["gk", "maths", "passage", "mains"]
        },
    }
