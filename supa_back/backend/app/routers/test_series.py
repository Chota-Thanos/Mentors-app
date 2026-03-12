import os
import base64
import hashlib
import hmac
import json
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, List, Optional, Set
from urllib.error import HTTPError, URLError
from urllib.parse import urlencode
from urllib.request import Request as UrlRequest, urlopen

from fastapi import APIRouter, Depends, Header, HTTPException, Query, Request
from fastapi.responses import RedirectResponse
from pydantic import BaseModel
from supabase import Client

from ..models import (
    CollectionTestKind,
    CollectionType,
    ContentType,
    CopySubmissionMode,
    CopySubmissionStatus,
    LifecycleTrackingResponse,
    LifecycleTrackingSummaryResponse,
    LifecycleTrackingIssueResponse,
    MainsCopySubmissionCheckUpdate,
    MainsCopySubmissionEtaUpdate,
    MainsCopySubmissionQuestionResponse,
    MainsCopySubmissionQuestionResponseCreate,
    MainsCopySubmissionQuestionMarkResponse,
    MainsCopySubmissionCreate,
    MainsCopySubmissionResponse,
    MentorshipTrackingCycleResponse,
    MentorshipTrackingEventResponse,
    MentorshipCallProvider,
    MentorshipEntitlementGrantCreate,
    MentorshipEntitlementResponse,
    MentorshipMode,
    MentorshipCallContextResponse,
    MentorshipRequestCreate,
    MentorshipRequestOfferSlots,
    MentorshipRequestResponse,
    MentorshipRequestSchedule,
    MentorshipRequestStartNow,
    MentorshipRequestStatus,
    MentorshipRequestStatusUpdate,
    MentorshipSessionResponse,
    MentorshipSessionStatus,
    MentorshipSlotCreate,
    MentorshipSlotBatchCreate,
    MentorshipSlotBatchDeactivate,
    MentorshipSlotResponse,
    MentorshipSlotUpdate,
    TestSeriesAccessType,
    TestSeriesCreate,
    TestSeriesDiscoverySeriesResponse,
    TestSeriesDiscoveryTestResponse,
    TestSeriesEnrollmentResponse,
    TestSeriesKind,
    TestSeriesResponse,
    TestSeriesTestCreate,
    TestSeriesTestResponse,
    TestSeriesTestUpdate,
    TestSeriesUpdate,
    ProfessionalProfileResponse,
    ProfessionalProfileUpdate,
    ProfessionalProfileReviewCreate,
    ProfessionalProfileReviewResponse,
    ProfessionalProfileReviewSummaryResponse,
    ProfessionalPublicProfileDetailResponse,
    ProfessionalSeriesOptionResponse,
    ProfessionalSeriesOptionsResponse,
    MentorAvailabilityStatusResponse,
    MentorZoomConnectResponse,
    MentorZoomIntegrationStatusResponse,
    SubscriptionPlanResponse,
    UserPerformanceQuestionRow,
    UserPerformanceReportResponse,
    UserLifecycleTrackingRowResponse,
    UserSubscriptionStatusResponse,
)
from ..supabase_client import get_supabase_client

router = APIRouter(prefix="/api/v1/premium", tags=["Premium Test Series"])

TEST_SERIES_TABLE = "test_series"
TEST_SERIES_ENROLLMENTS_TABLE = "test_series_enrollments"
COPY_SUBMISSIONS_TABLE = "mains_test_copy_submissions"
COPY_MARKS_TABLE = "mains_test_copy_marks"
MENTORSHIP_SLOTS_TABLE = "mentorship_slots"
MENTORSHIP_REQUESTS_TABLE = "mentorship_requests"
MENTORSHIP_SESSIONS_TABLE = "mentorship_sessions"
MENTORSHIP_ENTITLEMENTS_TABLE = "mentorship_entitlements"
MENTOR_ZOOM_CONNECTIONS_TABLE = "mentor_zoom_connections"
PROFILES_TABLE = "creator_mentor_profiles"
PROFILE_REVIEWS_TABLE = "professional_profile_reviews"
ONBOARDING_REQUESTS_TABLE = "professional_onboarding_requests"
SUBSCRIPTION_PLANS_TABLE = "subscription_plans"
USER_SUBSCRIPTIONS_TABLE = "user_subscriptions"
TEST_SERIES_MIGRATION_HINT = (
    "Missing Test Series tables. "
    "Run supa_back/migrations/2026-02-22_test_series_and_mentorship.sql in Supabase SQL Editor."
)
PROFILES_SUBSCRIPTIONS_MIGRATION_HINT = (
    "Missing profile/subscription scaffold tables. "
    "Run supa_back/migrations/2026-02-23_profiles_and_subscriptions_scaffold.sql in Supabase SQL Editor."
)
PROFILE_REVIEWS_MIGRATION_HINT = (
    "Missing professional_profile_reviews table. "
    "Run supa_back/migrations/2026-02-25_professional_profile_reviews.sql in Supabase SQL Editor."
)

DEFAULT_TEST_SUBSCRIBER_EMAILS: Set[str] = {"abrarsaifi00@gmail.com"}
MENTORSHIP_SLOT_DURATION_MINUTES = 20
TECHNICAL_ISSUE_KEYWORDS: Set[str] = {
    "tech",
    "technical",
    "network",
    "internet",
    "wifi",
    "audio",
    "video",
    "camera",
    "mic",
    "microphone",
    "login",
    "otp",
    "bug",
    "error",
    "issue",
    "crash",
    "problem",
    "lag",
    "slow",
    "link",
    "meeting",
}
MENTOR_REQUEST_RESPONSE_DELAY_HOURS = 24
COPY_REVIEW_DELAY_HOURS = 72
SESSION_DELAY_GRACE_MINUTES = 15
ZOOM_AUTHORIZE_URL = "https://zoom.us/oauth/authorize"
ZOOM_TOKEN_URL = "https://zoom.us/oauth/token"
ZOOM_API_ROOT = "https://api.zoom.us/v2"
ZOOM_USERINFO_URL = f"{ZOOM_API_ROOT}/users/me"


class CollectionItemUpdateRequest(BaseModel):
    order: Optional[int] = None
    section_title: Optional[str] = None


class EnrollRequest(BaseModel):
    access_source: str = "manual"
    subscribed_until: Optional[str] = None

def _rows(response: Any) -> List[Dict[str, Any]]:
    data = getattr(response, "data", None)
    if isinstance(data, list):
        return data
    if isinstance(data, dict):
        return [data]
    return []


def _first(response: Any) -> Optional[Dict[str, Any]]:
    rows = _rows(response)
    return rows[0] if rows else None


def _safe_rows(query_call: Any) -> List[Dict[str, Any]]:
    try:
        return _rows(query_call.execute())
    except Exception:
        return []


def _safe_first(query_call: Any) -> Optional[Dict[str, Any]]:
    rows = _safe_rows(query_call)
    return rows[0] if rows else None


def _is_missing_table_error(exc: Exception, table_name: str) -> bool:
    error_text = str(exc).lower()
    lowered = table_name.lower()
    if "could not find the table" in error_text and lowered in error_text:
        return True
    return lowered in error_text and (
        "does not exist" in error_text
        or "relation" in error_text
        or "undefined table" in error_text
    )


def _raise_test_series_migration_required(exc: Exception) -> None:
    if _is_missing_table_error(exc, TEST_SERIES_TABLE):
        raise HTTPException(status_code=503, detail=TEST_SERIES_MIGRATION_HINT)
    raise exc


def _raise_profile_reviews_migration_required(exc: Exception) -> None:
    if _is_missing_table_error(exc, PROFILE_REVIEWS_TABLE):
        raise HTTPException(status_code=503, detail=PROFILE_REVIEWS_MIGRATION_HINT)
    text = str(exc).lower()
    if PROFILE_REVIEWS_TABLE.lower() in text and (
        "does not exist" in text
        or "relation" in text
        or "undefined table" in text
        or "not found" in text
    ):
        raise HTTPException(status_code=503, detail=PROFILE_REVIEWS_MIGRATION_HINT)
    raise exc


def _utc_now() -> datetime:
    return datetime.now(timezone.utc)


def _utc_now_iso() -> str:
    return _utc_now().isoformat()


def _parse_datetime(value: Any) -> Optional[datetime]:
    raw = str(value or "").strip()
    if not raw:
        return None
    try:
        parsed = datetime.fromisoformat(raw.replace("Z", "+00:00"))
    except ValueError:
        return None
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=timezone.utc)
    return parsed.astimezone(timezone.utc)


def _required_datetime(value: str, field_name: str) -> datetime:
    parsed = _parse_datetime(value)
    if not parsed:
        raise HTTPException(status_code=400, detail=f"Invalid datetime format for '{field_name}'.")
    return parsed


def _latest_datetime_iso(values: List[Any]) -> Optional[str]:
    latest_dt: Optional[datetime] = None
    for value in values:
        dt = _parse_datetime(value)
        if not dt:
            continue
        if latest_dt is None or dt > latest_dt:
            latest_dt = dt
    return latest_dt.isoformat() if latest_dt else None


def _contains_technical_issue_text(*values: Any) -> bool:
    combined = " ".join(str(value or "") for value in values).strip().lower()
    if not combined:
        return False
    return any(keyword in combined for keyword in TECHNICAL_ISSUE_KEYWORDS)


def _tracking_actor_from_user_ctx(
    user_ctx: Optional[Dict[str, Any]],
    *,
    request_row: Optional[Dict[str, Any]] = None,
) -> str:
    if not user_ctx:
        return "system"
    if _is_admin_or_moderator(user_ctx):
        return "moderator"
    user_id = str(user_ctx.get("user_id") or "").strip()
    if request_row:
        if user_id and user_id == str(request_row.get("provider_user_id") or "").strip():
            return "mentor"
        if user_id and user_id == str(request_row.get("user_id") or "").strip():
            return "user"
    if _is_mentor_like(user_ctx) or _is_provider_like(user_ctx):
        return "mentor"
    return "user"


def _tracking_status_actor_from_meta(meta: Dict[str, Any], request_row: Dict[str, Any]) -> str:
    meta_actor = _as_role(meta.get("status_updated_by_role"))
    if meta_actor in {"user", "mentor", "moderator"}:
        return meta_actor

    updater_id = str(meta.get("status_updated_by") or "").strip()
    if updater_id:
        if updater_id == str(request_row.get("user_id") or "").strip():
            return "user"
        if updater_id == str(request_row.get("provider_user_id") or "").strip():
            return "mentor"
    return "system"


def _parse_provider_user_ids(raw: Optional[str]) -> List[str]:
    text = str(raw or "").strip()
    if not text:
        return []
    values: List[str] = []
    for part in text.split(","):
        value = part.strip()
        if value and value not in values:
            values.append(value)
    return values


def _build_mentor_availability_map(
    *,
    provider_user_ids: List[str],
    supabase: Client,
) -> Dict[str, MentorAvailabilityStatusResponse]:
    provider_ids = [str(item).strip() for item in provider_user_ids if str(item).strip()]
    if not provider_ids:
        return {}

    now_dt = _utc_now()
    now_iso = now_dt.isoformat()
    statuses: Dict[str, MentorAvailabilityStatusResponse] = {}

    for provider_user_id in provider_ids:
        statuses[provider_user_id] = MentorAvailabilityStatusResponse(
            provider_user_id=provider_user_id,
            status="offline",
            available_now=False,
            busy_now=False,
            active_slots_now=0,
            next_available_at=None,
            live_session_id=None,
            updated_at=now_iso,
        )

    slot_rows = _safe_rows(
        supabase.table(MENTORSHIP_SLOTS_TABLE)
        .select("id,provider_user_id,starts_at,ends_at,max_bookings,booked_count,is_active")
        .in_("provider_user_id", provider_ids)
        .eq("is_active", True)
        .gte("ends_at", now_iso)
        .limit(5000)
    )

    session_rows = _safe_rows(
        supabase.table(MENTORSHIP_SESSIONS_TABLE)
        .select("id,provider_user_id,status,starts_at,ends_at")
        .in_("provider_user_id", provider_ids)
        .in_("status", [MentorshipSessionStatus.LIVE.value, MentorshipSessionStatus.SCHEDULED.value])
        .gte("ends_at", now_iso)
        .limit(5000)
    )

    for session_row in session_rows:
        provider_user_id = str(session_row.get("provider_user_id") or "").strip()
        if not provider_user_id or provider_user_id not in statuses:
            continue
        starts_at = _parse_datetime(session_row.get("starts_at"))
        ends_at = _parse_datetime(session_row.get("ends_at"))
        if not starts_at or not ends_at:
            continue
        if not (starts_at <= now_dt <= ends_at):
            continue

        status_row = statuses[provider_user_id]
        status_row.busy_now = True
        session_id = int(session_row.get("id") or 0)
        if session_id > 0:
            status_row.live_session_id = session_id

    for slot_row in slot_rows:
        provider_user_id = str(slot_row.get("provider_user_id") or "").strip()
        if not provider_user_id or provider_user_id not in statuses:
            continue
        starts_at = _parse_datetime(slot_row.get("starts_at"))
        ends_at = _parse_datetime(slot_row.get("ends_at"))
        if not starts_at or not ends_at:
            continue
        max_bookings = int(slot_row.get("max_bookings") or 1)
        booked_count = int(slot_row.get("booked_count") or 0)
        has_capacity = booked_count < max_bookings
        status_row = statuses[provider_user_id]

        if has_capacity and starts_at <= now_dt <= ends_at:
            status_row.active_slots_now += 1
        if has_capacity and starts_at > now_dt:
            if not status_row.next_available_at:
                status_row.next_available_at = starts_at.isoformat()
            else:
                prev_dt = _parse_datetime(status_row.next_available_at)
                if not prev_dt or starts_at < prev_dt:
                    status_row.next_available_at = starts_at.isoformat()

    for provider_user_id, status_row in statuses.items():
        if status_row.busy_now:
            status_row.status = "busy"
            status_row.available_now = False
            continue
        if status_row.active_slots_now > 0:
            status_row.status = "available_now"
            status_row.available_now = True
            continue
        status_row.status = "offline"
        status_row.available_now = False

    return statuses


def _extract_bearer_token(authorization: Optional[str]) -> Optional[str]:
    if not authorization:
        return None
    parts = authorization.split(" ")
    if len(parts) != 2:
        return None
    if parts[0].strip().lower() != "bearer":
        return None
    token = parts[1].strip()
    return token or None


def _as_role(value: Any) -> str:
    return str(value or "").strip().lower()


def _truthy(value: Any) -> bool:
    if isinstance(value, bool):
        return value
    if isinstance(value, (int, float)):
        return value > 0
    if isinstance(value, str):
        normalized = value.strip().lower()
        return normalized in {"1", "true", "yes", "active", "paid", "premium"}
    return False


def _env_csv_values(name: str) -> Set[str]:
    raw = str(os.getenv(name, "")).strip()
    if not raw:
        return set()
    values: Set[str] = set()
    for part in raw.split(","):
        normalized = part.strip().lower()
        if normalized:
            values.add(normalized)
    return values


def get_user_context(
    authorization: Optional[str] = Header(None),
    supabase: Client = Depends(get_supabase_client),
) -> Optional[Dict[str, Any]]:
    token = _extract_bearer_token(authorization)
    if not token:
        return None
    try:
        response = supabase.auth.get_user(token)
        user = getattr(response, "user", None)
        if not user:
            return None
        app_meta = getattr(user, "app_metadata", None) or {}
        if not isinstance(app_meta, dict):
            app_meta = {}
        user_meta = getattr(user, "user_metadata", None) or {}
        if not isinstance(user_meta, dict):
            user_meta = {}

        role = _as_role(app_meta.get("role") or user_meta.get("role"))
        is_admin = role == "admin" or bool(app_meta.get("admin")) or bool(user_meta.get("admin"))
        is_moderator = role == "moderator" or bool(app_meta.get("moderator")) or bool(user_meta.get("moderator"))
        email = str(getattr(user, "email", None) or user_meta.get("email") or "").strip().lower() or None
        return {
            "user_id": getattr(user, "id", None),
            "email": email,
            "role": role,
            "is_admin": is_admin,
            "is_moderator": is_moderator,
            "app_metadata": app_meta,
            "user_metadata": user_meta,
        }
    except Exception:
        return None


def require_authenticated_user(
    user_ctx: Optional[Dict[str, Any]] = Depends(get_user_context),
) -> Dict[str, Any]:
    if not user_ctx:
        raise HTTPException(status_code=401, detail="Authentication required.")
    user_id = str(user_ctx.get("user_id") or "").strip()
    if not user_id:
        raise HTTPException(status_code=401, detail="Authentication required.")
    return user_ctx


def _is_admin(user_ctx: Dict[str, Any]) -> bool:
    return bool(user_ctx.get("is_admin"))


def _is_moderator(user_ctx: Dict[str, Any]) -> bool:
    return bool(user_ctx.get("is_moderator"))


def _is_admin_or_moderator(user_ctx: Dict[str, Any]) -> bool:
    return _is_admin(user_ctx) or _is_moderator(user_ctx)


def _is_provider_like(user_ctx: Dict[str, Any]) -> bool:
    if _is_admin(user_ctx):
        return True
    role = _as_role(user_ctx.get("role"))
    if role in {"provider", "institute", "creator", "quiz_master", "quizmaster"}:
        return True
    app_meta = user_ctx.get("app_metadata") or {}
    user_meta = user_ctx.get("user_metadata") or {}
    if _truthy(app_meta.get("provider")) or _truthy(user_meta.get("provider")):
        return True
    if _truthy(app_meta.get("institute")) or _truthy(user_meta.get("institute")):
        return True
    if _truthy(app_meta.get("creator")) or _truthy(user_meta.get("creator")):
        return True
    if _truthy(app_meta.get("quiz_master")) or _truthy(user_meta.get("quiz_master")):
        return True
    if _truthy(app_meta.get("quizmaster")) or _truthy(user_meta.get("quizmaster")):
        return True
    return False


def _is_mentor_like(user_ctx: Dict[str, Any]) -> bool:
    if _is_admin(user_ctx):
        return True
    role = _as_role(user_ctx.get("role"))
    if role in {"mentor", "mains_mentor", "mainsmentor"}:
        return True
    app_meta = user_ctx.get("app_metadata") or {}
    user_meta = user_ctx.get("user_metadata") or {}
    if _truthy(app_meta.get("mentor")) or _truthy(user_meta.get("mentor")):
        return True
    if _truthy(app_meta.get("mains_mentor")) or _truthy(user_meta.get("mains_mentor")):
        return True
    if _truthy(app_meta.get("mainsmentor")) or _truthy(user_meta.get("mainsmentor")):
        return True
    return False


def require_provider_user(
    user_ctx: Dict[str, Any] = Depends(require_authenticated_user),
) -> Dict[str, Any]:
    if not _is_provider_like(user_ctx):
        raise HTTPException(status_code=403, detail="Provider access required.")
    return user_ctx


def require_series_author_user(
    user_ctx: Dict[str, Any] = Depends(require_authenticated_user),
) -> Dict[str, Any]:
    if _is_provider_like(user_ctx) or _is_mentor_like(user_ctx):
        return user_ctx
    raise HTTPException(status_code=403, detail="Quiz Master or Mains Mentor access required.")


def require_mentor_user(
    user_ctx: Dict[str, Any] = Depends(require_authenticated_user),
) -> Dict[str, Any]:
    if not _is_mentor_like(user_ctx):
        raise HTTPException(status_code=403, detail="Mains Mentor access required.")
    return user_ctx


def require_moderator_or_admin_user(
    user_ctx: Dict[str, Any] = Depends(require_authenticated_user),
) -> Dict[str, Any]:
    if not _is_admin_or_moderator(user_ctx):
        raise HTTPException(status_code=403, detail="Moderator or admin access required.")
    return user_ctx


def _is_active_subscription(user_ctx: Dict[str, Any]) -> bool:
    if _is_admin(user_ctx):
        return True

    test_subscriber_emails = set(DEFAULT_TEST_SUBSCRIBER_EMAILS).union(_env_csv_values("TEST_SUBSCRIBER_EMAILS"))
    test_subscriber_ids = _env_csv_values("TEST_SUBSCRIBER_USER_IDS")
    current_email = _as_role(user_ctx.get("email"))
    current_user_id = str(user_ctx.get("user_id") or "").strip().lower()
    if (current_email and current_email in test_subscriber_emails) or (
        current_user_id and current_user_id in test_subscriber_ids
    ):
        return True

    app_meta = user_ctx.get("app_metadata") or {}
    user_meta = user_ctx.get("user_metadata") or {}

    for field in ("subscription_active", "is_subscribed", "has_subscription", "premium"):
        if _truthy(app_meta.get(field)) or _truthy(user_meta.get(field)):
            return True

    for field in ("subscription_status", "plan_status", "status"):
        status_value = _as_role(app_meta.get(field) or user_meta.get(field))
        if status_value in {"active", "paid", "premium"}:
            return True

    for field in ("plan", "current_plan", "tier"):
        plan_value = _as_role(app_meta.get(field) or user_meta.get(field))
        if plan_value and plan_value not in {"free", "basic", "none"}:
            return True

    return False


def _meta_dict(value: Any) -> Dict[str, Any]:
    return dict(value) if isinstance(value, dict) else {}


def _as_optional_text(value: Any, *, max_length: int) -> Optional[str]:
    text = str(value or "").strip()
    if not text:
        return None
    return text[:max_length]


def _parse_optional_non_negative_int(value: Any, *, max_value: Optional[int] = None) -> Optional[int]:
    try:
        parsed = int(value)
    except (TypeError, ValueError):
        return None
    if parsed < 0:
        return None
    if max_value is not None and parsed > max_value:
        return None
    return parsed


def _safe_int(value: Any, fallback: int = 0) -> int:
    try:
        return int(value)
    except (TypeError, ValueError):
        return fallback


def _safe_float(value: Any, fallback: float = 0.0) -> float:
    try:
        return float(value)
    except (TypeError, ValueError):
        return fallback


def _normalize_copy_submission_mode(value: Any) -> CopySubmissionMode:
    normalized = _as_role(value)
    for mode in CopySubmissionMode:
        if normalized == mode.value:
            return mode
    return CopySubmissionMode.PDF


def _normalize_mains_question_max_marks(value: Any, fallback: float = 10.0) -> float:
    parsed = _safe_float(value, fallback)
    return parsed if parsed > 0 else fallback


def _normalize_answer_image_urls(value: Any) -> List[str]:
    if not isinstance(value, list):
        return []
    output: List[str] = []
    for raw in value:
        url = str(raw or "").strip()
        if url and url not in output:
            output.append(url)
    return output


def _normalize_profile_role(value: Any, fallback: str = "mentor") -> str:
    normalized = _as_role(value)
    if normalized in {"provider", "institute", "mentor", "creator"}:
        return normalized
    return fallback


def _professional_role_title(value: Any) -> str:
    normalized = _as_role(value)
    if normalized == "mentor":
        return "Mains Mentor"
    if normalized in {"provider", "institute", "creator"}:
        return "Quiz Master"
    if normalized:
        return normalized.replace("_", " ").title()
    return "Professional"


def _sanitize_text_list(raw: Any, *, max_items: int = 12, max_length: int = 160) -> List[str]:
    values = raw if isinstance(raw, list) else []
    output: List[str] = []
    seen: Set[str] = set()
    for item in values:
        text = str(item or "").strip()
        if not text:
            continue
        normalized_key = text.lower()
        if normalized_key in seen:
            continue
        seen.add(normalized_key)
        output.append(text[:max_length])
        if len(output) >= max_items:
            break
    return output


def _parse_series_id_list(raw: Any, *, max_items: int = 120) -> List[int]:
    values = raw if isinstance(raw, list) else []
    output: List[int] = []
    for item in values:
        parsed = _parse_optional_non_negative_int(item)
        if not parsed or parsed <= 0:
            continue
        if parsed in output:
            continue
        output.append(parsed)
        if len(output) >= max_items:
            break
    return output


def _normalize_profile_meta(raw_meta: Any) -> Dict[str, Any]:
    meta = _meta_dict(raw_meta)
    normalized = dict(meta)

    normalized["achievements"] = _sanitize_text_list(
        normalized.get("achievements"),
        max_items=20,
        max_length=220,
    )
    normalized["service_specifications"] = _sanitize_text_list(
        normalized.get("service_specifications"),
        max_items=24,
        max_length=220,
    )

    authenticity_proof_url = _as_optional_text(normalized.get("authenticity_proof_url"), max_length=800)
    authenticity_note = _as_optional_text(normalized.get("authenticity_note"), max_length=240)
    if authenticity_proof_url:
        normalized["authenticity_proof_url"] = authenticity_proof_url
    else:
        normalized.pop("authenticity_proof_url", None)
    if authenticity_note:
        normalized["authenticity_note"] = authenticity_note
    else:
        normalized.pop("authenticity_note", None)

    mode = _as_role(normalized.get("mentorship_availability_mode"))
    if mode not in {"open", "series_only"}:
        mode = "series_only"
    normalized["mentorship_availability_mode"] = mode

    normalized["mentorship_available_series_ids"] = _parse_series_id_list(
        normalized.get("mentorship_available_series_ids"),
        max_items=160,
    )

    mentorship_open_scope_note = _as_optional_text(
        normalized.get("mentorship_open_scope_note"),
        max_length=1200,
    )
    if mentorship_open_scope_note:
        normalized["mentorship_open_scope_note"] = mentorship_open_scope_note
    else:
        normalized.pop("mentorship_open_scope_note", None)

    zoom_meeting_link = _as_optional_text(
        normalized.get("mentorship_zoom_meeting_link"),
        max_length=1200,
    )
    if zoom_meeting_link:
        normalized["mentorship_zoom_meeting_link"] = zoom_meeting_link
    else:
        normalized.pop("mentorship_zoom_meeting_link", None)

    default_call_provider = _as_role(normalized.get("mentorship_default_call_provider"))
    if default_call_provider not in {
        MentorshipCallProvider.CUSTOM.value,
        MentorshipCallProvider.ZOOM.value,
    }:
        default_call_provider = (
            MentorshipCallProvider.ZOOM.value
            if zoom_meeting_link
            else MentorshipCallProvider.CUSTOM.value
        )
    normalized["mentorship_default_call_provider"] = default_call_provider

    call_setup_note = _as_optional_text(
        normalized.get("mentorship_call_setup_note"),
        max_length=1200,
    )
    if call_setup_note:
        normalized["mentorship_call_setup_note"] = call_setup_note
    else:
        normalized.pop("mentorship_call_setup_note", None)

    if "copy_evaluation_enabled" in normalized:
        normalized["copy_evaluation_enabled"] = _truthy(normalized.get("copy_evaluation_enabled"))
    else:
        normalized.pop("copy_evaluation_enabled", None)
    if "copy_evaluation_configured" in normalized:
        normalized["copy_evaluation_configured"] = _truthy(normalized.get("copy_evaluation_configured"))
    else:
        normalized.pop("copy_evaluation_configured", None)
    copy_evaluation_note = _as_optional_text(
        normalized.get("copy_evaluation_note"),
        max_length=1200,
    )
    if copy_evaluation_note:
        normalized["copy_evaluation_note"] = copy_evaluation_note
    else:
        normalized.pop("copy_evaluation_note", None)

    return normalized


def _copy_evaluation_enabled_for_role(role_value: str, meta: Dict[str, Any]) -> bool:
    if _truthy(meta.get("copy_evaluation_configured")) and "copy_evaluation_enabled" in meta:
        return _truthy(meta.get("copy_evaluation_enabled"))
    return role_value == "mentor"


def _normalize_profile_row(row: Dict[str, Any]) -> Dict[str, Any]:
    meta = _normalize_profile_meta(row.get("meta"))
    role_value = _normalize_profile_role(row.get("role"))
    meta["copy_evaluation_enabled"] = _copy_evaluation_enabled_for_role(role_value, meta)
    display_name = str(row.get("display_name") or "").strip()
    if not display_name:
        display_name = str(meta.get("display_name") or "").strip() or f"UPSC {_professional_role_title(role_value)}"

    years_experience_raw = row.get("years_experience")
    years_experience: Optional[int] = None
    try:
        parsed_years = int(years_experience_raw)
        if parsed_years >= 0:
            years_experience = parsed_years
    except (TypeError, ValueError):
        years_experience = None

    return {
        "id": int(row.get("id") or 0),
        "user_id": str(row.get("user_id") or "").strip(),
        "role": role_value,
        "display_name": display_name,
        "headline": row.get("headline"),
        "bio": row.get("bio"),
        "years_experience": years_experience,
        "city": row.get("city"),
        "profile_image_url": row.get("profile_image_url"),
        "is_verified": bool(row.get("is_verified", False)),
        "highlights": _sanitize_text_list(row.get("highlights"), max_items=8, max_length=180),
        "credentials": _sanitize_text_list(row.get("credentials"), max_items=12, max_length=220),
        "specialization_tags": _sanitize_text_list(row.get("specialization_tags"), max_items=14, max_length=80),
        "languages": _sanitize_text_list(row.get("languages"), max_items=10, max_length=60),
        "contact_url": row.get("contact_url"),
        "public_email": row.get("public_email"),
        "is_public": bool(row.get("is_public", True)),
        "is_active": bool(row.get("is_active", True)),
        "meta": meta,
        "created_at": str(row.get("created_at") or ""),
        "updated_at": str(row.get("updated_at")) if row.get("updated_at") else None,
    }


def _profile_response(row: Dict[str, Any]) -> ProfessionalProfileResponse:
    return ProfessionalProfileResponse(**_normalize_profile_row(row))


def _series_option_response(row: Dict[str, Any]) -> ProfessionalSeriesOptionResponse:
    series_kind_raw = _as_role(row.get("series_kind")) or TestSeriesKind.QUIZ.value
    try:
        series_kind = TestSeriesKind(series_kind_raw)
    except ValueError:
        series_kind = TestSeriesKind.QUIZ
    return ProfessionalSeriesOptionResponse(
        id=int(row.get("id") or 0),
        title=str(row.get("title") or "").strip() or f"Series #{int(row.get('id') or 0)}",
        series_kind=series_kind,
    )


def _professional_series_lists(
    *,
    user_id: str,
    supabase: Client,
) -> tuple[List[TestSeriesResponse], List[TestSeriesResponse]]:
    provided_rows = _safe_rows(
        supabase.table(TEST_SERIES_TABLE)
        .select("*")
        .eq("provider_user_id", user_id)
        .eq("is_active", True)
        .order("created_at", desc=True)
        .limit(800)
    )

    provided_series: List[TestSeriesResponse] = [
        _series_row_to_response(row, test_count=0)
        for row in provided_rows
    ]
    provided_ids: Set[int] = {
        int(row.id)
        for row in provided_series
        if int(row.id) > 0
    }

    all_rows = _safe_rows(
        supabase.table(TEST_SERIES_TABLE)
        .select("*")
        .eq("is_active", True)
        .order("created_at", desc=True)
        .limit(2000)
    )
    assigned_series: List[TestSeriesResponse] = []
    for row in all_rows:
        series_id = int(row.get("id") or 0)
        if series_id <= 0 or series_id in provided_ids:
            continue
        mentor_ids = _series_mentor_user_ids(row)
        if user_id not in mentor_ids:
            continue
        assigned_series.append(_series_row_to_response(row, test_count=0))
    return provided_series, assigned_series


def _reviewer_label_from_row(row: Dict[str, Any]) -> str:
    meta = _meta_dict(row.get("meta"))
    explicit_label = _as_optional_text(meta.get("reviewer_label"), max_length=80)
    if explicit_label:
        return explicit_label
    reviewer_user_id = str(row.get("reviewer_user_id") or "").strip()
    if reviewer_user_id:
        return f"User {reviewer_user_id[:8]}"
    return "User"


def _profile_review_response(row: Dict[str, Any]) -> ProfessionalProfileReviewResponse:
    rating = _parse_optional_non_negative_int(row.get("rating"), max_value=5) or 0
    if rating < 1:
        rating = 1
    return ProfessionalProfileReviewResponse(
        id=int(row.get("id") or 0),
        target_user_id=str(row.get("target_user_id") or "").strip(),
        reviewer_user_id=str(row.get("reviewer_user_id") or "").strip(),
        reviewer_label=_reviewer_label_from_row(row),
        rating=rating,
        title=_as_optional_text(row.get("title"), max_length=140),
        comment=_as_optional_text(row.get("comment"), max_length=2500),
        is_public=bool(row.get("is_public", True)),
        is_active=bool(row.get("is_active", True)),
        meta=_meta_dict(row.get("meta")),
        created_at=str(row.get("created_at") or ""),
        updated_at=str(row.get("updated_at")) if row.get("updated_at") else None,
    )


def _profile_review_summary_for_target(*, target_user_id: str, supabase: Client) -> ProfessionalProfileReviewSummaryResponse:
    try:
        rows = _rows(
            supabase.table(PROFILE_REVIEWS_TABLE)
            .select("rating,is_public,is_active")
            .eq("target_user_id", target_user_id)
            .eq("is_active", True)
            .eq("is_public", True)
            .limit(5000)
            .execute()
        )
    except Exception as exc:
        _raise_profile_reviews_migration_required(exc)

    counts: Dict[int, int] = {1: 0, 2: 0, 3: 0, 4: 0, 5: 0}
    total = 0
    score_sum = 0
    for row in rows:
        rating = _parse_optional_non_negative_int(row.get("rating"), max_value=5)
        if not rating or rating < 1:
            continue
        counts[rating] = counts.get(rating, 0) + 1
        total += 1
        score_sum += rating

    average_rating = round(score_sum / total, 2) if total > 0 else 0.0
    return ProfessionalProfileReviewSummaryResponse(
        average_rating=average_rating,
        total_reviews=total,
        rating_1=counts.get(1, 0),
        rating_2=counts.get(2, 0),
        rating_3=counts.get(3, 0),
        rating_4=counts.get(4, 0),
        rating_5=counts.get(5, 0),
    )


