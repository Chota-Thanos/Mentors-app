from __future__ import annotations

import hashlib
import hmac
import json
import re
from datetime import datetime, timedelta, timezone
from typing import Any

import razorpay
from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field

from ..auth import ProfileRow, require_admin, require_auth
from ..config import get_settings
from ..db import get_admin_client

router = APIRouter(tags=["Compatibility"])
_settings = get_settings()

LEGACY_AI_CONTENT_TYPES = {
    "premium_gk_quiz",
    "premium_maths_quiz",
    "premium_passage_quiz",
    "mains_question_generation",
    "mains_evaluation",
}


class ExamWriteRequest(BaseModel):
    name: str
    slug: str | None = None
    exam_type: str = Field(default="combined", pattern="^(combined|prelims_only|mains_only|other)$")
    description: str | None = None
    logo_url: str | None = None
    is_active: bool = True


class AIExampleAnalysisWriteRequest(BaseModel):
    title: str
    description: str | None = None
    content_type: str = Field(
        ...,
        pattern="^(premium_gk_quiz|premium_maths_quiz|premium_passage_quiz|mains_question_generation|mains_evaluation)$",
    )
    style_profile: dict[str, Any] = Field(default_factory=dict)
    example_questions: list[str] = Field(default_factory=list)
    tags: list[str] = Field(default_factory=list)
    exam_ids: list[int] = Field(default_factory=list)
    tag_level1: str | None = None
    tag_level2: str | None = None
    is_active: bool = True


class AIInstructionWriteRequest(BaseModel):
    content_type: str | None = None
    ai_provider: str | None = None
    ai_model_name: str | None = None
    system_instructions: str | None = None
    input_schema: dict[str, Any] | None = None
    example_input: str | None = None
    output_schema: dict[str, Any] | None = None
    example_output: dict[str, Any] | None = None
    style_analysis_system_prompt: str | None = None


class OnboardingApplicationWriteRequest(BaseModel):
    desired_role: str = Field(..., pattern="^(creator|mentor)$")
    full_name: str | None = None
    city: str | None = None
    years_experience: int | None = None
    phone: str | None = None
    about: str | None = None
    details: dict[str, Any] = Field(default_factory=dict)


class OnboardingReviewRequest(BaseModel):
    action: str = Field(..., pattern="^(approve|reject)$")
    reviewer_note: str | None = None


def _rows(response: Any) -> list[dict[str, Any]]:
    data = getattr(response, "data", None)
    if isinstance(data, list):
        return data
    if isinstance(data, dict):
        return [data]
    return []


def _first(response: Any) -> dict[str, Any] | None:
    rows = _rows(response)
    return rows[0] if rows else None


def _safe_float(value: Any, default: float = 0.0) -> float:
    try:
        return float(value)
    except (TypeError, ValueError):
        return default


def _safe_int(value: Any, default: int = 0) -> int:
    try:
        return int(value)
    except (TypeError, ValueError):
        return default


def _normalize_text(value: Any) -> str:
    return str(value or "").strip()


def _as_dict(value: Any) -> dict[str, Any]:
    return value if isinstance(value, dict) else {}


def _normalize_string_list(value: Any) -> list[str]:
    if not isinstance(value, list):
        return []
    output: list[str] = []
    for item in value:
        normalized = _normalize_text(item)
        if normalized and normalized not in output:
            output.append(normalized)
    return output


def _normalize_int_list(value: Any) -> list[int]:
    if not isinstance(value, list):
        return []
    output: list[int] = []
    for item in value:
        normalized = _safe_int(item)
        if normalized > 0 and normalized not in output:
            output.append(normalized)
    return output


def _parse_datetime(value: Any) -> datetime | None:
    text = _normalize_text(value)
    if not text:
        return None
    normalized = text.replace("Z", "+00:00")
    try:
        parsed = datetime.fromisoformat(normalized)
    except ValueError:
        return None
    if parsed.tzinfo is None:
        return parsed.replace(tzinfo=timezone.utc)
    return parsed


def _iso(value: datetime | None) -> str | None:
    return value.astimezone(timezone.utc).isoformat() if value else None


def _max_dt(*values: Any) -> datetime | None:
    parsed = [value for value in (_parse_datetime(item) for item in values) if value is not None]
    return max(parsed) if parsed else None


def _now_utc() -> datetime:
    return datetime.now(timezone.utc)


def _slugify(value: Any) -> str:
    base = re.sub(r"[^a-z0-9]+", "-", _normalize_text(value).lower()).strip("-")
    if base:
        return base
    return f"item-{int(datetime.now(timezone.utc).timestamp())}"


def _default_onboarding_details() -> dict[str, Any]:
    return {
        "current_occupation": None,
        "professional_headshot": None,
        "upsc_roll_number": None,
        "upsc_years": None,
        "proof_documents": [],
        "mains_written_count": None,
        "interview_faced_count": None,
        "prelims_cleared_count": None,
        "highest_prelims_score": None,
        "optional_subject": None,
        "gs_preferences": [],
        "mentorship_years": None,
        "institute_associations": [],
        "sample_evaluation": None,
        "intro_video_url": None,
        "subject_focus": [],
        "content_experience": None,
        "short_bio": None,
        "preparation_strategy": None,
        "sample_mcqs": [],
    }


def _sanitize_onboarding_asset(value: Any) -> dict[str, Any] | None:
    record = _as_dict(value)
    if not record:
        return None
    return {
        "bucket": _normalize_text(record.get("bucket")) or None,
        "path": _normalize_text(record.get("path")) or None,
        "file_name": _normalize_text(record.get("file_name") or record.get("name")) or None,
        "mime_type": _normalize_text(record.get("mime_type")) or None,
        "size_bytes": _safe_int(record.get("size_bytes")) or None,
        "uploaded_at": _normalize_text(record.get("uploaded_at")) or None,
        "asset_kind": _normalize_text(record.get("asset_kind")) or None,
        "url": _normalize_text(record.get("url")) or None,
    }


def _normalize_onboarding_details(value: Any) -> dict[str, Any]:
    details = _default_onboarding_details()
    raw = _as_dict(value)
    if not raw:
        return details
    for key, default in details.items():
        current = raw.get(key)
        if key in {"proof_documents"}:
            details[key] = [
                asset
                for asset in (_sanitize_onboarding_asset(item) for item in (current if isinstance(current, list) else []))
                if asset
            ]
            continue
        if key in {"professional_headshot", "sample_evaluation"}:
            details[key] = _sanitize_onboarding_asset(current)
            continue
        if key in {"gs_preferences", "institute_associations", "subject_focus"}:
            details[key] = _normalize_string_list(current)
            continue
        if key == "sample_mcqs":
            if isinstance(current, list):
                details[key] = [_as_dict(item) for item in current if isinstance(item, dict)]
            continue
        if isinstance(default, int | float) or key in {
            "mains_written_count",
            "interview_faced_count",
            "prelims_cleared_count",
            "mentorship_years",
        }:
            details[key] = _safe_int(current) if current is not None else None
            continue
        details[key] = current if current is not None else default
    return details


def _desired_role_to_applied_roles(desired_role: str) -> list[str]:
    return ["mains_expert"] if _normalize_text(desired_role).lower() == "mentor" else ["prelims_expert"]


def _applied_roles_to_desired_role(applied_roles: Any, social_links: dict[str, Any] | None = None) -> str:
    meta_role = _normalize_text((social_links or {}).get("compat_desired_role")).lower()
    if meta_role in {"creator", "mentor"}:
        return meta_role
    roles = _normalize_string_list(applied_roles)
    return "mentor" if "mains_expert" in roles and "prelims_expert" not in roles else "creator"


def _map_onboarding_status(value: Any) -> str:
    normalized = _normalize_text(value).lower()
    if normalized == "under_review":
        return "draft"
    if normalized in {"pending", "approved", "rejected"}:
        return normalized
    return "pending"


def _desired_role_to_profile_role(desired_role: str) -> str:
    return "mains_expert" if _normalize_text(desired_role).lower() == "mentor" else "prelims_expert"


def _content_type_to_quiz_domain(content_type: str) -> str:
    normalized = _normalize_text(content_type).lower()
    if normalized == "premium_maths_quiz":
        return "maths"
    if normalized == "premium_passage_quiz":
        return "passage"
    if normalized in {"mains_question_generation", "mains_evaluation"}:
        return "mains"
    if normalized == "premium_gk_quiz":
        return "gk"
    raise HTTPException(status_code=422, detail=f"Unsupported content_type: {content_type}")


def _quiz_domain_to_content_type(quiz_domain: Any, style_profile: dict[str, Any] | None = None) -> str:
    profile = style_profile or {}
    marker = _normalize_text(profile.get("__compat_content_type")).lower()
    if marker in LEGACY_AI_CONTENT_TYPES:
        return marker
    normalized = _normalize_text(quiz_domain).lower()
    if normalized == "maths":
        return "premium_maths_quiz"
    if normalized == "passage":
        return "premium_passage_quiz"
    if normalized == "mains":
        if any(
            key in profile
            for key in ("question_style_instructions", "question_style", "answer_style_instructions", "answer_style")
        ):
            return "mains_question_generation"
        return "mains_evaluation"
    return "premium_gk_quiz"


def _content_type_to_instruction_scope(content_type: str) -> str:
    normalized = _normalize_text(content_type).lower()
    if normalized == "premium_gk_quiz":
        return "gk"
    if normalized == "premium_maths_quiz":
        return "maths"
    if normalized == "premium_passage_quiz":
        return "passage"
    if normalized == "mains_question_generation":
        return "mains"
    if normalized == "mains_evaluation":
        return "evaluation"
    raise HTTPException(status_code=422, detail=f"Unsupported content_type: {content_type}")


def _instruction_scope_to_content_type(scope: Any) -> str:
    normalized = _normalize_text(scope).lower()
    if normalized == "maths":
        return "premium_maths_quiz"
    if normalized == "passage":
        return "premium_passage_quiz"
    if normalized == "mains":
        return "mains_question_generation"
    if normalized == "evaluation":
        return "mains_evaluation"
    return "premium_gk_quiz"


def _parse_instruction_meta(value: Any) -> dict[str, Any]:
    raw = _normalize_text(value)
    if not raw:
        return {}
    try:
        parsed = json.loads(raw)
    except json.JSONDecodeError:
        return {"prompt_template": raw}
    return parsed if isinstance(parsed, dict) else {}


def _serialize_instruction_meta(meta: dict[str, Any]) -> str | None:
    cleaned = {key: value for key, value in meta.items() if value not in (None, "", [], {})}
    if not cleaned:
        return None
    return json.dumps(cleaned)


def _map_exam_row(row: dict[str, Any]) -> dict[str, Any]:
    return {
        "id": _safe_int(row.get("id")),
        "name": row.get("name"),
        "slug": row.get("slug"),
        "exam_type": row.get("exam_type"),
        "description": row.get("description"),
        "logo_url": row.get("logo_url"),
        "is_active": bool(row.get("is_active", True)),
    }


def _clean_style_profile(style_profile: dict[str, Any]) -> dict[str, Any]:
    return {
        key: value
        for key, value in style_profile.items()
        if key not in {"__compat_content_type", "exam_ids"}
    }


def _map_ai_example_analysis_row(
    row: dict[str, Any],
    author_lookup: dict[int, str] | None = None,
) -> dict[str, Any]:
    style_profile = _as_dict(row.get("style_profile"))
    author_id = _safe_int(row.get("author_id"))
    return {
        "id": _safe_int(row.get("id")),
        "title": row.get("title"),
        "description": row.get("description"),
        "tag_level1": row.get("tag_level1"),
        "tag_level2": row.get("tag_level2"),
        "content_type": _quiz_domain_to_content_type(row.get("quiz_domain"), style_profile),
        "style_profile": _clean_style_profile(style_profile),
        "example_questions": _normalize_string_list(row.get("example_questions")),
        "tags": _normalize_string_list(row.get("tags")),
        "exam_ids": _normalize_int_list(style_profile.get("exam_ids")),
        "is_active": bool(row.get("is_active", True)),
        "author_id": (author_lookup or {}).get(author_id) if author_id > 0 else None,
        "created_at": row.get("created_at"),
        "updated_at": row.get("updated_at"),
    }


def _map_instruction_row(row: dict[str, Any]) -> dict[str, Any]:
    meta = _parse_instruction_meta(row.get("user_prompt_template"))
    return {
        "id": _safe_int(row.get("id")),
        "content_type": _instruction_scope_to_content_type(row.get("scope")),
        "ai_provider": _normalize_text(meta.get("ai_provider")) or "gemini",
        "ai_model_name": _normalize_text(meta.get("ai_model_name")) or "gemini-3-flash-preview",
        "system_instructions": _normalize_text(row.get("system_prompt")),
        "input_schema": _as_dict(row.get("input_schema")),
        "example_input": meta.get("example_input"),
        "output_schema": _as_dict(row.get("output_schema")),
        "example_output": _as_dict(meta.get("example_output")),
        "style_analysis_system_prompt": meta.get("style_analysis_system_prompt"),
        "created_at": row.get("created_at"),
        "updated_at": row.get("updated_at"),
    }


def _map_onboarding_application_row(
    row: dict[str, Any],
    profile_lookup: dict[int, dict[str, Any]] | None = None,
) -> dict[str, Any]:
    profile = (profile_lookup or {}).get(_safe_int(row.get("user_id")), {})
    reviewer = (profile_lookup or {}).get(_safe_int(row.get("reviewed_by")), {})
    meta = _as_dict(row.get("social_links"))
    desired_role = _applied_roles_to_desired_role(row.get("applied_roles"), meta)
    details = _normalize_onboarding_details(meta.get("compat_details"))
    phone = _normalize_text(meta.get("compat_phone"))
    return {
        "id": _safe_int(row.get("id")),
        "user_id": _normalize_text(profile.get("auth_user_id")) or str(_safe_int(row.get("user_id"))),
        "email_snapshot": profile.get("email"),
        "desired_role": desired_role,
        "full_name": row.get("full_name") or "Applicant",
        "city": meta.get("compat_city"),
        "years_experience": meta.get("compat_years_experience"),
        "phone": phone or None,
        "phone_link": f"tel:{phone}" if phone else None,
        "about": row.get("bio") or meta.get("compat_about"),
        "details": details,
        "status": _map_onboarding_status(row.get("status")),
        "reviewer_user_id": _normalize_text(reviewer.get("auth_user_id")) or None,
        "reviewer_note": row.get("reviewer_note"),
        "reviewed_at": row.get("reviewed_at"),
        "created_at": row.get("created_at"),
        "updated_at": row.get("updated_at"),
    }


def _load_profile_lookup(profile_ids: list[int]) -> dict[int, dict[str, Any]]:
    relevant_ids = sorted({value for value in profile_ids if value > 0})
    if not relevant_ids:
        return {}
    admin = get_admin_client()
    rows = _rows(admin.table("profiles").select("id,auth_user_id,email,role").in_("id", relevant_ids).execute())
    return {_safe_int(row.get("id")): row for row in rows if _safe_int(row.get("id")) > 0}


