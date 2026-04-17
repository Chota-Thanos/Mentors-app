from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from ..auth import ProfileRow, require_admin, require_auth
from ..db import get_admin_client

router = APIRouter(prefix="/profiles", tags=["Profiles"])


class ProfilesBatchRequest(BaseModel):
    ids: list[int]


class ProfileRoleUpdateRequest(BaseModel):
    role: str


class ProfessionalProfileUpdateRequest(BaseModel):
    role: str | None = None
    display_name: str | None = None
    headline: str | None = None
    bio: str | None = None
    years_experience: int | None = None
    city: str | None = None
    profile_image_url: str | None = None
    is_verified: bool | None = None
    highlights: list[str] | None = None
    credentials: list[str] | None = None
    specialization_tags: list[str] | None = None
    languages: list[str] | None = None
    contact_url: str | None = None
    public_email: str | None = None
    is_public: bool | None = None
    is_active: bool | None = None
    exam_ids: list[int] | None = None
    meta: dict[str, Any] | None = None


def _safe_int(value: Any, default: int = 0) -> int:
    try:
        return int(value)
    except (TypeError, ValueError):
        return default


def _safe_float(value: Any, default: float = 0.0) -> float:
    try:
        return float(value)
    except (TypeError, ValueError):
        return default


def _safe_text(value: Any) -> str:
    return str(value or "").strip()


def _safe_dict(value: Any) -> dict[str, Any]:
    return value if isinstance(value, dict) else {}


def _safe_string_list(value: Any) -> list[str]:
    if not isinstance(value, list):
        return []
    output: list[str] = []
    for item in value:
        text = _safe_text(item)
        if text and text not in output:
            output.append(text)
    return output


def _safe_int_list(value: Any) -> list[int]:
    if not isinstance(value, list):
        return []
    output: list[int] = []
    for item in value:
        parsed = _safe_int(item)
        if parsed > 0 and parsed not in output:
            output.append(parsed)
    return output


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


def _load_profile(identifier: str) -> dict[str, Any] | None:
    normalized = _safe_text(identifier)
    if not normalized:
        return None

    admin = get_admin_client()
    query = admin.table("profiles").select("*").limit(1)
    if normalized.isdigit():
        query = query.eq("id", int(normalized))
    else:
        query = query.eq("auth_user_id", normalized)

    resp = query.execute()
    return _first(resp)


def _load_creator_profile(profile_id: int) -> dict[str, Any] | None:
    if profile_id <= 0:
        return None
    admin = get_admin_client()
    return _first(admin.table("creator_profiles").select("*").eq("user_id", profile_id).limit(1).execute())


def _load_creator_exam_ids(creator_profile_id: int) -> list[int]:
    if creator_profile_id <= 0:
        return []
    admin = get_admin_client()
    rows = _rows(
        admin.table("creator_profile_exams")
        .select("exam_id")
        .eq("creator_profile_id", creator_profile_id)
        .execute()
    )
    return _safe_int_list([row.get("exam_id") for row in rows])


def _profile_role_label(role: str) -> str:
    normalized = _safe_text(role).lower()
    if normalized == "mentor":
        return "Mains Mentor"
    if normalized in {"provider", "institute", "creator"}:
        return "Quiz Master"
    if normalized:
        return normalized.replace("_", " ").title()
    return "Professional"


def _creator_professional_role(creator_row: dict[str, Any] | None, profile_row: dict[str, Any] | None) -> str:
    social_links = _safe_dict((creator_row or {}).get("social_links"))
    for key in ("professional_role", "profile_role", "role"):
        candidate = _safe_text(social_links.get(key)).lower()
        if candidate in {"provider", "institute", "mentor", "creator"}:
            return candidate
    if creator_row:
        return "provider"
    base_role = _safe_text((profile_row or {}).get("role")).lower()
    if base_role in {"admin", "moderator", "prelims_expert"}:
        return "provider"
    if base_role == "mains_expert":
        return "mentor"
    return "provider"