def _profile_review_summary_map_for_targets(
    *,
    target_user_ids: List[str],
    supabase: Client,
) -> Dict[str, ProfessionalProfileReviewSummaryResponse]:
    unique_ids = sorted({str(value or "").strip() for value in target_user_ids if str(value or "").strip()})
    if not unique_ids:
        return {}
    try:
        rows = _rows(
            supabase.table(PROFILE_REVIEWS_TABLE)
            .select("target_user_id,rating,is_public,is_active")
            .in_("target_user_id", unique_ids)
            .eq("is_active", True)
            .eq("is_public", True)
            .limit(8000)
            .execute()
        )
    except Exception as exc:
        _raise_profile_reviews_migration_required(exc)

    counts_by_target: Dict[str, Dict[int, int]] = {}
    totals_by_target: Dict[str, int] = {}
    sums_by_target: Dict[str, int] = {}
    for row in rows:
        target_user_id = str(row.get("target_user_id") or "").strip()
        if not target_user_id:
            continue
        rating = _parse_optional_non_negative_int(row.get("rating"), max_value=5)
        if not rating or rating < 1:
            continue
        if target_user_id not in counts_by_target:
            counts_by_target[target_user_id] = {1: 0, 2: 0, 3: 0, 4: 0, 5: 0}
            totals_by_target[target_user_id] = 0
            sums_by_target[target_user_id] = 0
        counts_by_target[target_user_id][rating] = counts_by_target[target_user_id].get(rating, 0) + 1
        totals_by_target[target_user_id] = totals_by_target.get(target_user_id, 0) + 1
        sums_by_target[target_user_id] = sums_by_target.get(target_user_id, 0) + rating

    out: Dict[str, ProfessionalProfileReviewSummaryResponse] = {}
    for user_id in unique_ids:
        total = totals_by_target.get(user_id, 0)
        score_sum = sums_by_target.get(user_id, 0)
        counts = counts_by_target.get(user_id, {1: 0, 2: 0, 3: 0, 4: 0, 5: 0})
        out[user_id] = ProfessionalProfileReviewSummaryResponse(
            average_rating=round(score_sum / total, 2) if total > 0 else 0.0,
            total_reviews=total,
            rating_1=counts.get(1, 0),
            rating_2=counts.get(2, 0),
            rating_3=counts.get(3, 0),
            rating_4=counts.get(4, 0),
            rating_5=counts.get(5, 0),
        )
    return out


def _profile_edit_access_allowed(user_ctx: Dict[str, Any]) -> bool:
    if _is_admin_or_moderator(user_ctx):
        return True
    return _is_provider_like(user_ctx) or _is_mentor_like(user_ctx)


def _backfill_missing_profiles_from_onboarding(
    *,
    supabase: Client,
    desired_role: Optional[str] = None,
) -> None:
    normalized_role = _normalize_profile_role(desired_role, fallback="") if desired_role else None
    if normalized_role and normalized_role not in {"mentor", "creator"}:
        return

    try:
        query = (
            supabase.table(ONBOARDING_REQUESTS_TABLE)
            .select("id,user_id,desired_role,full_name,city,years_experience,about,reviewed_at,created_at,status")
            .eq("status", "approved")
            .order("reviewed_at", desc=True)
            .limit(500)
        )
        if normalized_role:
            query = query.eq("desired_role", normalized_role)
        approved_rows = _rows(query.execute())
    except Exception:
        return

    latest_by_user: Dict[str, Dict[str, Any]] = {}
    for row in approved_rows:
        user_id = str(row.get("user_id") or "").strip()
        role = _normalize_profile_role(row.get("desired_role"), fallback="")
        if not user_id or role not in {"mentor", "creator"}:
            continue
        if normalized_role and role != normalized_role:
            continue
        if user_id not in latest_by_user:
            latest_by_user[user_id] = row

    if not latest_by_user:
        return

    user_ids = list(latest_by_user.keys())
    try:
        existing_rows = _rows(
            supabase.table(PROFILES_TABLE)
            .select("id,user_id,display_name,headline,bio,years_experience,city,is_verified,meta")
            .in_("user_id", user_ids)
            .execute()
        )
    except Exception:
        return

    existing_map: Dict[str, Dict[str, Any]] = {}
    for row in existing_rows:
        existing_user_id = str(row.get("user_id") or "").strip()
        if existing_user_id:
            existing_map[existing_user_id] = row

    now_iso = _utc_now_iso()
    for user_id, app in latest_by_user.items():
        role = _normalize_profile_role(app.get("desired_role"), fallback="mentor")
        role_title = _professional_role_title(role)
        fallback_name = f"UPSC {role_title}"
        full_name = str(app.get("full_name") or "").strip() or fallback_name
        city = _as_optional_text(app.get("city"), max_length=120)
        about = _as_optional_text(app.get("about"), max_length=3000)
        years_experience = _parse_optional_non_negative_int(app.get("years_experience"), max_value=60)
        approved_at = _as_optional_text(app.get("reviewed_at"), max_length=80) or _as_optional_text(
            app.get("created_at"), max_length=80
        )
        app_id = _parse_optional_non_negative_int(app.get("id"))

        existing = existing_map.get(user_id)
        if existing:
            existing_meta = _meta_dict(existing.get("meta"))
            merged_meta = dict(existing_meta)
            merged_meta["onboarding_source"] = "professional_onboarding"
            if app_id is not None:
                merged_meta["onboarding_application_id"] = app_id
            if approved_at:
                merged_meta["onboarding_approved_at"] = approved_at

            try:
                supabase.table(PROFILES_TABLE).update(
                    {
                        "role": role,
                        "display_name": str(existing.get("display_name") or "").strip() or full_name,
                        "headline": _as_optional_text(existing.get("headline"), max_length=180) or f"UPSC {role_title}",
                        "bio": existing.get("bio") or about,
                        "years_experience": existing.get("years_experience")
                        if existing.get("years_experience") is not None
                        else years_experience,
                        "city": existing.get("city") or city,
                        "is_verified": bool(existing.get("is_verified", False)) or True,
                        "is_public": True,
                        "is_active": True,
                        "meta": merged_meta,
                        "updated_at": now_iso,
                    }
                ).eq("id", int(existing.get("id") or 0)).execute()
            except Exception:
                continue
            continue

        insert_meta: Dict[str, Any] = {
            "onboarding_source": "professional_onboarding",
        }
        if app_id is not None:
            insert_meta["onboarding_application_id"] = app_id
        if approved_at:
            insert_meta["onboarding_approved_at"] = approved_at

        try:
            supabase.table(PROFILES_TABLE).insert(
                {
                    "user_id": user_id,
                    "role": role,
                    "display_name": full_name,
                    "headline": f"UPSC {role_title}",
                    "bio": about,
                    "years_experience": years_experience,
                    "city": city,
                    "is_verified": True,
                    "highlights": [],
                    "credentials": [],
                    "specialization_tags": [],
                    "languages": [],
                    "is_public": True,
                    "is_active": True,
                    "meta": insert_meta,
                    "created_at": now_iso,
                    "updated_at": now_iso,
                }
            ).execute()
        except Exception:
            continue


def _default_subscription_plans() -> List[SubscriptionPlanResponse]:
    return [
        SubscriptionPlanResponse(
            id="starter",
            name="Starter",
            description="Entry plan for AI tools and basic practice workflow.",
            price=0.0,
            currency="INR",
            billing_cycle="monthly",
            is_active=True,
            features=[
                "AI quiz generation access",
                "Create and attempt personal tests",
                "Basic mentorship request flow",
            ],
            meta={"placeholder": True},
        ),
        SubscriptionPlanResponse(
            id="pro",
            name="Pro",
            description="Paid plan scaffold with richer limits and premium workflows.",
            price=999.0,
            currency="INR",
            billing_cycle="monthly",
            is_active=True,
            features=[
                "Higher AI usage limits",
                "Premium Prelims + Mains series access",
                "Priority mentorship handling",
            ],
            meta={"placeholder": True},
        ),
    ]


def _subscription_status_from_user_ctx(user_ctx: Dict[str, Any]) -> UserSubscriptionStatusResponse:
    app_meta = user_ctx.get("app_metadata") or {}
    user_meta = user_ctx.get("user_metadata") or {}
    status = _as_role(app_meta.get("subscription_status") or user_meta.get("subscription_status"))
    plan_id = _as_role(app_meta.get("plan") or user_meta.get("plan") or app_meta.get("tier") or user_meta.get("tier"))
    if not status:
        if _is_active_subscription(user_ctx):
            status = "active"
        else:
            status = "inactive"
    plan_name = str(app_meta.get("plan_name") or user_meta.get("plan_name") or plan_id or "").strip() or None
    valid_until = (
        str(app_meta.get("subscription_valid_until") or user_meta.get("subscription_valid_until") or "").strip()
        or None
    )
    source = str(app_meta.get("subscription_source") or user_meta.get("subscription_source") or "").strip() or None
    return UserSubscriptionStatusResponse(
        is_active=status in {"active", "paid", "premium"} or _is_active_subscription(user_ctx),
        status=status or "inactive",
        plan_id=plan_id or None,
        plan_name=plan_name,
        valid_until=valid_until,
        source=source,
        meta={},
    )


def _extract_category_ids_from_meta(meta: Dict[str, Any]) -> List[int]:
    raw = meta.get("category_ids")
    if not isinstance(raw, list):
        return []
    values: List[int] = []
    for item in raw:
        try:
            parsed = int(item)
        except (TypeError, ValueError):
            continue
        if parsed > 0 and parsed not in values:
            values.append(parsed)
    return values


def _matches_discovery_search(search: str, *parts: Optional[str]) -> bool:
    normalized = search.strip().lower()
    if not normalized:
        return True
    haystack = " ".join([str(part or "").strip().lower() for part in parts if part is not None])
    return normalized in haystack


def _safe_category_name_map(category_ids: List[int], supabase: Client) -> Dict[int, str]:
    unique_ids = sorted({cid for cid in category_ids if cid > 0})
    if not unique_ids:
        return {}
    try:
        rows = _rows(supabase.table("categories").select("id, name").in_("id", unique_ids).execute())
    except Exception:
        return {}
    output: Dict[int, str] = {}
    for row in rows:
        try:
            cid = int(row.get("id") or 0)
        except (TypeError, ValueError):
            continue
        if cid <= 0:
            continue
        name = str(row.get("name") or "").strip()
        if name:
            output[cid] = name
    return output


def _safe_profile_map(user_ids: List[str], supabase: Client) -> Dict[str, ProfessionalProfileResponse]:
    normalized_ids = [str(value or "").strip() for value in user_ids]
    unique_ids = sorted({value for value in normalized_ids if value})
    if not unique_ids:
        return {}
    try:
        rows = _rows(
            supabase.table(PROFILES_TABLE)
            .select("*")
            .in_("user_id", unique_ids)
            .eq("is_public", True)
            .eq("is_active", True)
            .execute()
        )
    except Exception:
        return {}
    output: Dict[str, ProfessionalProfileResponse] = {}
    for row in rows:
        user_id = str(row.get("user_id") or "").strip()
        if not user_id:
            continue
        output[user_id] = _profile_response(row)
    return output


def _resolve_collection_test_kind(meta: Optional[Dict[str, Any]]) -> CollectionTestKind:
    payload = meta if isinstance(meta, dict) else {}
    explicit_kind = _as_role(payload.get("test_kind"))
    if explicit_kind == CollectionTestKind.MAINS.value:
        return CollectionTestKind.MAINS
    if explicit_kind == CollectionTestKind.PRELIMS.value:
        return CollectionTestKind.PRELIMS

    mode = _as_role(payload.get("collection_mode"))
    if mode in {"mains", "mains_ai", "mains_ai_question", "mains_question", "mains_test"}:
        return CollectionTestKind.MAINS
    if mode in {"prelims", "prelims_quiz", "quiz", "quiz_collection", "quiz_test"}:
        return CollectionTestKind.PRELIMS
    return CollectionTestKind.PRELIMS


def _apply_collection_test_kind_meta(meta: Dict[str, Any], test_kind: CollectionTestKind) -> Dict[str, Any]:
    normalized_meta = dict(meta or {})
    if test_kind == CollectionTestKind.MAINS:
        normalized_meta["collection_mode"] = "mains_ai"
        normalized_meta["test_kind"] = CollectionTestKind.MAINS.value
        return normalized_meta
    normalized_meta["collection_mode"] = "prelims_quiz"
    normalized_meta["test_kind"] = CollectionTestKind.PRELIMS.value
    return normalized_meta


def _enforce_series_kind_authoring_access(*, user_ctx: Dict[str, Any], series_kind: Any) -> None:
    if _is_admin(user_ctx):
        return

    normalized_kind = _as_role(series_kind)
    is_quiz_master = _is_provider_like(user_ctx)
    is_mains_mentor = _is_mentor_like(user_ctx)

    if normalized_kind in {TestSeriesKind.MAINS.value, TestSeriesKind.HYBRID.value} and not is_mains_mentor:
        raise HTTPException(
            status_code=403,
            detail="Mains series authoring requires Mains Mentor access.",
        )
    if normalized_kind == TestSeriesKind.QUIZ.value and not is_quiz_master:
        raise HTTPException(
            status_code=403,
            detail="Prelims series authoring requires Quiz Master access.",
        )


def _enforce_test_kind_authoring_access(*, user_ctx: Dict[str, Any], test_kind: Any) -> None:
    if _is_admin(user_ctx):
        return

    normalized_kind = _as_role(test_kind)
    is_quiz_master = _is_provider_like(user_ctx)
    is_mains_mentor = _is_mentor_like(user_ctx)

    if normalized_kind == CollectionTestKind.MAINS.value and not is_mains_mentor:
        raise HTTPException(
            status_code=403,
            detail="Mains test authoring requires Mains Mentor access.",
        )
    if normalized_kind == CollectionTestKind.PRELIMS.value and not is_quiz_master:
        raise HTTPException(
            status_code=403,
            detail="Prelims test authoring requires Quiz Master access.",
        )


def _series_row_to_response(row: Dict[str, Any], test_count: int = 0) -> TestSeriesResponse:
    meta = _meta_dict(row.get("meta"))
    series_kind_raw = _as_role(row.get("series_kind")) or TestSeriesKind.MAINS.value
    access_type_raw = _as_role(row.get("access_type")) or TestSeriesAccessType.SUBSCRIPTION.value
    try:
        series_kind = TestSeriesKind(series_kind_raw)
    except ValueError:
        series_kind = TestSeriesKind.MAINS
    try:
        access_type = TestSeriesAccessType(access_type_raw)
    except ValueError:
        access_type = TestSeriesAccessType.SUBSCRIPTION
    price_raw = row.get("price")
    try:
        price = float(price_raw) if price_raw is not None else 0.0
    except (TypeError, ValueError):
        price = 0.0

    return TestSeriesResponse(
        id=int(row.get("id") or 0),
        title=str(row.get("title") or ""),
        description=row.get("description"),
        cover_image_url=row.get("cover_image_url"),
        provider_user_id=str(row.get("provider_user_id") or ""),
        series_kind=series_kind,
        access_type=access_type,
        price=price,
        is_public=bool(row.get("is_public", False)),
        is_active=bool(row.get("is_active", True)),
        meta=meta,
        test_count=test_count,
        created_at=str(row.get("created_at") or ""),
        updated_at=str(row.get("updated_at")) if row.get("updated_at") else None,
    )


def _resolve_series_id_from_collection(collection_row: Dict[str, Any]) -> Optional[int]:
    direct_series_id = collection_row.get("series_id")
    if direct_series_id is not None:
        try:
            parsed_direct = int(direct_series_id)
            if parsed_direct > 0:
                return parsed_direct
        except (TypeError, ValueError):
            pass

    meta = _meta_dict(collection_row.get("meta"))
    meta_series_id = meta.get("series_id")
    try:
        parsed_meta = int(meta_series_id)
        if parsed_meta > 0:
            return parsed_meta
    except (TypeError, ValueError):
        return None
    return None


def _collection_row_to_test_response(collection_row: Dict[str, Any], series_id: int) -> TestSeriesTestResponse:
    meta = _meta_dict(collection_row.get("meta"))
    kind = _resolve_collection_test_kind(meta)
    price_raw = collection_row.get("price")
    try:
        price = float(price_raw) if price_raw is not None else 0.0
    except (TypeError, ValueError):
        price = 0.0
    series_order = collection_row.get("series_order", meta.get("series_order", 0))
    try:
        order_value = int(series_order or 0)
    except (TypeError, ValueError):
        order_value = 0

    return TestSeriesTestResponse(
        id=int(collection_row.get("id") or 0),
        series_id=series_id,
        title=str(collection_row.get("title") or ""),
        description=collection_row.get("description"),
        test_kind=kind,
        test_label="Mains Test" if kind == CollectionTestKind.MAINS else "Prelims Test",
        thumbnail_url=collection_row.get("thumbnail_url"),
        is_public=bool(collection_row.get("is_public", False)),
        is_premium=bool(collection_row.get("is_premium", True)),
        price=price,
        is_finalized=bool(collection_row.get("is_finalized", False)),
        is_active=bool(collection_row.get("is_active", True)),
        series_order=order_value,
        question_count=max(0, int(collection_row.get("question_count") or 0)),
        meta=meta,
        created_at=str(collection_row.get("created_at") or ""),
        updated_at=str(collection_row.get("updated_at")) if collection_row.get("updated_at") else None,
    )


def _is_mains_question_content(content_type: Any, data: Dict[str, Any]) -> bool:
    if str(content_type or "").strip().lower() != ContentType.QUESTION.value:
        return False
    mode = str(data.get("mode") or data.get("kind") or "").strip().lower()
    if mode in {"mains_ai", "mains_ai_question", "mains_question", "mains_test"}:
        return True
    question_text = str(
        data.get("question_text")
        or data.get("question_statement")
        or data.get("question")
        or ""
    ).strip()
    return bool(question_text and ("model_answer" in data or "answer_approach" in data))


def _question_count_for_collection_content(content_row: Any) -> int:
    if isinstance(content_row, list):
        content_row = content_row[0] if content_row else {}
    if not isinstance(content_row, dict):
        return 0

    content_type = str(content_row.get("type") or "").strip().lower()
    data = content_row.get("data")
    if not isinstance(data, dict):
        data = {}

    if content_type == ContentType.QUIZ_PASSAGE.value:
        questions = data.get("questions")
        if not isinstance(questions, list):
            return 0
        return sum(1 for row in questions if isinstance(row, dict))

    if content_type in {ContentType.QUIZ_GK.value, ContentType.QUIZ_MATHS.value}:
        return 1

    if _is_mains_question_content(content_type, data):
        return 1

    return 0


def _fetch_test_question_counts(collection_ids: List[int], supabase: Client) -> Dict[int, int]:
    normalized_ids = sorted({int(collection_id) for collection_id in collection_ids if int(collection_id) > 0})
    if not normalized_ids:
        return {}

    counts = {collection_id: 0 for collection_id in normalized_ids}
    try:
        rows = _rows(
            supabase.table("collection_items")
            .select("collection_id, content_items(type, data)")
            .in_("collection_id", normalized_ids)
            .execute()
        )
    except Exception:
        return counts

    for row in rows:
        try:
            collection_id = int(row.get("collection_id") or 0)
        except (TypeError, ValueError):
            continue
        if collection_id not in counts:
            continue
        counts[collection_id] += _question_count_for_collection_content(row.get("content_items"))
    return counts


def _fetch_series_or_404(series_id: int, supabase: Client) -> Dict[str, Any]:
    try:
        row = _first(
            supabase.table(TEST_SERIES_TABLE)
            .select("*")
            .eq("id", series_id)
            .limit(1)
            .execute()
        )
    except Exception as exc:
        _raise_test_series_migration_required(exc)
    if not row:
        raise HTTPException(status_code=404, detail="Test series not found.")
    return row


def _fetch_collection_or_404(test_id: int, supabase: Client) -> Dict[str, Any]:
    row = _first(
        supabase.table("collections")
        .select("*")
        .eq("id", test_id)
        .limit(1)
        .execute()
    )
    if not row:
        raise HTTPException(status_code=404, detail="Test not found.")
    return row


def _fetch_mains_test_question_context(test_id: int, supabase: Client) -> List[Dict[str, Any]]:
    rows = _rows(
        supabase.table("collection_items")
        .select("id, content_item_id, order, section_title, content_items(*)")
        .eq("collection_id", test_id)
        .order("order")
        .execute()
    )

    output: List[Dict[str, Any]] = []
    question_number = 0
    for row in rows:
        content = row.get("content_items")
        if isinstance(content, list):
            content = content[0] if content else None
        if not isinstance(content, dict):
            continue

        data = content.get("data") or {}
        if not isinstance(data, dict):
            data = {}
        if not _is_mains_question_content(content.get("type"), data):
            continue

        question_text = str(
            data.get("question_text")
            or data.get("question_statement")
            or data.get("question")
            or ""
        ).strip()
        if not question_text:
            continue

        question_number += 1
        word_limit = _parse_optional_non_negative_int(data.get("word_limit"), max_value=1000) or 150
        max_marks = _normalize_mains_question_max_marks(
            data.get("max_marks") or data.get("marks") or data.get("question_marks"),
            fallback=10.0,
        )

        output.append(
            {
                "question_item_id": _safe_int(row.get("content_item_id") or content.get("id"), 0),
                "collection_item_id": _safe_int(row.get("id"), 0),
                "question_number": question_number,
                "question_text": question_text,
                "word_limit": word_limit,
                "max_marks": max_marks,
            }
        )

    return output


def _build_mains_question_context_maps(
    questions: List[Dict[str, Any]],
) -> tuple[Dict[int, Dict[str, Any]], Dict[int, Dict[str, Any]]]:
    by_item: Dict[int, Dict[str, Any]] = {}
    by_number: Dict[int, Dict[str, Any]] = {}
    for question in questions:
        question_item_id = _safe_int(question.get("question_item_id"), 0)
        question_number = _safe_int(question.get("question_number"), 0)
        if question_item_id > 0:
            by_item[question_item_id] = question
        if question_number > 0:
            by_number[question_number] = question
    return by_item, by_number


def _sanitize_question_submission_payload(
    question_responses: List[MainsCopySubmissionQuestionResponseCreate],
    *,
    questions: List[Dict[str, Any]],
) -> List[Dict[str, Any]]:
    by_item, by_number = _build_mains_question_context_maps(questions)
    merged: Dict[str, Dict[str, Any]] = {}

    for response in question_responses:
        answer_image_urls = _normalize_answer_image_urls(response.answer_image_urls)
        if not answer_image_urls:
            continue

        question_item_id = _safe_int(response.question_item_id, 0)
        question_number = _safe_int(response.question_number, 0)
        question = None
        if question_item_id > 0:
            question = by_item.get(question_item_id)
        if question is None and question_number > 0:
            question = by_number.get(question_number)
        if question is None:
            raise HTTPException(status_code=400, detail="One or more question image submissions do not belong to this test.")

        resolved_question_item_id = _safe_int(question.get("question_item_id"), 0) or question_item_id
        resolved_question_number = _safe_int(question.get("question_number"), 0) or question_number
        key = f"{resolved_question_item_id}:{resolved_question_number}"
        bucket = merged.get(key)
        if not bucket:
            bucket = {
                "question_item_id": resolved_question_item_id or None,
                "question_number": resolved_question_number or None,
                "answer_image_urls": [],
            }
            merged[key] = bucket
        for url in answer_image_urls:
            if url not in bucket["answer_image_urls"]:
                bucket["answer_image_urls"].append(url)

    return sorted(
        merged.values(),
        key=lambda item: (
            _safe_int(item.get("question_number"), 10**6),
            _safe_int(item.get("question_item_id"), 10**6),
        ),
    )


def _fetch_series_tests(
    *,
    series_id: int,
    supabase: Client,
    include_inactive: bool = False,
) -> List[Dict[str, Any]]:
    try:
        query = supabase.table("collections").select("*").eq("series_id", series_id)
        if not include_inactive:
            query = query.eq("is_active", True)
        rows = _rows(query.order("series_order").order("created_at").execute())
        return rows
    except Exception as exc:
        if "series_id" not in str(exc).lower():
            raise

    query = supabase.table("collections").select("*").contains("meta", {"series_id": series_id})
    if not include_inactive:
        query = query.eq("is_active", True)
    rows = _rows(query.order("created_at").execute())
    rows.sort(
        key=lambda row: int(_meta_dict(row.get("meta")).get("series_order") or 0)
    )
    return rows


def _fetch_public_series_tests(
    *,
    series_ids: List[int],
    supabase: Client,
) -> List[Dict[str, Any]]:
    if not series_ids:
        return []
    try:
        return _rows(
            supabase.table("collections")
            .select("*")
            .in_("series_id", series_ids)
            .eq("is_public", True)
            .eq("is_active", True)
            .order("created_at", desc=True)
            .execute()
        )
    except Exception as exc:
        if "series_id" not in str(exc).lower():
            raise

    fallback_rows = _rows(
        supabase.table("collections")
        .select("*")
        .eq("is_public", True)
        .eq("is_active", True)
        .order("created_at", desc=True)
        .execute()
    )
    series_id_set = {series_id for series_id in series_ids if series_id > 0}
    output: List[Dict[str, Any]] = []
    for row in fallback_rows:
        resolved_series_id = _resolve_series_id_from_collection(row)
        if resolved_series_id and resolved_series_id in series_id_set:
            output.append(row)
    return output


def _fetch_series_for_test_or_404(test_id: int, supabase: Client) -> tuple[Dict[str, Any], Dict[str, Any], int]:
    collection = _fetch_collection_or_404(test_id, supabase)
    series_id = _resolve_series_id_from_collection(collection)
    if not series_id:
        raise HTTPException(status_code=404, detail="Test is not mapped to a test series.")
    series = _fetch_series_or_404(series_id, supabase)
    return series, collection, series_id


def _ensure_series_owner_or_admin(series_row: Dict[str, Any], user_ctx: Dict[str, Any]) -> str:
    user_id = str(user_ctx.get("user_id") or "").strip()
    if not user_id:
        raise HTTPException(status_code=401, detail="Authentication required.")
    if _is_admin(user_ctx):
        return user_id
    provider_user_id = str(series_row.get("provider_user_id") or "").strip()
    if provider_user_id != user_id:
        raise HTTPException(status_code=403, detail="Only the provider can manage this test series.")
    return user_id


def _series_mentor_user_ids(series_row: Dict[str, Any]) -> List[str]:
    meta = _meta_dict(series_row.get("meta"))
    raw_ids = meta.get("mentor_user_ids")
    if not isinstance(raw_ids, list):
        raw_ids = []
    output: List[str] = []
    for raw in raw_ids:
        value = str(raw or "").strip()
        if value and value not in output:
            output.append(value)
    single_mentor = str(meta.get("mentor_user_id") or "").strip()
    if single_mentor and single_mentor not in output:
        output.append(single_mentor)
    return output


def _resolve_series_handler_user_id(series_row: Dict[str, Any]) -> str:
    mentor_ids = _series_mentor_user_ids(series_row)
    if mentor_ids:
        return mentor_ids[0]
    return str(series_row.get("provider_user_id") or "").strip()


def _ensure_series_mentor_or_admin(series_row: Dict[str, Any], user_ctx: Dict[str, Any]) -> str:
    user_id = str(user_ctx.get("user_id") or "").strip()
    if not user_id:
        raise HTTPException(status_code=401, detail="Authentication required.")
    if _is_admin(user_ctx):
        return user_id
    if not _is_mentor_like(user_ctx):
        raise HTTPException(status_code=403, detail="Only mentors can handle evaluation and mentorship workflows.")

    mentor_ids = _series_mentor_user_ids(series_row)
    if mentor_ids and user_id not in mentor_ids:
        raise HTTPException(status_code=403, detail="This mentor is not assigned to the series.")
    return user_id


def _can_monitor_or_review_series(user_ctx: Dict[str, Any], series_row: Dict[str, Any]) -> bool:
    user_id = str(user_ctx.get("user_id") or "").strip()
    if not user_id:
        return False
    if _is_admin_or_moderator(user_ctx):
        return True
    if str(series_row.get("provider_user_id") or "").strip() == user_id:
        return True
    if _is_mentor_like(user_ctx):
        mentor_ids = _series_mentor_user_ids(series_row)
        return (not mentor_ids) or (user_id in mentor_ids)
    return False


def _primary_series_ids_for_mentor(*, mentor_user_id: str, supabase: Client) -> List[int]:
    if not mentor_user_id:
        return []
    series_rows = _safe_rows(
        supabase.table(TEST_SERIES_TABLE)
        .select("id,meta")
        .limit(2000)
    )
    output: List[int] = []
    for row in series_rows:
        series_id = int(row.get("id") or 0)
        if series_id <= 0:
            continue
        mentor_ids = _series_mentor_user_ids(row)
        if mentor_ids and mentor_ids[0] == mentor_user_id:
            output.append(series_id)
    return output


def _claim_primary_mentor_requests(*, mentor_user_id: str, supabase: Client) -> None:
    series_ids = _primary_series_ids_for_mentor(mentor_user_id=mentor_user_id, supabase=supabase)
    if not series_ids:
        return

    request_rows = _safe_rows(
        supabase.table(MENTORSHIP_REQUESTS_TABLE)
        .select("id,status,provider_user_id")
        .in_("series_id", series_ids)
        .in_(
            "status",
            [
                MentorshipRequestStatus.REQUESTED.value,
                MentorshipRequestStatus.SCHEDULED.value,
            ],
        )
    )
    if not request_rows:
        return

    now_iso = _utc_now_iso()
    for row in request_rows:
        request_id = int(row.get("id") or 0)
        if request_id <= 0:
            continue
        current_provider = str(row.get("provider_user_id") or "").strip()
        if current_provider == mentor_user_id:
            continue

        _safe_first(
            supabase.table(MENTORSHIP_REQUESTS_TABLE)
            .update(
                {
                    "provider_user_id": mentor_user_id,
                    "updated_at": now_iso,
                }
            )
            .eq("id", request_id)
        )

        if str(row.get("status") or "").strip() == MentorshipRequestStatus.SCHEDULED.value:
            _safe_first(
                supabase.table(MENTORSHIP_SESSIONS_TABLE)
                .update(
                    {
                        "provider_user_id": mentor_user_id,
                        "updated_at": now_iso,
                    }
                )
                .eq("request_id", request_id)
            )


def _series_enrollment_row(
    *,
    series_id: int,
    user_id: str,
    supabase: Client,
) -> Optional[Dict[str, Any]]:
    return _safe_first(
        supabase.table(TEST_SERIES_ENROLLMENTS_TABLE)
        .select("*")
        .eq("series_id", series_id)
        .eq("user_id", user_id)
        .eq("status", "active")
        .limit(1)
    )


def _has_active_mentorship_entitlement(user_id: str, supabase: Client) -> bool:
    now_iso = _utc_now_iso()
    rows = _safe_rows(
        supabase.table(MENTORSHIP_ENTITLEMENTS_TABLE)
        .select("*")
        .eq("user_id", user_id)
        .eq("is_active", True)
        .gt("sessions_remaining", 0)
        .or_(f"valid_until.is.null,valid_until.gte.{now_iso}")
    )
    return len(rows) > 0


def _consume_mentorship_entitlement(user_id: str, supabase: Client) -> None:
    now_iso = _utc_now_iso()
    row = _safe_first(
        supabase.table(MENTORSHIP_ENTITLEMENTS_TABLE)
        .select("*")
        .eq("user_id", user_id)
        .eq("is_active", True)
        .gt("sessions_remaining", 0)
        .or_(f"valid_until.is.null,valid_until.gte.{now_iso}")
        .order("created_at")
        .limit(1)
    )
    if not row:
        raise HTTPException(status_code=403, detail="No mentorship entitlement remaining.")

    remaining = int(row.get("sessions_remaining") or 0) - 1
    if remaining < 0:
        remaining = 0
    supabase.table(MENTORSHIP_ENTITLEMENTS_TABLE).update(
        {
            "sessions_remaining": remaining,
            "updated_at": _utc_now_iso(),
            "is_active": remaining > 0,
        }
    ).eq("id", int(row["id"])).execute()


def _can_view_series(
    *,
    user_ctx: Optional[Dict[str, Any]],
    series_row: Dict[str, Any],
    supabase: Client,
) -> bool:
    if bool(series_row.get("is_public")) and bool(series_row.get("is_active", True)):
        return True
    if not user_ctx:
        return False
    if _is_admin_or_moderator(user_ctx):
        return True

    user_id = str(user_ctx.get("user_id") or "").strip()
    if not user_id:
        return False
    if str(series_row.get("provider_user_id") or "").strip() == user_id:
        return True

    series_id = int(series_row.get("id") or 0)
    if series_id <= 0:
        return False
    return _series_enrollment_row(series_id=series_id, user_id=user_id, supabase=supabase) is not None


def _can_access_series_content(
    *,
    user_ctx: Optional[Dict[str, Any]],
    series_row: Dict[str, Any],
    supabase: Client,
) -> bool:
    if not _can_view_series(user_ctx=user_ctx, series_row=series_row, supabase=supabase):
        return False
    if not user_ctx:
        return bool(series_row.get("access_type") == TestSeriesAccessType.FREE.value)

    if _is_admin_or_moderator(user_ctx):
        return True
    user_id = str(user_ctx.get("user_id") or "").strip()
    if not user_id:
        return False
    if str(series_row.get("provider_user_id") or "").strip() == user_id:
        return True

    access_type = _as_role(series_row.get("access_type")) or TestSeriesAccessType.SUBSCRIPTION.value
    if access_type == TestSeriesAccessType.FREE.value:
        return True

    series_id = int(series_row.get("id") or 0)
    if series_id > 0:
        enrollment = _series_enrollment_row(series_id=series_id, user_id=user_id, supabase=supabase)
        if enrollment:
            return True

    if access_type == TestSeriesAccessType.SUBSCRIPTION.value:
        return _is_active_subscription(user_ctx)
    return False


def _normalize_copy_status(value: Any) -> CopySubmissionStatus:
    normalized = _as_role(value)
    for status in CopySubmissionStatus:
        if normalized == status.value:
            return status
    return CopySubmissionStatus.SUBMITTED