def _build_onboarding_payload(
    body: OnboardingApplicationWriteRequest,
    existing: dict[str, Any] | None = None,
    draft: bool = False,
) -> dict[str, Any]:
    existing_meta = _as_dict((existing or {}).get("social_links"))
    merged_details = _normalize_onboarding_details(body.details)
    meta = {
        **existing_meta,
        "compat_desired_role": body.desired_role,
        "compat_city": _normalize_text(body.city) or None,
        "compat_years_experience": body.years_experience,
        "compat_phone": _normalize_text(body.phone) or None,
        "compat_about": body.about,
        "compat_details": merged_details,
    }
    return {
        "applied_roles": _desired_role_to_applied_roles(body.desired_role),
        "full_name": _normalize_text(body.full_name) or (existing or {}).get("full_name") or "Applicant",
        "bio": body.about if body.about is not None else (existing or {}).get("bio"),
        "qualifications": merged_details.get("short_bio"),
        "experience": (
            str(body.years_experience)
            if body.years_experience is not None
            else (existing or {}).get("experience")
        ),
        "sample_work_url": (
            merged_details.get("intro_video_url")
            or _as_dict(merged_details.get("sample_evaluation")).get("url")
            or (existing or {}).get("sample_work_url")
        ),
        "social_links": meta,
        "status": "under_review" if draft else "pending",
    }


def _issue(
    code: str,
    label: str,
    severity: str,
    actor: str,
    detected_at: str | None,
    detail: str | None = None,
    related_type: str | None = None,
    related_id: int | None = None,
) -> dict[str, Any]:
    return {
        "code": code,
        "label": label,
        "severity": severity,
        "actor": actor,
        "related_type": related_type,
        "related_id": related_id,
        "detected_at": detected_at,
        "detail": detail,
    }


def _tracking_time_label(value: Any) -> str | None:
    parsed = _parse_datetime(value)
    return _iso(parsed)


def _load_analysis_author_lookup(rows: list[dict[str, Any]]) -> dict[int, str]:
    author_ids = sorted({_safe_int(row.get("author_id")) for row in rows if _safe_int(row.get("author_id")) > 0})
    if not author_ids:
        return {}
    admin = get_admin_client()
    author_rows = _rows(admin.table("profiles").select("id,auth_user_id").in_("id", author_ids).execute())
    return {
        _safe_int(row.get("id")): _normalize_text(row.get("auth_user_id"))
        for row in author_rows
        if _safe_int(row.get("id")) > 0 and _normalize_text(row.get("auth_user_id"))
    }


def _analysis_matches_content_type(row: dict[str, Any], content_type: str | None) -> bool:
    if not content_type:
        return True
    style_profile = _as_dict(row.get("style_profile"))
    requested = _normalize_text(content_type).lower()
    actual = _quiz_domain_to_content_type(row.get("quiz_domain"), style_profile)
    if actual == requested:
        return True
    if _normalize_text(row.get("quiz_domain")).lower() != "mains":
        return False
    return requested == "mains_evaluation" and "__compat_content_type" not in style_profile


def _content_search_text(item: dict[str, Any]) -> str:
    data = item.get("data") if isinstance(item.get("data"), dict) else {}
    parts: list[str] = [
        _normalize_text(item.get("title")),
        _normalize_text(data.get("question_statement")),
        _normalize_text(data.get("supplementary_statement")),
        _normalize_text(data.get("question_prompt")),
        _normalize_text(data.get("question_text")),
        _normalize_text(data.get("passage_title")),
        _normalize_text(data.get("passage_text")),
        _normalize_text(data.get("source_reference")),
    ]
    questions = data.get("questions")
    if isinstance(questions, list):
        for question in questions:
            if not isinstance(question, dict):
                continue
            parts.extend(
                [
                    _normalize_text(question.get("question_statement")),
                    _normalize_text(question.get("question_text")),
                    _normalize_text(question.get("question_prompt")),
                ]
            )
    return " ".join(part for part in parts if part).lower()


def _content_matches(item: dict[str, Any], needle: str) -> bool:
    if not needle:
        return True
    normalized = needle.strip().lower()
    if not normalized:
        return True
    if normalized.isdigit() and _safe_int(item.get("id")) == int(normalized):
        return True
    return normalized in _content_search_text(item)


def _quiz_item_type(quiz_type: str) -> str:
    return "quiz_maths" if quiz_type == "maths" else "quiz_gk"


def _map_quiz_row(row: dict[str, Any]) -> dict[str, Any]:
    quiz_type = _normalize_text(row.get("quiz_type")).lower() or "gk"
    title = _normalize_text(row.get("title")) or _normalize_text(row.get("question_statement"))[:120]
    return {
        "id": _safe_int(row.get("id")),
        "title": title or None,
        "type": _quiz_item_type(quiz_type),
        "created_at": row.get("created_at"),
        "data": {
            "question_statement": row.get("question_statement"),
            "supp_question_statement": row.get("supp_question_statement"),
            "supplementary_statement": row.get("supp_question_statement"),
            "statements_facts": row.get("statements_facts") or [],
            "statement_facts": row.get("statements_facts") or [],
            "question_prompt": row.get("question_prompt"),
            "options": row.get("options") or [],
            "correct_answer": row.get("correct_answer"),
            "answer": row.get("correct_answer"),
            "explanation": row.get("explanation"),
            "explanation_text": row.get("explanation"),
            "source_reference": None,
        },
    }


def _map_passage_row(row: dict[str, Any], questions: list[dict[str, Any]]) -> dict[str, Any]:
    title = _normalize_text(row.get("passage_title")) or _normalize_text(row.get("title"))[:120]
    mapped_questions: list[dict[str, Any]] = []
    for question in questions:
        mapped_questions.append(
            {
                "question_statement": question.get("question_statement"),
                "supp_question_statement": question.get("supp_question_statement"),
                "supplementary_statement": question.get("supp_question_statement"),
                "statements_facts": question.get("statements_facts") or [],
                "statement_facts": question.get("statements_facts") or [],
                "question_prompt": question.get("question_prompt"),
                "options": question.get("options") or [],
                "correct_answer": question.get("correct_answer"),
                "answer": question.get("correct_answer"),
                "explanation": question.get("explanation"),
                "explanation_text": question.get("explanation"),
            }
        )
    return {
        "id": _safe_int(row.get("id")),
        "title": title or None,
        "type": "quiz_passage",
        "created_at": row.get("created_at"),
        "data": {
            "passage_title": row.get("passage_title"),
            "passage_text": row.get("passage_text"),
            "source_reference": row.get("source_reference"),
            "questions": mapped_questions,
        },
    }


def _map_mains_question_row(row: dict[str, Any]) -> dict[str, Any]:
    title = _normalize_text(row.get("question_text"))[:120]
    return {
        "id": _safe_int(row.get("id")),
        "title": title or None,
        "type": "question",
        "created_at": row.get("created_at"),
        "data": {
            "question_text": row.get("question_text"),
            "answer_approach": row.get("approach"),
            "model_answer": row.get("model_answer"),
            "word_limit": row.get("word_limit"),
            "max_marks": row.get("marks"),
            "source_reference": row.get("source_reference"),
        },
    }


def _sort_content_items(items: list[dict[str, Any]]) -> list[dict[str, Any]]:
    return sorted(
        items,
        key=lambda item: (
            _normalize_text(item.get("created_at")),
            _safe_int(item.get("id")),
        ),
        reverse=True,
    )


def _profile_role_allows_content_management(profile: ProfileRow) -> bool:
    return profile.role in {"admin", "moderator", "prelims_expert", "mains_expert"}


@router.get("/exams")
def list_exams(
    active_only: bool = False,
    _profile: ProfileRow = Depends(require_auth),
):
    admin = get_admin_client()
    query = admin.table("exams").select("*").order("name")
    if active_only:
        query = query.eq("is_active", True)
    rows = _rows(query.execute())
    return [_map_exam_row(row) for row in rows]


@router.post("/exams")
def create_exam(
    body: ExamWriteRequest,
    _profile: ProfileRow = Depends(require_admin),
):
    admin = get_admin_client()
    payload = {
        "name": _normalize_text(body.name),
        "slug": _slugify(body.slug or body.name),
        "exam_type": body.exam_type,
        "description": _normalize_text(body.description) or None,
        "logo_url": _normalize_text(body.logo_url) or None,
        "is_active": body.is_active,
    }
    if not payload["name"]:
        raise HTTPException(status_code=422, detail="Exam name is required.")
    try:
        row = _first(admin.table("exams").insert(payload).execute())
    except Exception as exc:
        raise HTTPException(status_code=400, detail=f"Failed to create exam: {exc}") from exc
    if not row:
        raise HTTPException(status_code=500, detail="Exam create returned no row.")
    return _map_exam_row(row)


@router.put("/exams/{exam_id}")
def update_exam(
    exam_id: int,
    body: ExamWriteRequest,
    _profile: ProfileRow = Depends(require_admin),
):
    admin = get_admin_client()
    existing = _first(admin.table("exams").select("*").eq("id", exam_id).limit(1).execute())
    if not existing:
        raise HTTPException(status_code=404, detail="Exam not found.")

    payload = {
        "name": _normalize_text(body.name),
        "slug": _slugify(body.slug or body.name),
        "exam_type": body.exam_type,
        "description": _normalize_text(body.description) or None,
        "logo_url": _normalize_text(body.logo_url) or None,
        "is_active": body.is_active,
    }
    if not payload["name"]:
        raise HTTPException(status_code=422, detail="Exam name is required.")
    try:
        row = _first(admin.table("exams").update(payload).eq("id", exam_id).execute())
    except Exception as exc:
        raise HTTPException(status_code=400, detail=f"Failed to update exam: {exc}") from exc
    if not row:
        raise HTTPException(status_code=500, detail="Exam update returned no row.")
    return _map_exam_row(row)


@router.delete("/exams/{exam_id}")
def delete_exam(
    exam_id: int,
    _profile: ProfileRow = Depends(require_admin),
):
    admin = get_admin_client()
    existing = _first(admin.table("exams").select("id").eq("id", exam_id).limit(1).execute())
    if not existing:
        raise HTTPException(status_code=404, detail="Exam not found.")
    try:
        admin.table("exams").delete().eq("id", exam_id).execute()
    except Exception as exc:
        raise HTTPException(
            status_code=409,
            detail=f"Exam is linked to other records and cannot be deleted safely: {exc}",
        ) from exc
    return {"id": exam_id, "deleted": True}


@router.get("/ai/example-analyses")
def list_ai_example_analyses(
    content_type: str | None = None,
    include_admin: bool = True,
    limit: int = Query(default=50, ge=1, le=200),
    active_only: bool = True,
    _profile: ProfileRow = Depends(require_auth),
):
    del include_admin
    admin = get_admin_client()
    query = admin.table("ai_example_analyses").select("*").order("updated_at", desc=True).limit(limit)
    if content_type:
        query = query.eq("quiz_domain", _content_type_to_quiz_domain(content_type))
    if active_only:
        query = query.eq("is_active", True)
    rows = _rows(query.execute())
    filtered_rows = [row for row in rows if _analysis_matches_content_type(row, content_type)]
    author_lookup = _load_analysis_author_lookup(filtered_rows)
    items = [_map_ai_example_analysis_row(row, author_lookup) for row in filtered_rows]
    return {"items": items, "total": len(items)}


@router.post("/ai/example-analyses")
def create_ai_example_analysis(
    body: AIExampleAnalysisWriteRequest,
    profile: ProfileRow = Depends(require_auth),
):
    admin = get_admin_client()
    style_profile = {
        **_as_dict(body.style_profile),
        "__compat_content_type": body.content_type,
        "exam_ids": _normalize_int_list(body.exam_ids),
    }
    payload = {
        "title": _normalize_text(body.title),
        "description": _normalize_text(body.description) or None,
        "quiz_domain": _content_type_to_quiz_domain(body.content_type),
        "tag_level1": _normalize_text(body.tag_level1).lower() or None,
        "tag_level2": _normalize_text(body.tag_level2).lower() or None,
        "style_profile": style_profile,
        "example_questions": _normalize_string_list(body.example_questions),
        "tags": _normalize_string_list(body.tags),
        "is_active": body.is_active,
        "author_id": None if profile.is_moderator else profile.id,
    }
    if not payload["title"]:
        raise HTTPException(status_code=422, detail="Analysis title is required.")
    try:
        row = _first(admin.table("ai_example_analyses").insert(payload).execute())
    except Exception as exc:
        raise HTTPException(status_code=400, detail=f"Failed to create analysis: {exc}") from exc
    if not row:
        raise HTTPException(status_code=500, detail="Analysis create returned no row.")
    author_lookup = {profile.id: profile.auth_user_id}
    return _map_ai_example_analysis_row(row, author_lookup)


@router.put("/ai/example-analyses/{analysis_id}")
def update_ai_example_analysis(
    analysis_id: int,
    body: AIExampleAnalysisWriteRequest,
    profile: ProfileRow = Depends(require_auth),
):
    admin = get_admin_client()
    existing = _first(admin.table("ai_example_analyses").select("*").eq("id", analysis_id).limit(1).execute())
    if not existing:
        raise HTTPException(status_code=404, detail="Analysis not found.")

    owner_id = _safe_int(existing.get("author_id"))
    if owner_id > 0 and owner_id != profile.id and not profile.is_moderator:
        raise HTTPException(status_code=403, detail="You can only edit your own saved analyses.")
    if owner_id <= 0 and not profile.is_moderator:
        raise HTTPException(status_code=403, detail="Only admins can edit shared analyses.")

    style_profile = {
        **_as_dict(body.style_profile),
        "__compat_content_type": body.content_type,
        "exam_ids": _normalize_int_list(body.exam_ids),
    }
    payload = {
        "title": _normalize_text(body.title),
        "description": _normalize_text(body.description) or None,
        "quiz_domain": _content_type_to_quiz_domain(body.content_type),
        "tag_level1": _normalize_text(body.tag_level1).lower() or None,
        "tag_level2": _normalize_text(body.tag_level2).lower() or None,
        "style_profile": style_profile,
        "example_questions": _normalize_string_list(body.example_questions),
        "tags": _normalize_string_list(body.tags),
        "is_active": body.is_active,
    }
    if not payload["title"]:
        raise HTTPException(status_code=422, detail="Analysis title is required.")
    try:
        row = _first(admin.table("ai_example_analyses").update(payload).eq("id", analysis_id).execute())
    except Exception as exc:
        raise HTTPException(status_code=400, detail=f"Failed to update analysis: {exc}") from exc
    if not row:
        raise HTTPException(status_code=500, detail="Analysis update returned no row.")
    author_lookup = _load_analysis_author_lookup([row])
    return _map_ai_example_analysis_row(row, author_lookup)


@router.delete("/ai/example-analyses/{analysis_id}")
def delete_ai_example_analysis(
    analysis_id: int,
    profile: ProfileRow = Depends(require_auth),
):
    admin = get_admin_client()
    existing = _first(admin.table("ai_example_analyses").select("id,author_id").eq("id", analysis_id).limit(1).execute())
    if not existing:
        raise HTTPException(status_code=404, detail="Analysis not found.")

    owner_id = _safe_int(existing.get("author_id"))
    if owner_id > 0 and owner_id != profile.id and not profile.is_moderator:
        raise HTTPException(status_code=403, detail="You can only delete your own saved analyses.")
    if owner_id <= 0 and not profile.is_moderator:
        raise HTTPException(status_code=403, detail="Only admins can delete shared analyses.")

    admin.table("ai_example_analyses").delete().eq("id", analysis_id).execute()
    return {"id": analysis_id, "deleted": True}