def _creator_profile_payload(profile_row: dict[str, Any], creator_row: dict[str, Any] | None) -> dict[str, Any]:
    creator_row = creator_row or {}
    social_links = _safe_dict(creator_row.get("social_links"))
    profile_exam_ids = _safe_int_list(profile_row.get("creator_exam_ids"))
    creator_exam_ids = _load_creator_exam_ids(_safe_int(creator_row.get("id")))
    exam_ids = sorted({*profile_exam_ids, *creator_exam_ids})
    professional_role = _creator_professional_role(creator_row, profile_row)

    profile_image_url = _safe_text(creator_row.get("profile_image_url")) or _safe_text(profile_row.get("avatar_url")) or None
    display_name = (
        _safe_text(creator_row.get("display_name"))
        or _safe_text(profile_row.get("display_name"))
        or _safe_text(profile_row.get("email")).split("@")[0]
        or "Professional"
    )

    meta = dict(social_links)
    meta["professional_role"] = professional_role
    meta["exam_ids"] = exam_ids

    return {
        "id": _safe_int(profile_row.get("id")),
        "auth_user_id": _safe_text(profile_row.get("auth_user_id")),
        "display_name": display_name,
        "email": _safe_text(profile_row.get("email")),
        "avatar_url": _safe_text(profile_row.get("avatar_url")) or None,
        "role": _safe_text(profile_row.get("role")) or "user",
        "professional_role": professional_role,
        "phone": None,
        "city": _safe_text(creator_row.get("city")) or _safe_text(profile_row.get("city")) or None,
        "bio": _safe_text(creator_row.get("bio")) or _safe_text(profile_row.get("bio")) or None,
        "headline": _safe_text(creator_row.get("headline")) or None,
        "years_experience": _safe_int(creator_row.get("years_experience")) if creator_row.get("years_experience") is not None else None,
        "profile_image_url": profile_image_url,
        "is_verified": bool(creator_row.get("is_verified", profile_row.get("is_verified", False))),
        "highlights": _safe_string_list(creator_row.get("highlights")) or _safe_string_list(profile_row.get("highlights")),
        "credentials": _safe_string_list(creator_row.get("credentials")),
        "specialization_tags": _safe_string_list(creator_row.get("specialization_tags")),
        "languages": _safe_string_list(creator_row.get("languages")),
        "contact_url": _safe_text(creator_row.get("contact_url")) or None,
        "public_email": _safe_text(creator_row.get("public_email")) or None,
        "is_public": bool(creator_row.get("is_public", True)),
        "is_active": bool(creator_row.get("is_active", profile_row.get("is_active", True))),
        "exam_ids": exam_ids,
        "meta": meta,
        "created_at": _safe_text(profile_row.get("created_at")) or None,
        "updated_at": _safe_text(profile_row.get("updated_at")) or None,
    }


def _base_profile_payload(profile_row: dict[str, Any], creator_row: dict[str, Any] | None) -> dict[str, Any]:
    payload = _creator_profile_payload(profile_row, creator_row)
    payload["role"] = _safe_text(profile_row.get("role")) or "user"
    return payload


def _series_mentor_user_ids(series_row: dict[str, Any]) -> list[str]:
    meta = _safe_dict(series_row.get("meta"))
    raw_ids = meta.get("mentor_user_ids")
    output: list[str] = []
    if isinstance(raw_ids, list):
        for raw in raw_ids:
            value = _safe_text(raw)
            if value and value not in output:
                output.append(value)
    single_mentor = _safe_text(meta.get("mentor_user_id"))
    if single_mentor and single_mentor not in output:
        output.append(single_mentor)
    return output