def _normalize_mentorship_mode(value: Any) -> MentorshipMode:
    normalized = _as_role(value)
    for mode in MentorshipMode:
        if normalized == mode.value:
            return mode
    return MentorshipMode.VIDEO


def _looks_like_zoom_link(value: Any) -> bool:
    text = str(value or "").strip().lower()
    if not text:
        return False
    return (
        "zoom.us/" in text
        or "zoomgov.com/" in text
        or "us02web.zoom" in text
        or "us03web.zoom" in text
    )


def _normalize_mentorship_call_provider(
    value: Any,
    *,
    meeting_link: Any = None,
) -> MentorshipCallProvider:
    normalized = _as_role(value)
    if normalized == MentorshipCallProvider.ZOOM.value:
        return MentorshipCallProvider.ZOOM
    if normalized == MentorshipCallProvider.CUSTOM.value:
        return MentorshipCallProvider.ZOOM if _looks_like_zoom_link(meeting_link) else MentorshipCallProvider.CUSTOM
    if _looks_like_zoom_link(meeting_link):
        return MentorshipCallProvider.ZOOM
    return MentorshipCallProvider.CUSTOM


def _normalize_mentorship_request_status(value: Any) -> MentorshipRequestStatus:
    normalized = _as_role(value)
    for status in MentorshipRequestStatus:
        if normalized == status.value:
            return status
    return MentorshipRequestStatus.REQUESTED


def _normalize_mentorship_session_status(value: Any) -> MentorshipSessionStatus:
    normalized = _as_role(value)
    for status in MentorshipSessionStatus:
        if normalized == status.value:
            return status
    return MentorshipSessionStatus.SCHEDULED


def _mentor_call_profile_defaults(
    provider_user_id: str,
    *,
    supabase: Client,
) -> tuple[MentorshipCallProvider, Optional[str], Optional[str]]:
    normalized_provider_user_id = str(provider_user_id or "").strip()
    if not normalized_provider_user_id:
        return MentorshipCallProvider.CUSTOM, None, None

    profile_row = _safe_first(
        supabase.table(PROFILES_TABLE)
        .select("meta")
        .eq("user_id", normalized_provider_user_id)
        .limit(1)
    )
    profile_meta = _normalize_profile_meta((profile_row or {}).get("meta"))
    zoom_meeting_link = _as_optional_text(profile_meta.get("mentorship_zoom_meeting_link"), max_length=1200)
    call_setup_note = _as_optional_text(profile_meta.get("mentorship_call_setup_note"), max_length=1200)
    default_call_provider = _normalize_mentorship_call_provider(
        profile_meta.get("mentorship_default_call_provider"),
        meeting_link=zoom_meeting_link,
    )
    return default_call_provider, zoom_meeting_link, call_setup_note


def _resolve_copy_submission_mode(row: Dict[str, Any]) -> CopySubmissionMode:
    explicit = _as_role(row.get("submission_mode"))
    if explicit:
        return _normalize_copy_submission_mode(explicit)

    raw_question_responses = row.get("question_responses")
    has_question_responses = isinstance(raw_question_responses, list) and any(
        isinstance(item, dict) and _normalize_answer_image_urls(item.get("answer_image_urls"))
        for item in raw_question_responses
    )
    has_answer_pdf = bool(str(row.get("answer_pdf_url") or "").strip())
    if has_answer_pdf and has_question_responses:
        return CopySubmissionMode.HYBRID
    if has_question_responses:
        return CopySubmissionMode.QUESTION_WISE
    return CopySubmissionMode.PDF


def _copy_question_responses_for_submission(
    row: Dict[str, Any],
    *,
    supabase: Client,
    question_context: Optional[List[Dict[str, Any]]] = None,
) -> List[MainsCopySubmissionQuestionResponse]:
    if question_context is None:
        test_id = _safe_int(row.get("test_collection_id"), 0)
        question_context = _fetch_mains_test_question_context(test_id, supabase) if test_id > 0 else []
    by_item, by_number = _build_mains_question_context_maps(question_context)

    raw_question_responses = row.get("question_responses")
    if not isinstance(raw_question_responses, list):
        raw_question_responses = []

    output: List[MainsCopySubmissionQuestionResponse] = []
    for item in raw_question_responses:
        if not isinstance(item, dict):
            continue
        question_item_id = _safe_int(item.get("question_item_id"), 0)
        question_number = _safe_int(item.get("question_number"), 0)
        question = None
        if question_item_id > 0:
            question = by_item.get(question_item_id)
        if question is None and question_number > 0:
            question = by_number.get(question_number)

        output.append(
            MainsCopySubmissionQuestionResponse(
                question_item_id=question_item_id or None,
                question_number=question_number or None,
                answer_image_urls=_normalize_answer_image_urls(item.get("answer_image_urls")),
                question_text=str(question.get("question_text") or "") if question else None,
                word_limit=(_safe_int(question.get("word_limit"), 0) or None) if question else None,
                max_marks=(_safe_float(question.get("max_marks"), 0.0) or None) if question else None,
            )
        )

    output.sort(
        key=lambda question: (
            _safe_int(question.question_number, 10**6),
            _safe_int(question.question_item_id, 10**6),
        )
    )
    return output


def _copy_marks_for_submission(submission_id: int, supabase: Client) -> List[MainsCopySubmissionQuestionMarkResponse]:
    rows = _safe_rows(
        supabase.table(COPY_MARKS_TABLE)
        .select("*")
        .eq("submission_id", submission_id)
        .order("question_number")
        .order("id")
    )
    out: List[MainsCopySubmissionQuestionMarkResponse] = []
    for row in rows:
        out.append(
            MainsCopySubmissionQuestionMarkResponse(
                id=int(row.get("id") or 0),
                submission_id=int(row.get("submission_id") or submission_id),
                question_item_id=int(row["question_item_id"]) if row.get("question_item_id") is not None else None,
                question_number=int(row["question_number"]) if row.get("question_number") is not None else None,
                marks_awarded=float(row.get("marks_awarded") or 0.0),
                max_marks=float(row.get("max_marks") or 10.0),
                remark=row.get("remark"),
                created_at=str(row.get("created_at") or ""),
                updated_at=str(row.get("updated_at")) if row.get("updated_at") else None,
            )
        )
    return out


def _copy_submission_response(
    row: Dict[str, Any],
    supabase: Client,
    *,
    question_context: Optional[List[Dict[str, Any]]] = None,
) -> MainsCopySubmissionResponse:
    submission_id = int(row.get("id") or 0)
    return MainsCopySubmissionResponse(
        id=submission_id,
        series_id=int(row["series_id"]) if row.get("series_id") is not None else None,
        test_collection_id=int(row["test_collection_id"]) if row.get("test_collection_id") is not None else None,
        user_id=str(row.get("user_id") or ""),
        answer_pdf_url=str(row.get("answer_pdf_url") or "").strip() or None,
        submission_mode=_resolve_copy_submission_mode(row),
        status=_normalize_copy_status(row.get("status")),
        learner_note=row.get("learner_note"),
        provider_eta_hours=int(row["provider_eta_hours"]) if row.get("provider_eta_hours") is not None else None,
        provider_eta_text=row.get("provider_eta_text"),
        provider_note=row.get("provider_note"),
        checked_copy_pdf_url=row.get("checked_copy_pdf_url"),
        total_marks=float(row["total_marks"]) if row.get("total_marks") is not None else None,
        ai_total_score=float(row["ai_total_score"]) if row.get("ai_total_score") is not None else None,
        submitted_at=str(row.get("submitted_at") or ""),
        eta_set_at=str(row.get("eta_set_at")) if row.get("eta_set_at") else None,
        checked_at=str(row.get("checked_at")) if row.get("checked_at") else None,
        created_at=str(row.get("created_at") or ""),
        updated_at=str(row.get("updated_at")) if row.get("updated_at") else None,
        question_responses=_copy_question_responses_for_submission(row, supabase=supabase, question_context=question_context),
        question_marks=_copy_marks_for_submission(submission_id, supabase),
    )


def _latest_checked_submission_for_user(
    *,
    user_id: str,
    supabase: Client,
    series_id: Optional[int] = None,
    test_id: Optional[int] = None,
) -> Optional[Dict[str, Any]]:
    query = (
        supabase.table(COPY_SUBMISSIONS_TABLE)
        .select("*")
        .eq("user_id", user_id)
        .eq("status", CopySubmissionStatus.CHECKED.value)
        .limit(1)
    )
    if series_id is not None:
        query = query.eq("series_id", series_id)
    if test_id is not None:
        query = query.eq("test_collection_id", test_id)
    rows = _rows(query.order("checked_at", desc=True).order("submitted_at", desc=True).execute())
    return rows[0] if rows else None


def _copy_submission_request_row(
    *,
    submission_id: int,
    supabase: Client,
) -> Optional[Dict[str, Any]]:
    if submission_id <= 0:
        return None
    rows = _rows(
        supabase.table(MENTORSHIP_REQUESTS_TABLE)
        .select("*")
        .eq("submission_id", submission_id)
        .order("requested_at", desc=True)
        .limit(12)
        .execute()
    )
    if not rows:
        return None
    for row in rows:
        if _normalize_mentorship_request_status(row.get("status")) not in {
            MentorshipRequestStatus.CANCELLED,
            MentorshipRequestStatus.REJECTED,
            MentorshipRequestStatus.COMPLETED,
        }:
            return row
    return rows[0]


def _create_copy_evaluation_request(
    *,
    submission_row: Dict[str, Any],
    provider_user_id: str,
    preferred_mode: MentorshipMode,
    supabase: Client,
    standalone: bool,
) -> Dict[str, Any]:
    submission_id = int(submission_row.get("id") or 0)
    if submission_id <= 0:
        raise HTTPException(status_code=400, detail="Could not resolve submitted copy.")

    existing_request = _copy_submission_request_row(submission_id=submission_id, supabase=supabase)
    if existing_request:
        return existing_request

    requested_at_iso = _utc_now_iso()
    copy_status = _normalize_copy_status(submission_row.get("status")).value
    insert_payload = {
        "user_id": str(submission_row.get("user_id") or "").strip(),
        "provider_user_id": provider_user_id,
        "series_id": int(submission_row.get("series_id") or 0) or None,
        "test_collection_id": int(submission_row.get("test_collection_id") or 0) or None,
        "submission_id": submission_id,
        "preferred_mode": preferred_mode.value,
        "note": submission_row.get("learner_note"),
        "status": MentorshipRequestStatus.REQUESTED.value,
        "requested_at": requested_at_iso,
        "updated_at": requested_at_iso,
        "meta": {
            "standalone": standalone,
            "requires_entitlement": False,
            "flow_kind": "copy_evaluation",
            "workflow_stage": "copy_submitted",
            "copy_status": copy_status,
            "copy_submitted_at": str(submission_row.get("submitted_at") or requested_at_iso),
            "copy_request_source": "direct_mentor_submission" if standalone else "series_submission",
            "slot_offer_status": "pending",
            "offered_slot_ids": [],
        },
    }
    row = _first(supabase.table(MENTORSHIP_REQUESTS_TABLE).insert(insert_payload).execute())
    if not row:
        raise HTTPException(status_code=400, detail="Failed to create copy evaluation workflow.")
    return row


def _update_copy_flow_request_meta(
    *,
    submission_id: int,
    supabase: Client,
    updates: Dict[str, Any],
) -> Optional[Dict[str, Any]]:
    row = _copy_submission_request_row(submission_id=submission_id, supabase=supabase)
    if not row:
        return None

    meta = _meta_dict(row.get("meta"))
    for key, value in updates.items():
        if value is None:
            continue
        meta[key] = value
    updated = _first(
        supabase.table(MENTORSHIP_REQUESTS_TABLE)
        .update(
            {
                "meta": meta,
                "updated_at": _utc_now_iso(),
            }
        )
        .eq("id", int(row.get("id") or 0))
        .execute()
    )
    return updated or row


def _ensure_direct_copy_submission_provider_or_admin(
    submission_row: Dict[str, Any],
    user_ctx: Dict[str, Any],
) -> str:
    user_id = str(user_ctx.get("user_id") or "").strip()
    if not user_id:
        raise HTTPException(status_code=401, detail="Authentication required.")
    if _is_admin(user_ctx):
        return user_id
    if not _is_mentor_like(user_ctx):
        raise HTTPException(status_code=403, detail="Only mentors can handle evaluation workflows.")

    provider_user_id = str(submission_row.get("provider_user_id") or "").strip()
    if provider_user_id and provider_user_id != user_id:
        raise HTTPException(status_code=403, detail="This mentor is not assigned to the copy submission.")
    return user_id


def _slot_response(row: Dict[str, Any]) -> MentorshipSlotResponse:
    resolved_call_provider = _normalize_mentorship_call_provider(
        row.get("call_provider"),
        meeting_link=row.get("meeting_link"),
    )
    return MentorshipSlotResponse(
        id=int(row.get("id") or 0),
        provider_user_id=str(row.get("provider_user_id") or ""),
        starts_at=str(row.get("starts_at") or ""),
        ends_at=str(row.get("ends_at") or ""),
        mode=_normalize_mentorship_mode(row.get("mode")),
        call_provider=resolved_call_provider,
        max_bookings=int(row.get("max_bookings") or 1),
        booked_count=int(row.get("booked_count") or 0),
        is_active=bool(row.get("is_active", True)),
        meeting_link=row.get("meeting_link"),
        title=row.get("title"),
        description=row.get("description"),
        created_at=str(row.get("created_at") or ""),
        updated_at=str(row.get("updated_at")) if row.get("updated_at") else None,
    )


def _request_response(row: Dict[str, Any]) -> MentorshipRequestResponse:
    return MentorshipRequestResponse(
        id=int(row.get("id") or 0),
        user_id=str(row.get("user_id") or ""),
        provider_user_id=str(row.get("provider_user_id") or ""),
        series_id=int(row["series_id"]) if row.get("series_id") is not None else None,
        test_collection_id=int(row["test_collection_id"]) if row.get("test_collection_id") is not None else None,
        submission_id=int(row["submission_id"]) if row.get("submission_id") is not None else None,
        preferred_mode=_normalize_mentorship_mode(row.get("preferred_mode")),
        note=row.get("note"),
        status=_normalize_mentorship_request_status(row.get("status")),
        scheduled_slot_id=int(row["scheduled_slot_id"]) if row.get("scheduled_slot_id") is not None else None,
        requested_at=str(row.get("requested_at") or ""),
        updated_at=str(row.get("updated_at")) if row.get("updated_at") else None,
        meta=_meta_dict(row.get("meta")),
    )


def _session_response(row: Dict[str, Any]) -> MentorshipSessionResponse:
    resolved_call_provider = _normalize_mentorship_call_provider(
        row.get("call_provider"),
        meeting_link=row.get("meeting_link"),
    )
    return MentorshipSessionResponse(
        id=int(row.get("id") or 0),
        request_id=int(row.get("request_id") or 0),
        slot_id=int(row["slot_id"]) if row.get("slot_id") is not None else None,
        provider_user_id=str(row.get("provider_user_id") or ""),
        user_id=str(row.get("user_id") or ""),
        mode=_normalize_mentorship_mode(row.get("mode")),
        call_provider=resolved_call_provider,
        starts_at=str(row.get("starts_at") or ""),
        ends_at=str(row.get("ends_at") or ""),
        meeting_link=row.get("meeting_link"),
        copy_attachment_url=row.get("copy_attachment_url"),
        summary=row.get("summary"),
        status=_normalize_mentorship_session_status(row.get("status")),
        created_at=str(row.get("created_at") or ""),
        updated_at=str(row.get("updated_at")) if row.get("updated_at") else None,
    )


def _decrement_mentorship_slot_booking(slot_id: int, *, supabase: Client, updated_at_iso: str) -> None:
    if slot_id <= 0:
        return

    slot_row = _first(
        supabase.table(MENTORSHIP_SLOTS_TABLE)
        .select("id,booked_count")
        .eq("id", slot_id)
        .limit(1)
        .execute()
    )
    if not slot_row:
        return

    booked_count = max(int(slot_row.get("booked_count") or 0), 0)
    if booked_count <= 0:
        return

    supabase.table(MENTORSHIP_SLOTS_TABLE).update(
        {
            "booked_count": booked_count - 1,
            "updated_at": updated_at_iso,
        }
    ).eq("id", slot_id).execute()


def _slot_segments(starts_at: datetime, ends_at: datetime) -> List[tuple[datetime, datetime]]:
    if ends_at <= starts_at:
        return []

    duration = ends_at - starts_at
    if duration <= timedelta(minutes=MENTORSHIP_SLOT_DURATION_MINUTES):
        return [(starts_at, ends_at)]

    segments: List[tuple[datetime, datetime]] = []
    cursor = starts_at
    step = timedelta(minutes=MENTORSHIP_SLOT_DURATION_MINUTES)
    while cursor + step <= ends_at:
        segment_end = cursor + step
        segments.append((cursor, segment_end))
        cursor = segment_end
    return segments or [(starts_at, ends_at)]


def _expand_slot_insert_rows(
    *,
    provider_user_id: str,
    starts_at: datetime,
    ends_at: datetime,
    mode: str,
    call_provider: str,
    meeting_link: Optional[str],
    title: Optional[str],
    description: Optional[str],
    is_active: bool,
    updated_at_iso: str,
) -> List[Dict[str, Any]]:
    rows: List[Dict[str, Any]] = []
    for segment_start, segment_end in _slot_segments(starts_at, ends_at):
        rows.append(
            {
                "provider_user_id": provider_user_id,
                "starts_at": segment_start.isoformat(),
                "ends_at": segment_end.isoformat(),
                "mode": mode,
                "call_provider": call_provider,
                "max_bookings": 1,
                "booked_count": 0,
                "is_active": is_active,
                "meeting_link": meeting_link,
                "title": title,
                "description": description,
                "updated_at": updated_at_iso,
            }
        )
    return rows


def _materialize_slot_segments(
    slot_row: Dict[str, Any],
    *,
    supabase: Client,
    updated_at_iso: str,
) -> List[Dict[str, Any]]:
    starts_at = _required_datetime(str(slot_row.get("starts_at") or ""), "slot.starts_at")
    ends_at = _required_datetime(str(slot_row.get("ends_at") or ""), "slot.ends_at")
    segments = _slot_segments(starts_at, ends_at)
    if len(segments) <= 1:
        return [slot_row]
    if int(slot_row.get("booked_count") or 0) > 0:
        return [slot_row]

    provider_user_id = str(slot_row.get("provider_user_id") or "").strip()
    mode = str(slot_row.get("mode") or MentorshipMode.VIDEO.value)
    call_provider = _normalize_mentorship_call_provider(
        slot_row.get("call_provider"),
        meeting_link=slot_row.get("meeting_link"),
    ).value
    existing_rows = _safe_rows(
        supabase.table(MENTORSHIP_SLOTS_TABLE)
        .select("*")
        .eq("provider_user_id", provider_user_id)
        .eq("is_active", True)
        .gte("starts_at", starts_at.isoformat())
        .lte("ends_at", ends_at.isoformat())
        .order("starts_at")
    )
    exact_by_window = {
        (
            str(row.get("starts_at") or ""),
            str(row.get("ends_at") or ""),
            str(row.get("mode") or ""),
            str(_normalize_mentorship_call_provider(row.get("call_provider"), meeting_link=row.get("meeting_link")).value),
        ): row
        for row in existing_rows
        if int(row.get("id") or 0) != int(slot_row.get("id") or 0)
    }

    inserted_rows: List[Dict[str, Any]] = []
    for segment_start, segment_end in segments:
        key = (segment_start.isoformat(), segment_end.isoformat(), mode, call_provider)
        if key in exact_by_window:
            inserted_rows.append(exact_by_window[key])
            continue
        created = _first(
            supabase.table(MENTORSHIP_SLOTS_TABLE).insert(
                {
                    "provider_user_id": provider_user_id,
                    "starts_at": segment_start.isoformat(),
                    "ends_at": segment_end.isoformat(),
                    "mode": mode,
                    "call_provider": call_provider,
                    "max_bookings": 1,
                    "booked_count": 0,
                    "is_active": True,
                    "meeting_link": slot_row.get("meeting_link"),
                    "title": slot_row.get("title"),
                    "description": slot_row.get("description"),
                    "updated_at": updated_at_iso,
                }
            ).execute()
        )
        if created:
            inserted_rows.append(created)

    if int(slot_row.get("booked_count") or 0) <= 0 and bool(slot_row.get("is_active", True)):
        supabase.table(MENTORSHIP_SLOTS_TABLE).update(
            {"is_active": False, "updated_at": updated_at_iso}
        ).eq("id", int(slot_row.get("id") or 0)).execute()

    inserted_rows.sort(key=lambda row: str(row.get("starts_at") or ""))
    return inserted_rows or [slot_row]


def _schedule_mentorship_request_with_slot(
    *,
    request_row: Dict[str, Any],
    slot_row: Dict[str, Any],
    supabase: Client,
    now_iso: str,
    actor_user_id: str,
    actor_role: str,
    workflow_stage: str,
    call_provider_override: Optional[MentorshipCallProvider] = None,
    meeting_link_override: Optional[str] = None,
    request_meta_updates: Optional[Dict[str, Any]] = None,
) -> tuple[Dict[str, Any], Dict[str, Any]]:
    request_id = int(request_row.get("id") or 0)
    slot_id = int(slot_row.get("id") or 0)
    if request_id <= 0 or slot_id <= 0:
        raise HTTPException(status_code=400, detail="Could not resolve mentorship request or slot.")

    provider_user_id = str(request_row.get("provider_user_id") or "").strip()
    if str(slot_row.get("provider_user_id") or "").strip() != provider_user_id:
        raise HTTPException(status_code=400, detail="Slot belongs to a different mentor.")
    if not bool(slot_row.get("is_active", True)):
        raise HTTPException(status_code=400, detail="Selected slot is inactive.")

    starts_at = _required_datetime(str(slot_row.get("starts_at") or ""), "slot.starts_at")
    ends_at = _required_datetime(str(slot_row.get("ends_at") or ""), "slot.ends_at")
    if ends_at <= _utc_now():
        raise HTTPException(status_code=400, detail="Selected slot has already ended.")

    max_bookings = max(int(slot_row.get("max_bookings") or 1), 1)
    booked_count = max(int(slot_row.get("booked_count") or 0), 0)
    previous_slot_id = int(request_row.get("scheduled_slot_id") or 0)
    if previous_slot_id != slot_id and booked_count >= max_bookings:
        raise HTTPException(status_code=400, detail="Selected slot is fully booked.")

    _profile_call_provider, profile_zoom_meeting_link, _call_setup_note = _mentor_call_profile_defaults(
        provider_user_id,
        supabase=supabase,
    )
    raw_call_provider = call_provider_override.value if call_provider_override else slot_row.get("call_provider")
    resolved_meeting_link = meeting_link_override or slot_row.get("meeting_link")
    if not resolved_meeting_link and str(raw_call_provider or "").strip().lower() == MentorshipCallProvider.ZOOM.value:
        resolved_meeting_link = profile_zoom_meeting_link
    resolved_call_provider = _normalize_mentorship_call_provider(
        raw_call_provider,
        meeting_link=resolved_meeting_link,
    )
    if resolved_call_provider == MentorshipCallProvider.ZOOM and not resolved_meeting_link:
        resolved_meeting_link = profile_zoom_meeting_link

    request_meta = _meta_dict(request_row.get("meta"))
    if (
        bool(request_meta.get("standalone"))
        and bool(request_meta.get("requires_entitlement"))
        and not request_meta.get("entitlement_consumed_at")
    ):
        _consume_mentorship_entitlement(str(request_row.get("user_id") or ""), supabase)
        request_meta["entitlement_consumed_at"] = now_iso

    request_meta["accepted_at"] = request_meta.get("accepted_at") or now_iso
    request_meta["accepted_by"] = actor_user_id
    request_meta["accepted_by_role"] = actor_role
    request_meta["scheduled_at"] = now_iso
    request_meta["scheduled_slot_id"] = slot_id
    request_meta["scheduled_slot_starts_at"] = starts_at.isoformat()
    request_meta["scheduled_slot_ends_at"] = ends_at.isoformat()
    request_meta["workflow_stage"] = workflow_stage
    request_meta["call_status"] = "scheduled"
    request_meta["call_provider"] = resolved_call_provider.value
    request_meta["status_updated_by"] = actor_user_id
    request_meta["status_updated_by_role"] = actor_role
    request_meta["status_updated_at"] = now_iso
    if request_meta_updates:
        for key, value in request_meta_updates.items():
            if value is not None:
                request_meta[key] = value

    updated_request = _first(
        supabase.table(MENTORSHIP_REQUESTS_TABLE)
        .update(
            {
                "status": MentorshipRequestStatus.SCHEDULED.value,
                "scheduled_slot_id": slot_id,
                "meta": request_meta,
                "updated_at": now_iso,
            }
        )
        .eq("id", request_id)
        .execute()
    )
    if not updated_request:
        raise HTTPException(status_code=404, detail="Mentorship request not found.")

    if previous_slot_id != slot_id:
        if previous_slot_id > 0:
            _decrement_mentorship_slot_booking(previous_slot_id, supabase=supabase, updated_at_iso=now_iso)
        supabase.table(MENTORSHIP_SLOTS_TABLE).update(
            {
                "booked_count": booked_count + 1,
                "updated_at": now_iso,
            }
        ).eq("id", slot_id).execute()

    existing_session = _first(
        supabase.table(MENTORSHIP_SESSIONS_TABLE)
        .select("*")
        .eq("request_id", request_id)
        .limit(1)
        .execute()
    )
    copy_attachment_url: Optional[str] = None
    if updated_request.get("submission_id"):
        submission_row = _safe_first(
            supabase.table(COPY_SUBMISSIONS_TABLE)
            .select("checked_copy_pdf_url,answer_pdf_url")
            .eq("id", int(updated_request["submission_id"]))
            .limit(1)
        )
        if submission_row:
            copy_attachment_url = str(
                submission_row.get("checked_copy_pdf_url")
                or submission_row.get("answer_pdf_url")
                or ""
            ).strip() or None

    session_payload = {
        "request_id": request_id,
        "slot_id": slot_id,
        "provider_user_id": provider_user_id,
        "user_id": str(updated_request.get("user_id") or ""),
        "mode": str(slot_row.get("mode") or MentorshipMode.VIDEO.value),
        "call_provider": resolved_call_provider.value,
        "starts_at": starts_at.isoformat(),
        "ends_at": ends_at.isoformat(),
        "meeting_link": resolved_meeting_link,
        "copy_attachment_url": copy_attachment_url,
        "status": MentorshipSessionStatus.SCHEDULED.value,
        "updated_at": now_iso,
    }

    try:
        session_payload = _provision_call_provider_session(session_payload, provider_user_id, supabase)
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))

    if existing_session:
        session_row = _first(
            supabase.table(MENTORSHIP_SESSIONS_TABLE)
            .update(session_payload)
            .eq("id", int(existing_session["id"]))
            .execute()
        )
    else:
        session_row = _first(supabase.table(MENTORSHIP_SESSIONS_TABLE).insert(session_payload).execute())
    if not session_row:
        raise HTTPException(status_code=400, detail="Failed to create mentorship session.")

    return updated_request, session_row


def _entitlement_response(row: Dict[str, Any]) -> MentorshipEntitlementResponse:
    return MentorshipEntitlementResponse(
        id=int(row.get("id") or 0),
        user_id=str(row.get("user_id") or ""),
        sessions_remaining=int(row.get("sessions_remaining") or 0),
        valid_until=str(row.get("valid_until")) if row.get("valid_until") else None,
        source=str(row.get("source") or "payment"),
        note=row.get("note"),
        is_active=bool(row.get("is_active", True)),
        created_at=str(row.get("created_at") or ""),
        updated_at=str(row.get("updated_at")) if row.get("updated_at") else None,
    )

@router.get("/test-series", response_model=List[TestSeriesResponse])
def list_test_series(
    mine_only: bool = False,
    only_public: bool = False,
    include_inactive: bool = False,
    include_tests: bool = False,
    series_kind: Optional[TestSeriesKind] = None,
    user_ctx: Optional[Dict[str, Any]] = Depends(get_user_context),
    supabase: Client = Depends(get_supabase_client),
):
    try:
        query = supabase.table(TEST_SERIES_TABLE).select("*").order("created_at", desc=True)
        if mine_only:
            user_id = str((user_ctx or {}).get("user_id") or "").strip()
            if not user_id:
                return []
            query = query.eq("provider_user_id", user_id)
        if only_public:
            query = query.eq("is_public", True)
        if not include_inactive:
            query = query.eq("is_active", True)
        if series_kind:
            query = query.eq("series_kind", series_kind.value)
        rows = _rows(query.execute())
    except Exception as exc:
        _raise_test_series_migration_required(exc)

    output: List[TestSeriesResponse] = []
    for row in rows:
        if not _can_view_series(user_ctx=user_ctx, series_row=row, supabase=supabase):
            continue
        test_count = 0
        if include_tests:
            tests = _fetch_series_tests(series_id=int(row["id"]), supabase=supabase, include_inactive=include_inactive)
            test_count = len(tests)
        output.append(_series_row_to_response(row, test_count=test_count))
    return output


@router.post("/test-series", response_model=TestSeriesResponse)
def create_test_series(
    payload: TestSeriesCreate,
    user_ctx: Dict[str, Any] = Depends(require_series_author_user),
    supabase: Client = Depends(get_supabase_client),
):
    title = str(payload.title or "").strip()
    if not title:
        raise HTTPException(status_code=400, detail="Series title is required.")

    _enforce_series_kind_authoring_access(user_ctx=user_ctx, series_kind=payload.series_kind.value)

    provider_user_id = str(user_ctx.get("user_id") or "").strip()
    if _is_admin(user_ctx) and payload.provider_user_id:
        provider_user_id = str(payload.provider_user_id).strip()
    if not provider_user_id:
        raise HTTPException(status_code=400, detail="Provider identity missing.")

    insert_payload = {
        "title": title,
        "description": payload.description,
        "cover_image_url": payload.cover_image_url,
        "provider_user_id": provider_user_id,
        "series_kind": payload.series_kind.value,
        "access_type": payload.access_type.value,
        "price": payload.price,
        "is_public": payload.is_public,
        "is_active": payload.is_active,
        "meta": payload.meta or {},
        "updated_at": _utc_now_iso(),
    }
    try:
        row = _first(supabase.table(TEST_SERIES_TABLE).insert(insert_payload).execute())
    except Exception as exc:
        _raise_test_series_migration_required(exc)
    if not row:
        raise HTTPException(status_code=400, detail="Failed to create test series.")
    return _series_row_to_response(row, test_count=0)


@router.get("/test-series/{series_id}", response_model=TestSeriesResponse)
def get_test_series(
    series_id: int,
    include_tests: bool = False,
    user_ctx: Optional[Dict[str, Any]] = Depends(get_user_context),
    supabase: Client = Depends(get_supabase_client),
):
    row = _fetch_series_or_404(series_id, supabase)
    if not _can_view_series(user_ctx=user_ctx, series_row=row, supabase=supabase):
        raise HTTPException(status_code=403, detail="Access denied for this test series.")
    test_count = 0
    if include_tests:
        tests = _fetch_series_tests(series_id=series_id, supabase=supabase, include_inactive=True)
        test_count = len(tests)
    return _series_row_to_response(row, test_count=test_count)


@router.put("/test-series/{series_id}", response_model=TestSeriesResponse)
def update_test_series(
    series_id: int,
    payload: TestSeriesUpdate,
    user_ctx: Dict[str, Any] = Depends(require_series_author_user),
    supabase: Client = Depends(get_supabase_client),
):
    row = _fetch_series_or_404(series_id, supabase)
    _ensure_series_owner_or_admin(row, user_ctx)

    target_series_kind = payload.series_kind.value if payload.series_kind is not None else _as_role(row.get("series_kind"))
    _enforce_series_kind_authoring_access(user_ctx=user_ctx, series_kind=target_series_kind)

    updates = payload.model_dump(exclude_none=True)
    if "title" in updates:
        normalized_title = str(updates["title"] or "").strip()
        if not normalized_title:
            raise HTTPException(status_code=400, detail="Series title cannot be blank.")
        updates["title"] = normalized_title
    if "series_kind" in updates and updates["series_kind"] is not None:
        updates["series_kind"] = updates["series_kind"].value
    if "access_type" in updates and updates["access_type"] is not None:
        updates["access_type"] = updates["access_type"].value
    if "meta" in updates and updates["meta"] is not None:
        merged_meta = _meta_dict(row.get("meta"))
        merged_meta.update(updates["meta"])
        updates["meta"] = merged_meta
    updates["updated_at"] = _utc_now_iso()

    updated = _first(supabase.table(TEST_SERIES_TABLE).update(updates).eq("id", series_id).execute())
    if not updated:
        raise HTTPException(status_code=404, detail="Test series not found.")
    tests = _fetch_series_tests(series_id=series_id, supabase=supabase, include_inactive=True)
    return _series_row_to_response(updated, test_count=len(tests))


@router.delete("/test-series/{series_id}")
def delete_test_series(
    series_id: int,
    hard_delete: bool = Query(default=False),
    user_ctx: Dict[str, Any] = Depends(require_series_author_user),
    supabase: Client = Depends(get_supabase_client),
):
    row = _fetch_series_or_404(series_id, supabase)
    _ensure_series_owner_or_admin(row, user_ctx)
    _enforce_series_kind_authoring_access(user_ctx=user_ctx, series_kind=_as_role(row.get("series_kind")))

    if hard_delete:
        deleted = _first(supabase.table(TEST_SERIES_TABLE).delete().eq("id", series_id).execute())
        if not deleted:
            raise HTTPException(status_code=404, detail="Test series not found.")
        return {"message": "Test series deleted permanently.", "id": series_id}

    updated = _first(
        supabase.table(TEST_SERIES_TABLE)
        .update({"is_active": False, "is_public": False, "updated_at": _utc_now_iso()})
        .eq("id", series_id)
        .execute()
    )
    if not updated:
        raise HTTPException(status_code=404, detail="Test series not found.")
    return {"message": "Test series archived.", "id": series_id}