@router.get("/admin/premium-ai-settings/")
@router.get("/api/v1/admin/premium-ai-settings/")
def list_premium_ai_settings(
    _profile: ProfileRow = Depends(require_admin),
):
    admin = get_admin_client()
    rows = _rows(
        admin.table("ai_instructions")
        .select("*")
        .in_("scope", ["gk", "maths", "passage", "mains", "evaluation"])
        .order("updated_at", desc=True)
        .execute()
    )
    return [_map_instruction_row(row) for row in rows]


@router.post("/admin/premium-ai-settings/")
@router.post("/api/v1/admin/premium-ai-settings/")
def create_premium_ai_setting(
    body: AIInstructionWriteRequest,
    profile: ProfileRow = Depends(require_admin),
):
    data = body.model_dump(exclude_unset=True)
    content_type = _normalize_text(data.get("content_type"))
    if content_type not in LEGACY_AI_CONTENT_TYPES:
        raise HTTPException(status_code=422, detail="A valid content_type is required.")

    payload = {
        "name": content_type,
        "scope": _content_type_to_instruction_scope(content_type),
        "system_prompt": _normalize_text(data.get("system_instructions")),
        "input_schema": data.get("input_schema") or {},
        "output_schema": data.get("output_schema") or {},
        "created_by": profile.id,
        "user_prompt_template": _serialize_instruction_meta(
            {
                "ai_provider": _normalize_text(data.get("ai_provider")) or "gemini",
                "ai_model_name": _normalize_text(data.get("ai_model_name")) or "gemini-3-flash-preview",
                "example_input": data.get("example_input"),
                "example_output": data.get("example_output") or {},
                "style_analysis_system_prompt": data.get("style_analysis_system_prompt"),
            }
        ),
    }
    try:
        row = _first(admin.table("ai_instructions").insert(payload).execute())
    except Exception as exc:
        raise HTTPException(status_code=400, detail=f"Failed to create AI setting: {exc}") from exc
    if not row:
        raise HTTPException(status_code=500, detail="AI setting create returned no row.")
    return _map_instruction_row(row)


@router.put("/admin/premium-ai-settings/{instruction_id}")
@router.put("/api/v1/admin/premium-ai-settings/{instruction_id}")
def update_premium_ai_setting(
    instruction_id: int,
    body: AIInstructionWriteRequest,
    _profile: ProfileRow = Depends(require_admin),
):
    admin = get_admin_client()
    existing = _first(admin.table("ai_instructions").select("*").eq("id", instruction_id).limit(1).execute())
    if not existing:
        raise HTTPException(status_code=404, detail="AI setting not found.")

    data = body.model_dump(exclude_unset=True)
    meta = _parse_instruction_meta(existing.get("user_prompt_template"))

    update_payload: dict[str, Any] = {}
    if "content_type" in data:
        content_type = _normalize_text(data.get("content_type"))
        if content_type not in LEGACY_AI_CONTENT_TYPES:
            raise HTTPException(status_code=422, detail="A valid content_type is required.")
        update_payload["name"] = content_type
        update_payload["scope"] = _content_type_to_instruction_scope(content_type)
    if "system_instructions" in data:
        update_payload["system_prompt"] = _normalize_text(data.get("system_instructions"))
    if "input_schema" in data:
        update_payload["input_schema"] = data.get("input_schema") or {}
    if "output_schema" in data:
        update_payload["output_schema"] = data.get("output_schema") or {}

    for key in ("ai_provider", "ai_model_name", "example_input", "example_output", "style_analysis_system_prompt"):
        if key in data:
            meta[key] = data.get(key)
    if meta:
        update_payload["user_prompt_template"] = _serialize_instruction_meta(meta)

    try:
        row = _first(admin.table("ai_instructions").update(update_payload).eq("id", instruction_id).execute())
    except Exception as exc:
        raise HTTPException(status_code=400, detail=f"Failed to update AI setting: {exc}") from exc
    if not row:
        raise HTTPException(status_code=500, detail="AI setting update returned no row.")
    return _map_instruction_row(row)


@router.delete("/admin/premium-ai-settings/{instruction_id}")
@router.delete("/api/v1/admin/premium-ai-settings/{instruction_id}")
def delete_premium_ai_setting(
    instruction_id: int,
    _profile: ProfileRow = Depends(require_admin),
):
    admin = get_admin_client()
    existing = _first(admin.table("ai_instructions").select("id").eq("id", instruction_id).limit(1).execute())
    if not existing:
        raise HTTPException(status_code=404, detail="AI setting not found.")
    admin.table("ai_instructions").delete().eq("id", instruction_id).execute()
    return {"id": instruction_id, "deleted": True}


@router.get("/onboarding/applications/me")
def list_my_onboarding_applications(profile: ProfileRow = Depends(require_auth)):
    admin = get_admin_client()
    rows = _rows(
        admin.table("creator_applications")
        .select("*")
        .eq("user_id", profile.id)
        .order("updated_at", desc=True)
        .execute()
    )
    profile_lookup = _load_profile_lookup([profile.id] + [_safe_int(row.get("reviewed_by")) for row in rows])
    return [_map_onboarding_application_row(row, profile_lookup) for row in rows]


@router.post("/onboarding/applications/draft")
def save_onboarding_application_draft(
    body: OnboardingApplicationWriteRequest,
    profile: ProfileRow = Depends(require_auth),
):
    admin = get_admin_client()
    existing_rows = _rows(
        admin.table("creator_applications")
        .select("*")
        .eq("user_id", profile.id)
        .order("updated_at", desc=True)
        .execute()
    )
    matching = next(
        (
            row
            for row in existing_rows
            if _applied_roles_to_desired_role(row.get("applied_roles"), _as_dict(row.get("social_links"))) == body.desired_role
        ),
        None,
    )
    payload = _build_onboarding_payload(body, matching, draft=True)
    if matching:
        row = _first(admin.table("creator_applications").update(payload).eq("id", matching["id"]).execute())
    else:
        row = _first(admin.table("creator_applications").insert({"user_id": profile.id, **payload}).execute())
    if not row:
        raise HTTPException(status_code=500, detail="Failed to save onboarding draft.")
    profile_lookup = _load_profile_lookup([profile.id])
    return _map_onboarding_application_row(row, profile_lookup)


@router.post("/onboarding/applications")
def submit_onboarding_application(
    body: OnboardingApplicationWriteRequest,
    profile: ProfileRow = Depends(require_auth),
):
    admin = get_admin_client()
    existing_rows = _rows(
        admin.table("creator_applications")
        .select("*")
        .eq("user_id", profile.id)
        .order("updated_at", desc=True)
        .execute()
    )
    matching = next(
        (
            row
            for row in existing_rows
            if _applied_roles_to_desired_role(row.get("applied_roles"), _as_dict(row.get("social_links"))) == body.desired_role
        ),
        None,
    )
    payload = _build_onboarding_payload(body, matching, draft=False)
    if matching:
        row = _first(admin.table("creator_applications").update(payload).eq("id", matching["id"]).execute())
    else:
        row = _first(admin.table("creator_applications").insert({"user_id": profile.id, **payload}).execute())
    if not row:
        raise HTTPException(status_code=500, detail="Failed to submit onboarding application.")
    profile_lookup = _load_profile_lookup([profile.id])
    return _map_onboarding_application_row(row, profile_lookup)


@router.get("/admin/onboarding/applications")
def list_admin_onboarding_applications(
    status: str = "pending",
    limit: int = Query(default=100, ge=1, le=500),
    _profile: ProfileRow = Depends(require_admin),
):
    admin = get_admin_client()
    rows = _rows(
        admin.table("creator_applications")
        .select("*")
        .order("updated_at", desc=True)
        .limit(limit)
        .execute()
    )
    mapped_status = status if status in {"pending", "approved", "rejected", "all"} else "pending"
    if mapped_status != "all":
        rows = [row for row in rows if _map_onboarding_status(row.get("status")) == mapped_status]
    profile_ids = [_safe_int(row.get("user_id")) for row in rows] + [_safe_int(row.get("reviewed_by")) for row in rows]
    profile_lookup = _load_profile_lookup(profile_ids)
    return [_map_onboarding_application_row(row, profile_lookup) for row in rows]


@router.put("/admin/onboarding/applications/{application_id}/review")
def review_onboarding_application(
    application_id: int,
    body: OnboardingReviewRequest,
    profile: ProfileRow = Depends(require_admin),
):
    admin = get_admin_client()
    existing = _first(admin.table("creator_applications").select("*").eq("id", application_id).limit(1).execute())
    if not existing:
        raise HTTPException(status_code=404, detail="Onboarding application not found.")

    desired_role = _applied_roles_to_desired_role(existing.get("applied_roles"), _as_dict(existing.get("social_links")))
    next_status = "approved" if body.action == "approve" else "rejected"
    row = _first(
        admin.table("creator_applications")
        .update(
            {
                "status": next_status,
                "reviewed_by": profile.id,
                "reviewer_note": body.reviewer_note,
                "reviewed_at": _now_utc().isoformat(),
            }
        )
        .eq("id", application_id)
        .execute()
    )
    if not row:
        raise HTTPException(status_code=500, detail="Failed to update onboarding application.")

    if body.action == "approve":
        applicant_profile = _first(admin.table("profiles").select("id,role").eq("id", _safe_int(existing.get("user_id"))).limit(1).execute())
        if applicant_profile:
            current_role = _normalize_text(applicant_profile.get("role")).lower()
            target_role = _desired_role_to_profile_role(desired_role)
            if current_role in {"", "user", target_role}:
                admin.table("profiles").update({"role": target_role}).eq("id", applicant_profile["id"]).execute()

    profile_lookup = _load_profile_lookup([_safe_int(existing.get("user_id")), profile.id])
    return _map_onboarding_application_row(row, profile_lookup)