def _series_payload(series_row: dict[str, Any]) -> dict[str, Any]:
    meta = _safe_dict(series_row.get("meta"))
    exam_ids = _safe_int_list(meta.get("exam_ids"))
    price = _safe_float(series_row.get("price"), 0.0)
    series_kind = _safe_text(series_row.get("series_kind")) or "prelims"
    access_type = _safe_text(series_row.get("access_type")) or "subscription"
    return {
        "id": _safe_int(series_row.get("id")),
        "title": _safe_text(series_row.get("title")) or f"Series #{_safe_int(series_row.get('id'))}",
        "description": series_row.get("description"),
        "cover_image_url": series_row.get("cover_image_url"),
        "provider_user_id": _safe_text(series_row.get("provider_user_id")),
        "series_kind": series_kind,
        "access_type": access_type,
        "price": price,
        "is_public": bool(series_row.get("is_public", False)),
        "is_active": bool(series_row.get("is_active", True)),
        "meta": meta,
        "exam_ids": exam_ids,
        "test_count": 0,
        "created_at": _safe_text(series_row.get("created_at")) or "",
        "updated_at": _safe_text(series_row.get("updated_at")) or None,
    }


def _load_series_lists(profile_row: dict[str, Any]) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    user_id = _safe_text(profile_row.get("auth_user_id"))
    if not user_id:
        return [], []

    admin = get_admin_client()
    provided_rows = _rows(
        admin.table("test_series")
        .select("*")
        .eq("provider_user_id", user_id)
        .eq("is_active", True)
        .order("created_at", desc=True)
        .execute()
    )
    provided = [_series_payload(row) for row in provided_rows]
    provided_ids = {item["id"] for item in provided if item["id"] > 0}

    all_rows = _rows(
        admin.table("test_series")
        .select("*")
        .eq("is_active", True)
        .order("created_at", desc=True)
        .execute()
    )
    assigned: list[dict[str, Any]] = []
    for row in all_rows:
        series_id = _safe_int(row.get("id"))
        if series_id <= 0 or series_id in provided_ids:
            continue
        mentor_ids = _series_mentor_user_ids(row)
        if user_id not in mentor_ids:
            continue
        assigned.append(_series_payload(row))
    return provided, assigned


def _load_profile_reviews(profile_row: dict[str, Any], creator_row: dict[str, Any]) -> tuple[dict[str, Any], list[dict[str, Any]]]:
    creator_profile_id = _safe_int(creator_row.get("id"))
    if creator_profile_id <= 0:
        return {
            "average_rating": 0.0,
            "total_reviews": 0,
            "rating_1": 0,
            "rating_2": 0,
            "rating_3": 0,
            "rating_4": 0,
            "rating_5": 0,
        }, []

    admin = get_admin_client()
    review_rows = _rows(
        admin.table("creator_profile_reviews")
        .select("*")
        .eq("creator_profile_id", creator_profile_id)
        .execute()
    )
    if not review_rows:
        return {
            "average_rating": 0.0,
            "total_reviews": 0,
            "rating_1": 0,
            "rating_2": 0,
            "rating_3": 0,
            "rating_4": 0,
            "rating_5": 0,
        }, []

    reviewer_ids = sorted({str(_safe_int(row.get("reviewer_id"))).strip() for row in review_rows if _safe_int(row.get("reviewer_id")) > 0})
    reviewer_names: dict[str, str] = {}
    if reviewer_ids:
        profile_rows = _rows(
            admin.table("profiles")
            .select("id,display_name,email")
            .in_("id", [int(item) for item in reviewer_ids])
            .execute()
        )
        for row in profile_rows:
            reviewer_names[str(_safe_int(row.get("id")))] = (
                _safe_text(row.get("display_name"))
                or _safe_text(row.get("email")).split("@")[0]
                or f"User {_safe_int(row.get('id'))}"
            )

    counts = {1: 0, 2: 0, 3: 0, 4: 0, 5: 0}
    total = 0
    score_sum = 0
    recent_reviews: list[dict[str, Any]] = []
    for row in sorted(review_rows, key=lambda item: _safe_text(item.get("created_at")), reverse=True):
        rating = max(1, min(5, _safe_int(row.get("rating"), 1)))
        counts[rating] += 1
        total += 1
        score_sum += rating
        reviewer_id = str(_safe_int(row.get("reviewer_id")))
        recent_reviews.append(
            {
                "id": _safe_int(row.get("id")),
                "target_user_id": _safe_text(profile_row.get("auth_user_id")),
                "reviewer_user_id": reviewer_id,
                "reviewer_label": reviewer_names.get(reviewer_id) or f"User {reviewer_id}",
                "rating": rating,
                "title": None,
                "comment": _safe_text(row.get("comment")) or None,
                "is_public": True,
                "is_active": True,
                "meta": {},
                "created_at": _safe_text(row.get("created_at")) or "",
                "updated_at": _safe_text(row.get("updated_at")) or None,
            }
        )

    summary = {
        "average_rating": round(score_sum / total, 2) if total > 0 else 0.0,
        "total_reviews": total,
        "rating_1": counts[1],
        "rating_2": counts[2],
        "rating_3": counts[3],
        "rating_4": counts[4],
        "rating_5": counts[5],
    }
    return summary, recent_reviews