@router.get("/test-series/{series_id}/tests", response_model=List[TestSeriesTestResponse])
def list_series_tests(
    series_id: int,
    include_inactive: bool = False,
    user_ctx: Optional[Dict[str, Any]] = Depends(get_user_context),
    supabase: Client = Depends(get_supabase_client),
):
    series_row = _fetch_series_or_404(series_id, supabase)
    if not _can_view_series(user_ctx=user_ctx, series_row=series_row, supabase=supabase):
        raise HTTPException(status_code=403, detail="Access denied for this test series.")

    tests = _fetch_series_tests(series_id=series_id, supabase=supabase, include_inactive=include_inactive)
    question_counts = _fetch_test_question_counts(
        [int(row.get("id") or 0) for row in tests],
        supabase,
    )
    output: List[TestSeriesTestResponse] = []
    for row in tests:
        shaped_row = dict(row)
        shaped_row["question_count"] = question_counts.get(int(row.get("id") or 0), 0)
        output.append(_collection_row_to_test_response(shaped_row, series_id=series_id))
    return output


@router.get("/test-series-discovery/tests", response_model=List[TestSeriesDiscoveryTestResponse])
def list_discovery_tests(
    test_kind: CollectionTestKind,
    search: Optional[str] = None,
    category_id: Optional[int] = Query(default=None, ge=1),
    access_type: Optional[TestSeriesAccessType] = None,
    min_price: Optional[float] = Query(default=None, ge=0),
    max_price: Optional[float] = Query(default=None, ge=0),
    only_free: bool = False,
    limit: int = Query(default=120, ge=1, le=500),
    user_ctx: Optional[Dict[str, Any]] = Depends(get_user_context),
    supabase: Client = Depends(get_supabase_client),
):
    try:
        query = (
            supabase.table(TEST_SERIES_TABLE)
            .select("*")
            .eq("is_public", True)
            .eq("is_active", True)
            .order("created_at", desc=True)
        )
        if access_type is not None:
            query = query.eq("access_type", access_type.value)
        series_rows = _rows(query.execute())
    except Exception as exc:
        _raise_test_series_migration_required(exc)

    if not series_rows:
        return []

    series_by_id: Dict[int, Dict[str, Any]] = {}
    series_ids: List[int] = []
    for row in series_rows:
        sid = int(row.get("id") or 0)
        if sid <= 0:
            continue
        series_by_id[sid] = row
        series_ids.append(sid)

    if not series_ids:
        return []

    test_rows = _fetch_public_series_tests(series_ids=series_ids, supabase=supabase)
    if not test_rows:
        return []

    candidate_rows: List[tuple[TestSeriesTestResponse, TestSeriesResponse, List[int]]] = []
    all_category_ids: List[int] = []
    provider_user_ids: List[str] = []

    for test_row in test_rows:
        series_id = _resolve_series_id_from_collection(test_row)
        if not series_id:
            continue
        series_row = series_by_id.get(series_id)
        if not series_row:
            continue
        if not _can_view_series(user_ctx=user_ctx, series_row=series_row, supabase=supabase):
            continue

        test_payload = _collection_row_to_test_response(test_row, series_id=series_id)
        if test_payload.test_kind != test_kind:
            continue

        price_value = float(test_payload.price or 0.0)
        if only_free and price_value > 0:
            continue
        if min_price is not None and price_value < float(min_price):
            continue
        if max_price is not None and price_value > float(max_price):
            continue

        series_payload = _series_row_to_response(series_row, test_count=0)
        if not _matches_discovery_search(
            str(search or ""),
            test_payload.title,
            test_payload.description,
            series_payload.title,
            series_payload.description,
        ):
            continue

        category_ids = _extract_category_ids_from_meta(test_payload.meta)
        if category_id is not None and category_id not in category_ids:
            continue
        all_category_ids.extend(category_ids)
        provider_user_id = str(series_payload.provider_user_id or "").strip()
        if provider_user_id:
            provider_user_ids.append(provider_user_id)
        candidate_rows.append((test_payload, series_payload, category_ids))

    if not candidate_rows:
        return []

    category_name_map = _safe_category_name_map(all_category_ids, supabase)
    profile_map = _safe_profile_map(provider_user_ids, supabase)

    output: List[TestSeriesDiscoveryTestResponse] = []
    for test_payload, series_payload, category_ids in candidate_rows[:limit]:
        labels = [category_name_map[cid] for cid in category_ids if cid in category_name_map]
        output.append(
            TestSeriesDiscoveryTestResponse(
                test=test_payload,
                series=series_payload,
                category_ids=category_ids,
                category_labels=labels,
                provider_profile=profile_map.get(str(series_payload.provider_user_id or "").strip()),
            )
        )
    return output


@router.get("/test-series-discovery/series", response_model=List[TestSeriesDiscoverySeriesResponse])
def list_discovery_series(
    series_kind: TestSeriesKind,
    search: Optional[str] = None,
    category_id: Optional[int] = Query(default=None, ge=1),
    access_type: Optional[TestSeriesAccessType] = None,
    min_price: Optional[float] = Query(default=None, ge=0),
    max_price: Optional[float] = Query(default=None, ge=0),
    only_free: bool = False,
    limit: int = Query(default=120, ge=1, le=500),
    user_ctx: Optional[Dict[str, Any]] = Depends(get_user_context),
    supabase: Client = Depends(get_supabase_client),
):
    try:
        query = (
            supabase.table(TEST_SERIES_TABLE)
            .select("*")
            .eq("is_public", True)
            .eq("is_active", True)
            .eq("series_kind", series_kind.value)
            .order("created_at", desc=True)
        )
        if access_type is not None:
            query = query.eq("access_type", access_type.value)
        series_rows = _rows(query.execute())
    except Exception as exc:
        _raise_test_series_migration_required(exc)

    if not series_rows:
        return []

    series_by_id: Dict[int, Dict[str, Any]] = {}
    for row in series_rows:
        series_id = int(row.get("id") or 0)
        if series_id <= 0:
            continue
        if not _can_view_series(user_ctx=user_ctx, series_row=row, supabase=supabase):
            continue
        series_by_id[series_id] = row

    if not series_by_id:
        return []

    public_test_rows = _fetch_public_series_tests(series_ids=list(series_by_id.keys()), supabase=supabase)
    tests_by_series: Dict[int, List[Dict[str, Any]]] = {}
    for test_row in public_test_rows:
        series_id = _resolve_series_id_from_collection(test_row)
        if not series_id or series_id not in series_by_id:
            continue
        tests_by_series.setdefault(series_id, []).append(test_row)

    candidate_rows: List[tuple[TestSeriesResponse, List[int]]] = []
    all_category_ids: List[int] = []
    provider_user_ids: List[str] = []

    for series_id, series_row in series_by_id.items():
        series_test_rows = tests_by_series.get(series_id, [])
        if not series_test_rows:
            continue

        series_payload = _series_row_to_response(series_row, test_count=len(series_test_rows))
        price_value = float(series_payload.price or 0.0)
        if only_free and price_value > 0:
            continue
        if min_price is not None and price_value < float(min_price):
            continue
        if max_price is not None and price_value > float(max_price):
            continue

        search_parts: List[Optional[str]] = [series_payload.title, series_payload.description]
        category_ids: List[int] = []
        for test_row in series_test_rows:
            search_parts.extend([str(test_row.get("title") or ""), test_row.get("description")])
            for resolved_category_id in _extract_category_ids_from_meta(_meta_dict(test_row.get("meta"))):
                if resolved_category_id not in category_ids:
                    category_ids.append(resolved_category_id)

        if category_id is not None and category_id not in category_ids:
            continue
        if not _matches_discovery_search(str(search or ""), *search_parts):
            continue

        all_category_ids.extend(category_ids)
        provider_user_id = str(series_payload.provider_user_id or "").strip()
        if provider_user_id:
            provider_user_ids.append(provider_user_id)
        candidate_rows.append((series_payload, category_ids))

    if not candidate_rows:
        return []

    category_name_map = _safe_category_name_map(all_category_ids, supabase)
    profile_map = _safe_profile_map(provider_user_ids, supabase)

    output: List[TestSeriesDiscoverySeriesResponse] = []
    for series_payload, category_ids in candidate_rows[:limit]:
        labels = [category_name_map[cid] for cid in category_ids if cid in category_name_map]
        output.append(
            TestSeriesDiscoverySeriesResponse(
                series=series_payload,
                category_ids=category_ids,
                category_labels=labels,
                provider_profile=profile_map.get(str(series_payload.provider_user_id or "").strip()),
            )
        )
    return output


@router.post("/test-series/{series_id}/tests", response_model=TestSeriesTestResponse)
def create_series_test(
    series_id: int,
    payload: TestSeriesTestCreate,
    user_ctx: Dict[str, Any] = Depends(require_series_author_user),
    supabase: Client = Depends(get_supabase_client),
):
    series_row = _fetch_series_or_404(series_id, supabase)
    _ensure_series_owner_or_admin(series_row, user_ctx)
    _enforce_series_kind_authoring_access(user_ctx=user_ctx, series_kind=_as_role(series_row.get("series_kind")))
    _enforce_test_kind_authoring_access(user_ctx=user_ctx, test_kind=payload.test_kind.value)

    title = str(payload.title or "").strip()
    if not title:
        raise HTTPException(status_code=400, detail="Test title is required.")

    merged_meta = dict(payload.meta or {})
    merged_meta["series_id"] = series_id
    merged_meta["series_order"] = payload.series_order
    merged_meta = _apply_collection_test_kind_meta(merged_meta, payload.test_kind)

    insert_payload = {
        "title": title,
        "description": payload.description,
        "type": CollectionType.TEST_SERIES.value,
        "thumbnail_url": payload.thumbnail_url,
        "is_public": payload.is_public,
        "is_premium": payload.is_premium or payload.price > 0,
        "price": payload.price,
        "is_finalized": payload.is_finalized,
        "meta": merged_meta,
        "series_id": series_id,
        "series_order": payload.series_order,
    }
    try:
        row = _first(supabase.table("collections").insert(insert_payload).execute())
    except Exception as exc:
        message = str(exc).lower()
        if "series_id" in message or "series_order" in message:
            insert_payload.pop("series_id", None)
            insert_payload.pop("series_order", None)
            row = _first(supabase.table("collections").insert(insert_payload).execute())
        else:
            raise
    if not row:
        raise HTTPException(status_code=400, detail="Failed to create test.")

    resolved_series_id = _resolve_series_id_from_collection(row) or series_id
    shaped_row = dict(row)
    shaped_row["question_count"] = _fetch_test_question_counts([int(row.get("id") or 0)], supabase).get(int(row.get("id") or 0), 0)
    return _collection_row_to_test_response(shaped_row, series_id=resolved_series_id)


@router.get("/tests/{test_id}", response_model=TestSeriesTestResponse)
def get_series_test(
    test_id: int,
    user_ctx: Optional[Dict[str, Any]] = Depends(get_user_context),
    supabase: Client = Depends(get_supabase_client),
):
    series_row, collection_row, series_id = _fetch_series_for_test_or_404(test_id, supabase)
    if not _can_view_series(user_ctx=user_ctx, series_row=series_row, supabase=supabase):
        raise HTTPException(status_code=403, detail="Access denied for this test.")
    shaped_row = dict(collection_row)
    shaped_row["question_count"] = _fetch_test_question_counts([test_id], supabase).get(test_id, 0)
    return _collection_row_to_test_response(shaped_row, series_id=series_id)


@router.put("/tests/{test_id}", response_model=TestSeriesTestResponse)
def update_series_test(
    test_id: int,
    payload: TestSeriesTestUpdate,
    user_ctx: Dict[str, Any] = Depends(require_series_author_user),
    supabase: Client = Depends(get_supabase_client),
):
    series_row, collection_row, series_id = _fetch_series_for_test_or_404(test_id, supabase)
    _ensure_series_owner_or_admin(series_row, user_ctx)
    _enforce_series_kind_authoring_access(user_ctx=user_ctx, series_kind=_as_role(series_row.get("series_kind")))

    target_test_kind = (
        payload.test_kind.value
        if payload.test_kind is not None
        else _resolve_collection_test_kind(_meta_dict(collection_row.get("meta"))).value
    )
    _enforce_test_kind_authoring_access(user_ctx=user_ctx, test_kind=target_test_kind)

    updates = payload.model_dump(exclude_none=True)
    if "title" in updates:
        normalized_title = str(updates["title"] or "").strip()
        if not normalized_title:
            raise HTTPException(status_code=400, detail="Test title cannot be blank.")
        updates["title"] = normalized_title

    if "meta" in updates and updates["meta"] is not None:
        merged_meta = _meta_dict(collection_row.get("meta"))
        merged_meta.update(updates["meta"])
    else:
        merged_meta = _meta_dict(collection_row.get("meta"))

    if payload.series_order is not None:
        merged_meta["series_order"] = payload.series_order
        updates["series_order"] = payload.series_order
    if payload.test_kind is not None:
        merged_meta = _apply_collection_test_kind_meta(merged_meta, payload.test_kind)
    updates["meta"] = merged_meta

    if payload.price is not None and payload.is_premium is None:
        updates["is_premium"] = float(payload.price) > 0

    if "test_kind" in updates:
        updates.pop("test_kind", None)
    if "series_order" not in updates and payload.series_order is not None:
        updates["series_order"] = payload.series_order

    try:
        updated = _first(supabase.table("collections").update(updates).eq("id", test_id).execute())
    except Exception as exc:
        message = str(exc).lower()
        if "series_order" in message:
            updates.pop("series_order", None)
            updated = _first(supabase.table("collections").update(updates).eq("id", test_id).execute())
        else:
            raise
    if not updated:
        raise HTTPException(status_code=404, detail="Test not found.")
    shaped_row = dict(updated)
    shaped_row["question_count"] = _fetch_test_question_counts([test_id], supabase).get(test_id, 0)
    return _collection_row_to_test_response(shaped_row, series_id=series_id)


@router.delete("/tests/{test_id}")
def delete_series_test(
    test_id: int,
    hard_delete: bool = Query(default=False),
    user_ctx: Dict[str, Any] = Depends(require_series_author_user),
    supabase: Client = Depends(get_supabase_client),
):
    series_row, _collection_row, _series_id = _fetch_series_for_test_or_404(test_id, supabase)
    _ensure_series_owner_or_admin(series_row, user_ctx)
    _enforce_series_kind_authoring_access(user_ctx=user_ctx, series_kind=_as_role(series_row.get("series_kind")))

    if hard_delete:
        deleted = _first(supabase.table("collections").delete().eq("id", test_id).execute())
        if not deleted:
            raise HTTPException(status_code=404, detail="Test not found.")
        return {"message": "Test deleted permanently.", "id": test_id}

    updated = _first(
        supabase.table("collections")
        .update({"is_active": False, "is_public": False})
        .eq("id", test_id)
        .execute()
    )
    if not updated:
        raise HTTPException(status_code=404, detail="Test not found.")
    return {"message": "Test archived.", "id": test_id}


@router.put("/tests/{test_id}/items/{collection_item_id}")
def update_test_item(
    test_id: int,
    collection_item_id: int,
    payload: CollectionItemUpdateRequest,
    user_ctx: Dict[str, Any] = Depends(require_series_author_user),
    supabase: Client = Depends(get_supabase_client),
):
    series_row, _collection_row, _series_id = _fetch_series_for_test_or_404(test_id, supabase)
    _ensure_series_owner_or_admin(series_row, user_ctx)
    _enforce_series_kind_authoring_access(user_ctx=user_ctx, series_kind=_as_role(series_row.get("series_kind")))
    updates = payload.model_dump(exclude_none=True)
    if not updates:
        raise HTTPException(status_code=400, detail="No item updates supplied.")

    row = _first(
        supabase.table("collection_items")
        .update(updates)
        .eq("id", collection_item_id)
        .eq("collection_id", test_id)
        .execute()
    )
    if not row:
        raise HTTPException(status_code=404, detail="Collection item not found.")
    return row


@router.delete("/tests/{test_id}/items/{collection_item_id}")
def delete_test_item(
    test_id: int,
    collection_item_id: int,
    user_ctx: Dict[str, Any] = Depends(require_series_author_user),
    supabase: Client = Depends(get_supabase_client),
):
    series_row, _collection_row, _series_id = _fetch_series_for_test_or_404(test_id, supabase)
    _ensure_series_owner_or_admin(series_row, user_ctx)
    _enforce_series_kind_authoring_access(user_ctx=user_ctx, series_kind=_as_role(series_row.get("series_kind")))
    row = _first(
        supabase.table("collection_items")
        .delete()
        .eq("id", collection_item_id)
        .eq("collection_id", test_id)
        .execute()
    )
    if not row:
        raise HTTPException(status_code=404, detail="Collection item not found.")
    return {"message": "Item removed from test.", "id": collection_item_id}


@router.post("/test-series/{series_id}/enroll", response_model=TestSeriesEnrollmentResponse)
def enroll_in_test_series(
    series_id: int,
    payload: EnrollRequest,
    user_ctx: Dict[str, Any] = Depends(require_authenticated_user),
    supabase: Client = Depends(get_supabase_client),
):
    _fetch_series_or_404(series_id, supabase)
    user_id = str(user_ctx.get("user_id") or "").strip()
    if not user_id:
        raise HTTPException(status_code=401, detail="Authentication required.")

    existing = _series_enrollment_row(series_id=series_id, user_id=user_id, supabase=supabase)
    if existing:
        return TestSeriesEnrollmentResponse(
            id=int(existing.get("id") or 0),
            series_id=int(existing.get("series_id") or series_id),
            user_id=str(existing.get("user_id") or user_id),
            status=str(existing.get("status") or "active"),
            access_source=str(existing.get("access_source") or payload.access_source or "manual"),
            subscribed_until=str(existing.get("subscribed_until")) if existing.get("subscribed_until") else None,
            created_at=str(existing.get("created_at") or ""),
            updated_at=str(existing.get("updated_at")) if existing.get("updated_at") else None,
        )

    insert_payload = {
        "series_id": series_id,
        "user_id": user_id,
        "status": "active",
        "access_source": payload.access_source or "manual",
        "subscribed_until": payload.subscribed_until,
        "updated_at": _utc_now_iso(),
    }
    row = _first(supabase.table(TEST_SERIES_ENROLLMENTS_TABLE).insert(insert_payload).execute())
    if not row:
        raise HTTPException(status_code=400, detail="Could not enroll in test series.")
    return TestSeriesEnrollmentResponse(
        id=int(row.get("id") or 0),
        series_id=int(row.get("series_id") or series_id),
        user_id=str(row.get("user_id") or user_id),
        status=str(row.get("status") or "active"),
        access_source=str(row.get("access_source") or "manual"),
        subscribed_until=str(row.get("subscribed_until")) if row.get("subscribed_until") else None,
        created_at=str(row.get("created_at") or ""),
        updated_at=str(row.get("updated_at")) if row.get("updated_at") else None,
    )

@router.get("/test-series/{series_id:int}/enrollments", response_model=List[TestSeriesEnrollmentResponse])
def list_series_enrollments(
    series_id: int,
    user_ctx: Dict[str, Any] = Depends(require_authenticated_user),
    supabase: Client = Depends(get_supabase_client),
):
    series_row = _fetch_series_or_404(series_id, supabase)
    if not _can_monitor_or_review_series(user_ctx, series_row):
        raise HTTPException(status_code=403, detail="Access denied.")

    rows = _rows(
        supabase.table(TEST_SERIES_ENROLLMENTS_TABLE)
        .select("*")
        .eq("series_id", series_id)
        .order("created_at", desc=True)
        .execute()
    )
    out: List[TestSeriesEnrollmentResponse] = []
    for row in rows:
        out.append(
            TestSeriesEnrollmentResponse(
                id=int(row.get("id") or 0),
                series_id=int(row.get("series_id") or series_id),
                user_id=str(row.get("user_id") or ""),
                status=str(row.get("status") or "active"),
                access_source=str(row.get("access_source") or "manual"),
                subscribed_until=str(row.get("subscribed_until")) if row.get("subscribed_until") else None,
                created_at=str(row.get("created_at") or ""),
                updated_at=str(row.get("updated_at")) if row.get("updated_at") else None,
            )
        )
    return out


@router.get("/test-series/my/enrollments", response_model=List[TestSeriesEnrollmentResponse])
def list_my_series_enrollments(
    user_ctx: Dict[str, Any] = Depends(require_authenticated_user),
    supabase: Client = Depends(get_supabase_client),
):
    user_id = str(user_ctx.get("user_id") or "").strip()
    rows = _rows(
        supabase.table(TEST_SERIES_ENROLLMENTS_TABLE)
        .select("*")
        .eq("user_id", user_id)
        .order("created_at", desc=True)
        .execute()
    )
    return [
        TestSeriesEnrollmentResponse(
            id=int(row.get("id") or 0),
            series_id=int(row.get("series_id") or 0),
            user_id=str(row.get("user_id") or ""),
            status=str(row.get("status") or "active"),
            access_source=str(row.get("access_source") or "manual"),
            subscribed_until=str(row.get("subscribed_until")) if row.get("subscribed_until") else None,
            created_at=str(row.get("created_at") or ""),
            updated_at=str(row.get("updated_at")) if row.get("updated_at") else None,
        )
        for row in rows
    ]


@router.post("/tests/{test_id}/copy-submissions", response_model=MainsCopySubmissionResponse)
def submit_mains_copy(
    test_id: int,
    payload: MainsCopySubmissionCreate,
    user_ctx: Dict[str, Any] = Depends(require_authenticated_user),
    supabase: Client = Depends(get_supabase_client),
):
    series_row, collection_row, series_id = _fetch_series_for_test_or_404(test_id, supabase)
    if not _can_access_series_content(user_ctx=user_ctx, series_row=series_row, supabase=supabase):
        raise HTTPException(status_code=403, detail="No access to submit answer copies for this test.")
    if _resolve_collection_test_kind(_meta_dict(collection_row.get("meta"))) != CollectionTestKind.MAINS:
        raise HTTPException(status_code=400, detail="Copy submissions are available only for mains tests.")

    user_id = str(user_ctx.get("user_id") or "").strip()
    question_context = _fetch_mains_test_question_context(test_id, supabase)
    answer_pdf_url = str(payload.answer_pdf_url or "").strip() or None
    question_responses = _sanitize_question_submission_payload(payload.question_responses, questions=question_context)
    if not answer_pdf_url and not question_responses:
        raise HTTPException(status_code=400, detail="Provide a full answer PDF or question-wise answer images.")

    if answer_pdf_url and question_responses:
        submission_mode = CopySubmissionMode.HYBRID.value
    elif question_responses:
        submission_mode = CopySubmissionMode.QUESTION_WISE.value
    else:
        submission_mode = CopySubmissionMode.PDF.value

    insert_payload = {
        "series_id": series_id,
        "test_collection_id": test_id,
        "provider_user_id": _resolve_series_handler_user_id(series_row),
        "user_id": user_id,
        "answer_pdf_url": answer_pdf_url,
        "submission_mode": submission_mode,
        "question_responses": question_responses,
        "status": CopySubmissionStatus.SUBMITTED.value,
        "learner_note": payload.note,
        "ai_total_score": payload.ai_total_score,
        "submitted_at": _utc_now_iso(),
        "updated_at": _utc_now_iso(),
    }
    row = _first(supabase.table(COPY_SUBMISSIONS_TABLE).insert(insert_payload).execute())
    if not row:
        raise HTTPException(status_code=400, detail="Failed to submit copy.")
    try:
        _create_copy_evaluation_request(
            submission_row=row,
            provider_user_id=_resolve_series_handler_user_id(series_row),
            preferred_mode=payload.preferred_mode,
            supabase=supabase,
            standalone=False,
        )
    except HTTPException:
        try:
            supabase.table(COPY_SUBMISSIONS_TABLE).delete().eq("id", int(row.get("id") or 0)).execute()
        except Exception:
            pass
        raise
    return _copy_submission_response(row, supabase, question_context=question_context)


@router.post("/mentors/{provider_user_id}/copy-submissions", response_model=MainsCopySubmissionResponse)
def submit_direct_mains_copy(
    provider_user_id: str,
    payload: MainsCopySubmissionCreate,
    user_ctx: Dict[str, Any] = Depends(require_authenticated_user),
    supabase: Client = Depends(get_supabase_client),
):
    normalized_provider_id = str(provider_user_id or "").strip()
    if not normalized_provider_id:
        raise HTTPException(status_code=400, detail="Mains Mentor user id is required.")

    mentor_profile_row = _safe_first(
        supabase.table(PROFILES_TABLE)
        .select("user_id,role,meta,is_active")
        .eq("user_id", normalized_provider_id)
        .limit(1)
    )
    mentor_profile_role = _normalize_profile_role((mentor_profile_row or {}).get("role"), fallback="")
    if mentor_profile_role != "mentor":
        raise HTTPException(status_code=400, detail="Selected professional is not available as a Mains Mentor.")
    if not bool((mentor_profile_row or {}).get("is_active", True)):
        raise HTTPException(status_code=400, detail="Selected Mains Mentor profile is currently inactive.")

    mentor_profile_meta = _normalize_profile_meta((mentor_profile_row or {}).get("meta"))
    if not _copy_evaluation_enabled_for_role(mentor_profile_role, mentor_profile_meta):
        raise HTTPException(
            status_code=400,
            detail="This Mains Mentor has not enabled direct copy evaluation yet.",
        )

    answer_pdf_url = str(payload.answer_pdf_url or "").strip() or None
    generic_question_responses: List[Dict[str, Any]] = []
    for response in payload.question_responses:
        answer_image_urls = _normalize_answer_image_urls(response.answer_image_urls)
        if not answer_image_urls:
            continue
        generic_question_responses.append(
            {
                "question_item_id": _safe_int(response.question_item_id, 0) or None,
                "question_number": _safe_int(response.question_number, 0) or None,
                "answer_image_urls": answer_image_urls,
            }
        )

    if not answer_pdf_url and not generic_question_responses:
        raise HTTPException(status_code=400, detail="Provide a full answer PDF or answer image URLs.")

    if answer_pdf_url and generic_question_responses:
        submission_mode = CopySubmissionMode.HYBRID.value
    elif generic_question_responses:
        submission_mode = CopySubmissionMode.QUESTION_WISE.value
    else:
        submission_mode = CopySubmissionMode.PDF.value

    submitted_at_iso = _utc_now_iso()
    insert_payload = {
        "series_id": None,
        "test_collection_id": None,
        "provider_user_id": normalized_provider_id,
        "user_id": str(user_ctx.get("user_id") or "").strip(),
        "answer_pdf_url": answer_pdf_url,
        "submission_mode": submission_mode,
        "question_responses": generic_question_responses,
        "status": CopySubmissionStatus.SUBMITTED.value,
        "learner_note": payload.note,
        "ai_total_score": payload.ai_total_score,
        "submitted_at": submitted_at_iso,
        "updated_at": submitted_at_iso,
    }
    row = _first(supabase.table(COPY_SUBMISSIONS_TABLE).insert(insert_payload).execute())
    if not row:
        raise HTTPException(status_code=400, detail="Failed to submit copy.")

    try:
        _create_copy_evaluation_request(
            submission_row=row,
            provider_user_id=normalized_provider_id,
            preferred_mode=payload.preferred_mode,
            supabase=supabase,
            standalone=True,
        )
    except HTTPException:
        try:
            supabase.table(COPY_SUBMISSIONS_TABLE).delete().eq("id", int(row.get("id") or 0)).execute()
        except Exception:
            pass
        raise
    return _copy_submission_response(row, supabase, question_context=[])


@router.get("/tests/{test_id}/copy-submissions", response_model=List[MainsCopySubmissionResponse])
def list_test_copy_submissions(
    test_id: int,
    user_ctx: Dict[str, Any] = Depends(require_authenticated_user),
    supabase: Client = Depends(get_supabase_client),
):
    series_row, _collection_row, series_id = _fetch_series_for_test_or_404(test_id, supabase)
    user_id = str(user_ctx.get("user_id") or "").strip()
    can_monitor = _can_monitor_or_review_series(user_ctx, series_row)
    question_context = _fetch_mains_test_question_context(test_id, supabase)

    query = supabase.table(COPY_SUBMISSIONS_TABLE).select("*").eq("test_collection_id", test_id).eq("series_id", series_id)
    if not can_monitor:
        query = query.eq("user_id", user_id)
    rows = _rows(query.order("submitted_at", desc=True).execute())
    return [_copy_submission_response(row, supabase, question_context=question_context) for row in rows]


@router.get("/copy-submissions/{submission_id}", response_model=MainsCopySubmissionResponse)
def get_copy_submission(
    submission_id: int,
    user_ctx: Dict[str, Any] = Depends(require_authenticated_user),
    supabase: Client = Depends(get_supabase_client),
):
    row = _first(
        supabase.table(COPY_SUBMISSIONS_TABLE)
        .select("*")
        .eq("id", submission_id)
        .limit(1)
        .execute()
    )
    if not row:
        raise HTTPException(status_code=404, detail="Copy submission not found.")

    user_id = str(user_ctx.get("user_id") or "").strip()
    series_id = int(row.get("series_id") or 0)
    if series_id > 0:
        series_row = _fetch_series_or_404(series_id, supabase)
        can_monitor = _can_monitor_or_review_series(user_ctx, series_row)
    else:
        provider_user_id = str(row.get("provider_user_id") or "").strip()
        can_monitor = bool(
            _is_admin_or_moderator(user_ctx)
            or (_is_mentor_like(user_ctx) and provider_user_id and provider_user_id == user_id)
        )
    if not can_monitor and str(row.get("user_id") or "").strip() != user_id:
        raise HTTPException(status_code=403, detail="Access denied.")
    test_id = _safe_int(row.get("test_collection_id"), 0)
    question_context = _fetch_mains_test_question_context(test_id, supabase) if test_id > 0 else []
    return _copy_submission_response(row, supabase, question_context=question_context)


@router.put("/copy-submissions/{submission_id}/eta", response_model=MainsCopySubmissionResponse)
def set_copy_submission_eta(
    submission_id: int,
    payload: MainsCopySubmissionEtaUpdate,
    user_ctx: Dict[str, Any] = Depends(require_mentor_user),
    supabase: Client = Depends(get_supabase_client),
):
    row = _first(
        supabase.table(COPY_SUBMISSIONS_TABLE)
        .select("*")
        .eq("id", submission_id)
        .limit(1)
        .execute()
    )
    if not row:
        raise HTTPException(status_code=404, detail="Copy submission not found.")
    series_id = int(row.get("series_id") or 0)
    if series_id > 0:
        series_row = _fetch_series_or_404(series_id, supabase)
        _ensure_series_mentor_or_admin(series_row, user_ctx)
    else:
        _ensure_direct_copy_submission_provider_or_admin(row, user_ctx)

    now_iso = _utc_now_iso()
    updates: Dict[str, Any] = {
        "updated_at": now_iso,
        "eta_set_at": now_iso,
    }
    if payload.provider_eta_hours is not None:
        updates["provider_eta_hours"] = payload.provider_eta_hours
    if payload.provider_eta_text is not None:
        updates["provider_eta_text"] = payload.provider_eta_text
    if payload.provider_note is not None:
        updates["provider_note"] = payload.provider_note
    updates["status"] = (
        payload.status.value
        if payload.status is not None
        else CopySubmissionStatus.ETA_DECLARED.value
    )

    updated = _first(supabase.table(COPY_SUBMISSIONS_TABLE).update(updates).eq("id", submission_id).execute())
    if not updated:
        raise HTTPException(status_code=404, detail="Copy submission not found.")
    requested_status = payload.status.value if payload.status is not None else CopySubmissionStatus.ETA_DECLARED.value
    _update_copy_flow_request_meta(
        submission_id=submission_id,
        supabase=supabase,
        updates={
            "workflow_stage": "under_review" if requested_status == CopySubmissionStatus.UNDER_REVIEW.value else "eta_declared",
            "copy_status": requested_status,
            "copy_eta_set_at": now_iso,
        },
    )
    return _copy_submission_response(updated, supabase)