@router.get("/lifecycle/tracking")
def get_lifecycle_tracking(
    scope: str = "provider",
    limit_cycles: int = Query(default=250, ge=1, le=1000),
    limit_users: int = Query(default=250, ge=1, le=1000),
    profile: ProfileRow = Depends(require_auth),
):
    admin = get_admin_client()
    normalized_scope = _normalize_text(scope).lower() or "provider"
    if normalized_scope == "all" and not profile.is_moderator:
        raise HTTPException(status_code=403, detail="Requires admin or moderator role for scope=all.")

    series_rows = _rows(admin.table("test_series").select("id,name,creator_id").execute())
    if normalized_scope == "all":
        scoped_series_rows = series_rows
    else:
        scoped_series_rows = [row for row in series_rows if _safe_int(row.get("creator_id")) == profile.id]
    scoped_series_ids = {_safe_int(row.get("id")) for row in scoped_series_rows if _safe_int(row.get("id")) > 0}
    series_title_map = {_safe_int(row.get("id")): row.get("name") for row in series_rows if _safe_int(row.get("id")) > 0}

    access_rows = _rows(
        admin.table("user_content_access")
        .select("user_id,test_series_id,is_active,expires_at")
        .eq("access_type", "test_series")
        .execute()
    )
    access_rows = [
        row
        for row in access_rows
        if _safe_int(row.get("user_id")) > 0
        and (
            normalized_scope == "all"
            or _safe_int(row.get("test_series_id")) in scoped_series_ids
        )
    ]

    attempt_rows = _rows(admin.table("test_attempts").select("id,user_id,test_series_id,attempt_timestamp").execute())
    attempt_rows = [
        row
        for row in attempt_rows
        if _safe_int(row.get("user_id")) > 0
        and (
            normalized_scope == "all"
            or _safe_int(row.get("test_series_id")) in scoped_series_ids
        )
    ]

    copy_rows = _rows(
        admin.table("mains_test_copy_submissions")
        .select("id,user_id,series_id,status,submitted_at,updated_at,total_marks,checked_copy_pdf_url")
        .execute()
    )
    copy_rows = [
        row
        for row in copy_rows
        if _safe_int(row.get("user_id")) > 0
        and (
            normalized_scope == "all"
            or _safe_int(row.get("series_id")) in scoped_series_ids
        )
    ]

    request_rows = _rows(
        admin.table("mentorship_requests")
        .select("id,user_id,mentor_id,series_id,preferred_mode,note,status,scheduled_slot_id,requested_at,updated_at")
        .execute()
    )
    request_rows = [
        row
        for row in request_rows
        if _safe_int(row.get("user_id")) > 0
        and (
            normalized_scope == "all"
            or _safe_int(row.get("series_id")) in scoped_series_ids
            or _safe_int(row.get("mentor_id")) == profile.id
        )
    ]

    session_rows = _rows(
        admin.table("mentorship_sessions")
        .select("id,request_id,slot_id,mentor_id,user_id,mode,starts_at,ends_at,meeting_link,status,updated_at")
        .execute()
    )
    request_id_set = {_safe_int(row.get("id")) for row in request_rows if _safe_int(row.get("id")) > 0}
    session_rows = [
        row
        for row in session_rows
        if _safe_int(row.get("request_id")) in request_id_set
    ]
    session_by_request = {_safe_int(row.get("request_id")): row for row in session_rows if _safe_int(row.get("request_id")) > 0}

    slot_rows = _rows(admin.table("mentorship_slots").select("id,mode,starts_at").execute())
    slot_by_id = {_safe_int(row.get("id")): row for row in slot_rows if _safe_int(row.get("id")) > 0}

    relevant_profile_ids = set()
    for row in access_rows:
        relevant_profile_ids.add(_safe_int(row.get("user_id")))
    for row in attempt_rows:
        relevant_profile_ids.add(_safe_int(row.get("user_id")))
    for row in copy_rows:
        relevant_profile_ids.add(_safe_int(row.get("user_id")))
    for row in request_rows:
        relevant_profile_ids.add(_safe_int(row.get("user_id")))
        relevant_profile_ids.add(_safe_int(row.get("mentor_id")))
    profile_lookup = _load_profile_lookup(list(relevant_profile_ids))

    user_accumulator: dict[int, dict[str, Any]] = {}

    def ensure_user_row(user_profile_id: int) -> dict[str, Any]:
        row = user_accumulator.get(user_profile_id)
        if row is None:
            profile_row = profile_lookup.get(user_profile_id, {})
            row = {
                "user_id": _normalize_text(profile_row.get("auth_user_id")) or str(user_profile_id),
                "series_ids": set(),
                "attempted_tests": 0,
                "copy_submissions": 0,
                "copy_checked": 0,
                "mentorship_requests": 0,
                "mentorship_scheduled": 0,
                "mentorship_completed": 0,
                "pending_copy_checks": 0,
                "pending_mentorship": 0,
                "delay_count": 0,
                "technical_issue_count": 0,
                "last_activity_at": None,
                "issues": [],
            }
            user_accumulator[user_profile_id] = row
        return row

    now = _now_utc()

    for row in access_rows:
        user_profile_id = _safe_int(row.get("user_id"))
        if user_profile_id <= 0:
            continue
        bucket = ensure_user_row(user_profile_id)
        series_id = _safe_int(row.get("test_series_id"))
        if series_id > 0:
            bucket["series_ids"].add(series_id)
        bucket["last_activity_at"] = _max_dt(bucket["last_activity_at"], row.get("expires_at"))

    for row in attempt_rows:
        user_profile_id = _safe_int(row.get("user_id"))
        if user_profile_id <= 0:
            continue
        bucket = ensure_user_row(user_profile_id)
        bucket["attempted_tests"] += 1
        bucket["last_activity_at"] = _max_dt(bucket["last_activity_at"], row.get("attempt_timestamp"))

    for row in copy_rows:
        user_profile_id = _safe_int(row.get("user_id"))
        if user_profile_id <= 0:
            continue
        bucket = ensure_user_row(user_profile_id)
        bucket["copy_submissions"] += 1
        status_value = _normalize_text(row.get("status")).lower()
        submitted_at = _parse_datetime(row.get("submitted_at"))
        if status_value in {"evaluated", "returned"} or row.get("total_marks") is not None or bool(row.get("checked_copy_pdf_url")):
            bucket["copy_checked"] += 1
        else:
            bucket["pending_copy_checks"] += 1
            if submitted_at and (now - submitted_at).total_seconds() > 72 * 3600:
                bucket["delay_count"] += 1
        bucket["last_activity_at"] = _max_dt(bucket["last_activity_at"], row.get("submitted_at"), row.get("updated_at"))

    mentorship_cycles: list[dict[str, Any]] = []
    for row in sorted(
        request_rows,
        key=lambda item: _normalize_text(item.get("requested_at")),
        reverse=True,
    )[:limit_cycles]:
        request_id = _safe_int(row.get("id"))
        user_profile_id = _safe_int(row.get("user_id"))
        mentor_profile_id = _safe_int(row.get("mentor_id"))
        session = session_by_request.get(request_id, {})
        slot = slot_by_id.get(_safe_int(row.get("scheduled_slot_id")), {})
        user_bucket = ensure_user_row(user_profile_id) if user_profile_id > 0 else None
        requested_at = _parse_datetime(row.get("requested_at"))
        issues: list[dict[str, Any]] = []

        status_value = _normalize_text(row.get("status")).lower() or "requested"
        if user_bucket is not None:
            user_bucket["mentorship_requests"] += 1
        if status_value in {"scheduled", "completed"} and user_bucket is not None:
            user_bucket["mentorship_scheduled"] += 1
        if status_value == "completed" and user_bucket is not None:
            user_bucket["mentorship_completed"] += 1
        if status_value in {"requested", "scheduled"} and user_bucket is not None:
            user_bucket["pending_mentorship"] += 1

        if status_value == "requested" and requested_at and (now - requested_at).total_seconds() > 48 * 3600:
            issues.append(
                _issue(
                    "mentorship_delay",
                    "Mentorship request pending too long",
                    "warning",
                    "mentor",
                    _iso(requested_at),
                    "Request has been pending for more than 48 hours.",
                    "mentorship_request",
                    request_id,
                )
            )
            if user_bucket is not None:
                user_bucket["delay_count"] += 1

        if status_value == "scheduled" and not session:
            issues.append(
                _issue(
                    "session_missing",
                    "Scheduled request has no session",
                    "critical",
                    "system",
                    _tracking_time_label(row.get("updated_at") or row.get("requested_at")),
                    "The request is scheduled but no mentorship session record exists.",
                    "mentorship_request",
                    request_id,
                )
            )
            if user_bucket is not None:
                user_bucket["technical_issue_count"] += 1

        if session and not _normalize_text(session.get("meeting_link")) and _normalize_text(session.get("status")).lower() == "scheduled":
            issues.append(
                _issue(
                    "meeting_link_missing",
                    "Scheduled session missing meeting link",
                    "warning",
                    "system",
                    _tracking_time_label(session.get("starts_at") or session.get("updated_at")),
                    "Learner may not be able to join the mentorship session.",
                    "mentorship_session",
                    _safe_int(session.get("id")),
                )
            )
            if user_bucket is not None:
                user_bucket["technical_issue_count"] += 1

        timeline = [
            {
                "key": "requested",
                "label": "Request submitted",
                "at": row.get("requested_at"),
                "actor": "user",
                "detail": row.get("note"),
            }
        ]
        scheduled_for = session.get("starts_at") or slot.get("starts_at")
        if scheduled_for:
            timeline.append(
                {
                    "key": "scheduled",
                    "label": "Session scheduled",
                    "at": scheduled_for,
                    "actor": "mentor",
                    "detail": None,
                }
            )
        if _normalize_text(session.get("status")).lower() == "completed":
            timeline.append(
                {
                    "key": "completed",
                    "label": "Session completed",
                    "at": session.get("updated_at"),
                    "actor": "mentor",
                    "detail": session.get("summary"),
                }
            )

        mentorship_cycles.append(
            {
                "request_id": request_id,
                "user_id": _normalize_text(profile_lookup.get(user_profile_id, {}).get("auth_user_id")) or str(user_profile_id),
                "provider_user_id": _normalize_text(profile_lookup.get(mentor_profile_id, {}).get("auth_user_id")) or str(mentor_profile_id),
                "series_id": _safe_int(row.get("series_id")) or None,
                "series_title": series_title_map.get(_safe_int(row.get("series_id"))),
                "test_collection_id": None,
                "test_title": None,
                "request_status": status_value,
                "session_status": _normalize_text(session.get("status")).lower() or None,
                "workflow_stage": (
                    "completed"
                    if status_value == "completed"
                    else "scheduled"
                    if status_value == "scheduled"
                    else "cancelled"
                    if status_value in {"cancelled", "rejected"}
                    else "submitted"
                ),
                "booking_open": status_value == "scheduled",
                "requested_at": row.get("requested_at"),
                "accepted_at": None,
                "feedback_ready_at": None,
                "booking_opened_at": scheduled_for,
                "scheduled_for": scheduled_for,
                "completed_at": session.get("updated_at") if _normalize_text(session.get("status")).lower() == "completed" else None,
                "join_available": bool(_normalize_text(session.get("meeting_link"))),
                "slot_id": _safe_int(row.get("scheduled_slot_id")) or None,
                "slot_mode": (
                    "video"
                    if _normalize_text(slot.get("mode") or row.get("preferred_mode")).lower() == "video"
                    else "audio"
                ),
                "note": row.get("note"),
                "timeline": timeline,
                "issues": issues,
            }
        )
        if user_bucket is not None:
            user_bucket["last_activity_at"] = _max_dt(
                user_bucket["last_activity_at"],
                row.get("requested_at"),
                row.get("updated_at"),
                session.get("updated_at"),
                scheduled_for,
            )

    user_rows = []
    for bucket in user_accumulator.values():
        issues: list[dict[str, Any]] = []
        if bucket["pending_copy_checks"] > 0:
            issues.append(
                _issue(
                    "pending_copy_checks",
                    "Pending copy checks",
                    "warning",
                    "mentor",
                    _iso(bucket["last_activity_at"]),
                    f"{bucket['pending_copy_checks']} mains submissions are still pending review.",
                )
            )
        if bucket["pending_mentorship"] > 0:
            issues.append(
                _issue(
                    "pending_mentorship",
                    "Pending mentorship",
                    "info",
                    "mentor",
                    _iso(bucket["last_activity_at"]),
                    f"{bucket['pending_mentorship']} mentorship requests are still open.",
                )
            )
        if bucket["delay_count"] > 0:
            issues.append(
                _issue(
                    "delayed_items",
                    "Delayed workflow items",
                    "critical" if bucket["delay_count"] > 1 else "warning",
                    "system",
                    _iso(bucket["last_activity_at"]),
                    f"{bucket['delay_count']} items have crossed the delay threshold.",
                )
            )
        if bucket["technical_issue_count"] > 0:
            issues.append(
                _issue(
                    "technical_issues",
                    "Technical workflow issues",
                    "warning",
                    "system",
                    _iso(bucket["last_activity_at"]),
                    f"{bucket['technical_issue_count']} technical issues were detected.",
                )
            )

        user_rows.append(
            {
                "user_id": bucket["user_id"],
                "enrolled_series_count": len(bucket["series_ids"]),
                "attempted_tests": bucket["attempted_tests"],
                "copy_submissions": bucket["copy_submissions"],
                "copy_checked": bucket["copy_checked"],
                "mentorship_requests": bucket["mentorship_requests"],
                "mentorship_scheduled": bucket["mentorship_scheduled"],
                "mentorship_completed": bucket["mentorship_completed"],
                "pending_copy_checks": bucket["pending_copy_checks"],
                "pending_mentorship": bucket["pending_mentorship"],
                "delay_count": bucket["delay_count"],
                "technical_issue_count": bucket["technical_issue_count"],
                "last_activity_at": _iso(bucket["last_activity_at"]),
                "issues": issues,
            }
        )

    user_rows = sorted(
        user_rows,
        key=lambda item: (
            _safe_int(item.get("delay_count")),
            _safe_int(item.get("technical_issue_count")),
            _normalize_text(item.get("last_activity_at")),
        ),
        reverse=True,
    )[:limit_users]

    mentorship_cycles = mentorship_cycles[:limit_cycles]
    summary = {
        "users": len(user_rows),
        "mentorship_cycles": len(mentorship_cycles),
        "pending_mentorship": sum(1 for row in mentorship_cycles if row.get("request_status") in {"requested", "scheduled"}),
        "scheduled_mentorship": sum(1 for row in mentorship_cycles if row.get("request_status") == "scheduled"),
        "completed_mentorship": sum(1 for row in mentorship_cycles if row.get("request_status") == "completed"),
        "pending_copy_checks": sum(_safe_int(row.get("pending_copy_checks")) for row in user_rows),
        "delayed_items": sum(_safe_int(row.get("delay_count")) for row in user_rows),
        "technical_issues": sum(_safe_int(row.get("technical_issue_count")) for row in user_rows),
    }

    return {
        "generated_at": _now_utc().isoformat(),
        "summary": summary,
        "mentorship_cycles": mentorship_cycles,
        "user_rows": user_rows,
    }


@router.get("/content")
def list_content(
    collection_id: int | None = None,
    quiz_kind: str | None = None,
    search: str | None = None,
    limit: int = Query(default=200, ge=1, le=1000),
    profile: ProfileRow = Depends(require_auth),
):
    if not _profile_role_allows_content_management(profile):
        raise HTTPException(status_code=403, detail="Requires creator access.")

    admin = get_admin_client()
    normalized_kind = _normalize_text(quiz_kind).lower()
    candidate_limit = min(max(limit * 3, limit), 300)
    items: list[dict[str, Any]] = []

    if collection_id is not None:
        item_rows = _rows(
            admin.table("premium_collection_items")
            .select("*")
            .eq("premium_collection_id", collection_id)
            .order("order_index")
            .execute()
        )
        quiz_ids = sorted({_safe_int(row.get("quiz_id")) for row in item_rows if _safe_int(row.get("quiz_id")) > 0})
        passage_ids = sorted(
            {_safe_int(row.get("passage_quiz_id")) for row in item_rows if _safe_int(row.get("passage_quiz_id")) > 0}
        )
        mains_ids = sorted(
            {_safe_int(row.get("mains_question_id")) for row in item_rows if _safe_int(row.get("mains_question_id")) > 0}
        )

        quiz_map: dict[int, dict[str, Any]] = {}
        if quiz_ids:
            for row in _rows(admin.table("quizzes").select("*").in_("id", quiz_ids).execute()):
                quiz_map[_safe_int(row.get("id"))] = _map_quiz_row(row)

        passage_questions_by_id: dict[int, list[dict[str, Any]]] = {}
        if passage_ids:
            passage_question_rows = _rows(
                admin.table("passage_questions")
                .select("*")
                .in_("passage_quiz_id", passage_ids)
                .order("display_order")
                .execute()
            )
            for row in passage_question_rows:
                passage_id = _safe_int(row.get("passage_quiz_id"))
                passage_questions_by_id.setdefault(passage_id, []).append(row)
            for row in _rows(admin.table("passage_quizzes").select("*").in_("id", passage_ids).execute()):
                passage_id = _safe_int(row.get("id"))
                items.append(_map_passage_row(row, passage_questions_by_id.get(passage_id, [])))

        mains_map: dict[int, dict[str, Any]] = {}
        if mains_ids:
            for row in _rows(admin.table("mains_questions").select("*").in_("id", mains_ids).execute()):
                mains_map[_safe_int(row.get("id"))] = _map_mains_question_row(row)

        ordered_items: list[dict[str, Any]] = []
        for row in item_rows:
            item_type = _normalize_text(row.get("item_type")).lower()
            if item_type == "passage_quiz":
                passage_id = _safe_int(row.get("passage_quiz_id"))
                passage_item = next(
                    (item for item in items if item.get("id") == passage_id and item.get("type") == "quiz_passage"),
                    None,
                )
                if passage_item:
                    ordered_items.append(passage_item)
                continue
            if item_type in {"gk_quiz", "maths_quiz"}:
                mapped = quiz_map.get(_safe_int(row.get("quiz_id")))
                if mapped:
                    ordered_items.append(mapped)
                continue
            if item_type == "mains_question":
                mapped = mains_map.get(_safe_int(row.get("mains_question_id")))
                if mapped:
                    ordered_items.append(mapped)
        items = ordered_items

    if normalized_kind == "gk":
        items = [item for item in items if item.get("type") == "quiz_gk"]
    elif normalized_kind == "maths":
        items = [item for item in items if item.get("type") == "quiz_maths"]
    elif normalized_kind == "passage":
        items = [item for item in items if item.get("type") == "quiz_passage"]
    elif normalized_kind == "mains":
        items = [item for item in items if item.get("type") == "question"]
    else:
        if normalized_kind in {"", "gk", "maths"}:
            quiz_query = admin.table("quizzes").select("*").order("created_at", desc=True).limit(candidate_limit)
            if normalized_kind in {"gk", "maths"}:
                quiz_query = quiz_query.eq("quiz_type", normalized_kind)
            items.extend(_map_quiz_row(row) for row in _rows(quiz_query.execute()))

        if normalized_kind in {"", "passage"}:
            passage_rows = _rows(
                admin.table("passage_quizzes")
                .select("*")
                .order("created_at", desc=True)
                .limit(candidate_limit)
                .execute()
            )
            passage_ids = [_safe_int(row.get("id")) for row in passage_rows if _safe_int(row.get("id")) > 0]
            passage_questions_by_id: dict[int, list[dict[str, Any]]] = {}
            if passage_ids:
                for row in _rows(
                    admin.table("passage_questions")
                    .select("*")
                    .in_("passage_quiz_id", passage_ids)
                    .order("display_order")
                    .execute()
                ):
                    passage_id = _safe_int(row.get("passage_quiz_id"))
                    passage_questions_by_id.setdefault(passage_id, []).append(row)
            items.extend(
                _map_passage_row(row, passage_questions_by_id.get(_safe_int(row.get("id")), []))
                for row in passage_rows
            )

        if normalized_kind in {"", "mains"}:
            items.extend(
                _map_mains_question_row(row)
                for row in _rows(
                    admin.table("mains_questions")
                    .select("*")
                    .order("created_at", desc=True)
                    .limit(candidate_limit)
                    .execute()
                )
            )

    filtered = [item for item in items if _content_matches(item, search or "")]
    return [
        {
            "id": item["id"],
            "title": item.get("title"),
            "type": item.get("type"),
            "data": item.get("data"),
        }
        for item in _sort_content_items(filtered)[:limit]
    ]