def _detail_payload(profile_row: dict[str, Any], creator_row: dict[str, Any] | None) -> dict[str, Any]:
    creator_row = creator_row or {}
    merged_profile = _creator_profile_payload(profile_row, creator_row)
    professional_role = _safe_text(merged_profile.get("professional_role")) or "provider"
    social_links = _safe_dict(creator_row.get("social_links"))
    provided_series, assigned_series = _load_series_lists(profile_row)
    review_summary, recent_reviews = _load_profile_reviews(profile_row, creator_row)

    return {
        "profile": {
            **merged_profile,
            "role": professional_role,
        },
        "role_label": _profile_role_label(professional_role),
        "achievements": _safe_string_list(social_links.get("achievements")),
        "service_specifications": _safe_string_list(social_links.get("service_specifications")),
        "mentorship_price": max(_safe_float(social_links.get("mentorship_price"), 0.0), 0.0),
        "copy_evaluation_price": max(_safe_float(social_links.get("copy_evaluation_price"), 0.0), 0.0),
        "currency": (_safe_text(social_links.get("currency")) or "INR").upper()[:8] or "INR",
        "response_time_text": _safe_text(social_links.get("response_time_text")) or None,
        "exam_focus": _safe_text(social_links.get("exam_focus")) or None,
        "students_mentored": _safe_int(social_links.get("students_mentored")) if social_links.get("students_mentored") is not None else None,
        "sessions_completed": _safe_int(social_links.get("sessions_completed")) if social_links.get("sessions_completed") is not None else None,
        "authenticity_proof_url": _safe_text(social_links.get("authenticity_proof_url")) or None,
        "authenticity_note": _safe_text(social_links.get("authenticity_note")) or None,
        "mentorship_availability_mode": _safe_text(social_links.get("mentorship_availability_mode")) if _safe_text(social_links.get("mentorship_availability_mode")) in {"open", "series_only"} else "series_only",
        "mentorship_open_scope_note": _safe_text(social_links.get("mentorship_open_scope_note")) or None,
        "mentorship_available_series_ids": _safe_int_list(social_links.get("mentorship_available_series_ids")),
        "mentorship_default_call_provider": _safe_text(social_links.get("mentorship_default_call_provider")) or "zoom_video_sdk",
        "mentorship_zoom_meeting_link": _safe_text(social_links.get("mentorship_zoom_meeting_link")) or None,
        "mentorship_call_setup_note": _safe_text(social_links.get("mentorship_call_setup_note")) or None,
        "copy_evaluation_enabled": bool(social_links.get("copy_evaluation_enabled", professional_role == "mentor")),
        "copy_evaluation_note": _safe_text(social_links.get("copy_evaluation_note")) or None,
        "provided_series": provided_series,
        "assigned_series": assigned_series,
        "review_summary": review_summary,
        "recent_reviews": recent_reviews,
    }