@router.put("/copy-submissions/{submission_id}/checked-copy", response_model=MainsCopySubmissionResponse)
def upload_checked_copy(
    submission_id: int,
    payload: MainsCopySubmissionCheckUpdate,
    user_ctx: Dict[str, Any] = Depends(require_mentor_user),
    supabase: Client = Depends(get_supabase_client),
):
    row = _first(
        supabase.table(COPY_SUBMISSIONS_TABLE)
        .select("*")
        .eq("id", submission_id)
        .limit(1)
        .execute()
    )
    if not row:
        raise HTTPException(status_code=404, detail="Copy submission not found.")
    series_id = int(row.get("series_id") or 0)
    if series_id > 0:
        series_row = _fetch_series_or_404(series_id, supabase)
        _ensure_series_mentor_or_admin(series_row, user_ctx)
    else:
        _ensure_direct_copy_submission_provider_or_admin(row, user_ctx)

    test_id = _safe_int(row.get("test_collection_id"), 0)
    question_context = _fetch_mains_test_question_context(test_id, supabase) if test_id > 0 else []
    by_item, by_number = _build_mains_question_context_maps(question_context)

    normalized_question_marks = []
    for mark in payload.question_marks:
        question_item_id = _safe_int(mark.question_item_id, 0)
        question_number = _safe_int(mark.question_number, 0)
        question = None
        if question_item_id > 0:
            question = by_item.get(question_item_id)
        if question is None and question_number > 0:
            question = by_number.get(question_number)

        resolved_question_item_id = question_item_id or _safe_int(question.get("question_item_id"), 0)
        resolved_question_number = question_number or _safe_int(question.get("question_number"), 0)
        resolved_max_marks = (
            mark.max_marks
            if mark.max_marks is not None
            else _safe_float(question.get("max_marks"), 10.0) if question else 10.0
        )
        normalized_question_marks.append(
            {
                "question_item_id": resolved_question_item_id or None,
                "question_number": resolved_question_number or None,
                "marks_awarded": mark.marks_awarded,
                "max_marks": _normalize_mains_question_max_marks(resolved_max_marks, fallback=10.0),
                "remark": mark.remark,
            }
        )

    total_marks = payload.total_marks
    if total_marks is None and normalized_question_marks:
        total_marks = round(sum(_safe_float(mark.get("marks_awarded"), 0.0) for mark in normalized_question_marks), 2)

    if (
        payload.checked_copy_pdf_url is None
        and total_marks is None
        and payload.provider_note is None
        and not normalized_question_marks
    ):
        raise HTTPException(status_code=400, detail="Provide a checked copy, note, total marks, or question-wise marks.")

    updates: Dict[str, Any] = {
        "status": CopySubmissionStatus.CHECKED.value,
        "checked_at": _utc_now_iso(),
        "updated_at": _utc_now_iso(),
    }
    if payload.checked_copy_pdf_url is not None:
        updates["checked_copy_pdf_url"] = str(payload.checked_copy_pdf_url or "").strip() or None
    if total_marks is not None:
        updates["total_marks"] = total_marks
    if payload.provider_note is not None:
        updates["provider_note"] = payload.provider_note
    updated = _first(supabase.table(COPY_SUBMISSIONS_TABLE).update(updates).eq("id", submission_id).execute())
    if not updated:
        raise HTTPException(status_code=404, detail="Copy submission not found.")

    if normalized_question_marks:
        supabase.table(COPY_MARKS_TABLE).delete().eq("submission_id", submission_id).execute()
        to_insert = []
        for mark in normalized_question_marks:
            to_insert.append(
                {
                    "submission_id": submission_id,
                    "question_item_id": mark["question_item_id"],
                    "question_number": mark["question_number"],
                    "marks_awarded": mark["marks_awarded"],
                    "max_marks": mark["max_marks"],
                    "remark": mark["remark"],
                    "updated_at": _utc_now_iso(),
                }
            )
        supabase.table(COPY_MARKS_TABLE).insert(to_insert).execute()

    _update_copy_flow_request_meta(
        submission_id=submission_id,
        supabase=supabase,
        updates={
            "workflow_stage": "copy_checked",
            "copy_status": CopySubmissionStatus.CHECKED.value,
            "copy_checked_at": str(updated.get("checked_at") or updated.get("updated_at") or _utc_now_iso()),
        },
    )
    return _copy_submission_response(updated, supabase, question_context=question_context)


@router.get("/users/me/mains-performance-report", response_model=UserPerformanceReportResponse)
def get_my_mains_performance_report(
    series_id: Optional[int] = None,
    user_ctx: Dict[str, Any] = Depends(require_authenticated_user),
    supabase: Client = Depends(get_supabase_client),
):
    user_id = str(user_ctx.get("user_id") or "").strip()
    query = supabase.table(COPY_SUBMISSIONS_TABLE).select("*").eq("user_id", user_id).order("submitted_at", desc=True)
    if series_id is not None:
        query = query.eq("series_id", series_id)
    submission_rows = _rows(query.execute())
    if not submission_rows:
        return UserPerformanceReportResponse(
            total_submissions=0,
            checked_submissions=0,
            average_provider_marks=0.0,
            average_ai_score=0.0,
            questions=[],
        )

    test_ids = sorted(
        {
            int(row.get("test_collection_id") or 0)
            for row in submission_rows
            if int(row.get("test_collection_id") or 0) > 0
        }
    )
    titles: Dict[int, str] = {}
    if test_ids:
        test_rows = _safe_rows(
            supabase.table("collections")
            .select("id, title")
            .in_("id", test_ids)
        )
        for row in test_rows:
            test_id = int(row.get("id") or 0)
            if test_id > 0:
                titles[test_id] = str(row.get("title") or f"Test {test_id}")

    total_provider = 0.0
    provider_count = 0
    total_ai = 0.0
    ai_count = 0
    checked_submissions = 0
    question_rows: List[UserPerformanceQuestionRow] = []
    question_context_by_test: Dict[int, List[Dict[str, Any]]] = {}
    question_lookup_by_test: Dict[int, tuple[Dict[int, Dict[str, Any]], Dict[int, Dict[str, Any]]]] = {}

    for submission in submission_rows:
        sub_id = int(submission.get("id") or 0)
        if _normalize_copy_status(submission.get("status")) == CopySubmissionStatus.CHECKED:
            checked_submissions += 1
        if submission.get("total_marks") is not None:
            try:
                total_provider += float(submission.get("total_marks"))
                provider_count += 1
            except (TypeError, ValueError):
                pass
        if submission.get("ai_total_score") is not None:
            try:
                total_ai += float(submission.get("ai_total_score"))
                ai_count += 1
            except (TypeError, ValueError):
                pass

        marks = _copy_marks_for_submission(sub_id, supabase)
        for mark in marks:
            test_id = int(submission.get("test_collection_id") or 0)
            if test_id > 0 and test_id not in question_lookup_by_test:
                question_context = _fetch_mains_test_question_context(test_id, supabase)
                question_context_by_test[test_id] = question_context
                question_lookup_by_test[test_id] = _build_mains_question_context_maps(question_context)
            by_item, by_number = question_lookup_by_test.get(test_id, ({}, {}))
            question = None
            if mark.question_item_id is not None:
                question = by_item.get(int(mark.question_item_id))
            if question is None and mark.question_number is not None:
                question = by_number.get(int(mark.question_number))
            question_rows.append(
                UserPerformanceQuestionRow(
                    submission_id=sub_id,
                    test_collection_id=test_id,
                    test_title=titles.get(test_id),
                    question_item_id=mark.question_item_id,
                    question_number=mark.question_number,
                    question_text=str(question.get("question_text") or "") if question else None,
                    marks_awarded=mark.marks_awarded,
                    max_marks=mark.max_marks,
                    submitted_at=str(submission.get("submitted_at") or ""),
                )
            )

    average_provider_marks = round(total_provider / provider_count, 2) if provider_count > 0 else 0.0
    average_ai_score = round(total_ai / ai_count, 2) if ai_count > 0 else 0.0

    return UserPerformanceReportResponse(
        total_submissions=len(submission_rows),
        checked_submissions=checked_submissions,
        average_provider_marks=average_provider_marks,
        average_ai_score=average_ai_score,
        questions=question_rows,
    )

@router.get("/provider/dashboard-summary")
def get_provider_dashboard_summary(
    user_ctx: Dict[str, Any] = Depends(require_series_author_user),
    supabase: Client = Depends(get_supabase_client),
):
    user_id = str(user_ctx.get("user_id") or "").strip()
    if _is_admin(user_ctx):
        series_rows = _safe_rows(supabase.table(TEST_SERIES_TABLE).select("id"))
    else:
        series_rows = _safe_rows(
            supabase.table(TEST_SERIES_TABLE).select("id").eq("provider_user_id", user_id)
        )
    series_ids = [int(row.get("id") or 0) for row in series_rows if int(row.get("id") or 0) > 0]
    test_rows = (
        _safe_rows(supabase.table("collections").select("id").in_("series_id", series_ids))
        if series_ids
        else []
    )
    active_enrollments_rows = (
        _safe_rows(
            supabase.table(TEST_SERIES_ENROLLMENTS_TABLE)
            .select("id")
            .in_("series_id", series_ids)
            .eq("status", "active")
        )
        if series_ids
        else []
    )
    pending_copy_ids: Set[int] = set()
    if series_ids:
        for row in _safe_rows(
            supabase.table(COPY_SUBMISSIONS_TABLE)
            .select("id")
            .in_("series_id", series_ids)
            .neq("status", CopySubmissionStatus.CHECKED.value)
        ):
            copy_id = int(row.get("id") or 0)
            if copy_id > 0:
                pending_copy_ids.add(copy_id)
    if _is_admin(user_ctx):
        for row in _safe_rows(
            supabase.table(COPY_SUBMISSIONS_TABLE)
            .select("id")
            .neq("status", CopySubmissionStatus.CHECKED.value)
        ):
            copy_id = int(row.get("id") or 0)
            if copy_id > 0:
                pending_copy_ids.add(copy_id)
    elif user_id:
        for row in _safe_rows(
            supabase.table(COPY_SUBMISSIONS_TABLE)
            .select("id")
            .eq("provider_user_id", user_id)
            .neq("status", CopySubmissionStatus.CHECKED.value)
        ):
            copy_id = int(row.get("id") or 0)
            if copy_id > 0:
                pending_copy_ids.add(copy_id)
    if _is_admin(user_ctx):
        mentorship_pending = _safe_rows(
            supabase.table(MENTORSHIP_REQUESTS_TABLE)
            .select("id")
            .in_("status", [MentorshipRequestStatus.REQUESTED.value, MentorshipRequestStatus.SCHEDULED.value])
        )
    else:
        mentorship_pending = _safe_rows(
            supabase.table(MENTORSHIP_REQUESTS_TABLE)
            .select("id")
            .eq("provider_user_id", user_id)
            .in_("status", [MentorshipRequestStatus.REQUESTED.value, MentorshipRequestStatus.SCHEDULED.value])
        )
    now_iso = _utc_now_iso()
    if _is_admin(user_ctx):
        upcoming_slots = _safe_rows(
            supabase.table(MENTORSHIP_SLOTS_TABLE)
            .select("id")
            .eq("is_active", True)
            .gte("starts_at", now_iso)
        )
    else:
        upcoming_slots = _safe_rows(
            supabase.table(MENTORSHIP_SLOTS_TABLE)
            .select("id")
            .eq("provider_user_id", user_id)
            .eq("is_active", True)
            .gte("starts_at", now_iso)
        )
    return {
        "series_count": len(series_ids),
        "test_count": len(test_rows),
        "active_enrollments": len(active_enrollments_rows),
        "pending_copy_checks": len(pending_copy_ids),
        "mentorship_pending_requests": len(mentorship_pending),
        "upcoming_slots": len(upcoming_slots),
    }


@router.get("/moderation/activity-summary")
def get_moderation_activity_summary(
    user_ctx: Dict[str, Any] = Depends(require_moderator_or_admin_user),
    supabase: Client = Depends(get_supabase_client),
):
    series_rows = _safe_rows(supabase.table(TEST_SERIES_TABLE).select("id,is_active"))
    series_ids = [int(row.get("id") or 0) for row in series_rows if int(row.get("id") or 0) > 0]
    active_series = sum(1 for row in series_rows if bool(row.get("is_active", True)))

    if series_ids:
        test_rows = _safe_rows(supabase.table("collections").select("id,is_active").in_("series_id", series_ids))
        enrollment_rows = _safe_rows(supabase.table(TEST_SERIES_ENROLLMENTS_TABLE).select("id,status").in_("series_id", series_ids))
    else:
        test_rows = []
        enrollment_rows = []
    copy_rows = _safe_rows(supabase.table(COPY_SUBMISSIONS_TABLE).select("id,status"))
    mentorship_rows = _safe_rows(supabase.table(MENTORSHIP_REQUESTS_TABLE).select("id,status"))

    active_tests = sum(1 for row in test_rows if bool(row.get("is_active", True)))
    active_enrollments = sum(1 for row in enrollment_rows if str(row.get("status") or "") == "active")
    pending_copy_checks = sum(
        1 for row in copy_rows if str(row.get("status") or "") != CopySubmissionStatus.CHECKED.value
    )
    mentorship_pending = sum(
        1
        for row in mentorship_rows
        if str(row.get("status") or "") in {
            MentorshipRequestStatus.REQUESTED.value,
            MentorshipRequestStatus.SCHEDULED.value,
        }
    )

    return {
        "series_count": len(series_ids),
        "active_series_count": active_series,
        "test_count": len(test_rows),
        "active_test_count": active_tests,
        "active_enrollments": active_enrollments,
        "copy_submissions_total": len(copy_rows),
        "pending_copy_checks": pending_copy_checks,
        "mentorship_requests_total": len(mentorship_rows),
        "mentorship_pending_requests": mentorship_pending,
    }


@router.get("/mentorship/mentors/status", response_model=List[MentorAvailabilityStatusResponse])
def list_mentor_availability_status(
    provider_user_ids: Optional[str] = None,
    only_available_now: bool = False,
    include_offline: bool = True,
    limit: int = Query(default=120, ge=1, le=500),
    user_ctx: Optional[Dict[str, Any]] = Depends(get_user_context),
    supabase: Client = Depends(get_supabase_client),
):
    provider_ids = _parse_provider_user_ids(provider_user_ids)
    if provider_ids:
        provider_ids = provider_ids[:limit]
    else:
        profile_query = (
            supabase.table(PROFILES_TABLE)
            .select("user_id,is_public,is_active")
            .eq("role", "mentor")
            .eq("is_active", True)
            .limit(limit * 3)
        )
        profile_rows = _safe_rows(profile_query)
        include_private = bool(user_ctx and _is_admin_or_moderator(user_ctx))
        for row in profile_rows:
            if not include_private and not bool(row.get("is_public", True)):
                continue
            user_id = str(row.get("user_id") or "").strip()
            if user_id and user_id not in provider_ids:
                provider_ids.append(user_id)
            if len(provider_ids) >= limit:
                break

    status_map = _build_mentor_availability_map(provider_user_ids=provider_ids, supabase=supabase)
    output: List[MentorAvailabilityStatusResponse] = []
    for provider_user_id in provider_ids:
        row = status_map.get(provider_user_id)
        if not row:
            row = MentorAvailabilityStatusResponse(
                provider_user_id=provider_user_id,
                status="offline",
                available_now=False,
                busy_now=False,
                active_slots_now=0,
                next_available_at=None,
                live_session_id=None,
                updated_at=_utc_now_iso(),
            )
        output.append(row)

    if only_available_now:
        output = [row for row in output if row.available_now]
    elif not include_offline:
        output = [row for row in output if row.status != "offline"]
    return output