@router.get("/user/progress")
def get_user_progress(profile: ProfileRow = Depends(require_auth)):
    admin = get_admin_client()

    attempt_rows = _rows(
        admin.table("test_attempts")
        .select("*")
        .eq("user_id", profile.id)
        .order("attempt_timestamp", desc=True)
        .limit(20)
        .execute()
    )
    attempt_ids = [_safe_int(row.get("id")) for row in attempt_rows if _safe_int(row.get("id")) > 0]
    result_map: dict[int, dict[str, Any]] = {}
    if attempt_ids:
        for row in _rows(admin.table("test_results").select("*").in_("attempt_id", attempt_ids).execute()):
            result_map[_safe_int(row.get("attempt_id"))] = row

    quiz_attempts = []
    for row in attempt_rows:
        attempt_id = _safe_int(row.get("id"))
        result = result_map.get(attempt_id, {})
        quiz_attempts.append(
            {
                "id": attempt_id,
                "collection_id": _safe_int(row.get("premium_collection_id")),
                "score": _safe_float(result.get("score")),
                "total_questions": _safe_int(result.get("total_questions")),
                "correct_answers": _safe_int(result.get("correct_answers")),
                "incorrect_answers": _safe_int(result.get("incorrect_answers")),
                "unanswered": _safe_int(result.get("unanswered")),
                "created_at": result.get("completed_at") or row.get("attempt_timestamp"),
            }
        )

    evaluation_rows = _rows(
        admin.table("user_mains_evaluations")
        .select("*")
        .eq("user_id", profile.id)
        .order("created_at", desc=True)
        .limit(20)
        .execute()
    )
    mains_evaluations = [
        {
            "id": _safe_int(row.get("id")),
            "question_text": row.get("question_text"),
            "score": _safe_float(row.get("ai_score")),
            "max_score": _safe_float(row.get("ai_max_score"), 10.0),
            "created_at": row.get("created_at"),
        }
        for row in evaluation_rows
    ]

    return {
        "quiz_attempts": quiz_attempts,
        "mains_evaluations": mains_evaluations,
    }


@router.get("/user/weak-areas")
def get_user_weak_areas(profile: ProfileRow = Depends(require_auth)):
    admin = get_admin_client()
    weak_rows = _rows(
        admin.table("user_weak_areas")
        .select("*")
        .eq("user_id", profile.id)
        .order("generated_at", desc=True)
        .limit(20)
        .execute()
    )
    if not weak_rows:
        return []

    category_ids = sorted({_safe_int(row.get("category_id")) for row in weak_rows if _safe_int(row.get("category_id")) > 0})
    category_map: dict[int, dict[str, Any]] = {}
    if category_ids:
        for row in _rows(admin.table("categories").select("id,name,domain").in_("id", category_ids).execute()):
            category_map[_safe_int(row.get("id"))] = row

    count_map: dict[tuple[int, str], int] = {}
    if category_ids:
        snapshot_rows = _rows(
            admin.table("user_performance_snapshots")
            .select("category_id,quiz_domain,incorrect_count")
            .eq("user_id", profile.id)
            .in_("category_id", category_ids)
            .execute()
        )
        for row in snapshot_rows:
            key = (_safe_int(row.get("category_id")), _normalize_text(row.get("quiz_domain")).lower())
            count_map[key] = max(count_map.get(key, 0), _safe_int(row.get("incorrect_count"), 1))

    output = []
    for row in weak_rows:
        category_id = _safe_int(row.get("category_id"))
        quiz_domain = _normalize_text(row.get("quiz_domain")).lower()
        category = category_map.get(category_id, {})
        output.append(
            {
                "id": category_id,
                "name": category.get("name") or f"Category {category_id}",
                "type": quiz_domain or category.get("domain") or "unknown",
                "count": max(1, count_map.get((category_id, quiz_domain), 1)),
            }
        )
    return output


@router.get("/users/me/mains-performance-report")
def get_mains_performance_report(
    series_id: int | None = None,
    profile: ProfileRow = Depends(require_auth),
):
    admin = get_admin_client()
    query = (
        admin.table("mains_test_copy_submissions")
        .select("*")
        .eq("user_id", profile.id)
        .order("submitted_at", desc=True)
    )
    if series_id is not None:
        query = query.eq("series_id", series_id)
    submission_rows = _rows(query.execute())
    if not submission_rows:
        return {
            "total_submissions": 0,
            "checked_submissions": 0,
            "average_provider_marks": 0.0,
            "average_ai_score": 0.0,
            "questions": [],
        }

    submission_ids = [_safe_int(row.get("id")) for row in submission_rows if _safe_int(row.get("id")) > 0]
    unit_step_ids = sorted({_safe_int(row.get("unit_step_id")) for row in submission_rows if _safe_int(row.get("unit_step_id")) > 0})

    step_map: dict[int, dict[str, Any]] = {}
    collection_ids: list[int] = []
    if unit_step_ids:
        for row in _rows(
            admin.table("program_unit_steps")
            .select("id,title,collection_id")
            .in_("id", unit_step_ids)
            .execute()
        ):
            step_id = _safe_int(row.get("id"))
            step_map[step_id] = row
            collection_id = _safe_int(row.get("collection_id"))
            if collection_id > 0 and collection_id not in collection_ids:
                collection_ids.append(collection_id)

    collection_map: dict[int, dict[str, Any]] = {}
    if collection_ids:
        for row in _rows(admin.table("premium_collections").select("id,name").in_("id", collection_ids).execute()):
            collection_map[_safe_int(row.get("id"))] = row

    mark_rows = []
    if submission_ids:
        mark_rows = _rows(
            admin.table("mains_test_copy_marks")
            .select("*")
            .in_("submission_id", submission_ids)
            .order("created_at", desc=False)
            .execute()
        )

    checked_submissions = 0
    provider_scores: list[float] = []
    ai_scores: list[float] = []
    submission_map = {_safe_int(row.get("id")): row for row in submission_rows}
    question_rows = []

    for row in submission_rows:
        status = _normalize_text(row.get("status")).lower()
        is_checked = status in {"evaluated", "returned"} or row.get("total_marks") is not None or bool(row.get("checked_copy_pdf_url"))
        if is_checked:
            checked_submissions += 1
        if row.get("total_marks") is not None:
            provider_scores.append(_safe_float(row.get("total_marks")))
        if row.get("ai_score") is not None:
            ai_scores.append(_safe_float(row.get("ai_score")))

    for row in mark_rows:
        submission_id = _safe_int(row.get("submission_id"))
        submission = submission_map.get(submission_id, {})
        step = step_map.get(_safe_int(submission.get("unit_step_id")), {})
        collection_id = _safe_int(step.get("collection_id"))
        collection = collection_map.get(collection_id, {})
        question_rows.append(
            {
                "submission_id": submission_id,
                "test_collection_id": collection_id,
                "test_title": collection.get("name") or step.get("title"),
                "question_item_id": _safe_int(row.get("mains_question_id")) or None,
                "question_number": _safe_int(row.get("question_number")) or None,
                "question_text": row.get("question_text"),
                "marks_awarded": _safe_float(row.get("marks_awarded")),
                "max_marks": _safe_float(row.get("max_marks"), 10.0),
                "submitted_at": submission.get("submitted_at"),
            }
        )

    average_provider_marks = round(sum(provider_scores) / len(provider_scores), 2) if provider_scores else 0.0
    average_ai_score = round(sum(ai_scores) / len(ai_scores), 2) if ai_scores else 0.0

    return {
        "total_submissions": len(submission_rows),
        "checked_submissions": checked_submissions,
        "average_provider_marks": average_provider_marks,
        "average_ai_score": average_ai_score,
        "questions": question_rows,
    }


@router.get("/moderation/activity-summary")
def get_moderation_activity_summary(profile: ProfileRow = Depends(require_admin)):
    admin = get_admin_client()

    series_rows = _rows(admin.table("test_series").select("id,is_active").execute())
    series_ids = [_safe_int(row.get("id")) for row in series_rows if _safe_int(row.get("id")) > 0]
    active_series_count = sum(1 for row in series_rows if bool(row.get("is_active", True)))

    unit_ids: list[int] = []
    if series_ids:
        unit_ids = [
            _safe_int(row.get("id"))
            for row in _rows(admin.table("program_units").select("id").in_("series_id", series_ids).execute())
            if _safe_int(row.get("id")) > 0
        ]

    collection_ids: set[int] = set()
    active_collection_ids: set[int] = set()
    if unit_ids:
        for row in _rows(
            admin.table("program_unit_steps")
            .select("collection_id,is_active")
            .in_("unit_id", unit_ids)
            .eq("step_type", "test")
            .execute()
        ):
            collection_id = _safe_int(row.get("collection_id"))
            if collection_id <= 0:
                continue
            collection_ids.add(collection_id)
            if bool(row.get("is_active", True)):
                active_collection_ids.add(collection_id)

    collection_map: dict[int, bool] = {}
    if collection_ids:
        for row in _rows(admin.table("premium_collections").select("id,is_active").in_("id", list(collection_ids)).execute()):
            collection_map[_safe_int(row.get("id"))] = bool(row.get("is_active", True))

    now_iso = datetime.now(timezone.utc).isoformat()
    active_enrollments = 0
    if series_ids:
        for row in _rows(
            admin.table("user_content_access")
            .select("test_series_id,expires_at,is_active")
            .eq("access_type", "test_series")
            .in_("test_series_id", series_ids)
            .execute()
        ):
            if not bool(row.get("is_active", True)):
                continue
            expires_at = _normalize_text(row.get("expires_at"))
            if expires_at and expires_at < now_iso:
                continue
            active_enrollments += 1

    copy_rows = _rows(admin.table("mains_test_copy_submissions").select("id,status").execute())
    pending_copy_checks = sum(
        1 for row in copy_rows if _normalize_text(row.get("status")).lower() not in {"evaluated", "returned"}
    )

    mentorship_rows = _rows(admin.table("mentorship_requests").select("id,status").execute())
    mentorship_pending = sum(
        1
        for row in mentorship_rows
        if _normalize_text(row.get("status")).lower() in {"requested", "scheduled"}
    )

    return {
        "series_count": len(series_ids),
        "active_series_count": active_series_count,
        "test_count": len(collection_ids),
        "active_test_count": sum(1 for collection_id in active_collection_ids if collection_map.get(collection_id, True)),
        "active_enrollments": active_enrollments,
        "copy_submissions_total": len(copy_rows),
        "pending_copy_checks": pending_copy_checks,
        "mentorship_requests_total": len(mentorship_rows),
        "mentorship_pending_requests": mentorship_pending,
    }


MENTORSHIP_REQUEST_STATUSES = {
    "requested",
    "accepted",
    "scheduled",
    "rejected",
    "expired",
    "cancelled",
    "completed",
}
MENTORSHIP_PAYMENT_STATUSES = {
    "not_initiated",
    "pending",
    "paid",
    "failed",
    "refunded",
}
MENTORSHIP_SESSION_STATUSES = {
    "scheduled",
    "live",
    "completed",
    "cancelled",
}
MENTORSHIP_WORKFLOW_STAGES = {
    "submitted",
    "accepted",
    "payment_pending",
    "paid",
    "evaluating",
    "feedback_ready",
    "booking_open",
    "scheduled",
    "live",
    "completed",
    "cancelled",
    "expired",
}
MENTORSHIP_ACTIVE_REQUEST_STATUSES = {"requested", "accepted", "scheduled"}
MENTORSHIP_TERMINAL_REQUEST_STATUSES = {"rejected", "expired", "cancelled", "completed"}


class MentorshipRequestCreateRequest(BaseModel):
    series_id: int | None = None
    test_id: int | None = None
    submission_id: int | None = None
    provider_user_id: str | None = None
    slot_id: int | None = None
    preferred_mode: str = Field(default="video", pattern="^(video|audio)$")
    note: str | None = None
    preferred_timing: str | None = None
    service_type: str | None = Field(default=None, pattern="^(mentorship_only|copy_evaluation_and_mentorship)$")
    learner_name: str | None = None
    learner_email: str | None = None
    provider_name: str | None = None


class MentorshipMessageWriteRequest(BaseModel):
    body: str = Field(min_length=1, max_length=4000)


class MentorshipOfferSlotsRequest(BaseModel):
    slot_ids: list[int] = Field(default_factory=list)


class MentorshipScheduleRequest(BaseModel):
    slot_id: int
    call_provider: str | None = Field(default=None, pattern="^(custom|zoom|zoom_video_sdk)$")
    meeting_link: str | None = None


class MentorshipStartNowRequest(BaseModel):
    call_provider: str | None = Field(default=None, pattern="^(custom|zoom|zoom_video_sdk)$")
    meeting_link: str | None = None
    duration_minutes: int = Field(default=45, ge=15, le=180)


class MentorshipStatusUpdateRequest(BaseModel):
    status: str = Field(pattern="^(requested|accepted|scheduled|rejected|expired|cancelled|completed)$")
    reason: str | None = None


class MentorshipPaymentOrderRequest(BaseModel):
    payment_method: str = Field(default="upi", max_length=60)
    coupon_code: str | None = Field(default=None, max_length=60)


class MentorshipPaymentVerifyRequest(BaseModel):
    razorpay_order_id: str = Field(min_length=1, max_length=120)
    razorpay_payment_id: str = Field(min_length=1, max_length=120)
    razorpay_signature: str = Field(min_length=1, max_length=256)
    payment_method: str = Field(default="razorpay", max_length=60)
    coupon_code: str | None = Field(default=None, max_length=60)


def _is_admin_or_moderator_profile(profile: ProfileRow) -> bool:
    return profile.role in {"admin", "moderator"}


def _is_mentor_like_profile(profile: ProfileRow) -> bool:
    return profile.role in {"admin", "moderator", "mains_expert"}


def _mentorship_mode_to_db(value: Any) -> str:
    return "call" if _normalize_text(value).lower() == "audio" else "video"


def _mentorship_mode_to_response(value: Any) -> str:
    return "audio" if _normalize_text(value).lower() in {"audio", "call"} else "video"


def _valid_mentorship_request_status(value: Any) -> str:
    normalized = _normalize_text(value).lower()
    return normalized if normalized in MENTORSHIP_REQUEST_STATUSES else "requested"


def _valid_mentorship_payment_status(value: Any) -> str:
    normalized = _normalize_text(value).lower()
    return normalized if normalized in MENTORSHIP_PAYMENT_STATUSES else "not_initiated"


def _valid_mentorship_session_status(value: Any) -> str:
    normalized = _normalize_text(value).lower()
    return normalized if normalized in MENTORSHIP_SESSION_STATUSES else "scheduled"


def _valid_mentorship_workflow_stage(value: Any) -> str:
    normalized = _normalize_text(value).lower()
    return normalized if normalized in MENTORSHIP_WORKFLOW_STAGES else ""


def _resolve_profile_by_id_or_auth(identifier: Any) -> dict[str, Any] | None:
    normalized = _normalize_text(identifier)
    if not normalized:
        return None
    admin = get_admin_client()
    query = admin.table("profiles").select("*").limit(1)
    row = _first(query.eq("id", _safe_int(normalized)).execute()) if normalized.isdigit() else None
    if row:
        return row
    return _first(admin.table("profiles").select("*").eq("auth_user_id", normalized).limit(1).execute())


def _load_creator_profile(user_id: int) -> dict[str, Any] | None:
    if user_id <= 0:
        return None
    admin = get_admin_client()
    return _first(admin.table("creator_profiles").select("*").eq("user_id", user_id).limit(1).execute())