@router.get("/me")
async def get_me(profile: ProfileRow = Depends(require_auth)):
    creator_row = _load_creator_profile(profile.id)
    return _base_profile_payload(profile._raw, creator_row)


@router.get("/resolve/{identifier}")
async def resolve_profile(identifier: str, profile: ProfileRow = Depends(require_auth)):
    _ = profile
    row = _load_profile(identifier)
    if not row:
        raise HTTPException(status_code=404, detail="Profile not found")
    creator_row = _load_creator_profile(_safe_int(row.get("id")))
    return _base_profile_payload(row, creator_row)


@router.post("/batch")
async def batch_profiles(body: ProfilesBatchRequest, profile: ProfileRow = Depends(require_auth)):
    _ = profile
    ids = sorted({int(item) for item in body.ids if int(item) > 0})
    if not ids:
        return []

    admin = get_admin_client()
    rows = _rows(
        admin.table("profiles")
        .select("*")
        .in_("id", ids)
        .execute()
    )
    creators_by_user_id = {
        _safe_int(row.get("user_id")): row
        for row in _rows(
            admin.table("creator_profiles")
            .select("*")
            .in_("user_id", ids)
            .execute()
        )
    }
    return [_base_profile_payload(row, creators_by_user_id.get(_safe_int(row.get("id")))) for row in rows]


@router.get("/all")
async def list_all_profiles(profile: ProfileRow = Depends(require_admin)):
    _ = profile
    admin = get_admin_client()
    rows = _rows(
        admin.table("profiles")
        .select("*")
        .order("created_at", desc=True)
        .execute()
    )
    creators_by_user_id = {
        _safe_int(row.get("user_id")): row
        for row in _rows(
            admin.table("creator_profiles")
            .select("*")
            .execute()
        )
    }
    return [_base_profile_payload(row, creators_by_user_id.get(_safe_int(row.get("id")))) for row in rows]


@router.get("/{identifier}/detail")
async def get_profile_detail(identifier: str, profile: ProfileRow = Depends(require_auth)):
    _ = profile
    row = _load_profile(identifier)
    if not row:
        raise HTTPException(status_code=404, detail="Professional profile not found")
    creator_row = _load_creator_profile(_safe_int(row.get("id")))
    return _detail_payload(row, creator_row)