@router.get("/lifecycle/tracking", response_model=LifecycleTrackingResponse)
def get_lifecycle_tracking(
    scope: str = Query(default="provider", pattern="^(me|provider|all)$"),
    series_id: Optional[int] = Query(default=None, ge=1),
    user_id: Optional[str] = None,
    provider_user_id: Optional[str] = None,
    limit_cycles: int = Query(default=250, ge=1, le=1200),
    limit_users: int = Query(default=250, ge=1, le=1200),
    user_ctx: Dict[str, Any] = Depends(require_authenticated_user),
    supabase: Client = Depends(get_supabase_client),
):
    requester_id = str(user_ctx.get("user_id") or "").strip()
    is_admin = _is_admin(user_ctx)
    is_moderator = _is_moderator(user_ctx)
    is_handler = _is_mentor_like(user_ctx)
    is_provider = _is_provider_like(user_ctx)

    if scope == "all" and not (is_admin or is_moderator):
        raise HTTPException(status_code=403, detail="All-scope tracking requires moderator/admin access.")
    if scope == "provider" and not (is_handler or is_provider or is_admin or is_moderator):
        raise HTTPException(
            status_code=403,
            detail="Provider-scope tracking requires Quiz Master, Mains Mentor, moderator, or admin access.",
        )

    user_filter = str(user_id or "").strip() or None
    provider_filter = str(provider_user_id or "").strip() or None
    if scope == "me":
        user_filter = requester_id
    if scope == "provider" and not (is_admin or is_moderator):
        provider_filter = requester_id

    generated_at = _utc_now_iso()
    now_dt = _required_datetime(generated_at, "generated_at")
    max_activity_rows = min(max(limit_users * 40, limit_cycles * 6, 800), 10000)

    request_query = supabase.table(MENTORSHIP_REQUESTS_TABLE).select("*").order("requested_at", desc=True)
    if series_id is not None:
        request_query = request_query.eq("series_id", series_id)
    if user_filter:
        request_query = request_query.eq("user_id", user_filter)
    if provider_filter:
        request_query = request_query.eq("provider_user_id", provider_filter)
    if scope == "me":
        request_query = request_query.eq("user_id", requester_id)
    request_rows = _rows(request_query.limit(limit_cycles).execute())

    request_ids = [int(row.get("id") or 0) for row in request_rows if int(row.get("id") or 0) > 0]
    session_rows: List[Dict[str, Any]] = []
    if request_ids:
        session_rows = _safe_rows(
            supabase.table(MENTORSHIP_SESSIONS_TABLE)
            .select("*")
            .in_("request_id", request_ids)
        )
    session_by_request_id: Dict[int, Dict[str, Any]] = {}
    for row in session_rows:
        req_id = int(row.get("request_id") or 0)
        if req_id <= 0:
            continue
        session_by_request_id[req_id] = row

    slot_ids: Set[int] = set()
    for request_row in request_rows:
        scheduled_slot_id = int(request_row.get("scheduled_slot_id") or 0)
        if scheduled_slot_id > 0:
            slot_ids.add(scheduled_slot_id)
    for session_row in session_rows:
        slot_id = int(session_row.get("slot_id") or 0)
        if slot_id > 0:
            slot_ids.add(slot_id)
    slot_rows = (
        _safe_rows(
            supabase.table(MENTORSHIP_SLOTS_TABLE)
            .select("*")
            .in_("id", sorted(slot_ids))
        )
        if slot_ids
        else []
    )
    slot_by_id: Dict[int, Dict[str, Any]] = {
        int(row.get("id") or 0): row
        for row in slot_rows
        if int(row.get("id") or 0) > 0
    }

    relevant_series_ids: Set[int] = set()
    if series_id is not None:
        relevant_series_ids.add(series_id)
    for request_row in request_rows:
        sid = int(request_row.get("series_id") or 0)
        if sid > 0:
            relevant_series_ids.add(sid)

    series_rows: List[Dict[str, Any]] = []
    if scope in {"provider", "all"} or series_id is not None:
        series_query = supabase.table(TEST_SERIES_TABLE).select("id,title,provider_user_id")
        if series_id is not None:
            series_query = series_query.eq("id", series_id)
        if provider_filter:
            series_query = series_query.eq("provider_user_id", provider_filter)
        series_rows = _safe_rows(series_query.limit(5000))
        for row in series_rows:
            sid = int(row.get("id") or 0)
            if sid > 0:
                relevant_series_ids.add(sid)

    enrollment_rows: List[Dict[str, Any]] = []
    if relevant_series_ids:
        enrollment_query = (
            supabase.table(TEST_SERIES_ENROLLMENTS_TABLE)
            .select("*")
            .in_("series_id", sorted(relevant_series_ids))
            .limit(max_activity_rows)
        )
        if user_filter:
            enrollment_query = enrollment_query.eq("user_id", user_filter)
        if scope == "me":
            enrollment_query = enrollment_query.eq("user_id", requester_id)
        enrollment_rows = _rows(enrollment_query.execute())
    elif scope == "me":
        enrollment_query = (
            supabase.table(TEST_SERIES_ENROLLMENTS_TABLE)
            .select("*")
            .eq("user_id", requester_id)
            .limit(max_activity_rows)
        )
        if series_id is not None:
            enrollment_query = enrollment_query.eq("series_id", series_id)
        enrollment_rows = _rows(enrollment_query.execute())
        for row in enrollment_rows:
            sid = int(row.get("series_id") or 0)
            if sid > 0:
                relevant_series_ids.add(sid)

    copy_rows: List[Dict[str, Any]] = []
    if relevant_series_ids:
        copy_query = (
            supabase.table(COPY_SUBMISSIONS_TABLE)
            .select("*")
            .in_("series_id", sorted(relevant_series_ids))
            .order("submitted_at", desc=True)
            .limit(max_activity_rows)
        )
        if user_filter:
            copy_query = copy_query.eq("user_id", user_filter)
        if scope == "me":
            copy_query = copy_query.eq("user_id", requester_id)
        copy_rows = _rows(copy_query.execute())
    elif scope == "me":
        copy_query = (
            supabase.table(COPY_SUBMISSIONS_TABLE)
            .select("*")
            .eq("user_id", requester_id)
            .order("submitted_at", desc=True)
            .limit(max_activity_rows)
        )
        if series_id is not None:
            copy_query = copy_query.eq("series_id", series_id)
        copy_rows = _rows(copy_query.execute())
    elif user_filter:
        copy_rows = _safe_rows(
            supabase.table(COPY_SUBMISSIONS_TABLE)
            .select("*")
            .eq("user_id", user_filter)
            .order("submitted_at", desc=True)
            .limit(max_activity_rows)
        )

    copy_by_id: Dict[int, Dict[str, Any]] = {
        int(row.get("id") or 0): row
        for row in copy_rows
        if int(row.get("id") or 0) > 0
    }
    missing_submission_ids = [
        int(row.get("submission_id") or 0)
        for row in request_rows
        if int(row.get("submission_id") or 0) > 0 and int(row.get("submission_id") or 0) not in copy_by_id
    ]
    if missing_submission_ids:
        extra_copy_rows = _safe_rows(
            supabase.table(COPY_SUBMISSIONS_TABLE)
            .select("*")
            .in_("id", missing_submission_ids)
        )
        for row in extra_copy_rows:
            copy_id = int(row.get("id") or 0)
            if copy_id <= 0 or copy_id in copy_by_id:
                continue
            copy_rows.append(row)
            copy_by_id[copy_id] = row
            sid = int(row.get("series_id") or 0)
            if sid > 0:
                relevant_series_ids.add(sid)

    series_by_id: Dict[int, Dict[str, Any]] = {}
    for row in series_rows:
        sid = int(row.get("id") or 0)
        if sid > 0:
            series_by_id[sid] = row
    missing_series_ids = [sid for sid in sorted(relevant_series_ids) if sid not in series_by_id]
    if missing_series_ids:
        missing_series_rows = _safe_rows(
            supabase.table(TEST_SERIES_TABLE)
            .select("id,title,provider_user_id")
            .in_("id", missing_series_ids)
        )
        for row in missing_series_rows:
            sid = int(row.get("id") or 0)
            if sid > 0:
                series_by_id[sid] = row

    test_ids: Set[int] = set()
    for request_row in request_rows:
        test_id = int(request_row.get("test_collection_id") or 0)
        if test_id > 0:
            test_ids.add(test_id)
    for copy_row in copy_rows:
        test_id = int(copy_row.get("test_collection_id") or 0)
        if test_id > 0:
            test_ids.add(test_id)

    test_title_by_id: Dict[int, str] = {}
    if test_ids:
        test_rows = _safe_rows(
            supabase.table("collections")
            .select("id,title")
            .in_("id", sorted(test_ids))
        )
        for row in test_rows:
            test_id = int(row.get("id") or 0)
            if test_id > 0:
                test_title_by_id[test_id] = str(row.get("title") or f"Test {test_id}")

    user_issues: Dict[str, List[LifecycleTrackingIssueResponse]] = {}
    user_issue_keys: Dict[str, Set[str]] = {}
    delay_issues_total = 0
    technical_issues_total = 0

    def build_issue(
        *,
        code: str,
        label: str,
        actor: str,
        detected_at: Optional[str],
        related_type: Optional[str] = None,
        related_id: Optional[int] = None,
        detail: Optional[str] = None,
        severity: str = "warning",
    ) -> LifecycleTrackingIssueResponse:
        return LifecycleTrackingIssueResponse(
            code=code,
            label=label,
            severity=severity,
            actor=actor,
            related_type=related_type,
            related_id=related_id,
            detected_at=str(detected_at or generated_at),
            detail=detail,
        )

    def attach_user_issue(user_identifier: str, issue: LifecycleTrackingIssueResponse) -> None:
        nonlocal delay_issues_total, technical_issues_total
        user_identifier = str(user_identifier or "").strip()
        if not user_identifier:
            return
        signature = f"{issue.code}:{issue.related_type}:{issue.related_id}"
        known = user_issue_keys.setdefault(user_identifier, set())
        if signature in known:
            return
        known.add(signature)
        user_issues.setdefault(user_identifier, []).append(issue)
        if "delay" in issue.code:
            delay_issues_total += 1
        if "technical" in issue.code:
            technical_issues_total += 1

    mentorship_cycles: List[MentorshipTrackingCycleResponse] = []
    user_rows: List[UserLifecycleTrackingRowResponse] = []

    for request_row in request_rows:
        request_id = int(request_row.get("id") or 0)
        if request_id <= 0:
            continue
        request_meta = _meta_dict(request_row.get("meta"))
        request_status = _normalize_mentorship_request_status(request_row.get("status"))
        request_user_id = str(request_row.get("user_id") or "").strip()
        request_provider_id = str(request_row.get("provider_user_id") or "").strip()
        submission_id = int(request_row.get("submission_id") or 0)
        copy_row = copy_by_id.get(submission_id) if submission_id > 0 else None

        session_row = session_by_request_id.get(request_id)
        session_status = _normalize_mentorship_session_status(session_row.get("status")) if session_row else None

        slot_id = int(request_row.get("scheduled_slot_id") or 0)
        if slot_id <= 0 and session_row:
            slot_id = int(session_row.get("slot_id") or 0)
        slot_row = slot_by_id.get(slot_id) if slot_id > 0 else None

        accepted_at = str(request_meta.get("accepted_at") or "").strip() or None
        if not accepted_at and session_row:
            accepted_at = str(session_row.get("created_at") or "").strip() or None
        if not accepted_at and request_status in {MentorshipRequestStatus.SCHEDULED, MentorshipRequestStatus.COMPLETED}:
            accepted_at = str(request_row.get("updated_at") or "").strip() or None

        scheduled_for = None
        if slot_row:
            scheduled_for = str(slot_row.get("starts_at") or "").strip() or None
        if not scheduled_for and session_row:
            scheduled_for = str(session_row.get("starts_at") or "").strip() or None
        if not scheduled_for:
            scheduled_for = str(request_meta.get("scheduled_slot_starts_at") or "").strip() or None

        completed_at = str(request_meta.get("completed_at") or "").strip() or None
        if not completed_at and session_row and session_status == MentorshipSessionStatus.COMPLETED:
            completed_at = str(session_row.get("updated_at") or session_row.get("ends_at") or "").strip() or None
        if not completed_at and request_status == MentorshipRequestStatus.COMPLETED:
            completed_at = str(request_row.get("updated_at") or "").strip() or None

        timeline: List[MentorshipTrackingEventResponse] = [
            MentorshipTrackingEventResponse(
                key="requested",
                label="Copy submitted" if copy_row else "Request raised",
                at=str(
                    (copy_row or {}).get("submitted_at")
                    or request_row.get("requested_at")
                    or ""
                ),
                actor="user",
            )
        ]
        if copy_row and str(copy_row.get("eta_set_at") or "").strip():
            timeline.append(
                MentorshipTrackingEventResponse(
                    key="eta_declared",
                    label="Checking ETA shared",
                    at=str(copy_row.get("eta_set_at") or ""),
                    actor="mentor",
                    detail=str(copy_row.get("provider_eta_text") or "").strip() or None,
                )
            )
        if copy_row and str(copy_row.get("checked_at") or "").strip():
            timeline.append(
                MentorshipTrackingEventResponse(
                    key="copy_checked",
                    label="Copy reviewed",
                    at=str(copy_row.get("checked_at") or ""),
                    actor="mentor",
                )
            )
        offered_at = str(request_meta.get("slot_options_offered_at") or "").strip() or None
        if offered_at:
            offered_count = len(
                [
                    slot_id
                    for slot_id in request_meta.get("offered_slot_ids", [])
                    if isinstance(slot_id, int) and int(slot_id) > 0
                ]
            )
            timeline.append(
                MentorshipTrackingEventResponse(
                    key="slots_offered",
                    label="Mentor offered slots",
                    at=offered_at,
                    actor=str(request_meta.get("slot_options_offered_by_role") or "mentor"),
                    detail=f"{offered_count} slot option{'s' if offered_count != 1 else ''} shared." if offered_count else None,
                )
            )
        if accepted_at:
            timeline.append(
                MentorshipTrackingEventResponse(
                    key="accepted",
                    label="Slot accepted" if offered_at else "Request accepted",
                    at=accepted_at,
                    actor=str(request_meta.get("accepted_by_role") or "mentor"),
                )
            )
        if scheduled_for:
            timeline.append(
                MentorshipTrackingEventResponse(
                    key="scheduled",
                    label="Session scheduled",
                    at=scheduled_for,
                    actor="mentor",
                )
            )
        if session_row and session_status == MentorshipSessionStatus.LIVE:
            timeline.append(
                MentorshipTrackingEventResponse(
                    key="live",
                    label="Session live",
                    at=str(session_row.get("updated_at") or session_row.get("starts_at") or ""),
                    actor="mentor",
                )
            )
        if request_status == MentorshipRequestStatus.COMPLETED and completed_at:
            timeline.append(
                MentorshipTrackingEventResponse(
                    key="completed",
                    label="Session completed",
                    at=completed_at,
                    actor=str(request_meta.get("completed_by_role") or "mentor"),
                )
            )
        if request_status == MentorshipRequestStatus.REJECTED:
            timeline.append(
                MentorshipTrackingEventResponse(
                    key="rejected",
                    label="Request rejected",
                    at=str(request_row.get("updated_at") or ""),
                    actor=str(request_meta.get("rejected_by_role") or "mentor"),
                )
            )
        if request_status == MentorshipRequestStatus.CANCELLED:
            timeline.append(
                MentorshipTrackingEventResponse(
                    key="cancelled",
                    label="Request cancelled",
                    at=str(request_row.get("updated_at") or ""),
                    actor=_tracking_status_actor_from_meta(request_meta, request_row),
                )
            )

        cycle_issues: List[LifecycleTrackingIssueResponse] = []
        requested_dt = _parse_datetime(request_row.get("requested_at"))
        scheduled_dt = _parse_datetime(scheduled_for)

        if _contains_technical_issue_text(request_row.get("note"), request_meta.get("last_status_reason")):
            issue = build_issue(
                code="technical_difficulty_reported",
                label="Technical difficulty reported in mentorship flow.",
                actor="user",
                detected_at=str(request_row.get("updated_at") or request_row.get("requested_at") or generated_at),
                related_type="mentorship_request",
                related_id=request_id,
                detail=str(request_row.get("note") or request_meta.get("last_status_reason") or "").strip()[:220] or None,
                severity="warning",
            )
            cycle_issues.append(issue)
            attach_user_issue(request_user_id, issue)

        if request_status == MentorshipRequestStatus.REQUESTED and requested_dt:
            if now_dt > requested_dt + timedelta(hours=MENTOR_REQUEST_RESPONSE_DELAY_HOURS):
                waited_hours = int((now_dt - requested_dt).total_seconds() // 3600)
                issue = build_issue(
                    code="mentor_response_delay",
                    label="Mentor response delay detected.",
                    actor="mentor",
                    detected_at=generated_at,
                    related_type="mentorship_request",
                    related_id=request_id,
                    detail=f"Pending for {waited_hours}h after request.",
                )
                cycle_issues.append(issue)
                attach_user_issue(request_user_id, issue)

        scheduled_like = request_status == MentorshipRequestStatus.SCHEDULED or (
            session_status == MentorshipSessionStatus.SCHEDULED
        )
        if scheduled_like and scheduled_dt:
            if now_dt > scheduled_dt + timedelta(minutes=SESSION_DELAY_GRACE_MINUTES):
                issue = build_issue(
                    code="scheduled_session_delay",
                    label="Scheduled mentorship session is delayed.",
                    actor="mentor",
                    detected_at=generated_at,
                    related_type="mentorship_request",
                    related_id=request_id,
                    detail="Scheduled time passed but session is not marked completed.",
                )
                cycle_issues.append(issue)
                attach_user_issue(request_user_id, issue)

        if request_status == MentorshipRequestStatus.CANCELLED:
            cancel_actor = _tracking_status_actor_from_meta(request_meta, request_row)
            issue = build_issue(
                code="user_cancelled_flow" if cancel_actor == "user" else "mentor_cancelled_flow",
                label="Mentorship flow was cancelled by user." if cancel_actor == "user" else "Mentorship flow was cancelled by mentor/moderation.",
                actor=cancel_actor if cancel_actor in {"user", "mentor", "moderator"} else "system",
                detected_at=str(request_row.get("updated_at") or generated_at),
                related_type="mentorship_request",
                related_id=request_id,
                detail=str(request_meta.get("last_status_reason") or "").strip() or None,
                severity="info" if cancel_actor == "user" else "warning",
            )
            cycle_issues.append(issue)
            attach_user_issue(request_user_id, issue)

        if request_status == MentorshipRequestStatus.REJECTED:
            issue = build_issue(
                code="mentor_rejected_request",
                label="Mentorship request was rejected.",
                actor="mentor",
                detected_at=str(request_row.get("updated_at") or generated_at),
                related_type="mentorship_request",
                related_id=request_id,
                detail=str(request_meta.get("last_status_reason") or "").strip() or None,
                severity="info",
            )
            cycle_issues.append(issue)
            attach_user_issue(request_user_id, issue)

        if request_status == MentorshipRequestStatus.COMPLETED and not session_row:
            issue = build_issue(
                code="completed_without_session_record",
                label="Completed mentorship has no session row.",
                actor="system",
                detected_at=str(request_row.get("updated_at") or generated_at),
                related_type="mentorship_request",
                related_id=request_id,
                detail="Data consistency issue: completed request missing session record.",
                severity="warning",
            )
            cycle_issues.append(issue)
            attach_user_issue(request_user_id, issue)

        req_series_id = int(request_row.get("series_id") or 0) or None
        req_test_id = int(request_row.get("test_collection_id") or 0) or None
        series_title = None
        if req_series_id and req_series_id in series_by_id:
            series_title = str(series_by_id[req_series_id].get("title") or f"Series {req_series_id}")
        test_title = test_title_by_id.get(req_test_id or 0) if req_test_id else None

        mentorship_cycles.append(
            MentorshipTrackingCycleResponse(
                request_id=request_id,
                user_id=request_user_id,
                provider_user_id=request_provider_id,
                series_id=req_series_id,
                series_title=series_title,
                test_collection_id=req_test_id,
                test_title=test_title,
                request_status=request_status,
                session_status=session_status,
                requested_at=str(request_row.get("requested_at") or ""),
                accepted_at=accepted_at,
                scheduled_for=scheduled_for,
                completed_at=completed_at,
                slot_id=slot_id if slot_id > 0 else None,
                slot_mode=(
                    _normalize_mentorship_mode(slot_row.get("mode") if slot_row else (session_row or {}).get("mode"))
                    if (slot_row or session_row)
                    else None
                ),
                note=request_row.get("note"),
                timeline=timeline,
                issues=cycle_issues,
            )
        )

    for copy_row in copy_rows:
        copy_id = int(copy_row.get("id") or 0)
        if copy_id <= 0:
            continue
        copy_user_id = str(copy_row.get("user_id") or "").strip()
        copy_status = _normalize_copy_status(copy_row.get("status"))
        submitted_at = _parse_datetime(copy_row.get("submitted_at"))
        eta_set_at = _parse_datetime(copy_row.get("eta_set_at"))
        eta_hours = _parse_optional_non_negative_int(copy_row.get("provider_eta_hours"), max_value=24 * 90)

        if _contains_technical_issue_text(copy_row.get("provider_note")):
            issue = build_issue(
                code="technical_copy_issue",
                label="Technical issue noted during copy-check workflow.",
                actor="mentor",
                detected_at=str(copy_row.get("updated_at") or copy_row.get("submitted_at") or generated_at),
                related_type="copy_submission",
                related_id=copy_id,
                detail=str(copy_row.get("provider_note") or "").strip()[:220] or None,
                severity="warning",
            )
            attach_user_issue(copy_user_id, issue)

        if copy_status != CopySubmissionStatus.CHECKED:
            if eta_hours is not None and eta_hours > 0 and eta_set_at:
                if now_dt > eta_set_at + timedelta(hours=eta_hours):
                    issue = build_issue(
                        code="copy_review_delay",
                        label="Copy review exceeded declared ETA.",
                        actor="mentor",
                        detected_at=generated_at,
                        related_type="copy_submission",
                        related_id=copy_id,
                        detail=f"ETA was {eta_hours}h from declaration.",
                    )
                    attach_user_issue(copy_user_id, issue)
            elif submitted_at and now_dt > submitted_at + timedelta(hours=COPY_REVIEW_DELAY_HOURS):
                issue = build_issue(
                    code="copy_review_delay_unplanned",
                    label="Copy review delay without declared ETA.",
                    actor="mentor",
                    detected_at=generated_at,
                    related_type="copy_submission",
                    related_id=copy_id,
                    detail=f"Submission pending more than {COPY_REVIEW_DELAY_HOURS}h.",
                )
                attach_user_issue(copy_user_id, issue)

    enrollment_by_user: Dict[str, List[Dict[str, Any]]] = {}
    for row in enrollment_rows:
        uid = str(row.get("user_id") or "").strip()
        if uid:
            enrollment_by_user.setdefault(uid, []).append(row)

    copies_by_user: Dict[str, List[Dict[str, Any]]] = {}
    for row in copy_rows:
        uid = str(row.get("user_id") or "").strip()
        if uid:
            copies_by_user.setdefault(uid, []).append(row)

    requests_by_user: Dict[str, List[Dict[str, Any]]] = {}
    for row in request_rows:
        uid = str(row.get("user_id") or "").strip()
        if uid:
            requests_by_user.setdefault(uid, []).append(row)

    sessions_by_user: Dict[str, List[Dict[str, Any]]] = {}
    for row in session_rows:
        uid = str(row.get("user_id") or "").strip()
        if uid:
            sessions_by_user.setdefault(uid, []).append(row)

    tracked_user_ids: Set[str] = set()
    tracked_user_ids.update(enrollment_by_user.keys())
    tracked_user_ids.update(copies_by_user.keys())
    tracked_user_ids.update(requests_by_user.keys())
    tracked_user_ids.update(sessions_by_user.keys())
    tracked_user_ids.update(user_issues.keys())
    if user_filter:
        tracked_user_ids.add(user_filter)
    if scope == "me":
        tracked_user_ids.add(requester_id)

    for tracked_user_id in tracked_user_ids:
        user_enrollments = enrollment_by_user.get(tracked_user_id, [])
        active_series = {
            int(row.get("series_id") or 0)
            for row in user_enrollments
            if int(row.get("series_id") or 0) > 0 and str(row.get("status") or "").strip() == "active"
        }
        user_copies = copies_by_user.get(tracked_user_id, [])
        user_requests = requests_by_user.get(tracked_user_id, [])
        user_sessions = sessions_by_user.get(tracked_user_id, [])
        user_issue_rows = sorted(
            user_issues.get(tracked_user_id, []),
            key=lambda issue: _parse_datetime(issue.detected_at) or datetime.min.replace(tzinfo=timezone.utc),
            reverse=True,
        )

        attempted_tests = {
            int(row.get("test_collection_id") or 0)
            for row in user_copies
            if int(row.get("test_collection_id") or 0) > 0
        }
        checked_copy_count = sum(
            1 for row in user_copies if _normalize_copy_status(row.get("status")) == CopySubmissionStatus.CHECKED
        )
        pending_copy_count = len(user_copies) - checked_copy_count

        pending_mentorship_count = sum(
            1
            for row in user_requests
            if _normalize_mentorship_request_status(row.get("status"))
            in {MentorshipRequestStatus.REQUESTED, MentorshipRequestStatus.SCHEDULED}
        )
        session_non_cancelled = [
            row for row in user_sessions if _normalize_mentorship_session_status(row.get("status")) != MentorshipSessionStatus.CANCELLED
        ]
        completed_sessions = [
            row for row in user_sessions if _normalize_mentorship_session_status(row.get("status")) == MentorshipSessionStatus.COMPLETED
        ]

        mentorship_scheduled = len(session_non_cancelled)
        if mentorship_scheduled == 0:
            mentorship_scheduled = sum(
                1
                for row in user_requests
                if _normalize_mentorship_request_status(row.get("status"))
                in {MentorshipRequestStatus.SCHEDULED, MentorshipRequestStatus.COMPLETED}
            )
        mentorship_completed = len(completed_sessions)
        if mentorship_completed == 0:
            mentorship_completed = sum(
                1
                for row in user_requests
                if _normalize_mentorship_request_status(row.get("status")) == MentorshipRequestStatus.COMPLETED
            )

        activity_values: List[Any] = []
        for row in user_enrollments:
            activity_values.extend([row.get("updated_at"), row.get("created_at")])
        for row in user_copies:
            activity_values.extend([row.get("updated_at"), row.get("submitted_at"), row.get("checked_at")])
        for row in user_requests:
            activity_values.extend([row.get("updated_at"), row.get("requested_at")])
        for row in user_sessions:
            activity_values.extend([row.get("updated_at"), row.get("starts_at"), row.get("ends_at"), row.get("created_at")])
        activity_values.extend([issue.detected_at for issue in user_issue_rows])
        last_activity_at = _latest_datetime_iso(activity_values)

        delay_count = sum(1 for issue in user_issue_rows if "delay" in issue.code)
        technical_issue_count = sum(1 for issue in user_issue_rows if "technical" in issue.code)

        user_rows.append(
            UserLifecycleTrackingRowResponse(
                user_id=tracked_user_id,
                enrolled_series_count=len(active_series),
                attempted_tests=len(attempted_tests),
                copy_submissions=len(user_copies),
                copy_checked=checked_copy_count,
                mentorship_requests=len(user_requests),
                mentorship_scheduled=mentorship_scheduled,
                mentorship_completed=mentorship_completed,
                pending_copy_checks=max(0, pending_copy_count),
                pending_mentorship=pending_mentorship_count,
                delay_count=delay_count,
                technical_issue_count=technical_issue_count,
                last_activity_at=last_activity_at,
                issues=user_issue_rows[:20],
            )
        )

    user_rows.sort(
        key=lambda row: (
            row.delay_count,
            row.pending_mentorship,
            row.technical_issue_count,
            _parse_datetime(row.last_activity_at) or datetime.min.replace(tzinfo=timezone.utc),
        ),
        reverse=True,
    )
    if len(user_rows) > limit_users:
        user_rows = user_rows[:limit_users]

    pending_mentorship_total = sum(
        1
        for row in request_rows
        if _normalize_mentorship_request_status(row.get("status"))
        in {MentorshipRequestStatus.REQUESTED, MentorshipRequestStatus.SCHEDULED}
    )
    scheduled_mentorship_total = sum(
        1 for row in request_rows if _normalize_mentorship_request_status(row.get("status")) == MentorshipRequestStatus.SCHEDULED
    )
    completed_mentorship_total = sum(
        1 for row in request_rows if _normalize_mentorship_request_status(row.get("status")) == MentorshipRequestStatus.COMPLETED
    )
    pending_copy_total = sum(
        1 for row in copy_rows if _normalize_copy_status(row.get("status")) != CopySubmissionStatus.CHECKED
    )

    summary = LifecycleTrackingSummaryResponse(
        users=len(user_rows),
        mentorship_cycles=len(mentorship_cycles),
        pending_mentorship=pending_mentorship_total,
        scheduled_mentorship=scheduled_mentorship_total,
        completed_mentorship=completed_mentorship_total,
        pending_copy_checks=pending_copy_total,
        delayed_items=delay_issues_total,
        technical_issues=technical_issues_total,
    )

    return LifecycleTrackingResponse(
        generated_at=generated_at,
        summary=summary,
        mentorship_cycles=mentorship_cycles,
        user_rows=user_rows,
    )


@router.post("/mentorship/entitlements/grant", response_model=MentorshipEntitlementResponse)
def grant_mentorship_entitlement(
    payload: MentorshipEntitlementGrantCreate,
    user_ctx: Dict[str, Any] = Depends(require_authenticated_user),
    supabase: Client = Depends(get_supabase_client),
):
    if not (_is_admin_or_moderator(user_ctx) or _is_mentor_like(user_ctx)):
        raise HTTPException(
            status_code=403,
            detail="Only Mains Mentor, moderator, or admin can grant mentorship entitlements.",
        )
    insert_payload = {
        "user_id": payload.user_id,
        "sessions_remaining": payload.sessions,
        "valid_until": payload.valid_until,
        "source": payload.source or "payment",
        "note": payload.note,
        "is_active": True,
        "updated_at": _utc_now_iso(),
    }
    row = _first(supabase.table(MENTORSHIP_ENTITLEMENTS_TABLE).insert(insert_payload).execute())
    if not row:
        raise HTTPException(status_code=400, detail="Failed to grant mentorship entitlement.")
    return _entitlement_response(row)


@router.get("/mentorship/entitlements/me", response_model=List[MentorshipEntitlementResponse])
def get_my_mentorship_entitlements(
    user_ctx: Dict[str, Any] = Depends(require_authenticated_user),
    supabase: Client = Depends(get_supabase_client),
):
    user_id = str(user_ctx.get("user_id") or "").strip()
    rows = _rows(
        supabase.table(MENTORSHIP_ENTITLEMENTS_TABLE)
        .select("*")
        .eq("user_id", user_id)
        .order("created_at", desc=True)
        .execute()
    )
    return [_entitlement_response(row) for row in rows]


@router.post("/mentorship/slots", response_model=MentorshipSlotResponse)
def create_mentorship_slot(
    payload: MentorshipSlotCreate,
    user_ctx: Dict[str, Any] = Depends(require_mentor_user),
    supabase: Client = Depends(get_supabase_client),
):
    user_id = str(user_ctx.get("user_id") or "").strip()
    starts_at = _required_datetime(payload.starts_at, "starts_at")
    ends_at = _required_datetime(payload.ends_at, "ends_at")
    if ends_at <= starts_at:
        raise HTTPException(status_code=400, detail="Slot end time must be after start time.")
    if ends_at - starts_at > timedelta(minutes=MENTORSHIP_SLOT_DURATION_MINUTES):
        raise HTTPException(
            status_code=400,
            detail=f"Single slot creation supports only {MENTORSHIP_SLOT_DURATION_MINUTES}-minute windows. Use batch publishing for longer availability.",
        )
    profile_call_provider, profile_zoom_meeting_link, _call_setup_note = _mentor_call_profile_defaults(
        user_id,
        supabase=supabase,
    )
    requested_call_provider = payload.call_provider.value if payload.call_provider else profile_call_provider.value
    resolved_meeting_link = payload.meeting_link or (
        profile_zoom_meeting_link if requested_call_provider == MentorshipCallProvider.ZOOM.value else None
    )
    call_provider = _normalize_mentorship_call_provider(
        requested_call_provider,
        meeting_link=resolved_meeting_link,
    )

    insert_payload = {
        "provider_user_id": user_id,
        "starts_at": starts_at.isoformat(),
        "ends_at": ends_at.isoformat(),
        "mode": payload.mode.value,
        "call_provider": call_provider.value,
        "max_bookings": payload.max_bookings,
        "booked_count": 0,
        "is_active": payload.is_active,
        "meeting_link": resolved_meeting_link,
        "title": payload.title,
        "description": payload.description,
        "updated_at": _utc_now_iso(),
    }
    row = _first(supabase.table(MENTORSHIP_SLOTS_TABLE).insert(insert_payload).execute())
    if not row:
        raise HTTPException(status_code=400, detail="Failed to create mentorship slot.")
    return _slot_response(row)


@router.post("/mentorship/slots/batch", response_model=List[MentorshipSlotResponse])
def create_mentorship_slots_batch(
    payload: MentorshipSlotBatchCreate,
    user_ctx: Dict[str, Any] = Depends(require_mentor_user),
    supabase: Client = Depends(get_supabase_client),
):
    user_id = str(user_ctx.get("user_id") or "").strip()
    slot_rows = payload.slots or []
    if not slot_rows:
        raise HTTPException(status_code=400, detail="At least one slot is required.")

    insert_rows: List[Dict[str, Any]] = []
    seen_slots: Set[tuple[str, str, str, str]] = set()
    updated_at_iso = _utc_now_iso()
    profile_call_provider, profile_zoom_meeting_link, _call_setup_note = _mentor_call_profile_defaults(
        user_id,
        supabase=supabase,
    )

    for index, slot in enumerate(slot_rows, start=1):
        starts_at = _required_datetime(slot.starts_at, f"slots[{index}].starts_at")
        ends_at = _required_datetime(slot.ends_at, f"slots[{index}].ends_at")
        if ends_at <= starts_at:
            raise HTTPException(status_code=400, detail=f"Slot #{index} end time must be after start time.")
        requested_call_provider = slot.call_provider.value if slot.call_provider else profile_call_provider.value
        resolved_meeting_link = slot.meeting_link or (
            profile_zoom_meeting_link if requested_call_provider == MentorshipCallProvider.ZOOM.value else None
        )
        expanded_rows = _expand_slot_insert_rows(
            provider_user_id=user_id,
            starts_at=starts_at,
            ends_at=ends_at,
            mode=slot.mode.value,
            call_provider=_normalize_mentorship_call_provider(
                requested_call_provider,
                meeting_link=resolved_meeting_link,
            ).value,
            meeting_link=resolved_meeting_link,
            title=slot.title,
            description=slot.description,
            is_active=slot.is_active,
            updated_at_iso=updated_at_iso,
        )
        for expanded_row in expanded_rows:
            dedupe_key = (
                str(expanded_row["starts_at"]),
                str(expanded_row["ends_at"]),
                str(expanded_row["mode"]),
                str(expanded_row["call_provider"]),
            )
            if dedupe_key in seen_slots:
                continue
            seen_slots.add(dedupe_key)
            insert_rows.append(expanded_row)

    if not insert_rows:
        raise HTTPException(status_code=400, detail="No valid unique slots were supplied.")

    rows = _rows(supabase.table(MENTORSHIP_SLOTS_TABLE).insert(insert_rows).execute())
    if not rows:
        raise HTTPException(status_code=400, detail="Failed to create mentorship slots.")

    rows.sort(key=lambda row: str(row.get("starts_at") or ""))
    return [_slot_response(row) for row in rows]


@router.get("/mentorship/slots", response_model=List[MentorshipSlotResponse])
def list_mentorship_slots(
    provider_user_id: Optional[str] = None,
    only_available: bool = True,
    include_past: bool = False,
    user_ctx: Optional[Dict[str, Any]] = Depends(get_user_context),
    supabase: Client = Depends(get_supabase_client),
):
    query = supabase.table(MENTORSHIP_SLOTS_TABLE).select("*").eq("is_active", True).order("starts_at")
    normalized_provider_id = str(provider_user_id or "").strip() or None
    own_id: Optional[str] = None
    if normalized_provider_id:
        query = query.eq("provider_user_id", normalized_provider_id)
    elif user_ctx and _is_mentor_like(user_ctx) and not (_is_admin(user_ctx) or _is_moderator(user_ctx)):
        own_id = str(user_ctx.get("user_id") or "").strip() or None
        if own_id:
            query = query.eq("provider_user_id", own_id)
    if not include_past:
        query = query.gte("ends_at", _utc_now_iso())

    rows = _rows(query.execute())

    materialize_provider_ids: Set[str] = set()
    if normalized_provider_id:
        materialize_provider_ids.add(normalized_provider_id)
    if own_id:
        materialize_provider_ids.add(own_id)

    if materialize_provider_ids:
        normalized_rows: List[Dict[str, Any]] = []
        seen_ids: Set[int] = set()
        updated_at_iso = _utc_now_iso()
        for row in rows:
            row_provider_id = str(row.get("provider_user_id") or "").strip()
            candidate_rows = [row]
            starts_at = _parse_datetime(row.get("starts_at"))
            ends_at = _parse_datetime(row.get("ends_at"))
            if (
                row_provider_id in materialize_provider_ids
                and starts_at
                and ends_at
                and ends_at - starts_at > timedelta(minutes=MENTORSHIP_SLOT_DURATION_MINUTES)
            ):
                candidate_rows = _materialize_slot_segments(row, supabase=supabase, updated_at_iso=updated_at_iso)

            for candidate in candidate_rows:
                candidate_id = int(candidate.get("id") or 0)
                if candidate_id > 0 and candidate_id in seen_ids:
                    continue
                if only_available and int(candidate.get("booked_count") or 0) >= int(candidate.get("max_bookings") or 1):
                    continue
                normalized_rows.append(candidate)
                if candidate_id > 0:
                    seen_ids.add(candidate_id)
        rows = normalized_rows
    elif only_available:
        rows = [
            row for row in rows
            if int(row.get("booked_count") or 0) < int(row.get("max_bookings") or 1)
        ]

    rows.sort(key=lambda row: str(row.get("starts_at") or ""))
    return [_slot_response(row) for row in rows]


@router.put("/mentorship/slots/{slot_id}", response_model=MentorshipSlotResponse)
def update_mentorship_slot(
    slot_id: int,
    payload: MentorshipSlotUpdate,
    user_ctx: Dict[str, Any] = Depends(require_mentor_user),
    supabase: Client = Depends(get_supabase_client),
):
    row = _first(supabase.table(MENTORSHIP_SLOTS_TABLE).select("*").eq("id", slot_id).limit(1).execute())
    if not row:
        raise HTTPException(status_code=404, detail="Slot not found.")
    if not _is_admin(user_ctx) and str(row.get("provider_user_id") or "") != str(user_ctx.get("user_id") or ""):
        raise HTTPException(status_code=403, detail="You can update only your own slots.")

    updates = payload.model_dump(exclude_none=True)
    if "mode" in updates and updates["mode"] is not None:
        updates["mode"] = updates["mode"].value
    if "call_provider" in updates and updates["call_provider"] is not None:
        updates["call_provider"] = updates["call_provider"].value
    if payload.starts_at is not None:
        updates["starts_at"] = _required_datetime(payload.starts_at, "starts_at").isoformat()
    if payload.ends_at is not None:
        updates["ends_at"] = _required_datetime(payload.ends_at, "ends_at").isoformat()

    starts = _parse_datetime(updates.get("starts_at") or row.get("starts_at"))
    ends = _parse_datetime(updates.get("ends_at") or row.get("ends_at"))
    if not starts or not ends or ends <= starts:
        raise HTTPException(status_code=400, detail="Invalid slot timings.")
    profile_call_provider, profile_zoom_meeting_link, _call_setup_note = _mentor_call_profile_defaults(
        str(row.get("provider_user_id") or ""),
        supabase=supabase,
    )
    resolved_meeting_link = updates.get("meeting_link") if "meeting_link" in updates else row.get("meeting_link")
    resolved_call_provider = updates.get("call_provider") if "call_provider" in updates else row.get("call_provider")
    if not resolved_meeting_link and str(resolved_call_provider or profile_call_provider.value) == MentorshipCallProvider.ZOOM.value:
        resolved_meeting_link = profile_zoom_meeting_link
        updates["meeting_link"] = resolved_meeting_link
    updates["call_provider"] = _normalize_mentorship_call_provider(
        resolved_call_provider,
        meeting_link=resolved_meeting_link,
    ).value

    updates["updated_at"] = _utc_now_iso()
    updated = _first(supabase.table(MENTORSHIP_SLOTS_TABLE).update(updates).eq("id", slot_id).execute())
    if not updated:
        raise HTTPException(status_code=404, detail="Slot not found.")
    return _slot_response(updated)


@router.post("/mentorship/slots/deactivate-batch")
def deactivate_mentorship_slots_batch(
    payload: MentorshipSlotBatchDeactivate,
    user_ctx: Dict[str, Any] = Depends(require_mentor_user),
    supabase: Client = Depends(get_supabase_client),
):
    slot_ids = sorted(
        {
            int(slot_id)
            for slot_id in (payload.slot_ids or [])
            if isinstance(slot_id, int) and int(slot_id) > 0
        }
    )
    if not slot_ids:
        raise HTTPException(status_code=400, detail="At least one slot id is required.")

    rows = _rows(
        supabase.table(MENTORSHIP_SLOTS_TABLE)
        .select("id,provider_user_id")
        .in_("id", slot_ids)
        .execute()
    )
    if not rows:
        raise HTTPException(status_code=404, detail="No mentorship slots found.")

    current_user_id = str(user_ctx.get("user_id") or "").strip()
    if not _is_admin(user_ctx):
        unauthorized = [
            int(row.get("id") or 0)
            for row in rows
            if str(row.get("provider_user_id") or "").strip() != current_user_id
        ]
        if unauthorized:
            raise HTTPException(status_code=403, detail="You can deactivate only your own slots.")

    updated_rows = _rows(
        supabase.table(MENTORSHIP_SLOTS_TABLE)
        .update({"is_active": False, "updated_at": _utc_now_iso()})
        .in_("id", slot_ids)
        .execute()
    )
    return {
        "updated_count": len(updated_rows),
        "slot_ids": [int(row.get("id") or 0) for row in updated_rows if int(row.get("id") or 0) > 0],
    }


@router.delete("/mentorship/slots/{slot_id}")
def delete_mentorship_slot(
    slot_id: int,
    user_ctx: Dict[str, Any] = Depends(require_mentor_user),
    supabase: Client = Depends(get_supabase_client),
):
    row = _first(supabase.table(MENTORSHIP_SLOTS_TABLE).select("*").eq("id", slot_id).limit(1).execute())
    if not row:
        raise HTTPException(status_code=404, detail="Slot not found.")
    if not _is_admin(user_ctx) and str(row.get("provider_user_id") or "") != str(user_ctx.get("user_id") or ""):
        raise HTTPException(status_code=403, detail="You can delete only your own slots.")

    updated = _first(
        supabase.table(MENTORSHIP_SLOTS_TABLE)
        .update({"is_active": False, "updated_at": _utc_now_iso()})
        .eq("id", slot_id)
        .execute()
    )
    if not updated:
        raise HTTPException(status_code=404, detail="Slot not found.")
    return {"message": "Mentorship slot deactivated.", "id": slot_id}


@router.post("/mentorship/requests", response_model=MentorshipRequestResponse)
def create_mentorship_request(
    payload: MentorshipRequestCreate,
    user_ctx: Dict[str, Any] = Depends(require_authenticated_user),
    supabase: Client = Depends(get_supabase_client),
):
    user_id = str(user_ctx.get("user_id") or "").strip()
    booking_slot_row: Optional[Dict[str, Any]] = None

    resolved_provider_id: Optional[str] = None
    resolved_series_id: Optional[int] = None
    resolved_test_id: Optional[int] = None
    resolved_submission_id: Optional[int] = None
    is_standalone = False
    existing_submission_request: Optional[Dict[str, Any]] = None

    if payload.series_id is not None:
        series_row = _fetch_series_or_404(payload.series_id, supabase)
        resolved_provider_id = _resolve_series_handler_user_id(series_row)
        resolved_series_id = int(series_row.get("id") or payload.series_id)
        if not _can_access_series_content(user_ctx=user_ctx, series_row=series_row, supabase=supabase):
            raise HTTPException(status_code=403, detail="You do not have access to this test series.")
        checked_submission_row = _latest_checked_submission_for_user(
            user_id=user_id,
            series_id=resolved_series_id,
            supabase=supabase,
        )
        if not checked_submission_row:
            raise HTTPException(
                status_code=400,
                detail="Mentorship unlocks only after at least one submitted answer has been checked by the mentor for this series.",
            )
        resolved_submission_id = int(checked_submission_row.get("id") or 0) or None
        resolved_test_id = int(checked_submission_row.get("test_collection_id") or 0) or None
    elif payload.test_id is not None:
        series_row, _collection_row, series_id = _fetch_series_for_test_or_404(payload.test_id, supabase)
        resolved_provider_id = _resolve_series_handler_user_id(series_row)
        resolved_series_id = series_id
        resolved_test_id = payload.test_id
        if not _can_access_series_content(user_ctx=user_ctx, series_row=series_row, supabase=supabase):
            raise HTTPException(status_code=403, detail="You do not have access to this test series.")
        checked_submission_row = _latest_checked_submission_for_user(
            user_id=user_id,
            test_id=payload.test_id,
            supabase=supabase,
        )
        if not checked_submission_row:
            raise HTTPException(
                status_code=400,
                detail="Mentorship unlocks only after the mentor has checked one of your answer submissions for this test.",
            )
        resolved_submission_id = int(checked_submission_row.get("id") or 0) or None
    elif payload.submission_id is not None:
        submission_row = _first(
            supabase.table(COPY_SUBMISSIONS_TABLE)
            .select("*")
            .eq("id", payload.submission_id)
            .limit(1)
            .execute()
        )
        if not submission_row:
            raise HTTPException(status_code=404, detail="Copy submission not found.")
        if str(submission_row.get("user_id") or "").strip() != user_id:
            raise HTTPException(status_code=403, detail="Mentorship can only be requested for your own submission.")
        if _normalize_copy_status(submission_row.get("status")) != CopySubmissionStatus.CHECKED:
            raise HTTPException(
                status_code=400,
                detail="Mentorship unlocks only after the mentor has checked this submission.",
            )
        resolved_submission_id = payload.submission_id
        resolved_test_id = int(submission_row.get("test_collection_id") or 0) or None
        resolved_series_id = int(submission_row.get("series_id") or 0) or None
        if resolved_series_id:
            series_row = _fetch_series_or_404(resolved_series_id, supabase)
            resolved_provider_id = _resolve_series_handler_user_id(series_row)
    else:
        is_standalone = True
        if payload.provider_user_id:
            resolved_provider_id = str(payload.provider_user_id).strip()
        if not resolved_provider_id:
            raise HTTPException(
                status_code=400,
                detail="Standalone mentorship request requires provider_user_id.",
            )
        if payload.slot_id is None and not _has_active_mentorship_entitlement(user_id, supabase) and not _is_active_subscription(user_ctx):
            raise HTTPException(
                status_code=403,
                detail="Standalone mentorship requires mentorship entitlement or active subscription.",
            )

    if resolved_submission_id:
        existing_submission_request = _copy_submission_request_row(
            submission_id=resolved_submission_id,
            supabase=supabase,
        )
        if existing_submission_request and not resolved_provider_id:
            resolved_provider_id = str(existing_submission_request.get("provider_user_id") or "").strip() or None

    if payload.slot_id is not None:
        booking_slot_row = _first(
            supabase.table(MENTORSHIP_SLOTS_TABLE)
            .select("*")
            .eq("id", int(payload.slot_id))
            .limit(1)
            .execute()
        )
        if not booking_slot_row:
            raise HTTPException(status_code=404, detail="Mentorship slot not found.")

        slot_provider_id = str(booking_slot_row.get("provider_user_id") or "").strip()
        if resolved_provider_id and slot_provider_id != resolved_provider_id:
            raise HTTPException(status_code=400, detail="Selected slot belongs to a different mentor.")
        if not resolved_provider_id:
            resolved_provider_id = slot_provider_id

        segment_start_iso = str(payload.slot_segment_starts_at or "").strip()
        segment_end_iso = str(payload.slot_segment_ends_at or "").strip()
        if segment_start_iso or segment_end_iso:
            if not (segment_start_iso and segment_end_iso):
                raise HTTPException(status_code=400, detail="Both slot segment start and end are required.")

            booking_slot_start = _required_datetime(str(booking_slot_row.get("starts_at") or ""), "slot.starts_at")
            booking_slot_end = _required_datetime(str(booking_slot_row.get("ends_at") or ""), "slot.ends_at")
            requested_segment_start = _required_datetime(segment_start_iso, "slot_segment_starts_at")
            requested_segment_end = _required_datetime(segment_end_iso, "slot_segment_ends_at")
            if requested_segment_end <= requested_segment_start:
                raise HTTPException(status_code=400, detail="Selected slot segment is invalid.")
            if requested_segment_start < booking_slot_start or requested_segment_end > booking_slot_end:
                raise HTTPException(status_code=400, detail="Selected slot segment falls outside the published availability.")
            if requested_segment_end - requested_segment_start != timedelta(minutes=MENTORSHIP_SLOT_DURATION_MINUTES):
                raise HTTPException(
                    status_code=400,
                    detail=f"Selected slot must be exactly {MENTORSHIP_SLOT_DURATION_MINUTES} minutes.",
                )

            segment_rows = _materialize_slot_segments(booking_slot_row, supabase=supabase, updated_at_iso=_utc_now_iso())
            target_segment = next(
                (
                    row
                    for row in segment_rows
                    if str(row.get("starts_at") or "") == requested_segment_start.isoformat()
                    and str(row.get("ends_at") or "") == requested_segment_end.isoformat()
                ),
                None,
            )
            if not target_segment:
                raise HTTPException(status_code=400, detail="Could not resolve the selected 20-minute slot.")
            booking_slot_row = target_segment
        else:
            booking_slot_start = _required_datetime(str(booking_slot_row.get("starts_at") or ""), "slot.starts_at")
            booking_slot_end = _required_datetime(str(booking_slot_row.get("ends_at") or ""), "slot.ends_at")
            if booking_slot_end - booking_slot_start > timedelta(minutes=MENTORSHIP_SLOT_DURATION_MINUTES):
                raise HTTPException(
                    status_code=400,
                    detail="Select a specific 20-minute slot inside the available window.",
                )

    if not resolved_provider_id:
        raise HTTPException(status_code=400, detail="Could not resolve provider for mentorship request.")

    mentor_profile_row = _safe_first(
        supabase.table(PROFILES_TABLE)
        .select("user_id,role,meta,is_active")
        .eq("user_id", resolved_provider_id)
        .limit(1)
    )
    mentor_profile_role = _normalize_profile_role((mentor_profile_row or {}).get("role"), fallback="")
    if mentor_profile_role != "mentor":
        raise HTTPException(
            status_code=400,
            detail="Selected professional is not available as a Mains Mentor.",
        )
    if not bool((mentor_profile_row or {}).get("is_active", True)):
        raise HTTPException(
            status_code=400,
            detail="Selected Mains Mentor profile is currently inactive.",
        )

    mentor_profile_meta = _normalize_profile_meta((mentor_profile_row or {}).get("meta"))
    availability_mode = _as_role(mentor_profile_meta.get("mentorship_availability_mode")) or "series_only"
    available_series_ids = _parse_series_id_list(mentor_profile_meta.get("mentorship_available_series_ids"))
    if availability_mode == "series_only":
        if not resolved_series_id:
            raise HTTPException(
                status_code=400,
                detail="This Mains Mentor accepts requests only for selected test series.",
            )
        if available_series_ids and int(resolved_series_id) not in set(available_series_ids):
            raise HTTPException(
                status_code=400,
                detail="This Mains Mentor is currently not available for the selected test series.",
            )

    requested_at_iso = _utc_now_iso()
    resolved_mode = (
        _normalize_mentorship_mode(booking_slot_row.get("mode"))
        if booking_slot_row
        else payload.preferred_mode
    )
    if existing_submission_request:
        existing_status = _normalize_mentorship_request_status(existing_submission_request.get("status"))
        if not booking_slot_row:
            return _request_response(existing_submission_request)
        if existing_status in {
            MentorshipRequestStatus.CANCELLED,
            MentorshipRequestStatus.REJECTED,
            MentorshipRequestStatus.COMPLETED,
        }:
            raise HTTPException(status_code=400, detail="This copy workflow is already closed.")
        actor_role = _tracking_actor_from_user_ctx(user_ctx, request_row=existing_submission_request)
        updated_request, _session_row = _schedule_mentorship_request_with_slot(
            request_row=existing_submission_request,
            slot_row=booking_slot_row,
            supabase=supabase,
            now_iso=requested_at_iso,
            actor_user_id=user_id,
            actor_role=actor_role,
            workflow_stage="booked_by_user",
            request_meta_updates={
                "booked_by_user_at": requested_at_iso,
                "booked_by_user": user_id,
                "booked_by_user_role": actor_role,
                "booking_source": "self_service_slot",
                "mentor_notified_at": requested_at_iso,
                "mentor_notification_channel": "dashboard",
            },
        )
        return _request_response(updated_request)

    insert_payload = {
        "user_id": user_id,
        "provider_user_id": resolved_provider_id,
        "series_id": resolved_series_id,
        "test_collection_id": resolved_test_id,
        "submission_id": resolved_submission_id,
        "preferred_mode": resolved_mode.value,
        "note": payload.note,
        "status": MentorshipRequestStatus.REQUESTED.value,
        "requested_at": requested_at_iso,
        "updated_at": requested_at_iso,
        "meta": {
            "standalone": is_standalone,
            "requires_entitlement": bool(is_standalone and payload.slot_id is None),
            "workflow_stage": "admin_scheduling",
            "admin_queue_status": "pending",
            "admin_queue_received_at": requested_at_iso,
        },
    }
    row = _first(supabase.table(MENTORSHIP_REQUESTS_TABLE).insert(insert_payload).execute())
    if not row:
        raise HTTPException(status_code=400, detail="Failed to create mentorship request.")

    if booking_slot_row:
        actor_role = _tracking_actor_from_user_ctx(user_ctx, request_row=row)
        updated_request, _session_row = _schedule_mentorship_request_with_slot(
            request_row=row,
            slot_row=booking_slot_row,
            supabase=supabase,
            now_iso=requested_at_iso,
            actor_user_id=user_id,
            actor_role=actor_role,
            workflow_stage="booked_by_user",
            request_meta_updates={
                "admin_queue_status": "booked_directly",
                "booked_by_user_at": requested_at_iso,
                "booked_by_user": user_id,
                "booked_by_user_role": actor_role,
                "booking_source": "self_service_slot",
                "mentor_notified_at": requested_at_iso,
                "mentor_notification_channel": "dashboard",
            },
        )
        return _request_response(updated_request)

    return _request_response(row)


@router.get("/mentorship/requests", response_model=List[MentorshipRequestResponse])
def list_mentorship_requests(
    scope: str = Query(default="me", pattern="^(me|provider|all)$"),
    status: Optional[MentorshipRequestStatus] = None,
    user_ctx: Dict[str, Any] = Depends(require_authenticated_user),
    supabase: Client = Depends(get_supabase_client),
):
    user_id = str(user_ctx.get("user_id") or "").strip()
    is_admin = _is_admin(user_ctx)
    is_moderator = _is_moderator(user_ctx)
    is_handler = _is_mentor_like(user_ctx)

    query = supabase.table(MENTORSHIP_REQUESTS_TABLE).select("*").order("requested_at", desc=True)
    if scope == "provider":
        if not (is_handler or is_moderator):
            raise HTTPException(
                status_code=403,
                detail="Provider scope requires Mains Mentor, moderator, or admin access.",
            )
        if not (is_admin or is_moderator):
            if _is_mentor_like(user_ctx):
                _claim_primary_mentor_requests(mentor_user_id=user_id, supabase=supabase)
            query = query.eq("provider_user_id", user_id)
    elif scope == "all":
        if not (is_admin or is_moderator):
            raise HTTPException(status_code=403, detail="Only admin/moderator can use all scope.")
    else:
        query = query.eq("user_id", user_id)

    if status:
        query = query.eq("status", status.value)
    rows = _rows(query.execute())
    return [_request_response(row) for row in rows]


@router.post("/mentorship/requests/{request_id}/offer-slots", response_model=MentorshipRequestResponse)
def offer_mentorship_request_slots(
    request_id: int,
    payload: MentorshipRequestOfferSlots,
    user_ctx: Dict[str, Any] = Depends(require_authenticated_user),
    supabase: Client = Depends(get_supabase_client),
):
    request_row = _first(
        supabase.table(MENTORSHIP_REQUESTS_TABLE)
        .select("*")
        .eq("id", request_id)
        .limit(1)
        .execute()
    )
    if not request_row:
        raise HTTPException(status_code=404, detail="Mentorship request not found.")

    provider_user_id = str(request_row.get("provider_user_id") or "").strip()
    current_user_id = str(user_ctx.get("user_id") or "").strip()
    is_admin_moderator = _is_admin_or_moderator(user_ctx)
    if not is_admin_moderator:
        if not _is_mentor_like(user_ctx) or provider_user_id != current_user_id:
            raise HTTPException(status_code=403, detail="Only the assigned mentor can offer slots.")

    request_status = _normalize_mentorship_request_status(request_row.get("status"))
    if request_status != MentorshipRequestStatus.REQUESTED:
        raise HTTPException(status_code=400, detail="Slots can be offered only while the workflow is pending.")

    submission_id = int(request_row.get("submission_id") or 0)
    if submission_id > 0:
        submission_row = _safe_first(
            supabase.table(COPY_SUBMISSIONS_TABLE)
            .select("id,status")
            .eq("id", submission_id)
            .limit(1)
        )
        if not submission_row:
            raise HTTPException(status_code=404, detail="Linked copy submission not found.")
        if _normalize_copy_status(submission_row.get("status")) != CopySubmissionStatus.CHECKED:
            raise HTTPException(status_code=400, detail="Review the copy before offering mentorship slots.")

    slot_ids = sorted({int(slot_id) for slot_id in (payload.slot_ids or []) if int(slot_id) > 0})
    if not slot_ids:
        raise HTTPException(status_code=400, detail="Select at least one mentorship slot to offer.")

    slot_rows = _rows(
        supabase.table(MENTORSHIP_SLOTS_TABLE)
        .select("*")
        .in_("id", slot_ids)
        .execute()
    )
    if len(slot_rows) != len(slot_ids):
        raise HTTPException(status_code=404, detail="One or more mentorship slots were not found.")

    now_dt = _utc_now()
    for slot_row in slot_rows:
        if str(slot_row.get("provider_user_id") or "").strip() != provider_user_id:
            raise HTTPException(status_code=400, detail="All offered slots must belong to the assigned mentor.")
        if not bool(slot_row.get("is_active", True)):
            raise HTTPException(status_code=400, detail="Inactive slots cannot be offered.")
        if int(slot_row.get("booked_count") or 0) >= int(slot_row.get("max_bookings") or 1):
            raise HTTPException(status_code=400, detail="Booked slots cannot be offered.")
        slot_end_dt = _parse_datetime(slot_row.get("ends_at"))
        if not slot_end_dt or slot_end_dt <= now_dt:
            raise HTTPException(status_code=400, detail="Past slots cannot be offered.")

    slot_rows.sort(key=lambda row: str(row.get("starts_at") or ""))
    offered_slot_ids = [int(row.get("id") or 0) for row in slot_rows if int(row.get("id") or 0) > 0]
    now_iso = now_dt.isoformat()
    actor_role = _tracking_actor_from_user_ctx(user_ctx, request_row=request_row)

    meta = _meta_dict(request_row.get("meta"))
    meta["offered_slot_ids"] = offered_slot_ids
    meta["slot_offer_status"] = "offered"
    meta["slot_options_offered_at"] = now_iso
    meta["slot_options_offered_by"] = current_user_id
    meta["slot_options_offered_by_role"] = actor_role
    meta["workflow_stage"] = "slots_offered"
    meta["status_updated_by"] = current_user_id
    meta["status_updated_by_role"] = actor_role
    meta["status_updated_at"] = now_iso

    updated = _first(
        supabase.table(MENTORSHIP_REQUESTS_TABLE)
        .update({"meta": meta, "updated_at": now_iso})
        .eq("id", request_id)
        .execute()
    )
    if not updated:
        raise HTTPException(status_code=404, detail="Mentorship request not found.")
    return _request_response(updated)


@router.post("/mentorship/requests/{request_id}/accept-slot", response_model=MentorshipSessionResponse)
def accept_mentorship_request_slot(
    request_id: int,
    payload: MentorshipRequestSchedule,
    user_ctx: Dict[str, Any] = Depends(require_authenticated_user),
    supabase: Client = Depends(get_supabase_client),
):
    request_row = _first(
        supabase.table(MENTORSHIP_REQUESTS_TABLE)
        .select("*")
        .eq("id", request_id)
        .limit(1)
        .execute()
    )
    if not request_row:
        raise HTTPException(status_code=404, detail="Mentorship request not found.")

    current_user_id = str(user_ctx.get("user_id") or "").strip()
    is_owner = str(request_row.get("user_id") or "").strip() == current_user_id
    if not (is_owner or _is_admin_or_moderator(user_ctx)):
        raise HTTPException(status_code=403, detail="Only the learner can accept an offered slot.")

    request_status = _normalize_mentorship_request_status(request_row.get("status"))
    if request_status != MentorshipRequestStatus.REQUESTED:
        raise HTTPException(status_code=400, detail="This workflow no longer accepts slot selection.")

    submission_id = int(request_row.get("submission_id") or 0)
    if submission_id > 0:
        submission_row = _safe_first(
            supabase.table(COPY_SUBMISSIONS_TABLE)
            .select("id,status")
            .eq("id", submission_id)
            .limit(1)
        )
        if not submission_row:
            raise HTTPException(status_code=404, detail="Linked copy submission not found.")
        if _normalize_copy_status(submission_row.get("status")) != CopySubmissionStatus.CHECKED:
            raise HTTPException(status_code=400, detail="Mentor review is still pending.")

    meta = _meta_dict(request_row.get("meta"))
    offered_slot_ids = [
        int(slot_id)
        for slot_id in meta.get("offered_slot_ids", [])
        if isinstance(slot_id, int) and int(slot_id) > 0
    ]
    if payload.slot_id not in offered_slot_ids:
        raise HTTPException(status_code=400, detail="Selected slot is not in the mentor's offered options.")

    slot_row = _first(
        supabase.table(MENTORSHIP_SLOTS_TABLE)
        .select("*")
        .eq("id", payload.slot_id)
        .limit(1)
        .execute()
    )
    if not slot_row:
        raise HTTPException(status_code=404, detail="Mentorship slot not found.")
    if str(slot_row.get("provider_user_id") or "").strip() != str(request_row.get("provider_user_id") or "").strip():
        raise HTTPException(status_code=400, detail="Selected slot belongs to a different mentor.")

    now_iso = _utc_now_iso()
    actor_role = _tracking_actor_from_user_ctx(user_ctx, request_row=request_row)
    _updated_request, session_row = _schedule_mentorship_request_with_slot(
        request_row=request_row,
        slot_row=slot_row,
        supabase=supabase,
        now_iso=now_iso,
        actor_user_id=current_user_id,
        actor_role=actor_role,
        workflow_stage="slot_accepted_by_user",
        call_provider_override=payload.call_provider,
        meeting_link_override=payload.meeting_link,
        request_meta_updates={
            "slot_offer_status": "accepted",
            "slot_selected_by_user_at": now_iso,
            "slot_selected_by_user": current_user_id,
            "slot_selected_by_user_role": actor_role,
            "accepted_offered_slot_id": payload.slot_id,
            "mentor_notified_at": now_iso,
            "mentor_notification_channel": "dashboard",
        },
    )
    return _session_response(session_row)


@router.post("/mentorship/requests/{request_id}/schedule", response_model=MentorshipSessionResponse)
def schedule_mentorship_request(
    request_id: int,
    payload: MentorshipRequestSchedule,
    user_ctx: Dict[str, Any] = Depends(require_authenticated_user),
    supabase: Client = Depends(get_supabase_client),
):
    now_iso = _utc_now_iso()
    if not _is_admin_or_moderator(user_ctx):
        raise HTTPException(
            status_code=403,
            detail="Only admin or moderator can assign mentorship slots.",
        )
    request_row = _first(
        supabase.table(MENTORSHIP_REQUESTS_TABLE)
        .select("*")
        .eq("id", request_id)
        .limit(1)
        .execute()
    )
    if not request_row:
        raise HTTPException(status_code=404, detail="Mentorship request not found.")

    provider_user_id = str(request_row.get("provider_user_id") or "").strip()
    current_user_id = str(user_ctx.get("user_id") or "").strip()
    actor_role = _tracking_actor_from_user_ctx(user_ctx, request_row=request_row)

    slot_row = _first(
        supabase.table(MENTORSHIP_SLOTS_TABLE)
        .select("*")
        .eq("id", payload.slot_id)
        .limit(1)
        .execute()
    )
    if not slot_row:
        raise HTTPException(status_code=404, detail="Mentorship slot not found.")
    if str(slot_row.get("provider_user_id") or "").strip() != provider_user_id:
        raise HTTPException(status_code=400, detail="Slot belongs to a different mentor.")

    _updated_request, session_row = _schedule_mentorship_request_with_slot(
        request_row=request_row,
        slot_row=slot_row,
        supabase=supabase,
        now_iso=now_iso,
        actor_user_id=current_user_id,
        actor_role=actor_role,
        workflow_stage="scheduled_by_admin",
        call_provider_override=payload.call_provider,
        meeting_link_override=payload.meeting_link,
        request_meta_updates={
            "admin_queue_status": "scheduled",
            "scheduled_by_admin_at": now_iso,
            "scheduled_by_admin": current_user_id,
            "scheduled_by_admin_role": actor_role,
        },
    )
    return _session_response(session_row)


@router.post("/mentorship/requests/{request_id}/start-now", response_model=MentorshipSessionResponse)
def start_mentorship_request_now(
    request_id: int,
    payload: MentorshipRequestStartNow,
    user_ctx: Dict[str, Any] = Depends(require_mentor_user),
    supabase: Client = Depends(get_supabase_client),
):
    now_dt = _utc_now()
    now_iso = now_dt.isoformat()

    request_row = _first(
        supabase.table(MENTORSHIP_REQUESTS_TABLE)
        .select("*")
        .eq("id", request_id)
        .limit(1)
        .execute()
    )
    if not request_row:
        raise HTTPException(status_code=404, detail="Mentorship request not found.")

    request_status = _normalize_mentorship_request_status(request_row.get("status"))
    if request_status in {
        MentorshipRequestStatus.REJECTED,
        MentorshipRequestStatus.CANCELLED,
        MentorshipRequestStatus.COMPLETED,
    }:
        raise HTTPException(status_code=400, detail="Request is already closed.")

    provider_user_id = str(request_row.get("provider_user_id") or "").strip()
    current_user_id = str(user_ctx.get("user_id") or "").strip()
    if not _is_admin(user_ctx) and provider_user_id != current_user_id:
        raise HTTPException(status_code=403, detail="Only assigned mentor can start this request.")

    duration_minutes = int(payload.duration_minutes or 45)
    default_end_dt = now_dt + timedelta(minutes=duration_minutes)
    profile_call_provider, profile_zoom_meeting_link, _call_setup_note = _mentor_call_profile_defaults(
        provider_user_id,
        supabase=supabase,
    )
    requested_call_provider = _normalize_mentorship_call_provider(
        payload.call_provider.value if payload.call_provider else profile_call_provider.value,
        meeting_link=payload.meeting_link or profile_zoom_meeting_link,
    )

    scheduled_slot_id = int(request_row.get("scheduled_slot_id") or 0)
    slot_row: Optional[Dict[str, Any]] = None
    slot_start_dt: Optional[datetime] = None
    slot_end_dt: Optional[datetime] = None
    if scheduled_slot_id > 0:
        candidate_slot = _first(
            supabase.table(MENTORSHIP_SLOTS_TABLE)
            .select("*")
            .eq("id", scheduled_slot_id)
            .limit(1)
            .execute()
        )
        if (
            candidate_slot
            and bool(candidate_slot.get("is_active", True))
            and str(candidate_slot.get("provider_user_id") or "").strip() == provider_user_id
        ):
            candidate_start = _parse_datetime(candidate_slot.get("starts_at"))
            candidate_end = _parse_datetime(candidate_slot.get("ends_at"))
            if candidate_start and candidate_end and candidate_start <= now_dt <= candidate_end:
                max_bookings = int(candidate_slot.get("max_bookings") or 1)
                booked_count = int(candidate_slot.get("booked_count") or 0)
                if booked_count < max_bookings or request_status == MentorshipRequestStatus.SCHEDULED:
                    slot_row = candidate_slot
                    slot_start_dt = candidate_start
                    slot_end_dt = candidate_end

    if not slot_row:
        active_slot_rows = _safe_rows(
            supabase.table(MENTORSHIP_SLOTS_TABLE)
            .select("*")
            .eq("provider_user_id", provider_user_id)
            .eq("is_active", True)
            .lte("starts_at", now_iso)
            .gte("ends_at", now_iso)
            .order("starts_at")
            .limit(200)
        )
        for candidate_slot in active_slot_rows:
            candidate_start = _parse_datetime(candidate_slot.get("starts_at"))
            candidate_end = _parse_datetime(candidate_slot.get("ends_at"))
            if not candidate_start or not candidate_end:
                continue
            if not (candidate_start <= now_dt <= candidate_end):
                continue
            max_bookings = int(candidate_slot.get("max_bookings") or 1)
            booked_count = int(candidate_slot.get("booked_count") or 0)
            if booked_count >= max_bookings:
                continue
            slot_row = candidate_slot
            slot_start_dt = candidate_start
            slot_end_dt = candidate_end
            break

    if not slot_row:
        instant_meeting_link = payload.meeting_link or (
            profile_zoom_meeting_link if requested_call_provider == MentorshipCallProvider.ZOOM else None
        )
        instant_slot_payload = {
            "provider_user_id": provider_user_id,
            "starts_at": now_iso,
            "ends_at": default_end_dt.isoformat(),
            "mode": _normalize_mentorship_mode(request_row.get("preferred_mode")).value,
            "call_provider": _normalize_mentorship_call_provider(
                requested_call_provider.value,
                meeting_link=instant_meeting_link,
            ).value,
            "max_bookings": 1,
            "booked_count": 0,
            "is_active": True,
            "meeting_link": instant_meeting_link,
            "title": "Instant mentorship",
            "description": "Immediate mentorship session started by mentor.",
            "updated_at": now_iso,
        }
        slot_row = _first(supabase.table(MENTORSHIP_SLOTS_TABLE).insert(instant_slot_payload).execute())
        if not slot_row:
            raise HTTPException(status_code=400, detail="Failed to create instant mentorship slot.")
        slot_start_dt = _parse_datetime(slot_row.get("starts_at")) or now_dt
        slot_end_dt = _parse_datetime(slot_row.get("ends_at")) or default_end_dt

    slot_id = int(slot_row.get("id") or 0)
    if slot_id <= 0:
        raise HTTPException(status_code=400, detail="Could not resolve slot for immediate start.")

    starts_at_dt = now_dt
    if slot_start_dt and slot_start_dt > now_dt:
        starts_at_dt = slot_start_dt
    ends_at_dt = slot_end_dt if slot_end_dt and slot_end_dt > starts_at_dt else default_end_dt

    request_meta = _meta_dict(request_row.get("meta"))
    resolved_meeting_link = payload.meeting_link or slot_row.get("meeting_link")
    if not resolved_meeting_link and requested_call_provider == MentorshipCallProvider.ZOOM:
        resolved_meeting_link = profile_zoom_meeting_link
    resolved_call_provider = _normalize_mentorship_call_provider(
        requested_call_provider.value,
        meeting_link=resolved_meeting_link,
    )
    if (
        bool(request_meta.get("standalone"))
        and bool(request_meta.get("requires_entitlement"))
        and request_status == MentorshipRequestStatus.REQUESTED
    ):
        _consume_mentorship_entitlement(str(request_row.get("user_id") or ""), supabase)
        request_meta["entitlement_consumed_at"] = now_iso
    request_meta["accepted_at"] = request_meta.get("accepted_at") or now_iso
    request_meta["accepted_by"] = current_user_id
    request_meta["accepted_by_role"] = _tracking_actor_from_user_ctx(user_ctx, request_row=request_row)
    request_meta["scheduled_at"] = request_meta.get("scheduled_at") or now_iso
    request_meta["scheduled_slot_id"] = slot_id
    request_meta["scheduled_slot_starts_at"] = starts_at_dt.isoformat()
    request_meta["scheduled_slot_ends_at"] = ends_at_dt.isoformat()
    request_meta["session_live_at"] = now_iso
    request_meta["workflow_stage"] = "session_live"
    request_meta["call_status"] = "live"
    request_meta["call_provider"] = resolved_call_provider.value
    request_meta["status_updated_by"] = current_user_id
    request_meta["status_updated_by_role"] = _tracking_actor_from_user_ctx(user_ctx, request_row=request_row)
    request_meta["status_updated_at"] = now_iso

    updated_request = _first(
        supabase.table(MENTORSHIP_REQUESTS_TABLE)
        .update(
            {
                "status": MentorshipRequestStatus.SCHEDULED.value,
                "scheduled_slot_id": slot_id,
                "meta": request_meta,
                "updated_at": now_iso,
            }
        )
        .eq("id", request_id)
        .execute()
    )
    if not updated_request:
        raise HTTPException(status_code=404, detail="Mentorship request not found.")

    previous_slot_id = int(request_row.get("scheduled_slot_id") or 0)
    if previous_slot_id != slot_id:
        max_bookings = int(slot_row.get("max_bookings") or 1)
        booked_count = int(slot_row.get("booked_count") or 0)
        if booked_count < max_bookings:
            supabase.table(MENTORSHIP_SLOTS_TABLE).update(
                {
                    "booked_count": booked_count + 1,
                    "updated_at": now_iso,
                }
            ).eq("id", slot_id).execute()

    existing_session = _first(
        supabase.table(MENTORSHIP_SESSIONS_TABLE)
        .select("*")
        .eq("request_id", request_id)
        .limit(1)
        .execute()
    )
    copy_attachment_url: Optional[str] = None
    if updated_request.get("submission_id"):
        submission_row = _safe_first(
            supabase.table(COPY_SUBMISSIONS_TABLE)
            .select("checked_copy_pdf_url,answer_pdf_url")
            .eq("id", int(updated_request["submission_id"]))
            .limit(1)
        )
        if submission_row:
            copy_attachment_url = str(
                submission_row.get("checked_copy_pdf_url")
                or submission_row.get("answer_pdf_url")
                or ""
            ).strip() or None

    session_payload = {
        "request_id": request_id,
        "slot_id": slot_id,
        "provider_user_id": provider_user_id,
        "user_id": str(updated_request.get("user_id") or ""),
        "mode": str(slot_row.get("mode") or _normalize_mentorship_mode(updated_request.get("preferred_mode")).value),
        "call_provider": resolved_call_provider.value,
        "starts_at": starts_at_dt.isoformat(),
        "ends_at": ends_at_dt.isoformat(),
        "meeting_link": resolved_meeting_link,
        "copy_attachment_url": copy_attachment_url,
        "status": MentorshipSessionStatus.LIVE.value,
        "updated_at": now_iso,
    }

    try:
        session_payload = _provision_call_provider_session(session_payload, provider_user_id, supabase)
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))

    if existing_session:
        session_row = _first(
            supabase.table(MENTORSHIP_SESSIONS_TABLE)
            .update(session_payload)
            .eq("id", int(existing_session["id"]))
            .execute()
        )
    else:
        session_row = _first(supabase.table(MENTORSHIP_SESSIONS_TABLE).insert(session_payload).execute())
    if not session_row:
        raise HTTPException(status_code=400, detail="Failed to start immediate mentorship session.")
    return _session_response(session_row)


