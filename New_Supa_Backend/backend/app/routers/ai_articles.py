"""
AI Article Generation Router
POST /ai/articles/generate   — generate an article draft from URL or text
POST /ai/articles/approve    — approve draft (admin) → publishes to articles table
GET  /ai/articles/drafts     — list pending drafts (admin)
"""

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from ..auth import ProfileRow, require_auth, require_admin
from ..db import get_admin_client
from ..ai_engine import generate_article_draft
from .pdfs import extract_text_from_url

router = APIRouter(prefix="/ai/articles", tags=["AI Articles"])


class ArticleGenerateRequest(BaseModel):
    source_url: str | None = None
    source_text: str | None = None
    style_guide: str | None = None
    provider: str | None = None
    model: str | None = None


class ApproveDraftRequest(BaseModel):
    draft_id: int
    # Overrides (admin can edit before publishing)
    title: str | None = None
    content: str | None = None
    subject_id: int | None = None
    topic_id: int | None = None
    subtopic_id: int | None = None
    tags: list[str] | None = None


@router.post("/generate")
async def generate_article(
    body: ArticleGenerateRequest,
    profile: ProfileRow = Depends(require_admin),
):
    """Generate an article draft (admin only)."""
    admin = get_admin_client()

    source_text = body.source_text
    if body.source_url and not source_text:
        source_text = await extract_text_from_url(body.source_url)

    if not source_text:
        raise HTTPException(422, "Provide source_text or source_url")

    # Fetch active style guide
    style_guide = body.style_guide
    if not style_guide:
        sg = admin.table("ai_article_style_guides").select("style_guide").order("created_at", desc=True).limit(1).execute()
        style_guide = (sg.data or [{}])[0].get("style_guide")

    result = await generate_article_draft(
        source_text=source_text,
        source_url=body.source_url,
        style_guide=style_guide,
        provider=body.provider,
        model=body.model,
    )

    if not result:
        raise HTTPException(502, "AI generation failed")

    # Save draft
    saved = admin.table("ai_article_drafts").insert({
        "raw_input_url": body.source_url,
        "raw_input_text": source_text[:5000] if source_text else None,
        "ai_generated_title": result.get("title"),
        "ai_generated_excerpt": result.get("excerpt"),
        "ai_generated_content": result.get("content"),
        "ai_suggested_tags": result.get("suggested_tags", []),
        "status": "pending_review",
        "created_by": profile.id,
    }).execute()

    draft_id = saved.data[0]["id"]
    return {"draft_id": draft_id, **result}


@router.post("/approve")
async def approve_draft(
    body: ApproveDraftRequest,
    profile: ProfileRow = Depends(require_admin),
):
    """Approve an article draft and publish it to the articles table."""
    admin = get_admin_client()

    draft = admin.table("ai_article_drafts").select("*").eq("id", body.draft_id).single().execute()
    if not draft.data:
        raise HTTPException(404, "Draft not found")

    d = draft.data
    title = body.title or d["ai_generated_title"] or "Untitled"
    content = body.content or d["ai_generated_content"] or ""
    tags = body.tags or d.get("ai_suggested_tags", [])

    # Create article
    import re
    slug = re.sub(r"[^a-z0-9]+", "-", title.lower()).strip("-")[:80]
    article = admin.table("articles").insert({
        "title": title,
        "slug": slug,
        "excerpt": d.get("ai_generated_excerpt"),
        "subject_id": body.subject_id or d.get("ai_suggested_subject_id"),
        "topic_id": body.topic_id or d.get("ai_suggested_topic_id"),
        "subtopic_id": body.subtopic_id or d.get("ai_suggested_subtopic_id"),
        "author_id": profile.id,
        "is_published": True,
    }).execute()

    article_id = article.data[0]["id"]

    # Create main article section
    admin.table("article_sections").insert({
        "article_id": article_id,
        "section_type": "body",
        "content_html": content,
        "order_index": 0,
    }).execute()

    # Mark draft as published
    admin.table("ai_article_drafts").update({
        "status": "published",
        "published_article_id": article_id,
        "reviewed_by": profile.id,
        "reviewed_at": "now()",
    }).eq("id", body.draft_id).execute()

    return {"article_id": article_id, "slug": slug}


@router.get("/drafts")
async def list_drafts(
    status: str = "pending_review",
    profile: ProfileRow = Depends(require_admin),
):
    """List article drafts by status (admin only)."""
    admin = get_admin_client()
    resp = (
        admin.table("ai_article_drafts")
        .select("id,ai_generated_title,ai_generated_excerpt,status,created_at,raw_input_url")
        .eq("status", status)
        .order("created_at", desc=True)
        .execute()
    )
    return {"drafts": resp.data or []}