def _resolve_mentor_price(mentor_id: int) -> float:
    creator_profile = _load_creator_profile(mentor_id) or {}
    social_links = _as_dict(creator_profile.get("social_links"))
    return max(_safe_float(social_links.get("mentorship_price"), 0.0), 0.0)


def _profile_label(profile_row: dict[str, Any] | None, creator_profile: dict[str, Any] | None = None) -> str:
    creator_name = _normalize_text((creator_profile or {}).get("display_name"))
    if creator_name:
        return creator_name
    for key in ("display_name", "full_name", "email"):
        value = _normalize_text((profile_row or {}).get(key))
        if value:
            return value
    return ""


def _request_meta(row: dict[str, Any] | None) -> dict[str, Any]:
    return _as_dict((row or {}).get("meta"))


def _request_submission_id(row: dict[str, Any]) -> int | None:
    value = _safe_int(_request_meta(row).get("submission_id"))
    return value if value > 0 else None


def _request_test_collection_id(row: dict[str, Any]) -> int | None:
    value = _safe_int(_request_meta(row).get("test_collection_id"))
    return value if value > 0 else None


def _request_effective_status(row: dict[str, Any]) -> str:
    meta_status = _valid_mentorship_request_status(_request_meta(row).get("compat_status"))
    if meta_status != "requested" or _normalize_text(_request_meta(row).get("compat_status")).lower() == "requested":
        return meta_status
    base_status = _normalize_text(row.get("status")).lower()
    if base_status == "scheduled":
        return "scheduled"
    if base_status == "completed":
        return "completed"
    if base_status == "cancelled":
        return "cancelled"
    if base_status == "rejected":
        return "rejected"
    return "requested"


def _request_effective_payment_status(row: dict[str, Any]) -> str:
    meta = _request_meta(row)
    if _normalize_text(meta.get("payment_status")):
        return _valid_mentorship_payment_status(meta.get("payment_status"))
    amount = _safe_float(meta.get("payment_amount"), 0.0)
    if amount <= 0 and _request_effective_status(row) in {"scheduled", "completed"}:
        return "paid"
    return "not_initiated"


def _request_workflow_stage(row: dict[str, Any], session_row: dict[str, Any] | None = None) -> str:
    meta = _request_meta(row)
    stored = _valid_mentorship_workflow_stage(meta.get("workflow_stage"))
    if stored:
        return stored
    request_status = _request_effective_status(row)
    payment_status = _request_effective_payment_status(row)
    if request_status == "completed":
        return "completed"
    if request_status in {"cancelled", "rejected"}:
        return "cancelled"
    if request_status == "expired":
        return "expired"
    if _session_effective_status(session_row, row) == "live":
        return "live"
    if request_status == "scheduled":
        return "scheduled"
    if _request_booking_open(row):
        return "booking_open"
    if payment_status == "pending":
        return "payment_pending"
    if payment_status == "paid":
        return "paid"
    if request_status == "accepted":
        return "accepted"
    return "submitted"


def _request_booking_open(row: dict[str, Any]) -> bool:
    status = _request_effective_status(row)
    if status in MENTORSHIP_TERMINAL_REQUEST_STATUSES or status == "scheduled":
        return False
    offered_slot_ids = _request_meta(row).get("offered_slot_ids")
    return isinstance(offered_slot_ids, list) and any(_safe_int(value) > 0 for value in offered_slot_ids)


def _session_meta_from_request(row: dict[str, Any] | None) -> dict[str, Any]:
    return _as_dict(_request_meta(row).get("session"))


def _session_effective_status(session_row: dict[str, Any] | None, request_row: dict[str, Any] | None = None) -> str:
    if not session_row:
        return ""
    session_meta = _session_meta_from_request(request_row)
    compat_status = _valid_mentorship_session_status(session_meta.get("status"))
    if compat_status != "scheduled" or _normalize_text(session_meta.get("status")).lower() == "scheduled":
        return compat_status
    base_status = _normalize_text(session_row.get("status")).lower()
    if base_status == "completed":
        return "completed"
    if base_status in {"cancelled", "no_show"}:
        return "cancelled"
    return "scheduled"


def _request_unread_count(request_id: int, viewer_profile_id: int) -> int:
    if request_id <= 0 or viewer_profile_id <= 0:
        return 0
    admin = get_admin_client()
    rows = _rows(
        admin.table("mentorship_messages")
        .select("id")
        .eq("request_id", request_id)
        .neq("sender_id", viewer_profile_id)
        .eq("is_read", False)
        .execute()
    )
    return len(rows)


def _map_mentorship_request_row(
    row: dict[str, Any],
    profile_lookup: dict[int, dict[str, Any]] | None = None,
    session_row: dict[str, Any] | None = None,
    viewer_profile_id: int | None = None,
) -> dict[str, Any]:
    meta = dict(_request_meta(row))
    user_id = _safe_int(row.get("user_id"))
    mentor_id = _safe_int(row.get("mentor_id"))
    if viewer_profile_id and viewer_profile_id > 0:
        meta["viewer_unread_message_count"] = _request_unread_count(_safe_int(row.get("id")), viewer_profile_id)
    return {
        "id": _safe_int(row.get("id")),
        "user_id": user_id,
        "mentor_id": mentor_id,
        "provider_user_id": str(mentor_id),
        "series_id": _safe_int(row.get("series_id")) or None,
        "test_collection_id": _request_test_collection_id(row),
        "submission_id": _request_submission_id(row),
        "preferred_mode": _mentorship_mode_to_response(row.get("preferred_mode")),
        "note": row.get("note"),
        "preferred_timing": meta.get("preferred_timing"),
        "service_type": _normalize_text(meta.get("service_type")) or (
            "copy_evaluation_and_mentorship" if _request_submission_id(row) else "mentorship_only"
        ),
        "status": _request_effective_status(row),
        "payment_status": _request_effective_payment_status(row),
        "payment_amount": _safe_float(meta.get("payment_amount"), 0.0),
        "payment_currency": _normalize_text(meta.get("payment_currency")) or "INR",
        "accepted_at": _normalize_text(meta.get("accepted_at")) or None,
        "scheduled_slot_id": _safe_int(row.get("scheduled_slot_id")) or None,
        "workflow_stage": _request_workflow_stage(row, session_row),
        "booking_open": _request_booking_open(row),
        "feedback_ready_at": _normalize_text(meta.get("feedback_ready_at")) or None,
        "booking_opened_at": _normalize_text(meta.get("booking_opened_at")) or None,
        "join_available": _session_effective_status(session_row, row) in {"scheduled", "live"},
        "requested_at": row.get("requested_at"),
        "updated_at": row.get("updated_at"),
        "meta": meta,
    }


def _map_mentorship_message_row(row: dict[str, Any]) -> dict[str, Any]:
    return {
        "id": _safe_int(row.get("id")),
        "request_id": _safe_int(row.get("request_id")),
        "sender_user_id": str(_safe_int(row.get("sender_id"))),
        "body": row.get("body") or "",
        "is_read": bool(row.get("is_read", False)),
        "created_at": row.get("created_at"),
    }


def _map_mentorship_session_row(session_row: dict[str, Any], request_row: dict[str, Any]) -> dict[str, Any]:
    session_meta = _session_meta_from_request(request_row)
    mentor_id = _safe_int(session_row.get("mentor_id"))
    return {
        "id": _safe_int(session_row.get("id")),
        "request_id": _safe_int(session_row.get("request_id")),
        "slot_id": _safe_int(session_row.get("slot_id")) or None,
        "mentor_id": mentor_id,
        "provider_user_id": str(mentor_id),
        "user_id": _safe_int(session_row.get("user_id")),
        "mode": _mentorship_mode_to_response(session_row.get("mode")),
        "call_provider": _normalize_text(session_meta.get("call_provider")) or ("custom" if session_row.get("meeting_link") else "zoom_video_sdk"),
        "starts_at": session_row.get("starts_at"),
        "ends_at": session_row.get("ends_at"),
        "meeting_link": session_row.get("meeting_link"),
        "provider_session_id": _normalize_text(session_meta.get("provider_session_id")) or None,
        "provider_host_url": _normalize_text(session_meta.get("provider_host_url")) or None,
        "provider_join_url": _normalize_text(session_meta.get("provider_join_url")) or None,
        "provider_payload": _as_dict(session_meta.get("provider_payload")),
        "provider_error": _normalize_text(session_meta.get("provider_error")) or None,
        "live_started_at": _normalize_text(session_meta.get("live_started_at")) or None,
        "live_ended_at": _normalize_text(session_meta.get("live_ended_at")) or None,
        "copy_attachment_url": session_row.get("copy_attachment_url"),
        "summary": session_row.get("summary"),
        "status": _session_effective_status(session_row, request_row),
        "join_available": _session_effective_status(session_row, request_row) in {"scheduled", "live"},
        "created_at": session_row.get("created_at"),
        "updated_at": session_row.get("updated_at"),
    }


def _load_mentorship_request_or_404(request_id: int) -> dict[str, Any]:
    admin = get_admin_client()
    row = _first(admin.table("mentorship_requests").select("*").eq("id", request_id).limit(1).execute())
    if not row:
        raise HTTPException(status_code=404, detail="Mentorship request not found.")
    return row


def _load_mentorship_session_for_request(request_id: int) -> dict[str, Any] | None:
    admin = get_admin_client()
    return _first(admin.table("mentorship_sessions").select("*").eq("request_id", request_id).limit(1).execute())


def _load_mentorship_slot_or_404(slot_id: int) -> dict[str, Any]:
    admin = get_admin_client()
    row = _first(admin.table("mentorship_slots").select("*").eq("id", slot_id).limit(1).execute())
    if not row:
        raise HTTPException(status_code=404, detail="Mentorship slot not found.")
    return row


def _load_mentorship_slot(slot_id: int) -> dict[str, Any] | None:
    if slot_id <= 0:
        return None
    admin = get_admin_client()
    return _first(admin.table("mentorship_slots").select("*").eq("id", slot_id).limit(1).execute())


def _ensure_mentorship_request_access(profile: ProfileRow, request_row: dict[str, Any], allow_mentor: bool = True) -> None:
    if _is_admin_or_moderator_profile(profile):
        return
    if _safe_int(request_row.get("user_id")) == profile.id:
        return
    if allow_mentor and _safe_int(request_row.get("mentor_id")) == profile.id and _is_mentor_like_profile(profile):
        return
    raise HTTPException(status_code=403, detail="You cannot access this mentorship request.")


def _ensure_slot_available(slot_row: dict[str, Any], mentor_id: int | None = None) -> None:
    if mentor_id and _safe_int(slot_row.get("mentor_id")) != mentor_id:
        raise HTTPException(status_code=400, detail="Selected slot belongs to a different mentor.")
    if not bool(slot_row.get("is_active", True)):
        raise HTTPException(status_code=400, detail="Selected session time is no longer available.")
    ends_at = _parse_datetime(slot_row.get("ends_at"))
    if not ends_at or ends_at <= _now_utc():
        raise HTTPException(status_code=400, detail="Selected session time is no longer available.")
    max_bookings = max(_safe_int(slot_row.get("max_bookings"), 1), 1)
    booked_count = max(_safe_int(slot_row.get("booked_count"), 0), 0)
    if booked_count >= max_bookings:
        raise HTTPException(status_code=400, detail="Selected session time is already fully booked.")


def _increment_slot_booking(slot_row: dict[str, Any]) -> None:
    slot_id = _safe_int(slot_row.get("id"))
    if slot_id <= 0:
        return
    admin = get_admin_client()
    next_count = max(_safe_int(slot_row.get("booked_count"), 0), 0) + 1
    admin.table("mentorship_slots").update({"booked_count": next_count}).eq("id", slot_id).execute()


def _decrement_slot_booking(slot_id: int) -> None:
    if slot_id <= 0:
        return
    admin = get_admin_client()
    current = _first(admin.table("mentorship_slots").select("id,booked_count").eq("id", slot_id).limit(1).execute())
    if not current:
        return
    next_count = max(_safe_int(current.get("booked_count"), 0) - 1, 0)
    admin.table("mentorship_slots").update({"booked_count": next_count}).eq("id", slot_id).execute()


def _persist_request_row(request_id: int, updates: dict[str, Any]) -> dict[str, Any]:
    admin = get_admin_client()
    row = _first(admin.table("mentorship_requests").update(updates).eq("id", request_id).execute())
    if not row:
        raise HTTPException(status_code=404, detail="Mentorship request not found.")
    return row


def _upsert_mentorship_session(
    request_row: dict[str, Any],
    *,
    slot_row: dict[str, Any] | None,
    starts_at: str,
    ends_at: str,
    meeting_link: str | None,
    compat_status: str,
    call_provider: str | None,
    extra_session_meta: dict[str, Any] | None = None,
) -> tuple[dict[str, Any], dict[str, Any]]:
    admin = get_admin_client()
    request_id = _safe_int(request_row.get("id"))
    if request_id <= 0:
        raise HTTPException(status_code=400, detail="Invalid mentorship request.")
    payload = {
        "request_id": request_id,
        "slot_id": _safe_int((slot_row or {}).get("id")) or None,
        "mentor_id": _safe_int(request_row.get("mentor_id")),
        "user_id": _safe_int(request_row.get("user_id")),
        "mode": (slot_row or {}).get("mode") or _mentorship_mode_to_db(request_row.get("preferred_mode")),
        "starts_at": starts_at,
        "ends_at": ends_at,
        "meeting_link": meeting_link,
        "status": "completed" if compat_status == "completed" else ("cancelled" if compat_status == "cancelled" else "scheduled"),
    }
    existing = _load_mentorship_session_for_request(request_id)
    session_row = (
        _first(admin.table("mentorship_sessions").update(payload).eq("id", existing["id"]).execute())
        if existing
        else _first(admin.table("mentorship_sessions").insert(payload).execute())
    )
    if not session_row:
        raise HTTPException(status_code=400, detail="Failed to save mentorship session.")
    meta = _request_meta(request_row)
    previous_session = _session_meta_from_request(request_row)
    next_session = {
        **previous_session,
        "status": compat_status,
        "call_provider": _normalize_text(call_provider) or previous_session.get("call_provider") or ("custom" if meeting_link else "zoom_video_sdk"),
        "provider_join_url": meeting_link or previous_session.get("provider_join_url"),
        "provider_host_url": meeting_link or previous_session.get("provider_host_url"),
        "provider_payload": _as_dict(previous_session.get("provider_payload")),
        "provider_error": None,
        "live_started_at": previous_session.get("live_started_at"),
        "live_ended_at": previous_session.get("live_ended_at"),
    }
    if extra_session_meta:
        next_session.update(extra_session_meta)
    meta["session"] = next_session
    updated_request = _persist_request_row(request_id, {"meta": meta, "updated_at": _now_utc().isoformat()})
    return updated_request, session_row


def _verify_razorpay_signature(order_id: str, payment_id: str, signature: str) -> bool:
    secret = _settings.razorpay_key_secret.encode("utf-8")
    message = f"{order_id}|{payment_id}".encode("utf-8")
    expected = hmac.new(secret, message, hashlib.sha256).hexdigest()
    return hmac.compare_digest(expected, signature)