@router.put("/mentorship/requests/{request_id}/status", response_model=MentorshipRequestResponse)
def update_mentorship_request_status(
    request_id: int,
    payload: MentorshipRequestStatusUpdate,
    user_ctx: Dict[str, Any] = Depends(require_authenticated_user),
    supabase: Client = Depends(get_supabase_client),
):
    row = _first(
        supabase.table(MENTORSHIP_REQUESTS_TABLE)
        .select("*")
        .eq("id", request_id)
        .limit(1)
        .execute()
    )
    if not row:
        raise HTTPException(status_code=404, detail="Mentorship request not found.")

    user_id = str(user_ctx.get("user_id") or "").strip()
    is_admin = _is_admin(user_ctx)
    is_moderator = _is_moderator(user_ctx)
    is_owner = str(row.get("user_id") or "").strip() == user_id
    is_handler = str(row.get("provider_user_id") or "").strip() == user_id and _is_mentor_like(user_ctx)
    if not (is_admin or is_moderator or is_owner or is_handler):
        raise HTTPException(status_code=403, detail="You cannot update this mentorship request.")

    next_status = payload.status
    if is_owner and next_status not in {MentorshipRequestStatus.CANCELLED} and not (is_admin or is_moderator):
        raise HTTPException(status_code=403, detail="Users can only cancel their own mentorship requests.")
    if is_handler and next_status == MentorshipRequestStatus.CANCELLED and not (is_admin or is_moderator):
        raise HTTPException(status_code=403, detail="Mentor should reject instead of cancelling request.")

    now_iso = _utc_now_iso()
    meta = _meta_dict(row.get("meta"))
    if payload.reason:
        meta["last_status_reason"] = payload.reason
    actor_role = _tracking_actor_from_user_ctx(user_ctx, request_row=row)
    meta["status_updated_by"] = user_id
    meta["status_updated_by_role"] = actor_role
    meta["status_updated_at"] = now_iso
    if next_status == MentorshipRequestStatus.SCHEDULED and not meta.get("accepted_at"):
        meta["accepted_at"] = now_iso
        meta["accepted_by"] = user_id
        meta["accepted_by_role"] = actor_role
    if next_status == MentorshipRequestStatus.COMPLETED:
        meta["completed_at"] = now_iso
        meta["completed_by"] = user_id
        meta["completed_by_role"] = actor_role
        meta["workflow_stage"] = "completed"
        meta["call_status"] = "completed"
    if next_status == MentorshipRequestStatus.REJECTED:
        meta["rejected_at"] = now_iso
        meta["rejected_by"] = user_id
        meta["rejected_by_role"] = actor_role
        meta["workflow_stage"] = "rejected"
    if next_status == MentorshipRequestStatus.CANCELLED:
        meta["cancelled_at"] = now_iso
        meta["cancelled_by"] = user_id
        meta["cancelled_by_role"] = actor_role
        meta["workflow_stage"] = "cancelled"

    current_status = _normalize_mentorship_request_status(row.get("status"))
    scheduled_slot_id = int(row.get("scheduled_slot_id") or 0)

    updated = _first(
        supabase.table(MENTORSHIP_REQUESTS_TABLE)
        .update(
            {
                "status": next_status.value,
                "meta": meta,
                "updated_at": now_iso,
            }
        )
        .eq("id", request_id)
        .execute()
    )
    if not updated:
        raise HTTPException(status_code=404, detail="Mentorship request not found.")

    if (
        next_status in {MentorshipRequestStatus.CANCELLED, MentorshipRequestStatus.REJECTED}
        and current_status == MentorshipRequestStatus.SCHEDULED
        and scheduled_slot_id > 0
    ):
        _decrement_mentorship_slot_booking(scheduled_slot_id, supabase=supabase, updated_at_iso=now_iso)

    if next_status in {
        MentorshipRequestStatus.CANCELLED,
        MentorshipRequestStatus.REJECTED,
        MentorshipRequestStatus.COMPLETED,
    }:
        mapped_status = (
            MentorshipSessionStatus.CANCELLED.value
            if next_status in {MentorshipRequestStatus.CANCELLED, MentorshipRequestStatus.REJECTED}
            else MentorshipSessionStatus.COMPLETED.value
        )
        supabase.table(MENTORSHIP_SESSIONS_TABLE).update(
            {"status": mapped_status, "updated_at": now_iso}
        ).eq("request_id", request_id).execute()
    return _request_response(updated)


@router.get("/mentorship/sessions", response_model=List[MentorshipSessionResponse])
def list_mentorship_sessions(
    scope: str = Query(default="me", pattern="^(me|provider|all)$"),
    status: Optional[MentorshipSessionStatus] = None,
    user_ctx: Dict[str, Any] = Depends(require_authenticated_user),
    supabase: Client = Depends(get_supabase_client),
):
    user_id = str(user_ctx.get("user_id") or "").strip()
    is_admin = _is_admin(user_ctx)
    is_moderator = _is_moderator(user_ctx)
    is_handler = _is_mentor_like(user_ctx)

    query = supabase.table(MENTORSHIP_SESSIONS_TABLE).select("*").order("starts_at", desc=True)
    if scope == "provider":
        if not (is_handler or is_moderator):
            raise HTTPException(
                status_code=403,
                detail="Provider scope requires Mains Mentor, moderator, or admin access.",
            )
        if not (is_admin or is_moderator):
            query = query.eq("provider_user_id", user_id)
    elif scope == "all":
        if not (is_admin or is_moderator):
            raise HTTPException(status_code=403, detail="Only admin/moderator can use all scope.")
    else:
        query = query.eq("user_id", user_id)

    if status:
        query = query.eq("status", status.value)
    rows = _rows(query.execute())
    return [_session_response(row) for row in rows]


@router.get("/subscriptions/plans", response_model=List[SubscriptionPlanResponse])
def list_subscription_plans(
    include_inactive: bool = False,
    supabase: Client = Depends(get_supabase_client),
):
    try:
        query = supabase.table(SUBSCRIPTION_PLANS_TABLE).select("*").order("price")
        if not include_inactive:
            query = query.eq("is_active", True)
        rows = _rows(query.execute())
    except Exception:
        return _default_subscription_plans()

    output: List[SubscriptionPlanResponse] = []
    for row in rows:
        features = _sanitize_text_list(row.get("features"), max_items=20, max_length=220)
        output.append(
            SubscriptionPlanResponse(
                id=str(row.get("id") or "").strip() or f"plan-{int(row.get('id') or 0)}",
                name=str(row.get("name") or "Plan").strip(),
                description=row.get("description"),
                price=float(row.get("price") or 0.0),
                currency=str(row.get("currency") or "INR"),
                billing_cycle=str(row.get("billing_cycle") or "monthly"),
                is_active=bool(row.get("is_active", True)),
                features=features,
                meta=_meta_dict(row.get("meta")),
            )
        )
    if output:
        return output
    return _default_subscription_plans()


@router.get("/subscriptions/me", response_model=UserSubscriptionStatusResponse)
def get_my_subscription_status(
    user_ctx: Dict[str, Any] = Depends(require_authenticated_user),
    supabase: Client = Depends(get_supabase_client),
):
    user_id = str(user_ctx.get("user_id") or "").strip()
    if not user_id:
        raise HTTPException(status_code=401, detail="Authentication required.")

    fallback_status = _subscription_status_from_user_ctx(user_ctx)

    try:
        row = _first(
            supabase.table(USER_SUBSCRIPTIONS_TABLE)
            .select("*")
            .eq("user_id", user_id)
            .order("updated_at", desc=True)
            .limit(1)
            .execute()
        )
    except Exception:
        return fallback_status

    if not row:
        return fallback_status

    status = _as_role(row.get("status") or fallback_status.status) or "inactive"
    plan_id = str(row.get("plan_id") or fallback_status.plan_id or "").strip() or None
    valid_until = str(row.get("valid_until") or fallback_status.valid_until or "").strip() or None
    source = str(row.get("source") or fallback_status.source or "").strip() or None

    plan_name: Optional[str] = fallback_status.plan_name
    if plan_id:
        try:
            plan_row = _first(
                supabase.table(SUBSCRIPTION_PLANS_TABLE)
                .select("name")
                .eq("id", plan_id)
                .limit(1)
                .execute()
            )
            if plan_row and str(plan_row.get("name") or "").strip():
                plan_name = str(plan_row.get("name") or "").strip()
        except Exception:
            plan_name = plan_name or None

    return UserSubscriptionStatusResponse(
        is_active=status in {"active", "paid", "premium"} or _is_active_subscription(user_ctx),
        status=status,
        plan_id=plan_id,
        plan_name=plan_name,
        valid_until=valid_until,
        source=source,
        meta=_meta_dict(row.get("meta")),
    )


@router.get("/profiles/public", response_model=List[ProfessionalProfileResponse])
def list_public_profiles(
    role: Optional[str] = Query(default=None, pattern="^(provider|institute|mentor|creator)$"),
    user_id: Optional[str] = None,
    only_verified: bool = False,
    include_inactive: bool = False,
    limit: int = Query(default=100, ge=1, le=500),
    supabase: Client = Depends(get_supabase_client),
):
    _backfill_missing_profiles_from_onboarding(supabase=supabase, desired_role=role)

    try:
        query = (
            supabase.table(PROFILES_TABLE)
            .select("*")
            .eq("is_public", True)
            .order("updated_at", desc=True)
            .limit(limit)
        )
        if role:
            query = query.eq("role", role)
        if user_id:
            query = query.eq("user_id", str(user_id).strip())
        if only_verified:
            query = query.eq("is_verified", True)
        if not include_inactive:
            query = query.eq("is_active", True)
        rows = _rows(query.execute())
    except Exception as exc:
        if _is_missing_table_error(exc, PROFILES_TABLE):
            raise HTTPException(status_code=503, detail=PROFILES_SUBSCRIPTIONS_MIGRATION_HINT)
        raise HTTPException(status_code=500, detail=str(exc))

    review_summary_by_user: Dict[str, ProfessionalProfileReviewSummaryResponse] = {}
    try:
        review_summary_by_user = _profile_review_summary_map_for_targets(
            target_user_ids=[str(row.get("user_id") or "").strip() for row in rows],
            supabase=supabase,
        )
    except HTTPException:
        review_summary_by_user = {}

    out: List[ProfessionalProfileResponse] = []
    for row in rows:
        normalized = _normalize_profile_row(row)
        user_id_value = str(normalized.get("user_id") or "").strip()
        summary = review_summary_by_user.get(user_id_value)
        if summary:
            meta = _meta_dict(normalized.get("meta"))
            meta["review_summary"] = {
                "average_rating": summary.average_rating,
                "total_reviews": summary.total_reviews,
                "rating_1": summary.rating_1,
                "rating_2": summary.rating_2,
                "rating_3": summary.rating_3,
                "rating_4": summary.rating_4,
                "rating_5": summary.rating_5,
            }
            normalized["meta"] = meta
        out.append(ProfessionalProfileResponse(**normalized))
    return out


@router.get("/mentors/public", response_model=List[ProfessionalProfileResponse])
def list_public_mentors(
    only_verified: bool = False,
    include_inactive: bool = False,
    limit: int = Query(default=100, ge=1, le=500),
    supabase: Client = Depends(get_supabase_client),
):
    return list_public_profiles(
        role="mentor",
        user_id=None,
        only_verified=only_verified,
        include_inactive=include_inactive,
        limit=limit,
        supabase=supabase,
    )