@router.put("/me")
async def update_my_profile(body: ProfessionalProfileUpdateRequest, profile: ProfileRow = Depends(require_auth)):
    admin = get_admin_client()
    profile_row = profile._raw
    creator_row = _load_creator_profile(profile.id)

    professional_role = _safe_text(body.role) or _creator_professional_role(creator_row, profile_row)
    social_links = _safe_dict((creator_row or {}).get("social_links"))
    if body.meta is not None:
        social_links.update(body.meta)
    social_links["professional_role"] = professional_role
    if body.exam_ids is not None:
        social_links["exam_ids"] = _safe_int_list(body.exam_ids)

    profile_updates: dict[str, Any] = {}
    creator_updates: dict[str, Any] = {"social_links": social_links}
    if body.display_name is not None:
        profile_updates["display_name"] = body.display_name.strip() if body.display_name.strip() else None
        creator_updates["display_name"] = body.display_name.strip() if body.display_name.strip() else None
    if body.headline is not None:
        creator_updates["headline"] = body.headline.strip() if body.headline.strip() else None
    if body.bio is not None:
        profile_updates["bio"] = body.bio.strip() if body.bio.strip() else None
        creator_updates["bio"] = body.bio.strip() if body.bio.strip() else None
    if body.years_experience is not None:
        creator_updates["years_experience"] = body.years_experience
    if body.city is not None:
        creator_updates["city"] = body.city.strip() if body.city.strip() else None
    if body.profile_image_url is not None:
        profile_updates["avatar_url"] = body.profile_image_url.strip() if body.profile_image_url.strip() else None
        creator_updates["profile_image_url"] = body.profile_image_url.strip() if body.profile_image_url.strip() else None
    if body.is_verified is not None:
        profile_updates["is_verified"] = bool(body.is_verified)
        creator_updates["is_verified"] = bool(body.is_verified)
    if body.exam_ids is not None:
        profile_updates["creator_exam_ids"] = _safe_int_list(body.exam_ids)
    if body.highlights is not None:
        profile_updates["highlights"] = body.highlights
        creator_updates["highlights"] = body.highlights
    if body.credentials is not None:
        creator_updates["credentials"] = body.credentials
    if body.specialization_tags is not None:
        creator_updates["specialization_tags"] = body.specialization_tags
    if body.languages is not None:
        creator_updates["languages"] = body.languages
    if body.contact_url is not None:
        creator_updates["contact_url"] = body.contact_url.strip() if body.contact_url.strip() else None
    if body.public_email is not None:
        creator_updates["public_email"] = body.public_email.strip() if body.public_email.strip() else None
    if body.is_public is not None:
        creator_updates["is_public"] = bool(body.is_public)
    if body.is_active is not None:
        creator_updates["is_active"] = bool(body.is_active)
    if body.meta is not None:
        payout_details = _safe_dict(profile_row.get("payout_details"))
        payout_details.update(body.meta)
        profile_updates["payout_details"] = payout_details

    if profile_updates:
        admin.table("profiles").update(profile_updates).eq("id", profile.id).execute()

    if creator_row:
        admin.table("creator_profiles").update(creator_updates).eq("user_id", profile.id).execute()
    else:
        insert_payload = {
            "user_id": profile.id,
            "display_name": body.display_name or profile_row.get("display_name") or profile_row.get("email") or "Professional",
            "headline": body.headline,
            "bio": body.bio,
            "years_experience": body.years_experience,
            "city": body.city,
            "profile_image_url": body.profile_image_url,
            "is_verified": bool(body.is_verified) if body.is_verified is not None else bool(profile_row.get("is_verified", False)),
            "highlights": body.highlights or [],
            "credentials": body.credentials or [],
            "specialization_tags": body.specialization_tags or [],
            "languages": body.languages or [],
            "contact_url": body.contact_url,
            "public_email": body.public_email,
            "is_public": bool(body.is_public) if body.is_public is not None else True,
            "is_active": bool(body.is_active) if body.is_active is not None else True,
            "social_links": social_links,
        }
        admin.table("creator_profiles").insert(insert_payload).execute()

    if body.exam_ids is not None:
        creator_row_after = _load_creator_profile(profile.id)
        creator_profile_id = _safe_int((creator_row_after or {}).get("id"))
        if creator_profile_id > 0:
            admin.table("creator_profile_exams").delete().eq("creator_profile_id", creator_profile_id).execute()
            exam_rows = [{"creator_profile_id": creator_profile_id, "exam_id": exam_id} for exam_id in _safe_int_list(body.exam_ids)]
            if exam_rows:
                admin.table("creator_profile_exams").insert(exam_rows).execute()

    refreshed_profile = _load_profile(str(profile.id))
    refreshed_creator = _load_creator_profile(profile.id)
    if not refreshed_profile:
        raise HTTPException(status_code=404, detail="Professional profile not found")
    return _base_profile_payload(refreshed_profile, refreshed_creator)


@router.put("/{profile_id}/role")
async def update_profile_role(
    profile_id: int,
    body: ProfileRoleUpdateRequest,
    profile: ProfileRow = Depends(require_admin),
):
    _ = profile
    admin = get_admin_client()
    resp = (
        admin.table("profiles")
        .update({"role": body.role})
        .eq("id", profile_id)
        .execute()
    )
    rows = resp.data if isinstance(resp.data, list) else ([resp.data] if resp.data else [])
    if not rows:
        raise HTTPException(status_code=404, detail="Profile not found")
    creator_row = _load_creator_profile(profile_id)
    return _base_profile_payload(rows[0], creator_row)