def _create_mentorship_razorpay_order(amount_minor: int, currency: str, notes: dict[str, str]) -> dict[str, Any]:
    if not _settings.razorpay_key_id or not _settings.razorpay_key_secret:
        raise HTTPException(status_code=503, detail="Razorpay is not configured.")
    client = razorpay.Client(auth=(_settings.razorpay_key_id, _settings.razorpay_key_secret))
    try:
        return client.order.create({"amount": amount_minor, "currency": currency, "notes": notes})
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"Failed to create Razorpay order: {exc}") from exc


@router.post("/mentorship/requests")
async def create_mentorship_request(
    body: MentorshipRequestCreateRequest,
    profile: ProfileRow = Depends(require_auth),
):
    admin = get_admin_client()
    mentor_profile: dict[str, Any] | None = None
    mentor_id = 0
    series_id = body.series_id if body.series_id and body.series_id > 0 else None
    test_collection_id = body.test_id if body.test_id and body.test_id > 0 else None
    submission_row: dict[str, Any] | None = None
    submission_id = body.submission_id if body.submission_id and body.submission_id > 0 else None

    if submission_id:
        submission_row = _first(
            admin.table("mains_test_copy_submissions")
            .select("*")
            .eq("id", submission_id)
            .limit(1)
            .execute()
        )
        if not submission_row:
            raise HTTPException(status_code=404, detail="Copy submission not found.")
        if _safe_int(submission_row.get("user_id")) != profile.id:
            raise HTTPException(status_code=403, detail="Mentorship can only be requested for your own submission.")
        if _normalize_text(submission_row.get("status")).lower() not in {"evaluated", "returned"}:
            raise HTTPException(status_code=400, detail="Mentorship unlocks only after the mentor has checked this submission.")
        series_id = _safe_int(submission_row.get("series_id")) or series_id
        mentor_id = _safe_int(submission_row.get("evaluator_id"))

    if series_id and mentor_id <= 0:
        series_row = _first(admin.table("test_series").select("id,creator_id,name").eq("id", series_id).limit(1).execute())
        if not series_row:
            raise HTTPException(status_code=404, detail="Program not found.")
        mentor_id = _safe_int(series_row.get("creator_id"))
        if mentor_id <= 0:
            raise HTTPException(status_code=400, detail="Could not resolve mentor for this program.")

    if mentor_id <= 0 and body.provider_user_id:
        mentor_profile = _resolve_profile_by_id_or_auth(body.provider_user_id)
        mentor_id = _safe_int((mentor_profile or {}).get("id"))

    if mentor_id <= 0:
        raise HTTPException(status_code=400, detail="Could not resolve mentor for mentorship request.")
    if mentor_id == profile.id:
        raise HTTPException(status_code=400, detail="You cannot create a mentorship request for yourself.")

    mentor_profile = mentor_profile or _first(admin.table("profiles").select("*").eq("id", mentor_id).limit(1).execute())
    if not mentor_profile:
        raise HTTPException(status_code=404, detail="Mentor profile not found.")

    creator_profile = _load_creator_profile(mentor_id) or {}
    payment_amount = _resolve_mentor_price(mentor_id)
    requested_at = _now_utc().isoformat()
    feedback_ready_at = None
    if submission_row and _normalize_text(submission_row.get("status")).lower() in {"evaluated", "returned"}:
        feedback_ready_at = _normalize_text(submission_row.get("evaluated_at")) or requested_at

    existing_rows = _rows(
        admin.table("mentorship_requests")
        .select("*")
        .eq("user_id", profile.id)
        .eq("mentor_id", mentor_id)
        .execute()
    )
    for existing in existing_rows:
        if _request_effective_status(existing) not in MENTORSHIP_ACTIVE_REQUEST_STATUSES:
            continue
        if submission_id and _request_submission_id(existing) == submission_id:
            raise HTTPException(status_code=409, detail="You already have an active mentorship request for this submission.")
        if not submission_id and not _request_submission_id(existing):
            raise HTTPException(status_code=409, detail="You already have an active mentorship request with this mentor.")

    meta = {
        "compat_status": "requested",
        "service_type": body.service_type or ("copy_evaluation_and_mentorship" if submission_id else "mentorship_only"),
        "preferred_timing": body.preferred_timing,
        "submission_id": submission_id,
        "test_collection_id": test_collection_id,
        "learner_name": _normalize_text(body.learner_name) or profile.full_name or None,
        "learner_email": _normalize_text(body.learner_email) or profile.email or None,
        "provider_name": _normalize_text(body.provider_name) or _profile_label(mentor_profile, creator_profile) or None,
        "payment_amount": payment_amount,
        "payment_currency": "INR",
        "payment_status": "not_initiated",
        "feedback_ready_at": feedback_ready_at,
        "workflow_stage": "submitted",
        "created_via": "compat_api",
    }
    insert_payload = {
        "user_id": profile.id,
        "mentor_id": mentor_id,
        "series_id": series_id,
        "preferred_mode": _mentorship_mode_to_db(body.preferred_mode),
        "note": body.note,
        "status": "requested",
        "meta": meta,
    }
    request_row = _first(admin.table("mentorship_requests").insert(insert_payload).execute())
    if not request_row:
        raise HTTPException(status_code=400, detail="Failed to create mentorship request.")

    if body.slot_id and body.slot_id > 0:
        slot_row = _load_mentorship_slot_or_404(body.slot_id)
        _ensure_slot_available(slot_row, mentor_id=mentor_id)
        _increment_slot_booking(slot_row)
        request_meta = _request_meta(request_row)
        request_meta.update(
            {
                "compat_status": "scheduled",
                "accepted_at": requested_at,
                "payment_status": "paid" if payment_amount <= 0 else request_meta.get("payment_status"),
                "workflow_stage": "scheduled",
            }
        )
        request_row = _persist_request_row(
            _safe_int(request_row.get("id")),
            {"scheduled_slot_id": _safe_int(slot_row.get("id")), "status": "scheduled", "meta": request_meta, "updated_at": requested_at},
        )
        request_row, session_row = _upsert_mentorship_session(
            request_row,
            slot_row=slot_row,
            starts_at=_normalize_text(slot_row.get("starts_at")),
            ends_at=_normalize_text(slot_row.get("ends_at")),
            meeting_link=_normalize_text(slot_row.get("meeting_link")) or None,
            compat_status="scheduled",
            call_provider="custom" if _normalize_text(slot_row.get("meeting_link")) else "zoom_video_sdk",
        )
        return _map_mentorship_request_row(request_row, session_row=session_row, viewer_profile_id=profile.id)

    return _map_mentorship_request_row(request_row, viewer_profile_id=profile.id)


@router.get("/mentorship/requests")
async def list_mentorship_requests(
    scope: str = Query(default="me", pattern="^(me|provider|all)$"),
    status: str | None = Query(default=None, pattern="^(requested|accepted|scheduled|rejected|expired|cancelled|completed)$"),
    profile: ProfileRow = Depends(require_auth),
):
    admin = get_admin_client()
    query = admin.table("mentorship_requests").select("*").order("requested_at", desc=True)
    if scope == "provider":
        if not _is_mentor_like_profile(profile):
            raise HTTPException(status_code=403, detail="Provider scope requires mentor, moderator, or admin access.")
        if not _is_admin_or_moderator_profile(profile):
            query = query.eq("mentor_id", profile.id)
    elif scope == "all":
        if not _is_admin_or_moderator_profile(profile):
            raise HTTPException(status_code=403, detail="Only admin/moderator can use all scope.")
    else:
        query = query.eq("user_id", profile.id)

    rows = _rows(query.execute())
    if status:
        rows = [row for row in rows if _request_effective_status(row) == status]
    request_ids = [_safe_int(row.get("id")) for row in rows if _safe_int(row.get("id")) > 0]
    session_rows = (
        _rows(admin.table("mentorship_sessions").select("*").in_("request_id", request_ids).execute()) if request_ids else []
    )
    session_map = {_safe_int(row.get("request_id")): row for row in session_rows if _safe_int(row.get("request_id")) > 0}
    return [
        _map_mentorship_request_row(row, session_row=session_map.get(_safe_int(row.get("id"))), viewer_profile_id=profile.id)
        for row in rows
    ]


@router.get("/mentorship/requests/{request_id}/messages")
async def list_mentorship_request_messages(
    request_id: int,
    profile: ProfileRow = Depends(require_auth),
):
    request_row = _load_mentorship_request_or_404(request_id)
    _ensure_mentorship_request_access(profile, request_row)
    admin = get_admin_client()
    rows = _rows(
        admin.table("mentorship_messages")
        .select("*")
        .eq("request_id", request_id)
        .order("created_at")
        .execute()
    )
    return [_map_mentorship_message_row(row) for row in rows]


@router.post("/mentorship/requests/{request_id}/messages/read")
async def mark_mentorship_request_messages_read(
    request_id: int,
    profile: ProfileRow = Depends(require_auth),
):
    request_row = _load_mentorship_request_or_404(request_id)
    _ensure_mentorship_request_access(profile, request_row)
    admin = get_admin_client()
    unread_rows = _rows(
        admin.table("mentorship_messages")
        .select("id")
        .eq("request_id", request_id)
        .neq("sender_id", profile.id)
        .eq("is_read", False)
        .execute()
    )
    message_ids = [_safe_int(row.get("id")) for row in unread_rows if _safe_int(row.get("id")) > 0]
    if message_ids:
        admin.table("mentorship_messages").update({"is_read": True}).in_("id", message_ids).execute()
    return {"marked_read": len(message_ids)}


@router.post("/mentorship/requests/{request_id}/messages")
async def create_mentorship_request_message(
    request_id: int,
    body: MentorshipMessageWriteRequest,
    profile: ProfileRow = Depends(require_auth),
):
    request_row = _load_mentorship_request_or_404(request_id)
    _ensure_mentorship_request_access(profile, request_row)
    admin = get_admin_client()
    row = _first(
        admin.table("mentorship_messages")
        .insert({"request_id": request_id, "sender_id": profile.id, "body": body.body.strip(), "is_read": False})
        .execute()
    )
    if not row:
        raise HTTPException(status_code=400, detail="Failed to send mentorship message.")
    return _map_mentorship_message_row(row)


@router.post("/mentorship/requests/{request_id}/offer-slots")
async def offer_mentorship_request_slots(
    request_id: int,
    body: MentorshipOfferSlotsRequest,
    profile: ProfileRow = Depends(require_auth),
):
    request_row = _load_mentorship_request_or_404(request_id)
    mentor_id = _safe_int(request_row.get("mentor_id"))
    if not _is_admin_or_moderator_profile(profile):
        if not _is_mentor_like_profile(profile) or mentor_id != profile.id:
            raise HTTPException(status_code=403, detail="Only the assigned mentor can offer slots.")
    request_status = _request_effective_status(request_row)
    if request_status not in {"requested", "accepted"}:
        raise HTTPException(status_code=400, detail="Slots can be offered only for open mentorship workflows.")
    if request_status == "accepted" and _request_effective_payment_status(request_row) != "paid":
        raise HTTPException(status_code=400, detail="Payment must be completed before slot booking opens.")
    slot_ids = sorted({_safe_int(slot_id) for slot_id in body.slot_ids if _safe_int(slot_id) > 0})
    if not slot_ids:
        raise HTTPException(status_code=400, detail="Select at least one mentorship slot to offer.")
    admin = get_admin_client()
    slot_rows = _rows(admin.table("mentorship_slots").select("*").in_("id", slot_ids).execute())
    if len(slot_rows) != len(slot_ids):
        raise HTTPException(status_code=404, detail="One or more mentorship slots were not found.")
    for slot_row in slot_rows:
        _ensure_slot_available(slot_row, mentor_id=mentor_id)
    meta = _request_meta(request_row)
    now_iso = _now_utc().isoformat()
    meta["offered_slot_ids"] = slot_ids
    meta["slot_offer_status"] = "offered"
    meta["booking_opened_at"] = meta.get("booking_opened_at") or now_iso
    meta["workflow_stage"] = "booking_open"
    updated = _persist_request_row(request_id, {"meta": meta, "updated_at": now_iso})
    session_row = _load_mentorship_session_for_request(request_id)
    return _map_mentorship_request_row(updated, session_row=session_row, viewer_profile_id=profile.id)


@router.post("/mentorship/requests/{request_id}/accept-slot")
async def accept_mentorship_request_slot(
    request_id: int,
    body: MentorshipScheduleRequest,
    profile: ProfileRow = Depends(require_auth),
):
    request_row = _load_mentorship_request_or_404(request_id)
    if not _is_admin_or_moderator_profile(profile) and _safe_int(request_row.get("user_id")) != profile.id:
        raise HTTPException(status_code=403, detail="Only the learner can accept an offered slot.")
    request_status = _request_effective_status(request_row)
    if request_status not in {"requested", "accepted"}:
        raise HTTPException(status_code=400, detail="This workflow no longer accepts slot selection.")
    if request_status == "accepted" and _request_effective_payment_status(request_row) != "paid":
        raise HTTPException(status_code=400, detail="Complete payment before selecting a slot.")
    meta = _request_meta(request_row)
    offered_slot_ids = [_safe_int(value) for value in meta.get("offered_slot_ids", []) if _safe_int(value) > 0]
    slot_row = _load_mentorship_slot_or_404(body.slot_id)
    _ensure_slot_available(slot_row, mentor_id=_safe_int(request_row.get("mentor_id")))
    if offered_slot_ids and body.slot_id not in offered_slot_ids:
        raise HTTPException(status_code=400, detail="Selected slot is not available for learner booking.")
    _increment_slot_booking(slot_row)
    now_iso = _now_utc().isoformat()
    meta.update(
        {
            "compat_status": "scheduled",
            "accepted_at": _normalize_text(meta.get("accepted_at")) or now_iso,
            "workflow_stage": "scheduled",
            "slot_offer_status": "accepted",
            "booking_source": "learner_self_booking",
        }
    )
    updated_request = _persist_request_row(
        request_id,
        {"scheduled_slot_id": body.slot_id, "status": "scheduled", "meta": meta, "updated_at": now_iso},
    )
    updated_request, session_row = _upsert_mentorship_session(
        updated_request,
        slot_row=slot_row,
        starts_at=_normalize_text(slot_row.get("starts_at")),
        ends_at=_normalize_text(slot_row.get("ends_at")),
        meeting_link=_normalize_text(body.meeting_link) or _normalize_text(slot_row.get("meeting_link")) or None,
        compat_status="scheduled",
        call_provider=body.call_provider or ("custom" if _normalize_text(slot_row.get("meeting_link")) else "zoom_video_sdk"),
    )
    return _map_mentorship_session_row(session_row, updated_request)