@router.get("/profiles/{target_user_id}/detail", response_model=ProfessionalPublicProfileDetailResponse)
def get_professional_profile_detail(
    target_user_id: str,
    reviews_limit: int = Query(default=20, ge=1, le=120),
    user_ctx: Optional[Dict[str, Any]] = Depends(get_user_context),
    supabase: Client = Depends(get_supabase_client),
):
    normalized_target_user_id = str(target_user_id or "").strip()
    if not normalized_target_user_id:
        raise HTTPException(status_code=400, detail="Invalid profile user id.")

    try:
        row = _first(
            supabase.table(PROFILES_TABLE)
            .select("*")
            .eq("user_id", normalized_target_user_id)
            .limit(1)
            .execute()
        )
    except Exception as exc:
        if _is_missing_table_error(exc, PROFILES_TABLE):
            raise HTTPException(status_code=503, detail=PROFILES_SUBSCRIPTIONS_MIGRATION_HINT)
        raise HTTPException(status_code=500, detail=str(exc))

    if not row:
        raise HTTPException(status_code=404, detail="Professional profile not found.")

    requester_id = str((user_ctx or {}).get("user_id") or "").strip()
    is_owner = requester_id and requester_id == normalized_target_user_id
    is_admin_moderator = bool(user_ctx and _is_admin_or_moderator(user_ctx))
    is_profile_public = bool(row.get("is_public", True)) and bool(row.get("is_active", True))
    if not is_profile_public and not (is_owner or is_admin_moderator):
        raise HTTPException(status_code=403, detail="This profile is private.")

    profile = _profile_response(row)
    profile_meta = _normalize_profile_meta(profile.meta)
    role_label = _professional_role_title(profile.role)

    provided_series, assigned_series = _professional_series_lists(
        user_id=normalized_target_user_id,
        supabase=supabase,
    )
    can_view_private_series = bool(is_owner or is_admin_moderator)
    if not can_view_private_series:
        provided_series = [row for row in provided_series if row.is_public and row.is_active]
        assigned_series = [row for row in assigned_series if row.is_public and row.is_active]

    available_series_ids = _parse_series_id_list(profile_meta.get("mentorship_available_series_ids"))
    if not can_view_private_series and available_series_ids:
        visible_series_ids = {
            int(item.id)
            for item in [*provided_series, *assigned_series]
            if int(item.id) > 0
        }
        available_series_ids = [sid for sid in available_series_ids if sid in visible_series_ids]

    review_summary = ProfessionalProfileReviewSummaryResponse()
    recent_reviews: List[ProfessionalProfileReviewResponse] = []
    try:
        review_summary = _profile_review_summary_for_target(
            target_user_id=normalized_target_user_id,
            supabase=supabase,
        )
        review_rows = _rows(
            supabase.table(PROFILE_REVIEWS_TABLE)
            .select("*")
            .eq("target_user_id", normalized_target_user_id)
            .eq("is_active", True)
            .eq("is_public", True)
            .order("created_at", desc=True)
            .limit(reviews_limit)
            .execute()
        )
        recent_reviews = [_profile_review_response(item) for item in review_rows]
    except HTTPException:
        review_summary = ProfessionalProfileReviewSummaryResponse()
        recent_reviews = []

    return ProfessionalPublicProfileDetailResponse(
        profile=profile,
        role_label=role_label,
        achievements=_sanitize_text_list(profile_meta.get("achievements"), max_items=20, max_length=220),
        service_specifications=_sanitize_text_list(profile_meta.get("service_specifications"), max_items=24, max_length=220),
        authenticity_proof_url=_as_optional_text(profile_meta.get("authenticity_proof_url"), max_length=800),
        authenticity_note=_as_optional_text(profile_meta.get("authenticity_note"), max_length=240),
        mentorship_availability_mode=_as_role(profile_meta.get("mentorship_availability_mode")) or "series_only",
        mentorship_open_scope_note=_as_optional_text(profile_meta.get("mentorship_open_scope_note"), max_length=1200),
        mentorship_available_series_ids=available_series_ids,
        mentorship_default_call_provider=_normalize_mentorship_call_provider(
            profile_meta.get("mentorship_default_call_provider"),
            meeting_link=profile_meta.get("mentorship_zoom_meeting_link"),
        ),
        mentorship_zoom_meeting_link=_as_optional_text(profile_meta.get("mentorship_zoom_meeting_link"), max_length=1200),
        mentorship_call_setup_note=_as_optional_text(profile_meta.get("mentorship_call_setup_note"), max_length=1200),
        copy_evaluation_enabled=_copy_evaluation_enabled_for_role(profile.role, profile_meta),
        copy_evaluation_note=_as_optional_text(profile_meta.get("copy_evaluation_note"), max_length=1200),
        provided_series=provided_series,
        assigned_series=assigned_series,
        review_summary=review_summary,
        recent_reviews=recent_reviews,
    )


@router.get("/profiles/{target_user_id}/reviews", response_model=List[ProfessionalProfileReviewResponse])
def list_professional_profile_reviews(
    target_user_id: str,
    include_hidden: bool = False,
    limit: int = Query(default=60, ge=1, le=300),
    user_ctx: Optional[Dict[str, Any]] = Depends(get_user_context),
    supabase: Client = Depends(get_supabase_client),
):
    normalized_target_user_id = str(target_user_id or "").strip()
    if not normalized_target_user_id:
        raise HTTPException(status_code=400, detail="Invalid profile user id.")

    requester_id = str((user_ctx or {}).get("user_id") or "").strip()
    is_owner = requester_id and requester_id == normalized_target_user_id
    is_admin_moderator = bool(user_ctx and _is_admin_or_moderator(user_ctx))
    if include_hidden and not (is_owner or is_admin_moderator):
        raise HTTPException(status_code=403, detail="Hidden reviews are restricted.")

    try:
        query = (
            supabase.table(PROFILE_REVIEWS_TABLE)
            .select("*")
            .eq("target_user_id", normalized_target_user_id)
            .eq("is_active", True)
            .order("created_at", desc=True)
            .limit(limit)
        )
        if not include_hidden:
            query = query.eq("is_public", True)
        rows = _rows(query.execute())
    except Exception as exc:
        _raise_profile_reviews_migration_required(exc)
    return [_profile_review_response(row) for row in rows]


@router.post("/profiles/{target_user_id}/reviews", response_model=ProfessionalProfileReviewResponse)
def upsert_professional_profile_review(
    target_user_id: str,
    payload: ProfessionalProfileReviewCreate,
    user_ctx: Dict[str, Any] = Depends(require_authenticated_user),
    supabase: Client = Depends(get_supabase_client),
):
    normalized_target_user_id = str(target_user_id or "").strip()
    reviewer_user_id = str(user_ctx.get("user_id") or "").strip()
    if not normalized_target_user_id:
        raise HTTPException(status_code=400, detail="Invalid profile user id.")
    if not reviewer_user_id:
        raise HTTPException(status_code=401, detail="Authentication required.")
    if reviewer_user_id == normalized_target_user_id:
        raise HTTPException(status_code=400, detail="You cannot review your own professional profile.")

    try:
        target_profile = _first(
            supabase.table(PROFILES_TABLE)
            .select("user_id,is_public,is_active")
            .eq("user_id", normalized_target_user_id)
            .limit(1)
            .execute()
        )
    except Exception as exc:
        if _is_missing_table_error(exc, PROFILES_TABLE):
            raise HTTPException(status_code=503, detail=PROFILES_SUBSCRIPTIONS_MIGRATION_HINT)
        raise HTTPException(status_code=500, detail=str(exc))
    if not target_profile:
        raise HTTPException(status_code=404, detail="Professional profile not found.")
    if not bool(target_profile.get("is_public", True)) or not bool(target_profile.get("is_active", True)):
        raise HTTPException(status_code=403, detail="This profile is not open for public reviews.")

    reviewer_email = _as_optional_text(user_ctx.get("email"), max_length=250) or ""
    reviewer_label = reviewer_email.split("@")[0].strip() if reviewer_email else ""
    if not reviewer_label:
        reviewer_label = f"User {reviewer_user_id[:8]}"
    reviewer_label = reviewer_label[:80]

    now_iso = _utc_now_iso()
    review_payload = {
        "rating": int(payload.rating),
        "title": _as_optional_text(payload.title, max_length=140),
        "comment": _as_optional_text(payload.comment, max_length=2500),
        "is_public": True,
        "is_active": True,
        "meta": {"reviewer_label": reviewer_label},
        "updated_at": now_iso,
    }

    try:
        existing = _first(
            supabase.table(PROFILE_REVIEWS_TABLE)
            .select("*")
            .eq("target_user_id", normalized_target_user_id)
            .eq("reviewer_user_id", reviewer_user_id)
            .limit(1)
            .execute()
        )
    except Exception as exc:
        _raise_profile_reviews_migration_required(exc)

    try:
        if existing:
            row = _first(
                supabase.table(PROFILE_REVIEWS_TABLE)
                .update(review_payload)
                .eq("id", int(existing.get("id") or 0))
                .execute()
            )
        else:
            create_payload = dict(review_payload)
            create_payload["target_user_id"] = normalized_target_user_id
            create_payload["reviewer_user_id"] = reviewer_user_id
            create_payload["created_at"] = now_iso
            row = _first(
                supabase.table(PROFILE_REVIEWS_TABLE)
                .insert(create_payload)
                .execute()
            )
    except Exception as exc:
        _raise_profile_reviews_migration_required(exc)

    if not row:
        raise HTTPException(status_code=400, detail="Failed to save review.")
    return _profile_review_response(row)


@router.get("/profiles/me/series-options", response_model=ProfessionalSeriesOptionsResponse)
def get_my_professional_series_options(
    user_ctx: Dict[str, Any] = Depends(require_authenticated_user),
    supabase: Client = Depends(get_supabase_client),
):
    if not _profile_edit_access_allowed(user_ctx):
        raise HTTPException(
            status_code=403,
            detail="Only Quiz Master or Mains Mentor roles can manage professional profile.",
        )
    user_id = str(user_ctx.get("user_id") or "").strip()
    if not user_id:
        raise HTTPException(status_code=401, detail="Authentication required.")

    provided_series, assigned_series = _professional_series_lists(user_id=user_id, supabase=supabase)

    return ProfessionalSeriesOptionsResponse(
        provided_series=[
            ProfessionalSeriesOptionResponse(id=int(row.id), title=row.title, series_kind=row.series_kind)
            for row in provided_series
            if int(row.id) > 0
        ],
        assigned_series=[
            ProfessionalSeriesOptionResponse(id=int(row.id), title=row.title, series_kind=row.series_kind)
            for row in assigned_series
            if int(row.id) > 0
        ],
    )


@router.get("/profiles/me", response_model=ProfessionalProfileResponse)
def get_my_professional_profile(
    user_ctx: Dict[str, Any] = Depends(require_authenticated_user),
    supabase: Client = Depends(get_supabase_client),
):
    if not _profile_edit_access_allowed(user_ctx):
        raise HTTPException(
            status_code=403,
            detail="Only Quiz Master or Mains Mentor roles can manage professional profile.",
        )
    user_id = str(user_ctx.get("user_id") or "").strip()
    try:
        row = _first(
            supabase.table(PROFILES_TABLE)
            .select("*")
            .eq("user_id", user_id)
            .limit(1)
            .execute()
        )
    except Exception as exc:
        if _is_missing_table_error(exc, PROFILES_TABLE):
            raise HTTPException(status_code=503, detail=PROFILES_SUBSCRIPTIONS_MIGRATION_HINT)
        raise HTTPException(status_code=500, detail=str(exc))
    if not row:
        raise HTTPException(status_code=404, detail="Professional profile not found.")
    return _profile_response(row)


@router.put("/profiles/me", response_model=ProfessionalProfileResponse)
def upsert_my_professional_profile(
    payload: ProfessionalProfileUpdate,
    user_ctx: Dict[str, Any] = Depends(require_authenticated_user),
    supabase: Client = Depends(get_supabase_client),
):
    if not _profile_edit_access_allowed(user_ctx):
        raise HTTPException(
            status_code=403,
            detail="Only Quiz Master or Mains Mentor roles can manage professional profile.",
        )

    user_id = str(user_ctx.get("user_id") or "").strip()
    if not user_id:
        raise HTTPException(status_code=401, detail="Authentication required.")

    try:
        existing = _first(
            supabase.table(PROFILES_TABLE)
            .select("*")
            .eq("user_id", user_id)
            .limit(1)
            .execute()
        )
    except Exception as exc:
        if _is_missing_table_error(exc, PROFILES_TABLE):
            raise HTTPException(status_code=503, detail=PROFILES_SUBSCRIPTIONS_MIGRATION_HINT)
        raise HTTPException(status_code=500, detail=str(exc))

    role_fallback = _normalize_profile_role((existing or {}).get("role") or user_ctx.get("role"), fallback="mentor")
    role = _normalize_profile_role(payload.role, fallback=role_fallback)

    updates: Dict[str, Any] = {
        "role": role,
        "updated_at": _utc_now_iso(),
    }
    if payload.display_name is not None:
        updates["display_name"] = str(payload.display_name or "").strip()
    if payload.headline is not None:
        updates["headline"] = str(payload.headline or "").strip() or None
    if payload.bio is not None:
        updates["bio"] = str(payload.bio or "").strip() or None
    if payload.years_experience is not None:
        updates["years_experience"] = int(payload.years_experience)
    if payload.city is not None:
        updates["city"] = str(payload.city or "").strip() or None
    if payload.profile_image_url is not None:
        updates["profile_image_url"] = str(payload.profile_image_url or "").strip() or None
    if payload.is_verified is not None:
        updates["is_verified"] = bool(payload.is_verified)
    if payload.highlights is not None:
        updates["highlights"] = _sanitize_text_list(payload.highlights, max_items=8, max_length=180)
    if payload.credentials is not None:
        updates["credentials"] = _sanitize_text_list(payload.credentials, max_items=12, max_length=220)
    if payload.specialization_tags is not None:
        updates["specialization_tags"] = _sanitize_text_list(payload.specialization_tags, max_items=14, max_length=80)
    if payload.languages is not None:
        updates["languages"] = _sanitize_text_list(payload.languages, max_items=10, max_length=60)
    if payload.contact_url is not None:
        updates["contact_url"] = str(payload.contact_url or "").strip() or None
    if payload.public_email is not None:
        updates["public_email"] = str(payload.public_email or "").strip() or None
    if payload.is_public is not None:
        updates["is_public"] = bool(payload.is_public)
    if payload.is_active is not None:
        updates["is_active"] = bool(payload.is_active)
    if payload.meta is not None:
        merged_meta = _meta_dict((existing or {}).get("meta"))
        merged_meta.update(_meta_dict(payload.meta))
        updates["meta"] = _normalize_profile_meta(merged_meta)

    display_name = str(updates.get("display_name") or (existing or {}).get("display_name") or "").strip()
    if not display_name:
        email_hint = str(user_ctx.get("email") or "").split("@")[0].strip()
        display_name = email_hint or f"UPSC {_professional_role_title(role)}"
        updates["display_name"] = display_name

    try:
        if existing:
            row = _first(supabase.table(PROFILES_TABLE).update(updates).eq("user_id", user_id).execute())
        else:
            insert_payload = {
                "user_id": user_id,
                "display_name": display_name,
                "role": role,
                "headline": updates.get("headline"),
                "bio": updates.get("bio"),
                "years_experience": updates.get("years_experience"),
                "city": updates.get("city"),
                "profile_image_url": updates.get("profile_image_url"),
                "is_verified": bool(updates.get("is_verified", False)),
                "highlights": updates.get("highlights") or [],
                "credentials": updates.get("credentials") or [],
                "specialization_tags": updates.get("specialization_tags") or [],
                "languages": updates.get("languages") or [],
                "contact_url": updates.get("contact_url"),
                "public_email": updates.get("public_email"),
                "is_public": bool(updates.get("is_public", True)),
                "is_active": bool(updates.get("is_active", True)),
                "meta": updates.get("meta") or {},
                "updated_at": _utc_now_iso(),
            }
            row = _first(supabase.table(PROFILES_TABLE).insert(insert_payload).execute())
    except Exception as exc:
        if _is_missing_table_error(exc, PROFILES_TABLE):
            raise HTTPException(status_code=503, detail=PROFILES_SUBSCRIPTIONS_MIGRATION_HINT)
        raise HTTPException(status_code=500, detail=str(exc))

    if not row:
        raise HTTPException(status_code=400, detail="Failed to save professional profile.")
    return _profile_response(row)


# ==========================================
# Zoom Integrations and Video SDK Handlers
# ==========================================
import hmac
import hashlib
import time
import requests
from urllib.request import Request as UrlRequest, urlopen
from urllib.parse import urlencode
from urllib.error import HTTPError

ZOOM_WEBHOOK_SECRET = os.getenv("ZOOM_WEBHOOK_SECRET", "")
ZOOM_CLIENT_ID = os.getenv("ZOOM_CLIENT_ID", "")
ZOOM_CLIENT_SECRET = os.getenv("ZOOM_CLIENT_SECRET", "")
ZOOM_SDK_KEY = os.getenv("ZOOM_SDK_KEY", "")
ZOOM_SDK_SECRET = os.getenv("ZOOM_SDK_SECRET", "")

def _zoom_api_request(method: str, url: str, headers: Dict[str, str] = None, data: Any = None) -> Dict[str, Any]:
    req = UrlRequest(url, method=method)
    if headers:
        for k, v in headers.items():
            req.add_header(k, v)
    body = None
    if data:
        if isinstance(data, dict):
            body = json.dumps(data).encode("utf-8")
            req.add_header("Content-Type", "application/json")
        else:
            body = data.encode("utf-8") if isinstance(data, str) else data
            if not req.has_header("Content-Type"):
                req.add_header("Content-Type", "application/x-www-form-urlencoded")
    try:
        with urlopen(req, data=body) as response:
            res_body = response.read().decode("utf-8")
            if not res_body:
                return {}
            return json.loads(res_body)
    except HTTPError as e:
        err_body = e.read().decode("utf-8")
        try:
            parsed = json.loads(err_body)
        except Exception:
            parsed = {"error": err_body}
        raise Exception(f"Zoom API Error {e.code}: {parsed}")


def _refresh_zoom_token(user_id: str, supabase: Client) -> Optional[Dict[str, Any]]:
    row = _safe_first(supabase.table("mentor_zoom_connections").select("*").eq("user_id", user_id).limit(1))
    if not row:
        return None
    now_dt = _utc_now()
    expires_at = _parse_datetime(row.get("expires_at"))

    if expires_at and expires_at > now_dt:
        return row

    refresh_token = row.get("refresh_token")
    if not refresh_token:
        supabase.table("mentor_zoom_connections").update({"last_error": "No refresh token available"}).eq("user_id", user_id).execute()
        return None
    auth_header = "Basic " + base64.b64encode(f"{ZOOM_CLIENT_ID}:{ZOOM_CLIENT_SECRET}".encode()).decode()
    try:
        token_data = _zoom_api_request(
            "POST",
            ZOOM_TOKEN_URL,
            headers={"Authorization": auth_header},
            data=urlencode({
                "grant_type": "refresh_token",
                "refresh_token": refresh_token
            })
        )
        access_token = token_data.get("access_token")
        new_refresh = token_data.get("refresh_token")
        expires_in = token_data.get("expires_in", 3600)
        new_expires_dt = now_dt + timedelta(seconds=expires_in - 60)
        
        info_data = _zoom_api_request(
            "GET",
            ZOOM_USERINFO_URL,
            headers={"Authorization": f"Bearer {access_token}"}
        )
        
        updates = {
            "access_token": access_token,
            "refresh_token": new_refresh,
            "expires_at": new_expires_dt.isoformat(),
            "zoom_account_id": info_data.get("account_id"),
            "display_name": f"{info_data.get('first_name', '')} {info_data.get('last_name', '')}".strip(),
            "email": info_data.get("email"),
            "last_error": None,
            "updated_at": _utc_now_iso()
        }
        return _first(supabase.table("mentor_zoom_connections").update(updates).eq("user_id", user_id).execute())
    except Exception as e:
        supabase.table("mentor_zoom_connections").update({"last_error": str(e)}).eq("user_id", user_id).execute()
        return None


def _provision_call_provider_session(payload: Dict[str, Any], provider_user_id: str, supabase: Client) -> Dict[str, Any]:
    call_provider = payload.get("call_provider")
    if call_provider != MentorshipCallProvider.ZOOM.value:
        return payload

    conn_row = _refresh_zoom_token(provider_user_id, supabase)
    if not conn_row or not conn_row.get("access_token"):
        raise HTTPException(status_code=400, detail="Mentor Zoom account is not connected or requires reconnect. Please contact the mentor.")

    mode = payload.get("mode", "video")
    zoom_payload = {
        "topic": "Mentorship Session",
        "type": 2, # Scheduled Meeting
        "start_time": payload["starts_at"],
        "duration": int((_parse_datetime(payload["ends_at"]) - _parse_datetime(payload["starts_at"])).total_seconds() / 60),
        "settings": {
            "host_video": mode == "video",
            "participant_video": mode == "video",
            "join_before_host": False,
            "mute_upon_entry": True,
            "waiting_room": True
        }
    }
    
    try:
        meeting_data = _zoom_api_request(
            "POST",
            f"{ZOOM_API_ROOT}/users/me/meetings",
            headers={"Authorization": f"Bearer {conn_row['access_token']}"},
            data=zoom_payload
        )
        payload["provider_session_id"] = str(meeting_data.get("id"))
        payload["provider_host_url"] = meeting_data.get("start_url")
        payload["provider_join_url"] = meeting_data.get("join_url")
        payload["meeting_link"] = meeting_data.get("join_url")
        payload["provider_payload"] = {
            "zoom_meeting_password": meeting_data.get("password")
        }
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Failed to create Zoom meeting: {str(e)}")
        
    return payload


@router.get("/mentorship/integrations/zoom/status", response_model=MentorZoomIntegrationStatusResponse)
def get_zoom_integration_status(
    user_ctx: Dict[str, Any] = Depends(require_mentor_user),
    supabase: Client = Depends(get_supabase_client),
):
    user_id = str(user_ctx.get("user_id") or "").strip()
    row = _refresh_zoom_token(user_id, supabase)
    import urllib.parse
    root_uri = os.getenv("API_URL", "http://localhost:8000")
    if root_uri.endswith("/"):
        root_uri = root_uri[:-1]
    
    # We pass mentor id as state to verify during callback
    # Real implementation should sign this state or store it
    redirect_uri = f"{root_uri}/api/v1/premium/mentorship/integrations/zoom/callback"
    auth_url = f"{ZOOM_AUTHORIZE_URL}?response_type=code&client_id={ZOOM_CLIENT_ID}&redirect_uri={urllib.parse.quote(redirect_uri)}"

    if not row:
        return MentorZoomIntegrationStatusResponse(
            connected=False,
            requires_reconnect=False,
            authorize_url=auth_url
        )
    
    now_dt = _utc_now()
    expires_at = _parse_datetime(row.get("expires_at"))
    requires_reconnect = bool(row.get("last_error")) or (expires_at and expires_at < now_dt)
    
    return MentorZoomIntegrationStatusResponse(
        connected=True,
        requires_reconnect=requires_reconnect,
        zoom_user_id=row.get("zoom_user_id"),
        zoom_account_id=row.get("zoom_account_id"),
        display_name=row.get("display_name"),
        email=row.get("email"),
        expires_at=row.get("expires_at"),
        connected_at=row.get("created_at"),
        updated_at=row.get("updated_at"),
        last_error=row.get("last_error"),
        authorize_url=auth_url if requires_reconnect else None
    )


class _ZoomConnectRequest(BaseModel):
    # Just an empty request body or maybe redirect scheme 
    redirect_override: Optional[str] = None

@router.post("/mentorship/integrations/zoom/connect", response_model=MentorZoomConnectResponse)
def connect_zoom_integration(
    payload: _ZoomConnectRequest,
    user_ctx: Dict[str, Any] = Depends(require_mentor_user),
):
    import urllib.parse
    root_uri = os.getenv("API_URL", "http://localhost:8000")
    if root_uri.endswith("/"):
        root_uri = root_uri[:-1]
    redirect_uri = payload.redirect_override or f"{root_uri}/api/v1/premium/mentorship/integrations/zoom/callback"
    auth_url = f"{ZOOM_AUTHORIZE_URL}?response_type=code&client_id={ZOOM_CLIENT_ID}&redirect_uri={urllib.parse.quote(redirect_uri)}"
    return MentorZoomConnectResponse(authorize_url=auth_url)


@router.get("/mentorship/integrations/zoom/callback")
def handle_zoom_oauth_callback(
    code: str,
    error: Optional[str] = None,
    user_ctx: Dict[str, Any] = Depends(require_mentor_user),
    supabase: Client = Depends(get_supabase_client),
):
    if error:
        raise HTTPException(status_code=400, detail=f"Zoom OAuth error: {error}")
    
    user_id = str(user_ctx.get("user_id") or "").strip()
    root_uri = os.getenv("API_URL", "http://localhost:8000").rstrip("/")
    redirect_uri = f"{root_uri}/api/v1/premium/mentorship/integrations/zoom/callback"
    
    auth_header = "Basic " + base64.b64encode(f"{ZOOM_CLIENT_ID}:{ZOOM_CLIENT_SECRET}".encode()).decode()
    try:
        token_data = _zoom_api_request(
            "POST",
            ZOOM_TOKEN_URL,
            headers={"Authorization": auth_header},
            data=urlencode({
                "grant_type": "authorization_code",
                "code": code,
                "redirect_uri": redirect_uri
            })
        )
        access_token = token_data.get("access_token")
        refresh_token = token_data.get("refresh_token")
        expires_in = token_data.get("expires_in", 3600)
        expires_at = (_utc_now() + timedelta(seconds=expires_in - 60)).isoformat()
        
        info_data = _zoom_api_request(
            "GET",
            ZOOM_USERINFO_URL,
            headers={"Authorization": f"Bearer {access_token}"}
        )
        
        row_data = {
            "user_id": user_id,
            "zoom_account_id": info_data.get("account_id"),
            "zoom_user_id": info_data.get("id"),
            "display_name": f"{info_data.get('first_name', '')} {info_data.get('last_name', '')}".strip(),
            "email": info_data.get("email"),
            "access_token": access_token,
            "refresh_token": refresh_token,
            "expires_at": expires_at,
            "last_error": None,
            "updated_at": _utc_now_iso(),
        }
        
        existing = _safe_first(supabase.table("mentor_zoom_connections").select("user_id").eq("user_id", user_id).limit(1))
        if existing:
            _first(supabase.table("mentor_zoom_connections").update(row_data).eq("user_id", user_id).execute())
        else:
            row_data["created_at"] = _utc_now_iso()
            _first(supabase.table("mentor_zoom_connections").insert(row_data).execute())
            
        return RedirectResponse(url="/admin/premium/mentorship/manage?zoom_connected=true")
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Zoom OAuth failed: {str(e)}")


@router.post("/mentorship/integrations/zoom/disconnect")
def disconnect_zoom_integration(
    user_ctx: Dict[str, Any] = Depends(require_mentor_user),
    supabase: Client = Depends(get_supabase_client),
):
    user_id = str(user_ctx.get("user_id") or "").strip()
    try:
        row = _safe_first(supabase.table("mentor_zoom_connections").select("access_token").eq("user_id", user_id).limit(1))
        if row and row.get("access_token"):
            auth_header = "Basic " + base64.b64encode(f"{ZOOM_CLIENT_ID}:{ZOOM_CLIENT_SECRET}".encode()).decode()
            _zoom_api_request(
                "POST", 
                "https://zoom.us/oauth/revoke",
                headers={"Authorization": auth_header},
                data=urlencode({"token": row.get("access_token")})
            )
    except Exception:
        pass # ignore revocation errors
        
    supabase.table("mentor_zoom_connections").delete().eq("user_id", user_id).execute()
    return {"message": "Zoom integration disconnected."}


@router.post("/mentorship/sessions/{session_id}/call-context", response_model=MentorshipCallContextResponse)
def get_mentorship_call_context(
    session_id: int,
    user_ctx: Dict[str, Any] = Depends(require_authenticated_user),
    supabase: Client = Depends(get_supabase_client),
):
    session_row = _first(supabase.table(MENTORSHIP_SESSIONS_TABLE).select("*").eq("id", session_id).limit(1))
    if not session_row:
        raise HTTPException(status_code=404, detail="Session not found.")
        
    user_id = str(user_ctx.get("user_id") or "").strip()
    is_admin = _is_admin_or_moderator(user_ctx)
    is_mentor = user_id == str(session_row.get("provider_user_id"))
    is_learner = user_id == str(session_row.get("user_id"))
    
    if not (is_admin or is_mentor or is_learner):
        raise HTTPException(status_code=403, detail="You are not authorized to join this session.")
        
    call_provider = session_row.get("call_provider")
    
    if call_provider == "zoom_video_sdk":
        # Generate short lived SDK credentials
        topic = f"Mentorship Session {session_row.get('id')}"
        iat = int(time.time()) - 30
        exp = iat + 3600 * 2 # 2 hours
        header = {"alg": "HS256", "typ": "JWT"}
        role_type = 1 if is_mentor or is_admin else 0
        payload = {
            "app_key": ZOOM_SDK_KEY,
            "tpc": topic,
            "role_type": role_type,
            "version": 1,
            "iat": iat,
            "exp": exp
        }
        def base64url_encode(data: bytes) -> str:
            return base64.urlsafe_b64encode(data).decode("utf-8").rstrip("=")
        encoded_header = base64url_encode(json.dumps(header).encode("utf-8"))
        encoded_payload = base64url_encode(json.dumps(payload).encode("utf-8"))
        signature = hmac.new(
            ZOOM_SDK_SECRET.encode("utf-8"),
            f"{encoded_header}.{encoded_payload}".encode("utf-8"),
            hashlib.sha256
        ).digest()
        jwt_token = f"{encoded_header}.{encoded_payload}.{base64url_encode(signature)}"
        
        display_name = user_ctx.get("user_metadata", {}).get("full_name") or user_ctx.get("email", "User")
        
        return MentorshipCallContextResponse(
            session_id=session_id,
            request_id=session_row.get("request_id"),
            call_provider=MentorshipCallProvider.ZOOM_VIDEO_SDK,
            mode=MentorshipMode(session_row.get("mode", "video")),
            sdk_signature=jwt_token,
            sdk_session_name=topic,
            sdk_user_name=display_name,
            sdk_user_identity=user_id,
            sdk_role_type=role_type,
            sdk_key=ZOOM_SDK_KEY
        )
        
    # Return links for zoom or custom
    return MentorshipCallContextResponse(
        session_id=session_id,
        request_id=session_row.get("request_id"),
        call_provider=MentorshipCallProvider(call_provider),
        mode=MentorshipMode(session_row.get("mode", "video")),
        join_url=session_row.get("provider_join_url") or session_row.get("meeting_link"),
        host_url=session_row.get("provider_host_url") if (is_mentor or is_admin) else None,
        provider_payload=session_row.get("provider_payload") or {}
    )


@router.post("/mentorship/sessions/{session_id}/recreate-provider-session", response_model=MentorshipSessionResponse)
def recreate_mentorship_provider_session(
    session_id: int,
    user_ctx: Dict[str, Any] = Depends(require_authenticated_user),
    supabase: Client = Depends(get_supabase_client),
):
    session_row = _first(supabase.table(MENTORSHIP_SESSIONS_TABLE).select("*").eq("id", session_id).limit(1))
    if not session_row:
        raise HTTPException(status_code=404, detail="Session not found.")
        
    user_id = str(user_ctx.get("user_id") or "").strip()
    is_admin = _is_admin_or_moderator(user_ctx)
    is_mentor = user_id == str(session_row.get("provider_user_id"))
    
    if not (is_admin or is_mentor):
        raise HTTPException(status_code=403, detail="Only mentor or admin can recreate session.")
        
    if session_row.get("call_provider") != MentorshipCallProvider.ZOOM.value:
        raise HTTPException(status_code=400, detail="Only Zoom meetings can be recreated.")
        
    try:
        updated_payload = dict(session_row)
        updated_payload = _provision_call_provider_session(updated_payload, str(session_row.get("provider_user_id")), supabase)
        new_row = _first(
            supabase.table(MENTORSHIP_SESSIONS_TABLE)
            .update({
                "provider_session_id": updated_payload.get("provider_session_id"),
                "provider_host_url": updated_payload.get("provider_host_url"),
                "provider_join_url": updated_payload.get("provider_join_url"),
                "meeting_link": updated_payload.get("meeting_link"),
                "provider_payload": updated_payload.get("provider_payload"),
                "updated_at": _utc_now_iso(),
            })
            .eq("id", session_id)
            .execute()
        )
        return _session_response(new_row or session_row)
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.post("/webhooks/zoom")
async def handle_zoom_webhook(
    request: Request,
    supabase: Client = Depends(get_supabase_client),
):
    body = await request.body()
    try:
        payload = json.loads(body)
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid JSON")
        
    event = payload.get("event")
    
    if event == "endpoint.url_validation":
        plain_token = payload.get("payload", {}).get("plainToken", "")
        encrypted = hmac.new(
            ZOOM_WEBHOOK_SECRET.encode("utf-8"),
            plain_token.encode("utf-8"),
            hashlib.sha256
        ).hexdigest()
        return {"plainToken": plain_token, "encryptedToken": encrypted}
        
    if event in ("meeting.started", "meeting.ended"):
        meeting_id = str(payload.get("payload", {}).get("object", {}).get("id"))
        if not meeting_id:
            return {"status": "ok"}
            
        session = _safe_first(
            supabase.table(MENTORSHIP_SESSIONS_TABLE)
            .select("id, status, live_started_at")
            .eq("provider_session_id", meeting_id)
            .limit(1)
        )
        if not session:
            return {"status": "ignored"}
            
        now_iso = _utc_now_iso()
        updates = {"updated_at": now_iso}
        
        if event == "meeting.started":
            updates["live_started_at"] = session.get("live_started_at") or now_iso
            if session.get("status") == MentorshipSessionStatus.SCHEDULED.value:
                updates["status"] = MentorshipSessionStatus.LIVE.value
        elif event == "meeting.ended":
            updates["live_ended_at"] = now_iso
            
        supabase.table(MENTORSHIP_SESSIONS_TABLE).update(updates).eq("id", session["id"]).execute()
        
    return {"status": "ok"}