@router.post("/mentorship/requests/{request_id}/schedule")
async def schedule_mentorship_request(
    request_id: int,
    body: MentorshipScheduleRequest,
    profile: ProfileRow = Depends(require_auth),
):
    if not _is_admin_or_moderator_profile(profile):
        raise HTTPException(status_code=403, detail="Only admin or moderator can assign mentorship slots.")
    request_row = _load_mentorship_request_or_404(request_id)
    slot_row = _load_mentorship_slot_or_404(body.slot_id)
    _ensure_slot_available(slot_row, mentor_id=_safe_int(request_row.get("mentor_id")))
    _increment_slot_booking(slot_row)
    now_iso = _now_utc().isoformat()
    meta = _request_meta(request_row)
    meta.update(
        {
            "compat_status": "scheduled",
            "accepted_at": _normalize_text(meta.get("accepted_at")) or now_iso,
            "workflow_stage": "scheduled",
            "scheduled_by_admin_at": now_iso,
        }
    )
    updated_request = _persist_request_row(
        request_id,
        {"scheduled_slot_id": body.slot_id, "status": "scheduled", "meta": meta, "updated_at": now_iso},
    )
    updated_request, session_row = _upsert_mentorship_session(
        updated_request,
        slot_row=slot_row,
        starts_at=_normalize_text(slot_row.get("starts_at")),
        ends_at=_normalize_text(slot_row.get("ends_at")),
        meeting_link=_normalize_text(body.meeting_link) or _normalize_text(slot_row.get("meeting_link")) or None,
        compat_status="scheduled",
        call_provider=body.call_provider or ("custom" if _normalize_text(slot_row.get("meeting_link")) else "zoom_video_sdk"),
    )
    return _map_mentorship_session_row(session_row, updated_request)


@router.post("/mentorship/requests/{request_id}/start-now")
async def start_mentorship_request_now(
    request_id: int,
    body: MentorshipStartNowRequest,
    profile: ProfileRow = Depends(require_auth),
):
    if not _is_mentor_like_profile(profile):
        raise HTTPException(status_code=403, detail="Requires mentor, moderator, or admin access.")
    request_row = _load_mentorship_request_or_404(request_id)
    mentor_id = _safe_int(request_row.get("mentor_id"))
    if not _is_admin_or_moderator_profile(profile) and mentor_id != profile.id:
        raise HTTPException(status_code=403, detail="Only assigned mentor can start this request.")
    request_status = _request_effective_status(request_row)
    if request_status in MENTORSHIP_TERMINAL_REQUEST_STATUSES:
        raise HTTPException(status_code=400, detail="Request is already closed.")
    if request_status == "accepted" and _request_effective_payment_status(request_row) != "paid":
        raise HTTPException(status_code=400, detail="Complete payment before starting the session.")
    now_dt = _now_utc()
    starts_at = now_dt.isoformat()
    ends_at = (now_dt + timedelta(minutes=body.duration_minutes)).isoformat()
    slot_row = None
    scheduled_slot_id = _safe_int(request_row.get("scheduled_slot_id"))
    if scheduled_slot_id > 0:
        slot_row = _load_mentorship_slot_or_404(scheduled_slot_id)
        starts_at = _normalize_text(slot_row.get("starts_at")) or starts_at
        ends_at = _normalize_text(slot_row.get("ends_at")) or ends_at
    meta = _request_meta(request_row)
    meta.update(
        {
            "compat_status": "scheduled",
            "accepted_at": _normalize_text(meta.get("accepted_at")) or now_dt.isoformat(),
            "workflow_stage": "live",
        }
    )
    updated_request = _persist_request_row(
        request_id,
        {"status": "scheduled", "meta": meta, "updated_at": now_dt.isoformat()},
    )
    updated_request, session_row = _upsert_mentorship_session(
        updated_request,
        slot_row=slot_row,
        starts_at=starts_at,
        ends_at=ends_at,
        meeting_link=_normalize_text(body.meeting_link) or _normalize_text((slot_row or {}).get("meeting_link")) or None,
        compat_status="live",
        call_provider=body.call_provider or ("custom" if _normalize_text(body.meeting_link) or _normalize_text((slot_row or {}).get("meeting_link")) else "zoom_video_sdk"),
        extra_session_meta={"live_started_at": now_dt.isoformat(), "live_ended_at": None},
    )
    return _map_mentorship_session_row(session_row, updated_request)


@router.put("/mentorship/requests/{request_id}/status")
async def update_mentorship_request_status(
    request_id: int,
    body: MentorshipStatusUpdateRequest,
    profile: ProfileRow = Depends(require_auth),
):
    request_row = _load_mentorship_request_or_404(request_id)
    request_status = _request_effective_status(request_row)
    is_owner = _safe_int(request_row.get("user_id")) == profile.id
    is_mentor = _safe_int(request_row.get("mentor_id")) == profile.id and _is_mentor_like_profile(profile)
    is_admin_mod = _is_admin_or_moderator_profile(profile)
    if not (is_owner or is_mentor or is_admin_mod):
        raise HTTPException(status_code=403, detail="You cannot update this mentorship request.")
    next_status = body.status
    if is_owner and not is_admin_mod and next_status != "cancelled":
        raise HTTPException(status_code=403, detail="Users can only cancel their own mentorship requests.")
    if is_mentor and not is_admin_mod and next_status == "cancelled":
        raise HTTPException(status_code=403, detail="Mentor should reject instead of cancelling request.")
    if next_status == "scheduled" and not (_safe_int(request_row.get("scheduled_slot_id")) > 0 or _load_mentorship_session_for_request(request_id)):
        raise HTTPException(status_code=400, detail="Assign a slot before marking the request scheduled.")
    now_iso = _now_utc().isoformat()
    meta = _request_meta(request_row)
    meta["compat_status"] = next_status
    meta["workflow_stage"] = (
        "accepted" if next_status == "accepted"
        else "scheduled" if next_status == "scheduled"
        else "completed" if next_status == "completed"
        else "expired" if next_status == "expired"
        else "cancelled" if next_status in {"cancelled", "rejected"}
        else "submitted"
    )
    if body.reason:
        meta["last_status_reason"] = body.reason
    if next_status in {"accepted", "scheduled"}:
        meta["accepted_at"] = _normalize_text(meta.get("accepted_at")) or now_iso
        if _safe_float(meta.get("payment_amount"), 0.0) <= 0 and _request_effective_payment_status(request_row) != "paid":
            meta["payment_status"] = "paid"
            meta["payment_paid_at"] = now_iso
    if next_status == "completed":
        meta["completed_at"] = now_iso
    if next_status == "rejected":
        meta["rejected_at"] = now_iso
    if next_status == "expired":
        meta["expired_at"] = now_iso
    if next_status == "cancelled":
        meta["cancelled_at"] = now_iso
    db_status = (
        "completed" if next_status == "completed"
        else "rejected" if next_status == "rejected"
        else "cancelled" if next_status in {"cancelled", "expired"}
        else "scheduled" if next_status == "scheduled"
        else "requested"
    )
    if request_status == "scheduled" and next_status in {"cancelled", "rejected", "expired"}:
        _decrement_slot_booking(_safe_int(request_row.get("scheduled_slot_id")))
    updated_request = _persist_request_row(request_id, {"status": db_status, "meta": meta, "updated_at": now_iso})
    session_row = _load_mentorship_session_for_request(request_id)
    if session_row and next_status in {"cancelled", "rejected", "expired", "completed"}:
        session_meta = {
            "status": "completed" if next_status == "completed" else "cancelled",
            "live_ended_at": now_iso if _session_effective_status(session_row, updated_request) == "live" else _session_meta_from_request(updated_request).get("live_ended_at"),
        }
        updated_request, session_row = _upsert_mentorship_session(
            updated_request,
            slot_row=_load_mentorship_slot(_safe_int(session_row.get("slot_id"))),
            starts_at=_normalize_text(session_row.get("starts_at")),
            ends_at=_normalize_text(session_row.get("ends_at")),
            meeting_link=_normalize_text(session_row.get("meeting_link")) or None,
            compat_status=session_meta["status"],
            call_provider=_session_meta_from_request(updated_request).get("call_provider"),
            extra_session_meta=session_meta,
        )
    return _map_mentorship_request_row(updated_request, session_row=session_row, viewer_profile_id=profile.id)


@router.delete("/mentorship/requests/{request_id}")
async def delete_mentorship_request(
    request_id: int,
    profile: ProfileRow = Depends(require_auth),
):
    request_row = _load_mentorship_request_or_404(request_id)
    is_owner = _safe_int(request_row.get("user_id")) == profile.id
    if not (is_owner or _is_admin_or_moderator_profile(profile)):
        raise HTTPException(status_code=403, detail="You cannot delete this mentorship request.")
    request_status = _request_effective_status(request_row)
    if is_owner and request_status not in MENTORSHIP_TERMINAL_REQUEST_STATUSES:
        raise HTTPException(status_code=400, detail="Cancel the mentorship request before deleting it.")
    session_row = _load_mentorship_session_for_request(request_id)
    if session_row and _session_effective_status(session_row, request_row) == "live":
        raise HTTPException(status_code=400, detail="A live session cannot be deleted.")
    if request_status == "scheduled":
        _decrement_slot_booking(_safe_int(request_row.get("scheduled_slot_id")))
    admin = get_admin_client()
    admin.table("mentorship_messages").delete().eq("request_id", request_id).execute()
    admin.table("mentorship_sessions").delete().eq("request_id", request_id).execute()
    deleted = _first(admin.table("mentorship_requests").delete().eq("id", request_id).execute())
    if not deleted:
        raise HTTPException(status_code=404, detail="Mentorship request not found.")
    return {"message": "Mentorship request deleted.", "id": request_id}


@router.post("/mentorship/requests/{request_id}/payment/order")
async def create_mentorship_payment_order(
    request_id: int,
    body: MentorshipPaymentOrderRequest,
    profile: ProfileRow = Depends(require_auth),
):
    request_row = _load_mentorship_request_or_404(request_id)
    if not (_safe_int(request_row.get("user_id")) == profile.id or _is_admin_or_moderator_profile(profile)):
        raise HTTPException(status_code=403, detail="Only the learner can pay for this request.")
    if _request_effective_status(request_row) != "accepted":
        raise HTTPException(status_code=400, detail="Payment is available only after mentor acceptance.")
    if _request_effective_payment_status(request_row) == "paid":
        raise HTTPException(status_code=409, detail="This mentorship request is already paid.")
    meta = _request_meta(request_row)
    amount_display = _safe_float(meta.get("payment_amount"), 0.0)
    if amount_display <= 0:
        raise HTTPException(status_code=400, detail="This mentorship request does not require online payment.")
    amount_minor = int(round(amount_display * 100))
    notes = {
        "request_id": str(request_id),
        "user_id": str(_safe_int(request_row.get("user_id"))),
        "mentor_id": str(_safe_int(request_row.get("mentor_id"))),
    }
    order = _create_mentorship_razorpay_order(amount_minor, "INR", notes)
    now_iso = _now_utc().isoformat()
    meta.update(
        {
            "payment_status": "pending",
            "payment_method": _normalize_text(body.payment_method) or "razorpay",
            "payment_gateway": "razorpay",
            "payment_attempted_at": now_iso,
            "payment_currency": "INR",
            "payment_order_id": _normalize_text(order.get("id")) or None,
            "payment_order_amount": _safe_int(order.get("amount")) or amount_minor,
            "payment_order_status": _normalize_text(order.get("status")) or "created",
            "workflow_stage": "payment_pending",
        }
    )
    _persist_request_row(request_id, {"meta": meta, "updated_at": now_iso})
    return {
        "request_id": request_id,
        "order_id": _normalize_text(order.get("id")),
        "key_id": _settings.razorpay_key_id,
        "amount": _safe_int(order.get("amount")) or amount_minor,
        "currency": "INR",
        "amount_display": amount_display,
        "name": "Mentors App",
        "description": f"Mentorship request #{request_id}",
        "prefill": {"name": _normalize_text(meta.get("learner_name")), "email": _normalize_text(meta.get("learner_email"))},
        "notes": {"request_id": str(request_id), "provider_name": _normalize_text(meta.get("provider_name"))},
    }


@router.post("/mentorship/requests/{request_id}/payment/verify")
async def verify_mentorship_payment(
    request_id: int,
    body: MentorshipPaymentVerifyRequest,
    profile: ProfileRow = Depends(require_auth),
):
    request_row = _load_mentorship_request_or_404(request_id)
    if not (_safe_int(request_row.get("user_id")) == profile.id or _is_admin_or_moderator_profile(profile)):
        raise HTTPException(status_code=403, detail="Only the learner can verify this payment.")
    if _request_effective_status(request_row) != "accepted":
        raise HTTPException(status_code=400, detail="Payment is available only after mentor acceptance.")
    if _request_effective_payment_status(request_row) == "paid":
        session_row = _load_mentorship_session_for_request(request_id)
        return _map_mentorship_request_row(request_row, session_row=session_row, viewer_profile_id=profile.id)
    meta = _request_meta(request_row)
    expected_order_id = _normalize_text(meta.get("payment_order_id"))
    if expected_order_id and expected_order_id != body.razorpay_order_id.strip():
        raise HTTPException(status_code=400, detail="Payment order does not match the latest checkout attempt.")
    if not _verify_razorpay_signature(body.razorpay_order_id.strip(), body.razorpay_payment_id.strip(), body.razorpay_signature.strip()):
        meta.update({"payment_status": "failed", "payment_failed_at": _now_utc().isoformat(), "payment_failure_reason": "signature_verification_failed"})
        _persist_request_row(request_id, {"meta": meta, "updated_at": _now_utc().isoformat()})
        raise HTTPException(status_code=400, detail="Razorpay payment verification failed.")
    now_iso = _now_utc().isoformat()
    meta.update(
        {
            "payment_status": "paid",
            "payment_paid_at": now_iso,
            "payment_method": _normalize_text(body.payment_method) or "razorpay",
            "coupon_code": _normalize_text(body.coupon_code) or meta.get("coupon_code"),
            "payment_gateway": "razorpay",
            "payment_order_id": body.razorpay_order_id.strip(),
            "razorpay_payment_id": body.razorpay_payment_id.strip(),
            "razorpay_signature": body.razorpay_signature.strip(),
            "workflow_stage": "booking_open" if _request_booking_open(request_row) else "paid",
        }
    )
    updated_request = _persist_request_row(request_id, {"meta": meta, "updated_at": now_iso})
    session_row = _load_mentorship_session_for_request(request_id)
    return _map_mentorship_request_row(updated_request, session_row=session_row, viewer_profile_id=profile.id)


@router.post("/mentorship/requests/{request_id}/pay")
async def pay_for_mentorship_request(
    request_id: int,
    body: MentorshipPaymentOrderRequest,
    profile: ProfileRow = Depends(require_auth),
):
    request_row = _load_mentorship_request_or_404(request_id)
    if not (_safe_int(request_row.get("user_id")) == profile.id or _is_admin_or_moderator_profile(profile)):
        raise HTTPException(status_code=403, detail="Only the learner can complete this payment.")
    if _request_effective_status(request_row) != "accepted":
        raise HTTPException(status_code=400, detail="Payment is available only after mentor acceptance.")
    meta = _request_meta(request_row)
    if _safe_float(meta.get("payment_amount"), 0.0) > 0:
        raise HTTPException(status_code=400, detail="Online checkout is required for paid mentorship requests.")
    now_iso = _now_utc().isoformat()
    meta.update(
        {
            "payment_status": "paid",
            "payment_paid_at": now_iso,
            "payment_method": _normalize_text(body.payment_method) or "complimentary",
            "coupon_code": _normalize_text(body.coupon_code) or meta.get("coupon_code"),
            "payment_gateway": "offline",
            "workflow_stage": "paid",
        }
    )
    updated_request = _persist_request_row(request_id, {"meta": meta, "updated_at": now_iso})
    session_row = _load_mentorship_session_for_request(request_id)
    return _map_mentorship_request_row(updated_request, session_row=session_row, viewer_profile_id=profile.id)
