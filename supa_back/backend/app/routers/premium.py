import logging
import asyncio
import os
import uuid
import io
import base64
import hashlib
import secrets
from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, List, Optional, Set, Tuple, Literal

from fastapi import APIRouter, Depends, HTTPException, Query, Header, UploadFile, File, Form
from fastapi.responses import StreamingResponse
from supabase import Client, create_client
import html
import re
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen
from urllib.parse import urlparse
from bs4 import BeautifulSoup
from xhtml2pdf import pisa
from pydantic import BaseModel, Field


from ..ai_logic import (
    analyze_style_profile,
    evaluate_mains_answer,
    extract_text_from_images,
    generate_dashboard_performance_analysis,
    generate_quiz_content,
    refine_style_profile,
    generate_mains_questions,
)
from ..models import (
    AIGenerateQuizRequest,
    AIInstructionCreate,
    AIInstructionResponse,
    AIInstructionType,
    AIInstructionUpdate,
    AIProvider,
    LanguageCode,
    AIQuizGenerateRequest,
    AIQuizGenerateResponse,
    AISystemInstructionContentType,
    CategoryAISourceCreate,
    CategoryAISourceResponse,
    CategoryAISourceUpdate,
    CategoryBulkCreateRequest,
    CategoryBulkCreateResponse,
    CategoryBulkDeleteRequest,
    CategoryBulkDeleteResponse,
    CategoryCreate,
    CategoryResponse,
    CategoryType,
    CategoryUpdate,
    CollectionCreate,
    CollectionItemAddRequest,
    CollectionItemsBulkAddRequest,
    CollectionTestKind,
    CollectionTestQuestion,
    CollectionTestResponse,
    QuizQuestionComplaintCreate,
    QuizQuestionComplaintResponse,
    QuizQuestionComplaintStatus,
    QuizQuestionComplaintUpdate,
    CollectionTestScoreDetail,
    CollectionTestScoreRequest,
    CollectionTestScoreResponse,
    MainsCollectionTestQuestion,
    MainsCollectionTestResponse,
    MainsCollectionTestScoreDetail,
    MainsCollectionTestScoreRequest,
    MainsCollectionTestScoreResponse,
    ChallengeAttemptSubmitRequest,
    ChallengeLeaderboardEntry,
    ChallengeLeaderboardResponse,
    ChallengeLinkCreateRequest,
    ChallengeLinkResponse,
    ChallengeLinkUpdateRequest,
    PublicChallengeListItemResponse,
    ChallengeScoreResponse,
    ChallengeTestQuestion,
    ChallengeTestResponse,
    CollectionUpdate,
    ContentItemCreate,
    ContentItemResponse,
    ContentType,
    ExamCreate,
    ExamResponse,
    ExamUpdate,
    MainsEvaluationRequest,
    MainsEvaluationResponse,
    OCRRequest,
    OCRResponse,
    PassageQuizCreateRequest,
    PremiumAIDraftQuiz,
    PremiumAIDraftQuizListResponse,
    PremiumAIDraftQuizUpdate,
    PremiumAIExampleAnalysis,
    PremiumAIExampleAnalysisCreate,
    PremiumAIExampleAnalysisListResponse,
    PremiumAIExampleAnalysisUpdate,
    PremiumAIQuizInstruction,
    PremiumAIQuizInstructionCreate,
    PremiumAIQuizInstructionUpdate,
    UploadedPDF,
    PremiumPreviewMixJobCreateRequest,
    PremiumPreviewMixJobCreateResponse,
    PremiumPreviewMixJobStatusResponse,
    PremiumPreviewMixJobTaskStatus,
    PremiumPreviewMixPlanTask,
    PremiumPreviewResponse,
    QuizBulkCreateRequest,
    QuizKind,
    UserAIMainsQuestion,
    MainsAIGenerateRequest,
    MainsAIGenerateResponse,
    MainsCategoryCreate,
    MainsCategoryResponse,
    MainsCategorySourceCreate,
    MainsCategorySourceResponse,
    MainsCategorySourceUpdate,
    MainsCategoryTreeNode,
    MainsCategoryUpdate,
    QuizQuestionCreate,
    SavePremiumDraftRequest,
    ConvertDraftToPremiumQuizRequest,
    ConvertDraftToPremiumQuizResponse,
)
from ..supabase_client import get_supabase_client

router = APIRouter(prefix="/api/v1/premium", tags=["Premium Systems"])
compat_router = APIRouter(prefix="/api/v1", tags=["Premium Systems Compatibility"])
logger = logging.getLogger(__name__)

EXAMPLE_ANALYSES_TABLE = "premium_ai_example_analyses"
EXAMPLE_ANALYSES_MIGRATION_HINT = (
    "Missing premium_ai_example_analyses table. "
    "Run supa_back/migrations/2026-02-13_premium_ai_example_analyses.sql in Supabase SQL Editor."
)
EXAMS_TABLE = "exams"
EXAMS_MIGRATION_HINT = (
    "Missing exams table. "
    "Run the exams migration in Supabase SQL Editor."
)
DRAFT_QUIZZES_TABLE = "premium_ai_draft_quizzes"
DRAFT_QUIZZES_MIGRATION_HINT = (
    "Missing premium_ai_draft_quizzes table. "
    "Run supa_back/migrations/2026-02-14_premium_ai_draft_quizzes.sql in Supabase SQL Editor."
)
DRAFT_QUIZZES_OWNERSHIP_MIGRATION_HINT = (
    "Missing premium_ai_draft_quizzes.author_id ownership column. "
    "Run supa_back/migrations/2026-03-25_premium_ai_draft_quiz_ownership.sql in Supabase SQL Editor."
)
CATEGORY_AI_SOURCES_TABLE = "category_ai_sources"
CATEGORY_AI_SOURCES_MIGRATION_HINT = (
    "Missing category_ai_sources table. "
    "Run supa_back/migrations/2026-02-18_category_ai_sources_and_mains_categories.sql in Supabase SQL Editor."
)
MAINS_CATEGORIES_TABLE = "mains_categories"
MAINS_CATEGORY_SOURCES_TABLE = "mains_category_sources"
MAINS_CATEGORIES_MIGRATION_HINT = (
    "Missing mains category tables. "
    "Run supa_back/migrations/2026-02-18_category_ai_sources_and_mains_categories.sql in Supabase SQL Editor."
)
UPLOADED_PDFS_TABLE = "uploaded_pdfs"
UPLOADED_PDFS_MIGRATION_HINT = (
    "Missing uploaded_pdfs table. "
    "Run supa_back/migrations/2026-02-16_uploaded_pdfs.sql in Supabase SQL Editor."
)
CHALLENGE_LINKS_TABLE = "collection_challenge_links"
CHALLENGE_ATTEMPTS_TABLE = "collection_challenge_attempts"
CHALLENGE_PUBLIC_TOKEN_RE = re.compile(r"^c(?P<id>\d+)-(?P<prefix>[a-f0-9]{16})$")
CHALLENGES_MIGRATION_HINT = (
    "Missing challenge tables. "
    "Run supa_back/migrations/2026-02-16_collection_challenges.sql in Supabase SQL Editor."
)
USER_AI_QUIZ_HINTS_TABLE = "user_ai_quiz_hints"
USER_AI_QUIZ_HINTS_MIGRATION_HINT = (
    "Missing user_ai_quiz_hints table. "
    "Run supa_back/migrations/2026-02-16_user_ai_quiz_hints.sql in Supabase SQL Editor."
)
QUIZ_COMPLAINTS_TABLE = "quiz_question_complaints"
QUIZ_COMPLAINTS_MIGRATION_HINT = (
    "Missing quiz_question_complaints table. "
    "Run supa_back/migrations/2026-03-24_quiz_question_complaints.sql in Supabase SQL Editor."
)
ONBOARDING_REQUESTS_TABLE = "professional_onboarding_requests"
ONBOARDING_REQUESTS_MIGRATION_HINT = (
    "Missing professional onboarding schema. "
    "Run supa_back/migrations/2026-02-24_professional_onboarding_requests.sql and "
    "supa_back/migrations/2026-04-06_professional_onboarding_v2.sql and "
    "supa_back/migrations/2026-04-07_professional_onboarding_drafts.sql in Supabase SQL Editor."
)
PROFILES_TABLE = "creator_mentor_profiles"
PROFILES_MIGRATION_HINT = (
    "Missing creator_mentor_profiles table. "
    "Run supa_back/migrations/2026-02-23_profiles_and_subscriptions_scaffold.sql in Supabase SQL Editor."
)
ONBOARDING_PROFILE_MEDIA_BUCKET = "professional-profile-media"
ONBOARDING_REVIEW_DOCS_BUCKET = "professional-review-docs"
ONBOARDING_ASSET_KINDS = {"headshot", "proof_document", "sample_evaluation"}
ONBOARDING_STORAGE_BUCKET_OPTIONS: Dict[str, Dict[str, Any]] = {
    ONBOARDING_PROFILE_MEDIA_BUCKET: {
        "public": True,
        "file_size_limit": 6 * 1024 * 1024,
        "allowed_mime_types": ["image/jpeg", "image/png", "image/webp"],
    },
    ONBOARDING_REVIEW_DOCS_BUCKET: {
        "public": False,
        "file_size_limit": 12 * 1024 * 1024,
        "allowed_mime_types": ["application/pdf", "image/jpeg", "image/png", "image/webp"],
    },
}
ONBOARDING_ASSETS_MIGRATION_HINT = (
    "Missing professional onboarding storage buckets. "
    "Run supa_back/migrations/2026-04-06_professional_onboarding_v2.sql in Supabase SQL Editor."
)
ONBOARDING_ASSET_MAX_SIZE_MB = max(1, int(os.getenv("ONBOARDING_ASSET_MAX_SIZE_MB", "12")))
ONBOARDING_ASSET_SIGNED_URL_TTL_SECONDS = max(
    300,
    int(os.getenv("ONBOARDING_ASSET_SIGNED_URL_TTL_SECONDS", "3600")),
)
TEST_SERIES_TABLE = "test_series"
TEST_SERIES_ENROLLMENTS_TABLE = "test_series_enrollments"
MIX_PREVIEW_MAX_CONCURRENT_JOBS = max(1, int(os.getenv("MIX_PREVIEW_MAX_CONCURRENT_JOBS", "2")))
MIX_PREVIEW_JOB_TTL_SECONDS = max(300, int(os.getenv("MIX_PREVIEW_JOB_TTL_SECONDS", "3600")))
MIX_PREVIEW_TASK_TIMEOUT_SECONDS = max(20, int(os.getenv("MIX_PREVIEW_TASK_TIMEOUT_SECONDS", "120")))
MIX_PREVIEW_MAX_TOTAL_QUESTIONS = max(1, int(os.getenv("MIX_PREVIEW_MAX_TOTAL_QUESTIONS", "40")))
UPLOADED_PDF_TTL_HOURS = max(1, int(os.getenv("UPLOADED_PDF_TTL_HOURS", "24")))
UPLOADED_PDF_MAX_SIZE_MB = max(1, int(os.getenv("UPLOADED_PDF_MAX_SIZE_MB", "20")))
UPLOADED_PDF_MIN_TEXT_CHARS = max(20, int(os.getenv("UPLOADED_PDF_MIN_TEXT_CHARS", "120")))
UPLOADED_PDF_OCR_MAX_PAGES = max(1, int(os.getenv("UPLOADED_PDF_OCR_MAX_PAGES", "8")))
USER_AI_HINTS_MAX_HINTS = max(4, int(os.getenv("USER_AI_HINTS_MAX_HINTS", "12")))
USER_AI_HINTS_MAX_RECENT_QUESTIONS = max(10, int(os.getenv("USER_AI_HINTS_MAX_RECENT_QUESTIONS", "30")))
CHALLENGE_DEFAULT_EXPIRY_HOURS = max(1, int(os.getenv("CHALLENGE_DEFAULT_EXPIRY_HOURS", "72")))
CHALLENGE_MAX_LEADERBOARD_SIZE = max(5, int(os.getenv("CHALLENGE_MAX_LEADERBOARD_SIZE", "100")))
DEFAULT_TEST_SUBSCRIBER_EMAILS: Set[str] = {"abrarsaifi00@gmail.com"}
CATEGORY_SOURCE_MAX_SOURCES = max(1, int(os.getenv("CATEGORY_SOURCE_MAX_SOURCES", "25")))
CATEGORY_SOURCE_MAX_CHARS = max(4000, int(os.getenv("CATEGORY_SOURCE_MAX_CHARS", "60000")))
MAINS_CATEGORY_SOURCE_MAX_SOURCES = max(1, int(os.getenv("MAINS_CATEGORY_SOURCE_MAX_SOURCES", "25")))
MAINS_CATEGORY_SOURCE_MAX_CHARS = max(4000, int(os.getenv("MAINS_CATEGORY_SOURCE_MAX_CHARS", "60000")))
CATEGORY_PDF_SOURCE_MAX_FILES = max(1, int(os.getenv("CATEGORY_PDF_SOURCE_MAX_FILES", "12")))
CATEGORY_PDF_SOURCE_MAX_CHARS = max(1000, int(os.getenv("CATEGORY_PDF_SOURCE_MAX_CHARS", "12000")))
MAINS_CATEGORY_PDF_SOURCE_MAX_CHARS = max(1000, int(os.getenv("MAINS_CATEGORY_PDF_SOURCE_MAX_CHARS", "12000")))
URL_SOURCE_FETCH_TIMEOUT_SECONDS = max(5, int(os.getenv("URL_SOURCE_FETCH_TIMEOUT_SECONDS", "20")))
URL_SOURCE_MIN_EXTRACT_CHARS = max(40, int(os.getenv("URL_SOURCE_MIN_EXTRACT_CHARS", "120")))

_USER_AI_HINTS_TABLE_WARNING_EMITTED = False
MANAGED_USER_ROLES: Set[str] = {
    "admin",
    "moderator",
    "provider",
    "institute",
    "creator",
    "mentor",
    "subscriber",
    "user",
}
_AUTH_ADMIN_CLIENT: Optional[Client] = None
_ONBOARDING_STORAGE_READY = False

QUIZ_KIND_TO_CONTENT_TYPE: Dict[QuizKind, str] = {
    QuizKind.GK: ContentType.QUIZ_GK.value,
    QuizKind.MATHS: ContentType.QUIZ_MATHS.value,
    QuizKind.PASSAGE: ContentType.QUIZ_PASSAGE.value,
}

QUIZ_TYPE_TO_CATEGORY_TYPE: Dict[str, str] = {
    "gk": CategoryType.GK.value,
    "maths": CategoryType.MATHS.value,
    "passage": CategoryType.PASSAGE.value,
    "premium_gk": CategoryType.GK.value,
    "premium_maths": CategoryType.MATHS.value,
    "premium_passage": CategoryType.PASSAGE.value,
}

PRELIMS_COLLECTION_MODES: Set[str] = {
    "prelims",
    "prelims_quiz",
    "quiz",
    "quiz_collection",
    "quiz_test",
}
MAINS_COLLECTION_MODES: Set[str] = {
    "mains",
    "mains_ai",
    "mains_ai_question",
    "mains_question",
    "mains_test",
}


def _normalize_collection_mode(value: Any) -> str:
    return str(value or "").strip().lower()


def _resolve_collection_test_kind(meta: Optional[Dict[str, Any]]) -> CollectionTestKind:
    payload = meta if isinstance(meta, dict) else {}
    explicit_kind = _normalize_collection_mode(payload.get("test_kind"))
    if explicit_kind == CollectionTestKind.MAINS.value:
        return CollectionTestKind.MAINS
    if explicit_kind == CollectionTestKind.PRELIMS.value:
        return CollectionTestKind.PRELIMS

    mode = _normalize_collection_mode(payload.get("collection_mode"))
    if mode in MAINS_COLLECTION_MODES:
        return CollectionTestKind.MAINS
    if mode in PRELIMS_COLLECTION_MODES:
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
    return "could not find the table" in error_text and table_name.lower() in error_text


def _is_missing_column_error(exc: Exception, table_name: str, column_name: str) -> bool:
    error_text = str(exc).lower()
    table_token = table_name.lower()
    column_token = column_name.lower()
    return (
        (f"could not find the '{column_token}' column" in error_text and table_token in error_text)
        or (f'column "{column_token}"' in error_text and "does not exist" in error_text)
        or (f"{table_token}.{column_token}" in error_text and "does not exist" in error_text)
    )


def _raise_example_analyses_migration_required(exc: Exception) -> None:
    logger.warning("premium_ai_example_analyses schema check failed: %s", exc)
    raise HTTPException(status_code=503, detail=EXAMPLE_ANALYSES_MIGRATION_HINT)


def get_user_id(
    authorization: Optional[str] = Header(None),
    supabase: Client = Depends(get_supabase_client),
) -> Optional[str]:
    user_ctx = get_user_context(authorization=authorization, supabase=supabase)
    return str(user_ctx.get("user_id")) if user_ctx else None


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


class AdminUserRoleRow(BaseModel):
    user_id: str
    email: Optional[str] = None
    role: str
    app_metadata: Dict[str, Any] = Field(default_factory=dict)
    user_metadata: Dict[str, Any] = Field(default_factory=dict)
    created_at: Optional[str] = None
    last_sign_in_at: Optional[str] = None


class AdminUserRoleUpdateRequest(BaseModel):
    role: str


class ProfessionalOnboardingAssetResponse(BaseModel):
    bucket: str
    path: str
    file_name: str
    mime_type: Optional[str] = None
    size_bytes: Optional[int] = None
    uploaded_at: Optional[str] = None
    asset_kind: Optional[str] = None
    url: Optional[str] = None


class ProfessionalOnboardingApplicationCreate(BaseModel):
    desired_role: Literal["mentor", "creator"]
    full_name: str = Field(min_length=2, max_length=120)
    city: Optional[str] = Field(default=None, max_length=120)
    years_experience: Optional[int] = Field(default=None, ge=0, le=60)
    phone: str = Field(min_length=7, max_length=40)
    about: Optional[str] = Field(default=None, max_length=3000)
    details: Dict[str, Any] = Field(default_factory=dict)


class ProfessionalOnboardingApplicationDraftSave(BaseModel):
    desired_role: Literal["mentor", "creator"]
    full_name: Optional[str] = Field(default=None, max_length=120)
    city: Optional[str] = Field(default=None, max_length=120)
    years_experience: Optional[int] = Field(default=None, ge=0, le=60)
    phone: Optional[str] = Field(default=None, max_length=40)
    about: Optional[str] = Field(default=None, max_length=3000)
    details: Dict[str, Any] = Field(default_factory=dict)


class ProfessionalOnboardingApplicationReview(BaseModel):
    action: Literal["approve", "reject"]
    reviewer_note: Optional[str] = Field(default=None, max_length=1200)


class ProfessionalOnboardingApplicationResponse(BaseModel):
    id: int
    user_id: str
    email_snapshot: Optional[str] = None
    desired_role: str
    full_name: str
    city: Optional[str] = None
    years_experience: Optional[int] = None
    phone: Optional[str] = None
    phone_link: Optional[str] = None
    about: Optional[str] = None
    details: Dict[str, Any] = Field(default_factory=dict)
    status: str
    reviewer_user_id: Optional[str] = None
    reviewer_note: Optional[str] = None
    reviewed_at: Optional[str] = None
    created_at: str
    updated_at: Optional[str] = None


def _is_admin(user_ctx: Optional[Dict[str, Any]]) -> bool:
    return bool(user_ctx and user_ctx.get("is_admin"))


def _is_moderator(user_ctx: Optional[Dict[str, Any]]) -> bool:
    return bool(user_ctx and user_ctx.get("is_moderator"))


def _is_admin_or_moderator(user_ctx: Optional[Dict[str, Any]]) -> bool:
    return _is_admin(user_ctx) or _is_moderator(user_ctx)


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


def _truthy(value: Any) -> bool:
    if isinstance(value, bool):
        return value
    if isinstance(value, (int, float)):
        return value > 0
    if isinstance(value, str):
        normalized = value.strip().lower()
        return normalized in {"1", "true", "yes", "active", "paid", "premium"}
    return False


def _is_active_subscription(user_ctx: Dict[str, Any]) -> bool:
    if user_ctx.get("is_admin"):
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

    for field in (
        "subscription_active",
        "is_subscribed",
        "has_subscription",
        "premium",
    ):
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


def _is_generation_subscription_enforced() -> bool:
    value = str(os.getenv("REQUIRE_GENERATION_SUBSCRIPTION", "false")).strip().lower()
    return value in {"1", "true", "yes", "active", "enforced"}


def _is_quiz_master_like_user(user_ctx: Dict[str, Any]) -> bool:
    role = _as_role(user_ctx.get("role"))
    if role in {"creator", "provider", "institute"}:
        return True

    app_meta = user_ctx.get("app_metadata") or {}
    user_meta = user_ctx.get("user_metadata") or {}
    for field in (
        "creator",
        "provider",
        "institute",
        "quiz_master",
        "quizmaster",
    ):
        if _truthy(app_meta.get(field)) or _truthy(user_meta.get(field)):
            return True
    return False


def _is_quiz_master_generation_subscription_enforced() -> bool:
    value = str(os.getenv("REQUIRE_QUIZ_MASTER_GENERATION_SUBSCRIPTION", "false")).strip().lower()
    return value in {"1", "true", "yes", "active", "enforced"}


def _is_active_quiz_master_generation_subscription(user_ctx: Dict[str, Any]) -> bool:
    if user_ctx.get("is_admin"):
        return True
    if not _is_quiz_master_like_user(user_ctx):
        return False

    app_meta = user_ctx.get("app_metadata") or {}
    user_meta = user_ctx.get("user_metadata") or {}

    for field in (
        "quiz_master_subscription_active",
        "creator_subscription_active",
        "quiz_master_ai_enabled",
        "creator_ai_enabled",
        "quiz_master_ai_access",
        "creator_ai_access",
    ):
        if _truthy(app_meta.get(field)) or _truthy(user_meta.get(field)):
            return True

    for field in (
        "quiz_master_subscription_status",
        "quiz_master_ai_subscription_status",
        "creator_subscription_status",
        "creator_ai_subscription_status",
    ):
        status_value = _as_role(app_meta.get(field) or user_meta.get(field))
        if status_value in {"active", "paid", "premium", "enabled"}:
            return True

    for field in (
        "quiz_master_plan",
        "quiz_master_ai_plan",
        "creator_plan",
        "creator_ai_plan",
    ):
        plan_value = _as_role(app_meta.get(field) or user_meta.get(field))
        if plan_value and plan_value not in {"free", "basic", "none"}:
            return True

    return False


def _is_mains_mentor_like_user(user_ctx: Dict[str, Any]) -> bool:
    role = _as_role(user_ctx.get("role"))
    if role == "mentor":
        return True

    app_meta = user_ctx.get("app_metadata") or {}
    user_meta = user_ctx.get("user_metadata") or {}
    for field in (
        "mentor",
        "mains_mentor",
        "mainsmentor",
    ):
        if _truthy(app_meta.get(field)) or _truthy(user_meta.get(field)):
            return True
    return False


def _is_mains_mentor_generation_subscription_enforced() -> bool:
    value = str(os.getenv("REQUIRE_MAINS_MENTOR_GENERATION_SUBSCRIPTION", "false")).strip().lower()
    return value in {"1", "true", "yes", "active", "enforced"}


def _is_active_mains_mentor_generation_subscription(user_ctx: Dict[str, Any]) -> bool:
    if user_ctx.get("is_admin"):
        return True
    if not _is_mains_mentor_like_user(user_ctx):
        return False

    app_meta = user_ctx.get("app_metadata") or {}
    user_meta = user_ctx.get("user_metadata") or {}

    for field in (
        "mains_mentor_subscription_active",
        "mentor_subscription_active",
        "mains_mentor_ai_enabled",
        "mentor_ai_enabled",
        "mains_mentor_ai_access",
        "mentor_ai_access",
    ):
        if _truthy(app_meta.get(field)) or _truthy(user_meta.get(field)):
            return True

    for field in (
        "mains_mentor_subscription_status",
        "mains_mentor_ai_subscription_status",
        "mentor_subscription_status",
        "mentor_ai_subscription_status",
    ):
        status_value = _as_role(app_meta.get(field) or user_meta.get(field))
        if status_value in {"active", "paid", "premium", "enabled"}:
            return True

    for field in (
        "mains_mentor_plan",
        "mains_mentor_ai_plan",
        "mentor_plan",
        "mentor_ai_plan",
    ):
        plan_value = _as_role(app_meta.get(field) or user_meta.get(field))
        if plan_value and plan_value not in {"free", "basic", "none"}:
            return True

    return False


def require_admin_user(
    user_ctx: Optional[Dict[str, Any]] = Depends(get_user_context),
) -> Dict[str, Any]:
    if not user_ctx:
        raise HTTPException(status_code=401, detail="Authentication required.")
    if not _is_admin(user_ctx):
        raise HTTPException(status_code=403, detail="Admin access required.")
    return user_ctx


def require_moderator_or_admin_user(
    user_ctx: Optional[Dict[str, Any]] = Depends(get_user_context),
) -> Dict[str, Any]:
    if not user_ctx:
        raise HTTPException(status_code=401, detail="Authentication required.")
    if not _is_admin_or_moderator(user_ctx):
        raise HTTPException(status_code=403, detail="Moderator or admin access required.")
    return user_ctx


def require_authenticated_user(
    user_ctx: Optional[Dict[str, Any]] = Depends(get_user_context),
) -> Dict[str, Any]:
    if not user_ctx:
        raise HTTPException(status_code=401, detail="Authentication required.")
    user_id = str(user_ctx.get("user_id") or "").strip()
    if not user_id:
        raise HTTPException(status_code=401, detail="Authentication required.")
    return user_ctx


def _get_auth_admin_client(default_client: Client) -> Client:
    global _AUTH_ADMIN_CLIENT
    if _AUTH_ADMIN_CLIENT:
        return _AUTH_ADMIN_CLIENT

    supabase_url = str(os.getenv("SUPABASE_URL", "")).strip()
    service_role_key = str(os.getenv("SUPABASE_SERVICE_ROLE_KEY", "")).strip()
    if supabase_url and service_role_key:
        try:
            _AUTH_ADMIN_CLIENT = create_client(supabase_url, service_role_key)
            return _AUTH_ADMIN_CLIENT
        except Exception as exc:
            logger.warning("Failed to initialize dedicated auth admin client: %s", exc)
    return default_client


def _storage_bucket_identifier(value: Any) -> str:
    if isinstance(value, dict):
        raw = value.get("id") or value.get("name")
    else:
        raw = getattr(value, "id", None) or getattr(value, "name", None)
    return str(raw or "").strip()


def _auth_user_to_role_row(user_obj: Any) -> AdminUserRoleRow:
    app_meta = getattr(user_obj, "app_metadata", None) or {}
    if not isinstance(app_meta, dict):
        app_meta = {}
    user_meta = getattr(user_obj, "user_metadata", None) or {}
    if not isinstance(user_meta, dict):
        user_meta = {}
    role = _as_role(app_meta.get("role") or user_meta.get("role")) or "user"
    return AdminUserRoleRow(
        user_id=str(getattr(user_obj, "id", None) or "").strip(),
        email=(str(getattr(user_obj, "email", None) or "").strip().lower() or None),
        role=role,
        app_metadata=app_meta,
        user_metadata=user_meta,
        created_at=(str(getattr(user_obj, "created_at", None) or "").strip() or None),
        last_sign_in_at=(str(getattr(user_obj, "last_sign_in_at", None) or "").strip() or None),
    )


def _build_role_flag_map(role: str) -> Dict[str, bool]:
    normalized = _as_role(role)
    return {
        "admin": normalized == "admin",
        "moderator": normalized == "moderator",
        "provider": normalized in {"provider", "institute", "creator"},
        "institute": normalized == "institute",
        "creator": normalized == "creator",
        "mentor": normalized == "mentor",
    }


def _role_flags_from_metadata(app_meta: Dict[str, Any]) -> Dict[str, bool]:
    role_derived = _build_role_flag_map(_as_role(app_meta.get("role")))
    return {
        "admin": _truthy(app_meta.get("admin")) or role_derived["admin"],
        "moderator": _truthy(app_meta.get("moderator")) or role_derived["moderator"],
        "provider": _truthy(app_meta.get("provider")) or role_derived["provider"],
        "institute": _truthy(app_meta.get("institute")) or role_derived["institute"],
        "creator": _truthy(app_meta.get("creator")) or role_derived["creator"],
        "mentor": _truthy(app_meta.get("mentor")) or role_derived["mentor"],
    }


def _has_quiz_master_access(user_ctx: Dict[str, Any]) -> bool:
    role = _as_role(user_ctx.get("role"))
    if role in {"creator", "provider", "institute"}:
        return True
    app_meta = user_ctx.get("app_metadata") or {}
    user_meta = user_ctx.get("user_metadata") or {}
    return any(
        _truthy(app_meta.get(field)) or _truthy(user_meta.get(field))
        for field in ("creator", "provider", "institute")
    )


def _has_mains_mentor_access(user_ctx: Dict[str, Any]) -> bool:
    role = _as_role(user_ctx.get("role"))
    if role == "mentor":
        return True
    app_meta = user_ctx.get("app_metadata") or {}
    user_meta = user_ctx.get("user_metadata") or {}
    return _truthy(app_meta.get("mentor")) or _truthy(user_meta.get("mentor"))


def _as_optional_text(value: Any, *, max_length: int) -> Optional[str]:
    text = str(value or "").strip()
    if not text:
        return None
    return text[:max_length]


def _sanitize_text_list(
    value: Any,
    *,
    max_items: int,
    max_length: int,
) -> List[str]:
    raw_values: List[Any]
    if isinstance(value, list):
        raw_values = value
    elif isinstance(value, str):
        raw_values = [item for item in re.split(r"[\n,]", value) if item and item.strip()]
    else:
        raw_values = []

    output: List[str] = []
    for item in raw_values:
        cleaned = _as_optional_text(item, max_length=max_length)
        if not cleaned or cleaned in output:
            continue
        output.append(cleaned)
        if len(output) >= max_items:
            break
    return output


def _phone_contact_url(value: Any) -> Optional[str]:
    raw = str(value or "").strip()
    if not raw:
        return None
    normalized = "".join(ch for ch in raw if ch.isdigit() or ch == "+")
    if not normalized:
        return None
    if normalized.count("+") > 1:
        normalized = normalized.replace("+", "")
    if "+" in normalized and not normalized.startswith("+"):
        normalized = normalized.replace("+", "")
    return f"tel:{normalized}"


def _is_missing_storage_bucket_error(exc: Exception) -> bool:
    text = str(exc).lower()
    return "bucket" in text and ("not found" in text or "does not exist" in text)


def _raise_onboarding_assets_migration_required(exc: Exception) -> None:
    text = str(exc).lower()
    if any(token in text for token in ("permission", "not authorized", "unauthorized", "access denied", "403")):
        detail = ONBOARDING_ASSETS_MIGRATION_HINT
        if not str(os.getenv("SUPABASE_SERVICE_ROLE_KEY", "")).strip():
            detail += " Automatic bucket provisioning also requires SUPABASE_SERVICE_ROLE_KEY on the backend."
        raise HTTPException(status_code=503, detail=detail)
    if _is_missing_storage_bucket_error(exc):
        raise HTTPException(status_code=503, detail=ONBOARDING_ASSETS_MIGRATION_HINT)
    raise exc


def _onboarding_bucket_for_asset_kind(asset_kind: str) -> str:
    return ONBOARDING_PROFILE_MEDIA_BUCKET if asset_kind == "headshot" else ONBOARDING_REVIEW_DOCS_BUCKET


def _ensure_onboarding_storage_buckets(default_client: Client) -> Client:
    global _ONBOARDING_STORAGE_READY
    storage_client = _get_auth_admin_client(default_client)
    if _ONBOARDING_STORAGE_READY:
        return storage_client

    try:
        existing_bucket_ids = {
            bucket_id
            for bucket_id in (
                _storage_bucket_identifier(item) for item in (storage_client.storage.list_buckets() or [])
            )
            if bucket_id
        }
        for bucket_id, options in ONBOARDING_STORAGE_BUCKET_OPTIONS.items():
            if bucket_id not in existing_bucket_ids:
                try:
                    storage_client.storage.create_bucket(bucket_id, bucket_id, options)
                except Exception as exc:
                    text = str(exc).lower()
                    if "already exists" not in text and "duplicate" not in text and "exists" not in text:
                        raise
            storage_client.storage.update_bucket(bucket_id, options)
        _ONBOARDING_STORAGE_READY = True
        return storage_client
    except Exception as exc:
        _raise_onboarding_assets_migration_required(exc)
        raise


def _normalize_onboarding_asset(
    value: Any,
    *,
    user_id: str,
) -> Optional[Dict[str, Any]]:
    if not isinstance(value, dict):
        return None

    bucket = _as_optional_text(value.get("bucket"), max_length=120)
    if bucket not in {ONBOARDING_PROFILE_MEDIA_BUCKET, ONBOARDING_REVIEW_DOCS_BUCKET}:
        return None

    path = _as_optional_text(value.get("path"), max_length=600)
    if not path:
        return None
    normalized_path = path.lstrip("/")
    if user_id and not normalized_path.startswith(f"{user_id}/"):
        return None

    file_name = _as_optional_text(
        value.get("file_name") or value.get("filename") or os.path.basename(normalized_path),
        max_length=240,
    ) or os.path.basename(normalized_path)
    mime_type = _as_optional_text(value.get("mime_type"), max_length=120)
    size_bytes = _parse_optional_non_negative_int(
        value.get("size_bytes"),
        max_value=ONBOARDING_ASSET_MAX_SIZE_MB * 1024 * 1024,
    )
    uploaded_at = _as_optional_text(value.get("uploaded_at"), max_length=80)
    asset_kind = _as_optional_text(value.get("asset_kind"), max_length=40)
    if asset_kind not in ONBOARDING_ASSET_KINDS:
        asset_kind = None

    return {
        "bucket": bucket,
        "path": normalized_path,
        "file_name": file_name,
        "mime_type": mime_type,
        "size_bytes": size_bytes,
        "uploaded_at": uploaded_at,
        "asset_kind": asset_kind,
    }


def _onboarding_asset_url(
    asset: Dict[str, Any],
    *,
    supabase: Client,
) -> Optional[str]:
    bucket = str(asset.get("bucket") or "").strip()
    path = str(asset.get("path") or "").strip()
    if not bucket or not path:
        return None
    try:
        bucket_proxy = supabase.storage.from_(bucket)
        if bucket == ONBOARDING_PROFILE_MEDIA_BUCKET:
            return bucket_proxy.get_public_url(path)
        signed = bucket_proxy.create_signed_url(path, ONBOARDING_ASSET_SIGNED_URL_TTL_SECONDS)
        return str(signed.get("signedURL") or "").strip() or None
    except Exception as exc:
        logger.warning("Failed to create onboarding asset URL for %s/%s: %s", bucket, path, exc)
        return None


def _present_onboarding_asset(
    asset: Any,
    *,
    user_id: str,
    supabase: Client,
) -> Optional[Dict[str, Any]]:
    normalized = _normalize_onboarding_asset(asset, user_id=user_id)
    if not normalized:
        return None
    presented = dict(normalized)
    presented["url"] = _onboarding_asset_url(normalized, supabase=supabase)
    return presented


def _normalize_quiz_master_sample_mcqs(value: Any) -> List[Dict[str, Any]]:
    if not isinstance(value, list):
        return []

    output: List[Dict[str, Any]] = []
    for entry in value[:5]:
        if not isinstance(entry, dict):
            continue
        options = _sanitize_text_list(entry.get("options"), max_items=5, max_length=280)
        correct_option = _as_optional_text(entry.get("correct_option"), max_length=1)
        correct_option = correct_option.upper() if correct_option else None
        if correct_option not in {"A", "B", "C", "D", "E"}:
            correct_option = None
        output.append(
            {
                "question": _as_optional_text(entry.get("question"), max_length=1200),
                "options": options,
                "correct_option": correct_option,
                "explanation": _as_optional_text(entry.get("explanation"), max_length=3000),
            }
        )
    return output


def _normalize_onboarding_details(
    value: Any,
    *,
    user_id: str,
    desired_role: str,
    strict: bool,
) -> Dict[str, Any]:
    raw = value if isinstance(value, dict) else {}
    details: Dict[str, Any] = {
        "current_occupation": _as_optional_text(raw.get("current_occupation"), max_length=180),
        "professional_headshot": _normalize_onboarding_asset(raw.get("professional_headshot"), user_id=user_id),
        "upsc_roll_number": _as_optional_text(raw.get("upsc_roll_number"), max_length=80),
        "upsc_years": _as_optional_text(raw.get("upsc_years"), max_length=180),
        "proof_documents": [
            asset
            for asset in (
                _normalize_onboarding_asset(item, user_id=user_id)
                for item in (raw.get("proof_documents") if isinstance(raw.get("proof_documents"), list) else [])
            )
            if asset
        ][:6],
        "mains_written_count": _parse_optional_non_negative_int(raw.get("mains_written_count"), max_value=25),
        "interview_faced_count": _parse_optional_non_negative_int(raw.get("interview_faced_count"), max_value=25),
        "prelims_cleared_count": _parse_optional_non_negative_int(raw.get("prelims_cleared_count"), max_value=25),
        "highest_prelims_score": _as_optional_text(raw.get("highest_prelims_score"), max_length=80),
        "optional_subject": _as_optional_text(raw.get("optional_subject"), max_length=120),
        "gs_preferences": _sanitize_text_list(raw.get("gs_preferences"), max_items=6, max_length=40),
        "mentorship_years": _parse_optional_non_negative_int(raw.get("mentorship_years"), max_value=60),
        "institute_associations": _sanitize_text_list(raw.get("institute_associations"), max_items=8, max_length=160),
        "sample_evaluation": _normalize_onboarding_asset(raw.get("sample_evaluation"), user_id=user_id),
        "intro_video_url": _as_optional_text(raw.get("intro_video_url"), max_length=800),
        "subject_focus": _sanitize_text_list(raw.get("subject_focus"), max_items=10, max_length=80),
        "content_experience": _as_optional_text(raw.get("content_experience"), max_length=3000),
        "short_bio": _as_optional_text(raw.get("short_bio"), max_length=600),
        "preparation_strategy": _as_optional_text(raw.get("preparation_strategy"), max_length=12000),
        "sample_mcqs": _normalize_quiz_master_sample_mcqs(raw.get("sample_mcqs")),
    }

    if strict:
        if not details["current_occupation"]:
            raise HTTPException(status_code=400, detail="Current occupation is required.")
        if not details["professional_headshot"]:
            raise HTTPException(status_code=400, detail="Professional headshot is required.")
        if not details["upsc_roll_number"]:
            raise HTTPException(status_code=400, detail="UPSC roll number is required.")
        if not details["upsc_years"]:
            raise HTTPException(status_code=400, detail="UPSC year details are required.")
        if len(details["proof_documents"]) == 0:
            raise HTTPException(status_code=400, detail="Upload at least one official proof document.")

        if desired_role == "mentor":
            if details["mains_written_count"] is None:
                raise HTTPException(status_code=400, detail="Number of UPSC Mains written is required.")
            if details["interview_faced_count"] is None:
                raise HTTPException(status_code=400, detail="Number of UPSC interviews faced is required.")
            if not details["optional_subject"] and len(details["gs_preferences"]) == 0:
                raise HTTPException(status_code=400, detail="Add optional subject or at least one GS preference.")
            if details["mentorship_years"] is None:
                raise HTTPException(status_code=400, detail="Mentorship experience years are required.")
            if not details["sample_evaluation"]:
                raise HTTPException(status_code=400, detail="Upload a sample evaluated Mains copy.")
            if not details["intro_video_url"]:
                raise HTTPException(status_code=400, detail="Introduction video link is required.")
        else:
            if details["prelims_cleared_count"] is None:
                raise HTTPException(status_code=400, detail="Number of UPSC Prelims cleared is required.")
            if not details["highest_prelims_score"]:
                raise HTTPException(status_code=400, detail="Highest Prelims score is required.")
            if len(details["subject_focus"]) == 0:
                raise HTTPException(status_code=400, detail="Select at least one subject focus.")
            if not details["content_experience"]:
                raise HTTPException(status_code=400, detail="Content experience is required.")

    return details


def _present_onboarding_details(
    value: Any,
    *,
    user_id: str,
    desired_role: str,
    supabase: Client,
) -> Dict[str, Any]:
    details = _normalize_onboarding_details(value, user_id=user_id, desired_role=desired_role, strict=False)
    presented = dict(details)
    presented["professional_headshot"] = _present_onboarding_asset(
        details.get("professional_headshot"),
        user_id=user_id,
        supabase=supabase,
    )
    presented["proof_documents"] = [
        asset
        for asset in (
            _present_onboarding_asset(item, user_id=user_id, supabase=supabase)
            for item in (details.get("proof_documents") or [])
        )
        if asset
    ]
    presented["sample_evaluation"] = _present_onboarding_asset(
        details.get("sample_evaluation"),
        user_id=user_id,
        supabase=supabase,
    )
    return presented


def _default_onboarding_about(
    *,
    desired_role: str,
    details: Dict[str, Any],
) -> Optional[str]:
    pieces: List[str] = []
    current_occupation = _as_optional_text(details.get("current_occupation"), max_length=180)
    if current_occupation:
        pieces.append(current_occupation)
    if desired_role == "mentor":
        if details.get("optional_subject"):
            pieces.append(f"Optional: {details['optional_subject']}")
        if details.get("gs_preferences"):
            pieces.append(f"GS focus: {', '.join(details['gs_preferences'])}")
        mentorship_years = _parse_optional_non_negative_int(details.get("mentorship_years"), max_value=60)
        if mentorship_years is not None:
            pieces.append(f"Mentorship experience: {mentorship_years} years")
    else:
        if details.get("short_bio"):
            pieces.append(str(details["short_bio"]))
        if details.get("subject_focus"):
            pieces.append(f"Subject focus: {', '.join(details['subject_focus'])}")
        if details.get("content_experience"):
            pieces.append(str(details["content_experience"]))
    summary = " | ".join(piece for piece in pieces if piece).strip()
    return summary[:3000] if summary else None


def _professional_role_title(value: Any) -> str:
    normalized = _as_role(value)
    if normalized == "mentor":
        return "Mains Mentor"
    if normalized in {"provider", "institute", "creator"}:
        return "Quiz Master"
    if normalized:
        return normalized.replace("_", " ").title()
    return "Professional"


def _onboarding_application_response(
    row: Dict[str, Any],
    *,
    supabase: Client,
) -> ProfessionalOnboardingApplicationResponse:
    years_raw = row.get("years_experience")
    years_experience: Optional[int] = None
    try:
        parsed = int(years_raw)
        if parsed >= 0:
            years_experience = parsed
    except (TypeError, ValueError):
        years_experience = None

    user_id = str(row.get("user_id") or "").strip()
    desired_role = _as_role(row.get("desired_role") or "mentor") or "mentor"
    phone = _as_optional_text(row.get("phone"), max_length=40)

    return ProfessionalOnboardingApplicationResponse(
        id=int(row.get("id") or 0),
        user_id=user_id,
        email_snapshot=_as_optional_text(row.get("email_snapshot"), max_length=250),
        desired_role=desired_role,
        full_name=str(row.get("full_name") or "").strip(),
        city=_as_optional_text(row.get("city"), max_length=120),
        years_experience=years_experience,
        phone=phone,
        phone_link=_phone_contact_url(phone),
        about=_as_optional_text(row.get("about"), max_length=3000),
        details=_present_onboarding_details(
            row.get("details"),
            user_id=user_id,
            desired_role=desired_role,
            supabase=supabase,
        ),
        status=_as_role(row.get("status") or "pending") or "pending",
        reviewer_user_id=_as_optional_text(row.get("reviewer_user_id"), max_length=80),
        reviewer_note=_as_optional_text(row.get("reviewer_note"), max_length=1200),
        reviewed_at=_as_optional_text(row.get("reviewed_at"), max_length=80),
        created_at=str(row.get("created_at") or ""),
        updated_at=_as_optional_text(row.get("updated_at"), max_length=80),
    )


def _raise_onboarding_migration_required(exc: Exception) -> None:
    if _is_missing_table_error(exc, ONBOARDING_REQUESTS_TABLE):
        raise HTTPException(status_code=503, detail=ONBOARDING_REQUESTS_MIGRATION_HINT)
    text = str(exc).lower()
    if "professional_onboarding_requests" in text and "details" in text and "column" in text:
        raise HTTPException(status_code=503, detail=ONBOARDING_REQUESTS_MIGRATION_HINT)
    if ONBOARDING_REQUESTS_TABLE.lower() in text and (
        "does not exist" in text
        or "relation" in text
        or "undefined table" in text
        or "not found" in text
    ):
        raise HTTPException(status_code=503, detail=ONBOARDING_REQUESTS_MIGRATION_HINT)
    raise exc


def _raise_profiles_migration_required(exc: Exception) -> None:
    if _is_missing_table_error(exc, PROFILES_TABLE):
        raise HTTPException(status_code=503, detail=PROFILES_MIGRATION_HINT)
    text = str(exc).lower()
    if PROFILES_TABLE.lower() in text and (
        "does not exist" in text
        or "relation" in text
        or "undefined table" in text
        or "not found" in text
    ):
        raise HTTPException(status_code=503, detail=PROFILES_MIGRATION_HINT)
    raise exc


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


def _upsert_professional_profile_from_onboarding(
    *,
    supabase: Client,
    application: Dict[str, Any],
    desired_role: str,
) -> None:
    normalized_role = _as_role(desired_role)
    if normalized_role not in {"mentor", "creator"}:
        return

    user_id = str(application.get("user_id") or "").strip()
    if not user_id:
        raise HTTPException(status_code=400, detail="Onboarding application has no valid user id.")

    role_title = _professional_role_title(normalized_role)
    fallback_name = f"UPSC {role_title}"
    full_name = _as_optional_text(application.get("full_name"), max_length=120) or fallback_name
    city = _as_optional_text(application.get("city"), max_length=120)
    about = _as_optional_text(application.get("about"), max_length=3000)
    years_experience = _parse_optional_non_negative_int(application.get("years_experience"), max_value=60)
    phone = _as_optional_text(application.get("phone"), max_length=40)
    details = _normalize_onboarding_details(
        application.get("details"),
        user_id=user_id,
        desired_role=normalized_role,
        strict=False,
    )
    current_occupation = _as_optional_text(details.get("current_occupation"), max_length=180)
    professional_headshot = _normalize_onboarding_asset(details.get("professional_headshot"), user_id=user_id)
    profile_image_url = _onboarding_asset_url(professional_headshot, supabase=supabase) if professional_headshot else None
    phone_link = _phone_contact_url(phone)
    derived_about = _default_onboarding_about(desired_role=normalized_role, details=details)
    short_bio = _as_optional_text(details.get("short_bio"), max_length=600)
    preparation_strategy = _as_optional_text(details.get("preparation_strategy"), max_length=12000)
    derived_years_experience = (
        _parse_optional_non_negative_int(details.get("mentorship_years"), max_value=60)
        if normalized_role == "mentor"
        else None
    )
    now_iso = _utc_now().isoformat()
    app_id = _parse_optional_non_negative_int(application.get("id"))

    try:
        existing = _first(
            supabase.table(PROFILES_TABLE)
            .select("*")
            .eq("user_id", user_id)
            .limit(1)
            .execute()
        )
    except Exception as exc:
        _raise_profiles_migration_required(exc)

    existing_meta = existing.get("meta") if isinstance(existing, dict) else None
    meta = dict(existing_meta) if isinstance(existing_meta, dict) else {}
    meta["onboarding_source"] = "professional_onboarding"
    meta["onboarding_approved_at"] = now_iso
    meta["phone"] = phone
    meta["phone_link"] = phone_link
    meta["eligibility_details"] = details
    if preparation_strategy:
        meta["preparation_strategy"] = preparation_strategy
    if app_id is not None:
        meta["onboarding_application_id"] = app_id

    existing_display_name = _as_optional_text((existing or {}).get("display_name"), max_length=120)
    existing_city = _as_optional_text((existing or {}).get("city"), max_length=120)
    existing_bio = _as_optional_text((existing or {}).get("bio"), max_length=3000)
    existing_years = _parse_optional_non_negative_int((existing or {}).get("years_experience"), max_value=60)
    existing_profile_image_url = _as_optional_text((existing or {}).get("profile_image_url"), max_length=1200)
    existing_contact_url = _as_optional_text((existing or {}).get("contact_url"), max_length=1200)
    existing_public_email = _as_optional_text((existing or {}).get("public_email"), max_length=250)
    existing_headline = _as_optional_text((existing or {}).get("headline"), max_length=180)

    generated_specialization_tags = (
        _sanitize_text_list(
            [details.get("optional_subject"), *(details.get("gs_preferences") or [])],
            max_items=10,
            max_length=80,
        )
        if normalized_role == "mentor"
        else _sanitize_text_list(details.get("subject_focus"), max_items=10, max_length=80)
    )
    generated_highlights = (
        _sanitize_text_list(
            [
                current_occupation,
                f"UPSC Mains written: {details['mains_written_count']}" if details.get("mains_written_count") is not None else None,
                f"Interviews faced: {details['interview_faced_count']}" if details.get("interview_faced_count") is not None else None,
                f"Mentorship experience: {details['mentorship_years']} years" if details.get("mentorship_years") is not None else None,
            ],
            max_items=8,
            max_length=180,
        )
        if normalized_role == "mentor"
        else _sanitize_text_list(
            [
                current_occupation,
                f"UPSC Prelims cleared: {details['prelims_cleared_count']}" if details.get("prelims_cleared_count") is not None else None,
                f"Highest Prelims score: {details['highest_prelims_score']}" if details.get("highest_prelims_score") else None,
                f"Subject focus: {', '.join(details.get('subject_focus') or [])}" if details.get("subject_focus") else None,
                short_bio,
            ],
            max_items=8,
            max_length=180,
        )
    )
    generated_credentials = (
        _sanitize_text_list(
            [
                "Official UPSC Mains/Interview documents reviewed" if details.get("proof_documents") else None,
                f"Optional subject: {details['optional_subject']}" if details.get("optional_subject") else None,
                f"GS specialization: {', '.join(details.get('gs_preferences') or [])}" if details.get("gs_preferences") else None,
                "Sample evaluated copy reviewed" if details.get("sample_evaluation") else None,
            ],
            max_items=12,
            max_length=220,
        )
        if normalized_role == "mentor"
        else _sanitize_text_list(
            [
                "Official UPSC Prelims documents reviewed" if details.get("proof_documents") else None,
                f"Content focus: {', '.join(details.get('subject_focus') or [])}" if details.get("subject_focus") else None,
                "Preparation strategy published" if preparation_strategy else None,
            ],
            max_items=12,
            max_length=220,
        )
    )

    profile_payload: Dict[str, Any] = {
        "role": normalized_role,
        "display_name": existing_display_name or full_name,
        "headline": existing_headline or current_occupation or f"UPSC {role_title}",
        "bio": existing_bio or short_bio or about or derived_about,
        "years_experience": existing_years if existing_years is not None else (years_experience if years_experience is not None else derived_years_experience),
        "city": existing_city or city,
        "profile_image_url": existing_profile_image_url or profile_image_url,
        "contact_url": existing_contact_url or phone_link,
        "public_email": existing_public_email or _as_optional_text(application.get("email_snapshot"), max_length=250),
        "is_public": True,
        "is_active": True,
        "is_verified": True,
        "highlights": _sanitize_text_list((existing or {}).get("highlights") or generated_highlights, max_items=8, max_length=180),
        "credentials": _sanitize_text_list((existing or {}).get("credentials") or generated_credentials, max_items=12, max_length=220),
        "specialization_tags": _sanitize_text_list((existing or {}).get("specialization_tags") or generated_specialization_tags, max_items=14, max_length=80),
        "meta": meta,
        "updated_at": now_iso,
    }

    try:
        if existing:
            supabase.table(PROFILES_TABLE).update(profile_payload).eq("id", int(existing.get("id") or 0)).execute()
            return

        create_payload: Dict[str, Any] = {
            "user_id": user_id,
            "role": normalized_role,
            "display_name": full_name,
            "headline": f"UPSC {role_title}",
            "bio": short_bio or about or derived_about,
            "years_experience": years_experience if years_experience is not None else derived_years_experience,
            "city": city,
            "profile_image_url": profile_image_url,
            "is_public": True,
            "is_active": True,
            "is_verified": True,
            "highlights": generated_highlights,
            "credentials": generated_credentials,
            "specialization_tags": generated_specialization_tags,
            "languages": [],
            "contact_url": phone_link,
            "public_email": _as_optional_text(application.get("email_snapshot"), max_length=250),
            "meta": meta,
            "created_at": now_iso,
            "updated_at": now_iso,
        }
        supabase.table(PROFILES_TABLE).insert(create_payload).execute()
    except Exception as exc:
        _raise_profiles_migration_required(exc)


def _update_user_role_metadata(
    *,
    admin_client: Client,
    target_user_id: str,
    role: str,
    preserve_admin_flags: bool = False,
    merge_with_existing_flags: bool = False,
    keep_existing_primary_role: bool = False,
) -> AdminUserRoleRow:
    normalized_role = _as_role(role)
    if normalized_role not in MANAGED_USER_ROLES:
        allowed = ", ".join(sorted(MANAGED_USER_ROLES))
        raise HTTPException(status_code=400, detail=f"Unsupported role '{role}'. Allowed roles: {allowed}.")

    try:
        current_response = admin_client.auth.admin.get_user_by_id(target_user_id)
    except Exception as exc:
        raise HTTPException(status_code=404, detail=f"User not found: {exc}")
    current_user = getattr(current_response, "user", None)
    if not current_user:
        raise HTTPException(status_code=404, detail="User not found.")

    app_meta = getattr(current_user, "app_metadata", None) or {}
    if not isinstance(app_meta, dict):
        app_meta = {}
    app_meta = dict(app_meta)
    existing_flags = _role_flags_from_metadata(app_meta)
    existing_admin = existing_flags["admin"]
    existing_moderator = existing_flags["moderator"]
    existing_role = _as_role(app_meta.get("role"))

    if merge_with_existing_flags:
        target_flags = _build_role_flag_map(normalized_role)
        merged_flags = {
            key: bool(existing_flags.get(key)) or bool(target_flags.get(key))
            for key in ("admin", "moderator", "provider", "institute", "creator", "mentor")
        }
        app_meta.update(merged_flags)
        if (
            keep_existing_primary_role
            and existing_role
            and existing_role not in {"user", "subscriber"}
        ):
            app_meta["role"] = existing_role
        else:
            app_meta["role"] = normalized_role
    else:
        app_meta["role"] = normalized_role
        app_meta.update(_build_role_flag_map(normalized_role))

    if preserve_admin_flags:
        if existing_admin:
            app_meta["admin"] = True
        if existing_moderator:
            app_meta["moderator"] = True

    try:
        updated_response = admin_client.auth.admin.update_user_by_id(
            target_user_id,
            {"app_metadata": app_meta},
        )
    except Exception as exc:
        raise HTTPException(status_code=400, detail=f"Failed to update role: {exc}")

    updated_user = getattr(updated_response, "user", None)
    if not updated_user:
        raise HTTPException(status_code=400, detail="Role updated but updated user payload was empty.")
    return _auth_user_to_role_row(updated_user)


@router.get("/admin/users/roles", response_model=List[AdminUserRoleRow])
def list_user_roles(
    search: Optional[str] = None,
    page: int = Query(default=1, ge=1),
    per_page: int = Query(default=100, ge=1, le=1000),
    user_ctx: Dict[str, Any] = Depends(require_moderator_or_admin_user),
    supabase: Client = Depends(get_supabase_client),
):
    _ = user_ctx
    admin_client = _get_auth_admin_client(supabase)
    try:
        users = admin_client.auth.admin.list_users(page=page, per_page=per_page)
    except Exception as exc:
        raise HTTPException(status_code=503, detail=f"Failed to load auth users: {exc}")

    query = _as_role(search)
    rows: List[AdminUserRoleRow] = []
    for user in users or []:
        row = _auth_user_to_role_row(user)
        if not row.user_id:
            continue
        if query:
            haystack = " ".join([row.user_id, row.email or "", row.role]).lower()
            if query not in haystack:
                continue
        rows.append(row)
    return rows


@router.get("/admin/users/{target_user_id}/role", response_model=AdminUserRoleRow)
def get_user_role(
    target_user_id: str,
    user_ctx: Dict[str, Any] = Depends(require_moderator_or_admin_user),
    supabase: Client = Depends(get_supabase_client),
):
    _ = user_ctx
    admin_client = _get_auth_admin_client(supabase)
    try:
        response = admin_client.auth.admin.get_user_by_id(target_user_id)
    except Exception as exc:
        raise HTTPException(status_code=404, detail=f"User not found: {exc}")
    user_obj = getattr(response, "user", None)
    if not user_obj:
        raise HTTPException(status_code=404, detail="User not found.")
    return _auth_user_to_role_row(user_obj)


@router.put("/admin/users/{target_user_id}/role", response_model=AdminUserRoleRow)
def update_user_role(
    target_user_id: str,
    payload: AdminUserRoleUpdateRequest,
    user_ctx: Dict[str, Any] = Depends(require_admin_user),
    supabase: Client = Depends(get_supabase_client),
):
    _ = user_ctx
    admin_client = _get_auth_admin_client(supabase)
    return _update_user_role_metadata(
        admin_client=admin_client,
        target_user_id=target_user_id,
        role=payload.role,
        preserve_admin_flags=False,
    )


@router.post("/onboarding/assets/upload", response_model=ProfessionalOnboardingAssetResponse)
async def upload_professional_onboarding_asset(
    file: UploadFile = File(...),
    asset_kind: str = Form(...),
    user_ctx: Dict[str, Any] = Depends(require_authenticated_user),
    supabase: Client = Depends(get_supabase_client),
):
    user_id = str(user_ctx.get("user_id") or "").strip()
    if not user_id:
        raise HTTPException(status_code=401, detail="Authentication required.")

    normalized_asset_kind = str(asset_kind or "").strip().lower()
    if normalized_asset_kind not in ONBOARDING_ASSET_KINDS:
        raise HTTPException(status_code=400, detail="Unsupported asset type.")

    filename = _as_optional_text(file.filename, max_length=220) or f"{normalized_asset_kind}.bin"
    extension = os.path.splitext(filename)[1].strip().lower()
    content_type = _as_optional_text(file.content_type, max_length=120) or "application/octet-stream"
    max_bytes = ONBOARDING_ASSET_MAX_SIZE_MB * 1024 * 1024

    image_extensions = {".jpg", ".jpeg", ".png", ".webp"}
    image_content_types = {"image/jpeg", "image/png", "image/webp"}
    document_extensions = {".pdf", *image_extensions}
    document_content_types = {"application/pdf", *image_content_types}

    if normalized_asset_kind == "headshot":
        if extension not in image_extensions and content_type not in image_content_types:
            raise HTTPException(status_code=400, detail="Headshot must be JPG, PNG, or WEBP.")
    elif extension not in document_extensions and content_type not in document_content_types:
        raise HTTPException(status_code=400, detail="Document must be PDF, JPG, PNG, or WEBP.")

    file_bytes = await file.read()
    if not file_bytes:
        raise HTTPException(status_code=400, detail="Uploaded file is empty.")
    if len(file_bytes) > max_bytes:
        raise HTTPException(
            status_code=400,
            detail=f"File exceeds the {ONBOARDING_ASSET_MAX_SIZE_MB}MB upload limit.",
        )

    safe_stem = re.sub(r"[^a-zA-Z0-9_-]+", "-", os.path.splitext(filename)[0].strip()).strip("-").lower() or normalized_asset_kind
    storage_path = f"{user_id}/{normalized_asset_kind}/{uuid.uuid4().hex}-{safe_stem}{extension or ''}"
    bucket = _onboarding_bucket_for_asset_kind(normalized_asset_kind)
    storage_client = _get_auth_admin_client(supabase)

    try:
        storage_client.storage.from_(bucket).upload(
            storage_path,
            file_bytes,
            {"content-type": content_type},
        )
    except Exception as exc:
        if _is_missing_storage_bucket_error(exc):
            try:
                storage_client = _ensure_onboarding_storage_buckets(supabase)
                storage_client.storage.from_(bucket).upload(
                    storage_path,
                    file_bytes,
                    {"content-type": content_type},
                )
            except Exception as retry_exc:
                _raise_onboarding_assets_migration_required(retry_exc)
                raise HTTPException(status_code=500, detail=str(retry_exc))
        else:
            _raise_onboarding_assets_migration_required(exc)
            raise HTTPException(status_code=500, detail=str(exc))

    asset = {
        "bucket": bucket,
        "path": storage_path,
        "file_name": filename,
        "mime_type": content_type,
        "size_bytes": len(file_bytes),
        "uploaded_at": _utc_now().isoformat(),
        "asset_kind": normalized_asset_kind,
    }
    asset["url"] = _onboarding_asset_url(asset, supabase=storage_client)
    return ProfessionalOnboardingAssetResponse(**asset)


@router.post("/onboarding/applications/draft", response_model=ProfessionalOnboardingApplicationResponse)
def save_professional_onboarding_application_draft(
    payload: ProfessionalOnboardingApplicationDraftSave,
    user_ctx: Dict[str, Any] = Depends(require_authenticated_user),
    supabase: Client = Depends(get_supabase_client),
):
    user_id = str(user_ctx.get("user_id") or "").strip()
    if not user_id:
        raise HTTPException(status_code=401, detail="Authentication required.")

    desired_role = _as_role(payload.desired_role)
    if desired_role == "mentor" and _has_mains_mentor_access(user_ctx):
        raise HTTPException(status_code=400, detail="You already have Mains Mentor access.")
    if desired_role == "creator" and _has_quiz_master_access(user_ctx):
        raise HTTPException(status_code=400, detail="You already have Quiz Master access.")

    normalized_details = _normalize_onboarding_details(
        payload.details,
        user_id=user_id,
        desired_role=desired_role,
        strict=False,
    )
    now_iso = _utc_now().isoformat()
    row_payload: Dict[str, Any] = {
        "desired_role": desired_role,
        "full_name": _as_optional_text(payload.full_name, max_length=120) or "",
        "city": _as_optional_text(payload.city, max_length=120),
        "years_experience": payload.years_experience,
        "phone": _as_optional_text(payload.phone, max_length=40),
        "about": _as_optional_text(payload.about, max_length=3000),
        "details": normalized_details,
        "email_snapshot": _as_optional_text(user_ctx.get("email"), max_length=250),
        "updated_at": now_iso,
        "status": "draft",
        "reviewer_user_id": None,
        "reviewer_note": None,
        "reviewed_at": None,
    }

    try:
        draft_row = _first(
            supabase.table(ONBOARDING_REQUESTS_TABLE)
            .select("*")
            .eq("user_id", user_id)
            .eq("status", "draft")
            .eq("desired_role", desired_role)
            .order("updated_at", desc=True)
            .limit(1)
            .execute()
        )
    except Exception as exc:
        _raise_onboarding_migration_required(exc)

    try:
        if draft_row:
            saved = _first(
                supabase.table(ONBOARDING_REQUESTS_TABLE)
                .update(row_payload)
                .eq("id", int(draft_row.get("id") or 0))
                .execute()
            )
        else:
            create_payload = dict(row_payload)
            create_payload["user_id"] = user_id
            create_payload["created_at"] = now_iso
            saved = _first(supabase.table(ONBOARDING_REQUESTS_TABLE).insert(create_payload).execute())
    except Exception as exc:
        _raise_onboarding_migration_required(exc)

    if not saved:
        raise HTTPException(status_code=400, detail="Failed to save onboarding draft.")
    return _onboarding_application_response(saved, supabase=supabase)


@router.post("/onboarding/applications", response_model=ProfessionalOnboardingApplicationResponse)
def submit_professional_onboarding_application(
    payload: ProfessionalOnboardingApplicationCreate,
    user_ctx: Dict[str, Any] = Depends(require_authenticated_user),
    supabase: Client = Depends(get_supabase_client),
):
    user_id = str(user_ctx.get("user_id") or "").strip()
    if not user_id:
        raise HTTPException(status_code=401, detail="Authentication required.")

    desired_role = _as_role(payload.desired_role)
    if desired_role == "mentor":
        if _has_mains_mentor_access(user_ctx):
            raise HTTPException(status_code=400, detail="You already have Mains Mentor access.")
    if desired_role == "creator":
        if _has_quiz_master_access(user_ctx):
            raise HTTPException(status_code=400, detail="You already have Quiz Master access.")

    normalized_details = _normalize_onboarding_details(
        payload.details,
        user_id=user_id,
        desired_role=desired_role,
        strict=True,
    )
    about = _as_optional_text(payload.about, max_length=3000) or _default_onboarding_about(
        desired_role=desired_role,
        details=normalized_details,
    )
    years_experience = payload.years_experience
    if years_experience is None and desired_role == "mentor":
        years_experience = _parse_optional_non_negative_int(normalized_details.get("mentorship_years"), max_value=60)

    row_payload: Dict[str, Any] = {
        "desired_role": desired_role,
        "full_name": str(payload.full_name or "").strip(),
        "city": _as_optional_text(payload.city, max_length=120),
        "years_experience": years_experience,
        "phone": _as_optional_text(payload.phone, max_length=40),
        "about": about,
        "details": normalized_details,
        "email_snapshot": _as_optional_text(user_ctx.get("email"), max_length=250),
        "updated_at": _utc_now().isoformat(),
        "status": "pending",
        "reviewer_user_id": None,
        "reviewer_note": None,
        "reviewed_at": None,
    }

    try:
        pending_row = _first(
            supabase.table(ONBOARDING_REQUESTS_TABLE)
            .select("*")
            .eq("user_id", user_id)
            .eq("status", "pending")
            .eq("desired_role", desired_role)
            .order("updated_at", desc=True)
            .limit(1)
            .execute()
        )
    except Exception as exc:
        _raise_onboarding_migration_required(exc)

    draft_row: Optional[Dict[str, Any]] = None
    if not pending_row:
        try:
            draft_row = _first(
                supabase.table(ONBOARDING_REQUESTS_TABLE)
                .select("*")
                .eq("user_id", user_id)
                .eq("status", "draft")
                .eq("desired_role", desired_role)
                .order("updated_at", desc=True)
                .limit(1)
                .execute()
            )
        except Exception as exc:
            _raise_onboarding_migration_required(exc)

    try:
        if pending_row:
            saved = _first(
                supabase.table(ONBOARDING_REQUESTS_TABLE)
                .update(row_payload)
                .eq("id", int(pending_row.get("id") or 0))
                .execute()
            )
        elif draft_row:
            saved = _first(
                supabase.table(ONBOARDING_REQUESTS_TABLE)
                .update(row_payload)
                .eq("id", int(draft_row.get("id") or 0))
                .execute()
            )
        else:
            create_payload = dict(row_payload)
            create_payload["user_id"] = user_id
            create_payload["created_at"] = _utc_now().isoformat()
            saved = _first(supabase.table(ONBOARDING_REQUESTS_TABLE).insert(create_payload).execute())
    except Exception as exc:
        _raise_onboarding_migration_required(exc)

    if not saved:
        raise HTTPException(status_code=400, detail="Failed to submit onboarding application.")
    return _onboarding_application_response(saved, supabase=supabase)


@router.get("/onboarding/applications/me", response_model=List[ProfessionalOnboardingApplicationResponse])
def list_my_onboarding_applications(
    limit: int = Query(default=20, ge=1, le=100),
    user_ctx: Dict[str, Any] = Depends(require_authenticated_user),
    supabase: Client = Depends(get_supabase_client),
):
    user_id = str(user_ctx.get("user_id") or "").strip()
    try:
        rows = _rows(
            supabase.table(ONBOARDING_REQUESTS_TABLE)
            .select("*")
            .eq("user_id", user_id)
            .order("updated_at", desc=True)
            .order("created_at", desc=True)
            .limit(limit)
            .execute()
        )
    except Exception as exc:
        _raise_onboarding_migration_required(exc)
    return [_onboarding_application_response(row, supabase=supabase) for row in rows]


@router.get("/admin/onboarding/applications", response_model=List[ProfessionalOnboardingApplicationResponse])
def list_onboarding_applications_for_review(
    status: str = Query(default="pending", pattern="^(pending|approved|rejected|all)$"),
    desired_role: Optional[str] = Query(default=None, pattern="^(mentor|creator)$"),
    limit: int = Query(default=200, ge=1, le=1000),
    user_ctx: Dict[str, Any] = Depends(require_moderator_or_admin_user),
    supabase: Client = Depends(get_supabase_client),
):
    _ = user_ctx
    try:
        query = (
            supabase.table(ONBOARDING_REQUESTS_TABLE)
            .select("*")
            .order("updated_at", desc=True)
            .order("created_at", desc=True)
            .limit(limit)
        )
        if status != "all":
            query = query.eq("status", status)
        if desired_role:
            query = query.eq("desired_role", _as_role(desired_role))
        rows = _rows(query.execute())
    except Exception as exc:
        _raise_onboarding_migration_required(exc)
    return [_onboarding_application_response(row, supabase=supabase) for row in rows]


@router.put("/admin/onboarding/applications/{application_id}/review", response_model=ProfessionalOnboardingApplicationResponse)
def review_onboarding_application(
    application_id: int,
    payload: ProfessionalOnboardingApplicationReview,
    user_ctx: Dict[str, Any] = Depends(require_moderator_or_admin_user),
    supabase: Client = Depends(get_supabase_client),
):
    reviewer_user_id = str(user_ctx.get("user_id") or "").strip()
    if not reviewer_user_id:
        raise HTTPException(status_code=401, detail="Authentication required.")

    try:
        existing = _first(
            supabase.table(ONBOARDING_REQUESTS_TABLE)
            .select("*")
            .eq("id", application_id)
            .limit(1)
            .execute()
        )
    except Exception as exc:
        _raise_onboarding_migration_required(exc)
    if not existing:
        raise HTTPException(status_code=404, detail="Onboarding application not found.")

    current_status = _as_role(existing.get("status") or "pending")
    if current_status != "pending":
        raise HTTPException(status_code=400, detail="Only pending applications can be reviewed.")

    action = _as_role(payload.action)
    now_iso = _utc_now().isoformat()
    updates: Dict[str, Any] = {
        "status": "approved" if action == "approve" else "rejected",
        "reviewer_user_id": reviewer_user_id,
        "reviewer_note": _as_optional_text(payload.reviewer_note, max_length=1200),
        "reviewed_at": now_iso,
        "updated_at": now_iso,
    }

    if action == "approve":
        desired_role = _as_role(existing.get("desired_role") or "")
        if desired_role not in {"mentor", "creator"}:
            raise HTTPException(status_code=400, detail="Unsupported requested role on application.")
        _upsert_professional_profile_from_onboarding(
            supabase=supabase,
            application=existing,
            desired_role=desired_role,
        )
        admin_client = _get_auth_admin_client(supabase)
        _update_user_role_metadata(
            admin_client=admin_client,
            target_user_id=str(existing.get("user_id") or "").strip(),
            role=desired_role,
            preserve_admin_flags=True,
            merge_with_existing_flags=True,
            keep_existing_primary_role=True,
        )

    try:
        saved = _first(
            supabase.table(ONBOARDING_REQUESTS_TABLE)
            .update(updates)
            .eq("id", application_id)
            .execute()
        )
    except Exception as exc:
        _raise_onboarding_migration_required(exc)

    if not saved:
        raise HTTPException(status_code=400, detail="Failed to update onboarding application.")
    return _onboarding_application_response(saved, supabase=supabase)


def require_generation_access(
    user_ctx: Optional[Dict[str, Any]] = Depends(get_user_context),
) -> Dict[str, Any]:
    if not user_ctx:
        raise HTTPException(status_code=401, detail="Authentication required.")
    if not _is_generation_subscription_enforced():
        return user_ctx
    if not _is_active_subscription(user_ctx):
        raise HTTPException(status_code=403, detail="Active subscription required for AI generation.")
    return user_ctx


def require_quiz_generation_access(
    user_ctx: Optional[Dict[str, Any]] = Depends(get_user_context),
) -> Dict[str, Any]:
    if not user_ctx:
        raise HTTPException(status_code=401, detail="Authentication required.")
    if user_ctx.get("is_admin"):
        return user_ctx

    if _is_quiz_master_like_user(user_ctx):
        if not _is_quiz_master_generation_subscription_enforced():
            return user_ctx
        if _is_active_quiz_master_generation_subscription(user_ctx):
            return user_ctx
        raise HTTPException(status_code=403, detail="Active Quiz Master AI subscription required for AI generation.")

    if not _is_generation_subscription_enforced():
        return user_ctx
    if not _is_active_subscription(user_ctx):
        raise HTTPException(status_code=403, detail="Active subscription required for AI generation.")
    return user_ctx


def require_mains_generation_access(
    user_ctx: Optional[Dict[str, Any]] = Depends(get_user_context),
) -> Dict[str, Any]:
    if not user_ctx:
        raise HTTPException(status_code=401, detail="Authentication required.")
    if user_ctx.get("is_admin"):
        return user_ctx

    if _is_mains_mentor_like_user(user_ctx):
        if not _is_mains_mentor_generation_subscription_enforced():
            return user_ctx
        if _is_active_mains_mentor_generation_subscription(user_ctx):
            return user_ctx
        raise HTTPException(status_code=403, detail="Active Mains Mentor AI subscription required for AI generation.")

    if not _is_generation_subscription_enforced():
        return user_ctx
    if not _is_active_subscription(user_ctx):
        raise HTTPException(status_code=403, detail="Active subscription required for AI generation.")
    return user_ctx


def _raise_exams_migration_required(exc: Exception) -> None:
    logger.warning("exams schema check failed: %s", exc)
    raise HTTPException(status_code=503, detail=EXAMS_MIGRATION_HINT)


def _raise_draft_quizzes_migration_required(exc: Exception) -> None:
    logger.warning("premium_ai_draft_quizzes schema check failed: %s", exc)
    raise HTTPException(status_code=503, detail=DRAFT_QUIZZES_MIGRATION_HINT)


def _raise_draft_quizzes_ownership_migration_required(exc: Exception) -> None:
    logger.warning("premium_ai_draft_quizzes ownership schema check failed: %s", exc)
    raise HTTPException(status_code=503, detail=DRAFT_QUIZZES_OWNERSHIP_MIGRATION_HINT)


def _raise_category_ai_sources_migration_required(exc: Exception) -> None:
    logger.warning("category_ai_sources schema check failed: %s", exc)
    raise HTTPException(status_code=503, detail=CATEGORY_AI_SOURCES_MIGRATION_HINT)


def _raise_mains_categories_migration_required(exc: Exception) -> None:
    logger.warning("mains category schema check failed: %s", exc)
    raise HTTPException(status_code=503, detail=MAINS_CATEGORIES_MIGRATION_HINT)


def _raise_uploaded_pdfs_migration_required(exc: Exception) -> None:
    logger.warning("uploaded_pdfs schema check failed: %s", exc)
    raise HTTPException(status_code=503, detail=UPLOADED_PDFS_MIGRATION_HINT)


def _raise_challenges_migration_required(exc: Exception) -> None:
    logger.warning("challenge schema check failed: %s", exc)
    raise HTTPException(status_code=503, detail=CHALLENGES_MIGRATION_HINT)


def _is_missing_table_like_error(exc: Exception, table_name: str) -> bool:
    text = str(exc).lower()
    lowered = table_name.lower()
    if _is_missing_table_error(exc, table_name):
        return True
    return (
        lowered in text
        and (
            "does not exist" in text
            or "relation" in text
            or "not found" in text
            or "undefined table" in text
        )
    )


def _warn_user_hint_table_missing(exc: Exception) -> None:
    global _USER_AI_HINTS_TABLE_WARNING_EMITTED
    if _USER_AI_HINTS_TABLE_WARNING_EMITTED:
        return
    _USER_AI_HINTS_TABLE_WARNING_EMITTED = True
    logger.warning("user_ai_quiz_hints schema check failed: %s", exc)
    logger.warning(USER_AI_QUIZ_HINTS_MIGRATION_HINT)


@dataclass
class _MixPreviewTaskRuntime:
    plan_id: str
    title: str
    requested_count: int
    example_analysis_id: int
    user_instructions: Optional[str]
    formatting_instruction_text: Optional[str]
    max_attempts: int
    status: str = "pending"
    attempt: int = 0
    produced_count: int = 0
    error: Optional[str] = None


@dataclass
class _MixPreviewJobRuntime:
    job_id: str
    owner_user_id: str
    quiz_kind: QuizKind
    content_type: AISystemInstructionContentType
    created_at: datetime
    updated_at: datetime
    status: str = "queued"
    tasks: List[_MixPreviewTaskRuntime] = field(default_factory=list)
    parsed_quiz_data: Optional[Dict[str, Any]] = None
    warnings: List[str] = field(default_factory=list)
    error: Optional[str] = None
    finished_at: Optional[datetime] = None


class _MixPreviewJobStore:
    def __init__(self, *, max_concurrent_jobs: int, ttl_seconds: int) -> None:
        self._jobs: Dict[str, _MixPreviewJobRuntime] = {}
        self._lock = asyncio.Lock()
        self._semaphore = asyncio.Semaphore(max_concurrent_jobs)
        self._ttl = timedelta(seconds=ttl_seconds)

    @staticmethod
    def _now() -> datetime:
        return datetime.now(timezone.utc)

    @staticmethod
    def _to_iso(value: Optional[datetime]) -> Optional[str]:
        return value.isoformat() if value else None

    def _cleanup_expired_locked(self, now: datetime) -> None:
        stale_ids: List[str] = []
        for job_id, job in self._jobs.items():
            if not job.finished_at:
                continue
            if now - job.finished_at > self._ttl:
                stale_ids.append(job_id)
        for job_id in stale_ids:
            self._jobs.pop(job_id, None)

    def _status_view(self, job: _MixPreviewJobRuntime) -> PremiumPreviewMixJobStatusResponse:
        completed = sum(1 for task in job.tasks if task.status == "completed")
        failed = sum(1 for task in job.tasks if task.status == "failed")
        expires_at = None
        if job.finished_at:
            expires_at = self._to_iso(job.finished_at + self._ttl)
        return PremiumPreviewMixJobStatusResponse(
            job_id=job.job_id,
            status=job.status,
            total_tasks=len(job.tasks),
            completed_tasks=completed,
            failed_tasks=failed,
            tasks=[
                PremiumPreviewMixJobTaskStatus(
                    plan_id=task.plan_id,
                    title=task.title,
                    requested_count=task.requested_count,
                    status=task.status,
                    attempt=task.attempt,
                    max_attempts=task.max_attempts,
                    produced_count=task.produced_count,
                    error=task.error,
                )
                for task in job.tasks
            ],
            parsed_quiz_data=job.parsed_quiz_data,
            warnings=list(job.warnings),
            error=job.error,
            created_at=job.created_at.isoformat(),
            updated_at=job.updated_at.isoformat(),
            finished_at=self._to_iso(job.finished_at),
            expires_at=expires_at,
        )

    async def create_job(
        self,
        *,
        owner_user_id: str,
        quiz_kind: QuizKind,
        content_type: AISystemInstructionContentType,
        plans: List[PremiumPreviewMixPlanTask],
        max_attempts: int,
    ) -> _MixPreviewJobRuntime:
        now = self._now()
        job_id = uuid.uuid4().hex
        tasks = [
            _MixPreviewTaskRuntime(
                plan_id=plan.plan_id,
                title=(plan.title or f"Format {index + 1}").strip(),
                requested_count=plan.desired_question_count,
                example_analysis_id=plan.example_analysis_id,
                user_instructions=plan.user_instructions,
                formatting_instruction_text=plan.formatting_instruction_text,
                max_attempts=max_attempts,
            )
            for index, plan in enumerate(plans)
        ]
        job = _MixPreviewJobRuntime(
            job_id=job_id,
            owner_user_id=owner_user_id,
            quiz_kind=quiz_kind,
            content_type=content_type,
            created_at=now,
            updated_at=now,
            tasks=tasks,
        )
        async with self._lock:
            self._cleanup_expired_locked(now)
            self._jobs[job_id] = job
        return job

    async def get_job(self, job_id: str) -> Optional[_MixPreviewJobRuntime]:
        async with self._lock:
            self._cleanup_expired_locked(self._now())
            return self._jobs.get(job_id)

    async def get_status_view(self, job_id: str) -> Optional[PremiumPreviewMixJobStatusResponse]:
        async with self._lock:
            self._cleanup_expired_locked(self._now())
            job = self._jobs.get(job_id)
            return self._status_view(job) if job else None

    async def mark_running(self, job_id: str) -> Optional[_MixPreviewJobRuntime]:
        async with self._lock:
            job = self._jobs.get(job_id)
            if not job:
                return None
            job.status = "running"
            job.updated_at = self._now()
            return job

    async def mark_task_update(
        self,
        *,
        job_id: str,
        plan_id: str,
        status: str,
        attempt: int,
        error: Optional[str] = None,
        produced_count: Optional[int] = None,
    ) -> None:
        async with self._lock:
            job = self._jobs.get(job_id)
            if not job:
                return
            for task in job.tasks:
                if task.plan_id != plan_id:
                    continue
                task.status = status
                task.attempt = attempt
                task.error = error
                if produced_count is not None:
                    task.produced_count = produced_count
                break
            job.updated_at = self._now()

    async def mark_finished(
        self,
        *,
        job_id: str,
        status: str,
        parsed_quiz_data: Optional[Dict[str, Any]],
        warnings: Optional[List[str]] = None,
        error: Optional[str] = None,
    ) -> None:
        async with self._lock:
            job = self._jobs.get(job_id)
            if not job:
                return
            now = self._now()
            job.status = status
            job.parsed_quiz_data = parsed_quiz_data
            job.warnings = warnings or []
            job.error = error
            job.finished_at = now
            job.updated_at = now

    async def run_job(
        self,
        *,
        job_id: str,
        task_runner: Any,
        payload_builder: Any,
    ) -> None:
        async with self._semaphore:
            job = await self.mark_running(job_id)
            if not job:
                return

            aggregate_items: List[Dict[str, Any]] = []
            warnings: List[str] = []
            for task in list(job.tasks):
                success = False
                for attempt in range(1, task.max_attempts + 1):
                    await self.mark_task_update(
                        job_id=job_id,
                        plan_id=task.plan_id,
                        status="retrying" if attempt > 1 else "running",
                        attempt=attempt,
                        error=None,
                    )
                    try:
                        items = await asyncio.wait_for(
                            task_runner(task),
                            timeout=MIX_PREVIEW_TASK_TIMEOUT_SECONDS,
                        )
                        if not items:
                            raise RuntimeError("No valid questions were generated.")
                        aggregate_items.extend(items)
                        await self.mark_task_update(
                            job_id=job_id,
                            plan_id=task.plan_id,
                            status="completed",
                            attempt=attempt,
                            error=None,
                            produced_count=_count_generated_questions(items),
                        )
                        success = True
                        break
                    except Exception as exc:
                        message = str(exc) or "Unknown generation error"
                        if attempt < task.max_attempts:
                            await self.mark_task_update(
                                job_id=job_id,
                                plan_id=task.plan_id,
                                status="retrying",
                                attempt=attempt,
                                error=f"Retrying: {message}",
                            )
                            await asyncio.sleep(min(2.0, 0.35 * attempt))
                            continue
                        await self.mark_task_update(
                            job_id=job_id,
                            plan_id=task.plan_id,
                            status="failed",
                            attempt=attempt,
                            error=message,
                        )
                        warnings.append(f"{task.title}: {message}")
                if not success:
                    continue

            final_job = await self.get_job(job_id)
            if not final_job:
                return

            failed_tasks = sum(1 for task in final_job.tasks if task.status == "failed")
            completed_tasks = sum(1 for task in final_job.tasks if task.status == "completed")

            if not aggregate_items:
                await self.mark_finished(
                    job_id=job_id,
                    status="failed",
                    parsed_quiz_data=None,
                    warnings=warnings,
                    error="All mix-plan tasks failed.",
                )
                return

            try:
                parsed_quiz_data = payload_builder(aggregate_items)
            except Exception as exc:
                await self.mark_finished(
                    job_id=job_id,
                    status="failed",
                    parsed_quiz_data=None,
                    warnings=warnings,
                    error=str(exc) or "Failed to build preview payload.",
                )
                return
            if completed_tasks > 0 and failed_tasks == 0:
                await self.mark_finished(
                    job_id=job_id,
                    status="completed",
                    parsed_quiz_data=parsed_quiz_data,
                    warnings=warnings,
                )
                return

            await self.mark_finished(
                job_id=job_id,
                status="partial",
                parsed_quiz_data=parsed_quiz_data,
                warnings=warnings,
                error="Some tasks failed after retries.",
            )


mix_preview_jobs = _MixPreviewJobStore(
    max_concurrent_jobs=MIX_PREVIEW_MAX_CONCURRENT_JOBS,
    ttl_seconds=MIX_PREVIEW_JOB_TTL_SECONDS,
)


def _normalize_label(value: Optional[str]) -> str:
    label = (value or "").strip().upper()
    if label in {"A", "B", "C", "D", "E"}:
        return label
    return label[:1] if label else "A"


def _category_type_from_quiz_type(quiz_type: str) -> str:
    normalized = (quiz_type or "").strip().lower()
    mapped = QUIZ_TYPE_TO_CATEGORY_TYPE.get(normalized)
    if not mapped:
        raise HTTPException(status_code=400, detail=f"Unsupported quiz type: {quiz_type}")
    return mapped


def _normalize_exam_ids(raw_ids: Any) -> List[int]:
    if not isinstance(raw_ids, list):
        return []
    output: List[int] = []
    for value in raw_ids:
        try:
            ivalue = int(value)
        except (TypeError, ValueError):
            continue
        if ivalue not in output:
            output.append(ivalue)
    return output


def _normalize_tag_value(value: Any) -> Optional[str]:
    normalized = str(value or "").strip().lower()
    return normalized or None


def _validate_tag_hierarchy(tag_level1: Any, tag_level2: Any) -> Tuple[Optional[str], Optional[str]]:
    normalized_l1 = _normalize_tag_value(tag_level1)
    normalized_l2 = _normalize_tag_value(tag_level2)
    if normalized_l2 and not normalized_l1:
        raise HTTPException(status_code=400, detail="tag_level1 is required when tag_level2 is provided.")
    return normalized_l1, normalized_l2


_CATEGORY_TOKEN_STOPWORDS: Set[str] = {
    "and",
    "for",
    "the",
    "with",
    "from",
    "into",
    "about",
    "under",
    "over",
    "after",
    "before",
    "than",
    "that",
    "this",
    "those",
    "these",
    "which",
    "whose",
    "where",
    "when",
    "while",
    "topic",
    "topics",
    "chapter",
    "chapters",
    "section",
    "sections",
    "subject",
    "subjects",
}


def _quiz_kind_from_content_item_type(content_type: Any) -> Optional[QuizKind]:
    value = str(content_type or "").strip().lower()
    if value == ContentType.QUIZ_GK.value:
        return QuizKind.GK
    if value == ContentType.QUIZ_MATHS.value:
        return QuizKind.MATHS
    if value == ContentType.QUIZ_PASSAGE.value:
        return QuizKind.PASSAGE
    return None


def _category_type_for_quiz_kind(quiz_kind: QuizKind) -> str:
    if quiz_kind == QuizKind.GK:
        return CategoryType.GK.value
    if quiz_kind == QuizKind.MATHS:
        return CategoryType.MATHS.value
    return CategoryType.PASSAGE.value


def _normalized_source_kind(value: Any) -> str:
    normalized = str(value or "").strip().lower()
    if normalized in {"text", "url", "content_item"}:
        return normalized
    return "text"


def _flatten_source_text_chunks(value: Any, output: List[str], depth: int = 0) -> None:
    if depth > 4:
        return
    if isinstance(value, str):
        cleaned = re.sub(r"\s+", " ", value).strip()
        if cleaned:
            output.append(cleaned)
        return
    if isinstance(value, list):
        for item in value[:60]:
            _flatten_source_text_chunks(item, output, depth + 1)
        return
    if isinstance(value, dict):
        for key in (
            "title",
            "question_text",
            "question_statement",
            "passage_title",
            "passage_text",
            "content",
            "body",
            "text",
            "description",
            "summary",
            "answer_approach",
            "model_answer",
            "source_reference",
            "source",
        ):
            if key in value:
                _flatten_source_text_chunks(value.get(key), output, depth + 1)
        for key, item in list(value.items())[:40]:
            if key in {
                "title",
                "question_text",
                "question_statement",
                "passage_title",
                "passage_text",
                "content",
                "body",
                "text",
                "description",
                "summary",
                "answer_approach",
                "model_answer",
                "source_reference",
                "source",
            }:
                continue
            _flatten_source_text_chunks(item, output, depth + 1)


def _source_text_from_content_item_row(content_item_row: Dict[str, Any]) -> str:
    data = content_item_row.get("data")
    if not isinstance(data, dict):
        data = {}
    content_type_value = str(content_item_row.get("type") or "").strip().lower()
    quiz_kind = _quiz_kind_from_content_item_type(content_type_value)
    if quiz_kind is not None:
        text = _content_data_match_text(data, quiz_kind)
        if text.strip():
            return text.strip()

    chunks: List[str] = []
    title = str(content_item_row.get("title") or "").strip()
    if title:
        chunks.append(title)
    _flatten_source_text_chunks(data, chunks)
    merged = "\n".join(chunks).strip()
    return merged[:18000] if len(merged) > 18000 else merged


def _resolve_category_source_text_from_row(row: Dict[str, Any], *, supabase: Client) -> str:
    kind = _normalized_source_kind(row.get("source_kind"))
    source_url = str(row.get("source_url") or "").strip()
    explicit_text = str(row.get("source_text") or "").strip()
    if explicit_text:
        if kind == "url" or source_url:
            normalized_explicit = _normalize_extracted_source_text(explicit_text)
            if normalized_explicit:
                return normalized_explicit
        return explicit_text

    source_html = str(row.get("source_content_html") or "").strip()
    if source_html:
        extracted = _extract_text_from_html(source_html)
        if extracted:
            return extracted

    if kind == "url" and source_url:
        fetched = _fetch_url_content(source_url)
        if fetched:
            return fetched

    if kind == "content_item" and row.get("content_item_id") is not None:
        try:
            content_item_id = int(row.get("content_item_id"))
        except (TypeError, ValueError):
            content_item_id = 0
        if content_item_id > 0:
            content_row = _safe_first(
                supabase.table("content_items")
                .select("id, title, type, data")
                .eq("id", content_item_id)
                .limit(1)
            )
            if content_row:
                extracted = _source_text_from_content_item_row(content_row)
                if extracted:
                    return extracted

    if source_url:
        fetched = _fetch_url_content(source_url)
        if fetched:
            return fetched

    return ""


def _expand_category_ids_with_descendants(
    category_ids: List[int],
    *,
    category_type: str,
    supabase: Client,
) -> Tuple[List[int], Dict[int, str]]:
    requested_ids = _normalize_exam_ids(category_ids)
    if not requested_ids:
        return [], {}

    rows = _safe_rows(
        supabase.table("categories")
        .select("id, name, parent_id")
        .eq("type", category_type)
        .eq("is_active", True)
        .order("name")
        .limit(4000)
    )
    if not rows:
        return [], {}

    names_by_id: Dict[int, str] = {}
    children_by_parent: Dict[Optional[int], List[int]] = {}
    for row in rows:
        try:
            row_id = int(row.get("id"))
        except (TypeError, ValueError):
            continue
        names_by_id[row_id] = str(row.get("name") or f"Category {row_id}")
        parent_raw = row.get("parent_id")
        try:
            parent_id = int(parent_raw) if parent_raw is not None else None
        except (TypeError, ValueError):
            parent_id = None
        children_by_parent.setdefault(parent_id, []).append(row_id)

    output: List[int] = []
    queue: List[int] = [row_id for row_id in requested_ids if row_id in names_by_id]
    while queue:
        current = queue.pop(0)
        if current in output:
            continue
        output.append(current)
        for child_id in children_by_parent.get(current, []):
            if child_id not in output:
                queue.append(child_id)
    return output, names_by_id


def _resolve_quiz_category_source_content(
    *,
    category_ids: List[int],
    quiz_kind: QuizKind,
    supabase: Client,
) -> Tuple[str, Dict[str, Any]]:
    requested_ids = _normalize_exam_ids(category_ids)
    if not requested_ids:
        raise HTTPException(status_code=400, detail="At least one category is required in category source mode.")

    category_type = _category_type_for_quiz_kind(quiz_kind)
    expanded_ids, names_by_id = _expand_category_ids_with_descendants(
        requested_ids,
        category_type=category_type,
        supabase=supabase,
    )
    if not expanded_ids:
        raise HTTPException(status_code=400, detail="Selected categories are invalid for this quiz type.")

    try:
        source_rows = _safe_rows(
            supabase.table(CATEGORY_AI_SOURCES_TABLE)
            .select("*")
            .in_("category_id", expanded_ids)
            .eq("is_active", True)
            .order("priority", desc=True)
            .order("id", desc=True)
            .limit(CATEGORY_SOURCE_MAX_SOURCES)
        )
    except Exception as exc:
        if _is_missing_table_like_error(exc, CATEGORY_AI_SOURCES_TABLE):
            _raise_category_ai_sources_migration_required(exc)
        raise

    sections: List[str] = []
    source_ids: List[int] = []
    for row in source_rows:
        text = _resolve_category_source_text_from_row(row, supabase=supabase).strip()
        if not text:
            continue
        try:
            source_id = int(row.get("id"))
        except (TypeError, ValueError):
            source_id = 0
        try:
            category_id = int(row.get("category_id"))
        except (TypeError, ValueError):
            category_id = 0
        category_name = names_by_id.get(category_id, f"Category {category_id}") if category_id else "Category"
        title = str(row.get("title") or f"Source {source_id or len(sections) + 1}").strip()
        section_header = f"[{category_name}] {title}".strip()
        sections.append(f"{section_header}\n{text}")
        if source_id > 0:
            source_ids.append(source_id)

    if not sections:
        raise HTTPException(
            status_code=404,
            detail="No active source material is attached to the selected categories.",
        )

    merged = "Category Linked Source Material (Primary Context):\n\n" + "\n\n---\n\n".join(sections)
    if len(merged) > CATEGORY_SOURCE_MAX_CHARS:
        merged = merged[:CATEGORY_SOURCE_MAX_CHARS].rstrip() + "\n\n[Truncated due to size]"
    return merged, {
        "requested_category_ids": requested_ids,
        "resolved_category_ids": expanded_ids,
        "source_ids": source_ids,
    }


def _category_ai_source_view(row: Dict[str, Any]) -> Dict[str, Any]:
    return {
        "id": int(row["id"]),
        "category_id": int(row.get("category_id") or 0),
        "source_kind": _normalized_source_kind(row.get("source_kind")),
        "title": row.get("title"),
        "source_url": row.get("source_url"),
        "source_text": row.get("source_text"),
        "source_content_html": row.get("source_content_html"),
        "content_item_id": row.get("content_item_id"),
        "priority": int(row.get("priority") or 0),
        "is_active": bool(row.get("is_active", True)),
        "meta": row.get("meta") if isinstance(row.get("meta"), dict) else {},
        "created_by": str(row.get("created_by")) if row.get("created_by") else None,
        "created_at": str(row.get("created_at") or ""),
        "updated_at": str(row.get("updated_at")) if row.get("updated_at") else None,
    }


def _mains_category_view(row: Dict[str, Any]) -> Dict[str, Any]:
    return {
        "id": int(row["id"]),
        "name": str(row.get("name") or ""),
        "slug": row.get("slug"),
        "description": row.get("description"),
        "parent_id": row.get("parent_id"),
        "is_active": bool(row.get("is_active", True)),
        "meta": row.get("meta") if isinstance(row.get("meta"), dict) else {},
        "created_at": str(row.get("created_at") or ""),
        "updated_at": str(row.get("updated_at")) if row.get("updated_at") else None,
    }


def _build_mains_category_tree(rows: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    nodes: Dict[int, Dict[str, Any]] = {}
    for row in rows:
        try:
            node_id = int(row.get("id"))
        except (TypeError, ValueError):
            continue
        nodes[node_id] = {**row, "children": []}
    roots: List[Dict[str, Any]] = []
    for node in nodes.values():
        parent_raw = node.get("parent_id")
        try:
            parent_id = int(parent_raw) if parent_raw is not None else None
        except (TypeError, ValueError):
            parent_id = None
        if parent_id is None or parent_id not in nodes:
            roots.append(node)
            continue
        nodes[parent_id]["children"].append(node)
    return roots


def _mains_category_source_view(row: Dict[str, Any]) -> Dict[str, Any]:
    return {
        "id": int(row["id"]),
        "mains_category_id": int(row.get("mains_category_id") or 0),
        "source_kind": _normalized_source_kind(row.get("source_kind")),
        "title": row.get("title"),
        "source_url": row.get("source_url"),
        "source_text": row.get("source_text"),
        "source_content_html": row.get("source_content_html"),
        "content_item_id": row.get("content_item_id"),
        "priority": int(row.get("priority") or 0),
        "is_active": bool(row.get("is_active", True)),
        "meta": row.get("meta") if isinstance(row.get("meta"), dict) else {},
        "created_by": str(row.get("created_by")) if row.get("created_by") else None,
        "created_at": str(row.get("created_at") or ""),
        "updated_at": str(row.get("updated_at")) if row.get("updated_at") else None,
    }


def _expand_mains_category_ids_with_descendants(
    mains_category_ids: List[int],
    *,
    supabase: Client,
) -> Tuple[List[int], Dict[int, str]]:
    requested_ids = _normalize_exam_ids(mains_category_ids)
    if not requested_ids:
        return [], {}
    try:
        rows = _safe_rows(
            supabase.table(MAINS_CATEGORIES_TABLE)
            .select("id, name, parent_id")
            .eq("is_active", True)
            .order("name")
            .limit(4000)
        )
    except Exception as exc:
        if _is_missing_table_like_error(exc, MAINS_CATEGORIES_TABLE):
            _raise_mains_categories_migration_required(exc)
        raise
    names_by_id: Dict[int, str] = {}
    children_by_parent: Dict[Optional[int], List[int]] = {}
    for row in rows:
        try:
            row_id = int(row.get("id"))
        except (TypeError, ValueError):
            continue
        names_by_id[row_id] = str(row.get("name") or f"Mains Category {row_id}")
        parent_raw = row.get("parent_id")
        try:
            parent_id = int(parent_raw) if parent_raw is not None else None
        except (TypeError, ValueError):
            parent_id = None
        children_by_parent.setdefault(parent_id, []).append(row_id)

    output: List[int] = []
    queue: List[int] = [row_id for row_id in requested_ids if row_id in names_by_id]
    while queue:
        current = queue.pop(0)
        if current in output:
            continue
        output.append(current)
        for child_id in children_by_parent.get(current, []):
            if child_id not in output:
                queue.append(child_id)
    return output, names_by_id


def _resolve_mains_category_source_content(
    *,
    mains_category_ids: List[int],
    supabase: Client,
) -> Tuple[str, Dict[str, Any]]:
    requested_ids = _normalize_exam_ids(mains_category_ids)
    if not requested_ids:
        raise HTTPException(status_code=400, detail="At least one mains category is required in mains category source mode.")

    expanded_ids, names_by_id = _expand_mains_category_ids_with_descendants(
        requested_ids,
        supabase=supabase,
    )
    if not expanded_ids:
        raise HTTPException(status_code=400, detail="Selected mains categories are invalid.")

    try:
        source_rows = _safe_rows(
            supabase.table(MAINS_CATEGORY_SOURCES_TABLE)
            .select("*")
            .in_("mains_category_id", expanded_ids)
            .eq("is_active", True)
            .order("priority", desc=True)
            .order("id", desc=True)
            .limit(MAINS_CATEGORY_SOURCE_MAX_SOURCES)
        )
    except Exception as exc:
        if _is_missing_table_like_error(exc, MAINS_CATEGORY_SOURCES_TABLE):
            _raise_mains_categories_migration_required(exc)
        raise

    sections: List[str] = []
    source_ids: List[int] = []
    for row in source_rows:
        text = _resolve_category_source_text_from_row(row, supabase=supabase).strip()
        if not text:
            continue
        try:
            source_id = int(row.get("id"))
        except (TypeError, ValueError):
            source_id = 0
        try:
            category_id = int(row.get("mains_category_id"))
        except (TypeError, ValueError):
            category_id = 0
        category_name = names_by_id.get(category_id, f"Mains Category {category_id}") if category_id else "Mains Category"
        title = str(row.get("title") or f"Source {source_id or len(sections) + 1}").strip()
        sections.append(f"[{category_name}] {title}\n{text}")
        if source_id > 0:
            source_ids.append(source_id)

    if not sections:
        raise HTTPException(
            status_code=404,
            detail="No active source material is attached to the selected mains categories.",
        )

    merged = "Mains Category Linked Source Material (Primary Context):\n\n" + "\n\n---\n\n".join(sections)
    if len(merged) > MAINS_CATEGORY_SOURCE_MAX_CHARS:
        merged = merged[:MAINS_CATEGORY_SOURCE_MAX_CHARS].rstrip() + "\n\n[Truncated due to size]"
    return merged, {
        "requested_mains_category_ids": requested_ids,
        "resolved_mains_category_ids": expanded_ids,
        "source_ids": source_ids,
    }


def _split_hint_values(raw: Any) -> List[str]:
    if isinstance(raw, str):
        return [part.strip() for part in re.split(r"[,\n;/|]+", raw) if part and part.strip()]
    if isinstance(raw, list):
        values: List[str] = []
        for item in raw:
            if item is None:
                continue
            text = str(item).strip()
            if text:
                values.append(text)
        return values
    return []


def _normalize_hint_phrases(values: List[str]) -> List[str]:
    unique: List[str] = []
    seen: Set[str] = set()
    for phrase in values:
        normalized = re.sub(r"\s+", " ", str(phrase or "").strip().lower())
        if len(normalized) < 3 or normalized in seen:
            continue
        seen.add(normalized)
        unique.append(normalized)
    return unique


def _hint_phrases_from_meta(meta: Any) -> List[str]:
    phrases: List[str] = []
    if isinstance(meta, dict):
        for key in ("keywords", "tags", "aliases", "topics", "subtopics"):
            phrases.extend(_split_hint_values(meta.get(key)))
    return phrases


def _category_hint_phrases(row: Dict[str, Any]) -> List[str]:
    phrases: List[str] = []
    name = str(row.get("name") or "").strip()
    if name:
        phrases.append(name)
    slug = str(row.get("slug") or "").strip()
    if slug:
        phrases.append(slug.replace("-", " "))
    description = str(row.get("description") or "").strip()
    if description:
        phrases.append(description)
    phrases.extend(_hint_phrases_from_meta(row.get("meta") or {}))
    return _normalize_hint_phrases(phrases)


def _mains_category_hint_phrases(row: Dict[str, Any]) -> List[str]:
    phrases: List[str] = []
    name = str(row.get("name") or "").strip()
    if name:
        phrases.append(name)
    slug = str(row.get("slug") or "").strip()
    if slug:
        phrases.append(slug.replace("-", " "))
    description = str(row.get("description") or "").strip()
    if description:
        phrases.append(description)
    phrases.extend(_hint_phrases_from_meta(row.get("meta") or {}))
    return _normalize_hint_phrases(phrases)


def _source_url_hint_text(raw_url: Any) -> str:
    candidate = _normalize_source_url(raw_url)
    if not candidate:
        return ""
    parsed = urlparse(candidate)
    parts = [parsed.netloc or "", parsed.path.replace("/", " "), parsed.query.replace("&", " ")]
    merged = " ".join(part for part in parts if part).replace("-", " ")
    merged = re.sub(r"[^a-z0-9.\s]", " ", merged.lower())
    return re.sub(r"\s+", " ", merged).strip()


def _stored_source_hint_text_from_row(row: Dict[str, Any], *, max_chars: int = 1200) -> str:
    chunks: List[str] = []
    title = str(row.get("title") or "").strip()
    if title:
        chunks.append(title)

    explicit_text = _normalize_extracted_source_text(row.get("source_text"), max_chars=max_chars)
    if explicit_text:
        chunks.append(explicit_text)

    source_html = str(row.get("source_content_html") or "").strip()
    if source_html:
        extracted_html = _extract_text_from_html(source_html, max_chars=max_chars)
        if extracted_html:
            chunks.append(extracted_html)

    url_hint = _source_url_hint_text(row.get("source_url"))
    if url_hint:
        chunks.append(url_hint)

    chunks.extend(_hint_phrases_from_meta(row.get("meta") or {}))
    merged = "\n".join(part for part in chunks if str(part or "").strip()).strip()
    if len(merged) > max_chars:
        return merged[:max_chars].rstrip()
    return merged


def _taxonomy_source_hint_map(
    *,
    source_table: str,
    foreign_key: str,
    category_ids: List[int],
    supabase: Client,
    max_sources_per_category: int = 2,
) -> Dict[int, List[str]]:
    normalized_ids = _normalize_exam_ids(category_ids)
    if not normalized_ids:
        return {}

    rows = _safe_rows(
        supabase.table(source_table)
        .select("id, title, source_text, source_content_html, source_url, meta, priority, " + foreign_key)
        .in_(foreign_key, normalized_ids)
        .eq("is_active", True)
        .order("priority", desc=True)
        .order("id", desc=True)
        .limit(max(100, len(normalized_ids) * max_sources_per_category * 3))
    )
    grouped: Dict[int, List[str]] = {}
    for row in rows:
        try:
            resolved_category_id = int(row.get(foreign_key))
        except (TypeError, ValueError):
            continue
        if resolved_category_id <= 0:
            continue
        current = grouped.setdefault(resolved_category_id, [])
        if len(current) >= max_sources_per_category:
            continue
        hint_text = _stored_source_hint_text_from_row(row)
        if hint_text:
            current.append(hint_text)
    return grouped


def _tokenize_for_category_match(text: str) -> Set[str]:
    tokens = set()
    for token in re.findall(r"[a-z0-9]+", str(text or "").lower()):
        if len(token) < 3 or token in _CATEGORY_TOKEN_STOPWORDS:
            continue
        tokens.add(token)
    return tokens


def _score_taxonomy_row_for_text(
    *,
    text: str,
    text_tokens: Set[str],
    phrases: List[str],
    source_hints: List[str],
) -> float:
    score = 0.0
    for phrase in phrases:
        if " " in phrase and phrase in text:
            score += 4.0
        elif phrase in text_tokens:
            score += 3.0
        phrase_tokens = _tokenize_for_category_match(phrase)
        if phrase_tokens:
            overlap = len(phrase_tokens.intersection(text_tokens))
            if overlap:
                score += float(overlap)

    for source_hint in source_hints:
        source_tokens = _tokenize_for_category_match(source_hint)
        if not source_tokens:
            continue
        overlap = len(source_tokens.intersection(text_tokens))
        if overlap:
            score += min(2.5, overlap * 0.4)

    return score


def _prune_ancestor_category_matches(category_ids: List[int], parent_by_id: Dict[int, Optional[int]]) -> List[int]:
    selected = set(category_ids)
    output: List[int] = []
    for category_id in category_ids:
        is_ancestor_of_selected = False
        for other_id in selected:
            if other_id == category_id:
                continue
            ancestor_id = parent_by_id.get(other_id)
            while ancestor_id is not None:
                if ancestor_id == category_id:
                    is_ancestor_of_selected = True
                    break
                ancestor_id = parent_by_id.get(ancestor_id)
            if is_ancestor_of_selected:
                break
        if is_ancestor_of_selected:
            continue
        output.append(category_id)
    return output


def _extract_category_ids_from_content_data(data: Dict[str, Any], quiz_kind: QuizKind) -> List[int]:
    category_ids = _normalize_exam_ids(data.get("category_ids"))
    if not category_ids and quiz_kind == QuizKind.GK:
        category_ids = _normalize_exam_ids(data.get("premium_gk_category_ids"))
    if not category_ids and quiz_kind == QuizKind.MATHS:
        category_ids = _normalize_exam_ids(data.get("premium_maths_category_ids"))
    if not category_ids and quiz_kind == QuizKind.PASSAGE:
        category_ids = _normalize_exam_ids(data.get("premium_passage_category_ids"))
    return category_ids


def _apply_category_ids_to_content_data(data: Dict[str, Any], quiz_kind: QuizKind, category_ids: List[int]) -> None:
    normalized = _normalize_exam_ids(category_ids)
    if not normalized:
        return
    data["category_ids"] = normalized
    if quiz_kind == QuizKind.GK:
        data["premium_gk_category_ids"] = normalized
    elif quiz_kind == QuizKind.MATHS:
        data["premium_maths_category_ids"] = normalized
    elif quiz_kind == QuizKind.PASSAGE:
        data["premium_passage_category_ids"] = normalized


def _content_data_match_text(data: Dict[str, Any], quiz_kind: QuizKind) -> str:
    parts: List[str] = []
    if quiz_kind == QuizKind.PASSAGE:
        parts.extend(
            [
                str(data.get("passage_title") or ""),
                str(data.get("passage_text") or data.get("passage") or ""),
                str(data.get("source_reference") or data.get("source") or ""),
            ]
        )
        raw_questions = data.get("questions")
        if isinstance(raw_questions, list):
            for question in raw_questions:
                if not isinstance(question, dict):
                    continue
                parts.extend(
                    [
                        str(question.get("question_statement") or question.get("question") or ""),
                        str(question.get("supp_question_statement") or question.get("supplementary_statement") or ""),
                        str(question.get("question_prompt") or ""),
                        str(question.get("explanation_text") or question.get("explanation") or ""),
                    ]
                )
                statements = question.get("statements_facts") or question.get("statement_facts") or []
                if isinstance(statements, list):
                    parts.extend(str(item) for item in statements if item is not None)
                options = question.get("options") or []
                if isinstance(options, list):
                    for option in options:
                        if isinstance(option, dict):
                            parts.append(str(option.get("text") or option.get("value") or ""))
                        elif option is not None:
                            parts.append(str(option))
    else:
        parts.extend(
            [
                str(data.get("question_statement") or data.get("question") or ""),
                str(data.get("supp_question_statement") or data.get("supplementary_statement") or ""),
                str(data.get("question_prompt") or ""),
                str(data.get("explanation_text") or data.get("explanation") or ""),
                str(data.get("source_reference") or data.get("source") or ""),
            ]
        )
        statements = data.get("statements_facts") or data.get("statement_facts") or []
        if isinstance(statements, list):
            parts.extend(str(item) for item in statements if item is not None)
        options = data.get("options") or []
        if isinstance(options, list):
            for option in options:
                if isinstance(option, dict):
                    parts.append(str(option.get("text") or option.get("value") or ""))
                elif option is not None:
                    parts.append(str(option))
    return "\n".join(part for part in parts if part and part.strip())


def _infer_category_ids_for_text(
    source_text: str,
    category_type: str,
    supabase: Client,
    fallback_category_ids: Optional[List[int]] = None,
    max_categories: int = 3,
) -> List[int]:
    fallback_ids = _normalize_exam_ids(fallback_category_ids or [])

    text = str(source_text or "").strip().lower()
    if not text:
        return fallback_ids
    text_tokens = _tokenize_for_category_match(text)
    if not text_tokens:
        return fallback_ids

    rows = _safe_rows(
        supabase.table("categories")
        .select("id, name, slug, parent_id, description, meta")
        .eq("is_active", True)
        .eq("type", category_type)
        .order("name")
    )
    if not rows:
        return fallback_ids

    source_hint_map = _taxonomy_source_hint_map(
        source_table=CATEGORY_AI_SOURCES_TABLE,
        foreign_key="category_id",
        category_ids=[int(row.get("id")) for row in rows if row.get("id") is not None],
        supabase=supabase,
    )

    scored_rows: List[Tuple[int, float, str]] = []
    parent_by_id: Dict[int, Optional[int]] = {}
    for row in rows:
        try:
            category_id = int(row.get("id"))
        except (TypeError, ValueError):
            continue
        parent_raw = row.get("parent_id")
        try:
            parent_by_id[category_id] = int(parent_raw) if parent_raw is not None else None
        except (TypeError, ValueError):
            parent_by_id[category_id] = None
        phrases = _category_hint_phrases(row)
        source_hints = source_hint_map.get(category_id, [])
        if not phrases and not source_hints:
            continue
        score = _score_taxonomy_row_for_text(
            text=text,
            text_tokens=text_tokens,
            phrases=phrases,
            source_hints=source_hints,
        )
        if score <= 0:
            continue
        scored_rows.append((category_id, score, str(row.get("name") or "")))

    if not scored_rows:
        return fallback_ids

    scored_rows.sort(key=lambda item: (-item[1], item[2].lower()))
    top_score = scored_rows[0][1]
    threshold = max(1.0, top_score * 0.6)
    output: List[int] = []
    for category_id, score, _name in scored_rows:
        if score < threshold:
            continue
        if category_id not in output:
            output.append(category_id)
        if len(output) >= max_categories:
            break
    pruned = _prune_ancestor_category_matches(output, parent_by_id)
    return pruned or fallback_ids


def _mains_question_match_text(data: Dict[str, Any]) -> str:
    parts = [
        str(data.get("question_text") or data.get("question_statement") or data.get("question") or ""),
        str(data.get("answer_approach") or ""),
        str(data.get("model_answer") or ""),
        str(data.get("source_reference") or data.get("source") or ""),
        str(data.get("description") or ""),
    ]
    return "\n".join(part for part in parts if part and part.strip())


def _apply_mains_category_ids_to_content_data(data: Dict[str, Any], category_ids: List[int]) -> None:
    normalized = _normalize_exam_ids(category_ids)
    if not normalized:
        return
    data["mains_category_ids"] = normalized
    data["mains_category_id"] = normalized[0]
    data["category_ids"] = normalized
    if not str(data.get("description") or "").strip():
        data["description"] = str(
            data.get("question_text")
            or data.get("question_statement")
            or data.get("question")
            or ""
        ).strip() or None


def _infer_mains_category_ids_for_text(
    source_text: str,
    supabase: Client,
    fallback_category_ids: Optional[List[int]] = None,
    max_categories: int = 3,
) -> List[int]:
    fallback_ids = _normalize_exam_ids(fallback_category_ids or [])

    text = str(source_text or "").strip().lower()
    if not text:
        return fallback_ids
    text_tokens = _tokenize_for_category_match(text)
    if not text_tokens:
        return fallback_ids

    rows = _safe_rows(
        supabase.table(MAINS_CATEGORIES_TABLE)
        .select("id, name, slug, parent_id, description, meta")
        .eq("is_active", True)
        .order("name")
    )
    if not rows:
        return fallback_ids

    source_hint_map = _taxonomy_source_hint_map(
        source_table=MAINS_CATEGORY_SOURCES_TABLE,
        foreign_key="mains_category_id",
        category_ids=[int(row.get("id")) for row in rows if row.get("id") is not None],
        supabase=supabase,
    )

    scored_rows: List[Tuple[int, float, str]] = []
    parent_by_id: Dict[int, Optional[int]] = {}
    for row in rows:
        try:
            category_id = int(row.get("id"))
        except (TypeError, ValueError):
            continue
        parent_raw = row.get("parent_id")
        try:
            parent_by_id[category_id] = int(parent_raw) if parent_raw is not None else None
        except (TypeError, ValueError):
            parent_by_id[category_id] = None
        phrases = _mains_category_hint_phrases(row)
        source_hints = source_hint_map.get(category_id, [])
        if not phrases and not source_hints:
            continue
        score = _score_taxonomy_row_for_text(
            text=text,
            text_tokens=text_tokens,
            phrases=phrases,
            source_hints=source_hints,
        )
        if score <= 0:
            continue
        scored_rows.append((category_id, score, str(row.get("name") or "")))

    if not scored_rows:
        return fallback_ids

    scored_rows.sort(key=lambda item: (-item[1], item[2].lower()))
    top_score = scored_rows[0][1]
    threshold = max(1.0, top_score * 0.6)
    output: List[int] = []
    for category_id, score, _name in scored_rows:
        if score < threshold:
            continue
        if category_id not in output:
            output.append(category_id)
        if len(output) >= max_categories:
            break
    pruned = _prune_ancestor_category_matches(output, parent_by_id)
    return pruned or fallback_ids


def _category_rows_for_quiz_kind(
    quiz_kind: QuizKind,
    supabase: Client,
    *,
    restrict_category_ids: Optional[List[int]] = None,
    limit: int = 120,
) -> List[Dict[str, Any]]:
    normalized_ids = _normalize_exam_ids(restrict_category_ids or [])
    query = (
        supabase.table("categories")
        .select("id, name, parent_id, description, meta")
        .eq("is_active", True)
        .eq("type", _category_type_for_quiz_kind(quiz_kind))
        .order("name")
        .limit(limit)
    )
    if normalized_ids:
        query = query.in_("id", normalized_ids)
    rows = _safe_rows(query)
    if not normalized_ids:
        return rows

    rows_by_id: Dict[int, Dict[str, Any]] = {}
    for row in rows:
        try:
            row_id = int(row.get("id"))
        except (TypeError, ValueError):
            continue
        rows_by_id[row_id] = row
    ordered: List[Dict[str, Any]] = []
    for category_id in normalized_ids:
        if category_id in rows_by_id:
            ordered.append(rows_by_id[category_id])
    return ordered


def _category_structure_instruction_block(
    quiz_kind: QuizKind,
    supabase: Client,
    *,
    requested_category_ids: Optional[List[int]] = None,
    max_lines: int = 40,
) -> str:
    rows = _category_rows_for_quiz_kind(
        quiz_kind,
        supabase,
        restrict_category_ids=requested_category_ids,
        limit=200,
    )
    if not rows:
        return ""

    nodes_by_id: Dict[int, Dict[str, Any]] = {}
    children_by_parent: Dict[Optional[int], List[Dict[str, Any]]] = {}
    for row in rows:
        try:
            row_id = int(row.get("id"))
        except (TypeError, ValueError):
            continue
        nodes_by_id[row_id] = row
        try:
            parent_raw = row.get("parent_id")
            parent_id = int(parent_raw) if parent_raw is not None else None
        except (TypeError, ValueError):
            parent_id = None
        children_by_parent.setdefault(parent_id, []).append(row)

    for values in children_by_parent.values():
        values.sort(key=lambda item: str(item.get("name") or "").strip().lower())

    lines: List[str] = []
    visited: Set[int] = set()

    def walk(row: Dict[str, Any], depth: int) -> None:
        try:
            row_id = int(row.get("id"))
        except (TypeError, ValueError):
            return
        if row_id in visited:
            return
        visited.add(row_id)
        name = str(row.get("name") or "").strip() or f"Category {row_id}"
        indent = "  " * max(0, depth)
        lines.append(f"{indent}- [{row_id}] {name}")
        for child in children_by_parent.get(row_id, []):
            walk(child, depth + 1)

    roots = children_by_parent.get(None, [])
    if not roots:
        roots = sorted(rows, key=lambda item: str(item.get("name") or "").strip().lower())
    for row in roots:
        walk(row, 0)
    for row in rows:
        walk(row, 0)

    if len(lines) > max_lines:
        hidden = len(lines) - max_lines
        lines = lines[:max_lines]
        lines.append(f"- ... {hidden} more categories available")

    normalized_requested = _normalize_exam_ids(requested_category_ids or [])
    if normalized_requested:
        header = (
            "Requested Category Scope (MANDATORY): keep generated questions inside this scope "
            "and attach matching category IDs."
        )
    else:
        header = (
            "Available Category Structure (MANDATORY): align each generated question to this taxonomy "
            "and attach matching category IDs."
        )
    return "\n".join([header, *lines]).strip()


def _mains_category_structure_instruction_block(
    supabase: Client,
    *,
    requested_mains_category_ids: Optional[List[int]] = None,
    max_lines: int = 40,
) -> str:
    normalized_requested = _normalize_exam_ids(requested_mains_category_ids or [])
    query = (
        supabase.table(MAINS_CATEGORIES_TABLE)
        .select("id, name, parent_id")
        .eq("is_active", True)
        .order("name")
        .limit(400)
    )
    if normalized_requested:
        query = query.in_("id", normalized_requested)
    rows = _safe_rows(query)
    if not rows:
        return ""

    nodes_by_id: Dict[int, Dict[str, Any]] = {}
    children_by_parent: Dict[Optional[int], List[Dict[str, Any]]] = {}
    for row in rows:
        try:
            row_id = int(row.get("id"))
        except (TypeError, ValueError):
            continue
        nodes_by_id[row_id] = row
        parent_raw = row.get("parent_id")
        try:
            parent_id = int(parent_raw) if parent_raw is not None else None
        except (TypeError, ValueError):
            parent_id = None
        children_by_parent.setdefault(parent_id, []).append(row)

    for values in children_by_parent.values():
        values.sort(key=lambda item: str(item.get("name") or "").strip().lower())

    lines: List[str] = []
    visited: Set[int] = set()

    def walk(row: Dict[str, Any], depth: int) -> None:
        try:
            row_id = int(row.get("id"))
        except (TypeError, ValueError):
            return
        if row_id in visited:
            return
        visited.add(row_id)
        name = str(row.get("name") or "").strip() or f"Mains Category {row_id}"
        indent = "  " * max(0, depth)
        lines.append(f"{indent}- [{row_id}] {name}")
        for child in children_by_parent.get(row_id, []):
            walk(child, depth + 1)

    roots = children_by_parent.get(None, [])
    if not roots:
        roots = sorted(rows, key=lambda item: str(item.get("name") or "").strip().lower())
    for row in roots:
        walk(row, 0)
    for row in rows:
        walk(row, 0)

    if len(lines) > max_lines:
        hidden = len(lines) - max_lines
        lines = lines[:max_lines]
        lines.append(f"- ... {hidden} more mains categories available")

    if normalized_requested:
        header = (
            "Requested Mains Category Scope (MANDATORY): keep generated questions inside this scope "
            "and attach matching mains_category_ids/category_ids."
        )
    else:
        header = (
            "Available Mains Category Structure (MANDATORY): align each generated question to this taxonomy "
            "and attach matching mains_category_ids/category_ids."
        )
    return "\n".join([header, *lines]).strip()


def _assign_category_ids_to_generated_items(
    items: List[Dict[str, Any]],
    *,
    quiz_kind: QuizKind,
    supabase: Client,
    requested_category_ids: Optional[List[int]] = None,
    source_text: Optional[str] = None,
) -> List[Dict[str, Any]]:
    requested_ids = _normalize_exam_ids(requested_category_ids or [])
    category_type = _category_type_for_quiz_kind(quiz_kind)
    source_level_category_ids = requested_ids
    if not source_level_category_ids:
        source_level_category_ids = _infer_category_ids_for_text(
            str(source_text or "").strip(),
            category_type,
            supabase,
        )
    output: List[Dict[str, Any]] = []
    for raw_item in items:
        if not isinstance(raw_item, dict):
            continue
        item = dict(raw_item)
        existing_ids = _extract_category_ids_from_content_data(item, quiz_kind)
        resolved_ids = existing_ids or requested_ids
        if not resolved_ids:
            resolved_ids = _infer_category_ids_for_text(
                _content_data_match_text(item, quiz_kind),
                category_type,
                supabase,
                fallback_category_ids=source_level_category_ids,
            )
        if resolved_ids:
            _apply_category_ids_to_content_data(item, quiz_kind, resolved_ids)
        output.append(item)
    return output


def _collect_string_list(value: Any) -> List[str]:
    if isinstance(value, list):
        output: List[str] = []
        for item in value:
            if item is None:
                continue
            text = str(item).strip()
            if text:
                output.append(text)
        return output
    if isinstance(value, str):
        cleaned = value.strip()
        return [cleaned] if cleaned else []
    return []


def _example_analysis_guidance_text(example_analysis_row: Dict[str, Any]) -> str:
    style_profile = example_analysis_row.get("style_profile") or {}
    if not isinstance(style_profile, dict):
        style_profile = {}

    lines: List[str] = [
        "Saved Example Analysis Guidance (strictly apply this style):",
        "- Use this analysis for BOTH question type selection and depth analysis, not only wording.",
        "- Use examples as format templates only; never copy topic facts or answer-key sequences.",
    ]

    summary = str(style_profile.get("summary") or "").strip()
    if summary:
        lines.append(f"Summary: {summary}")

    style_instructions = str(style_profile.get("style_instructions") or "").strip()
    if style_instructions:
        lines.append("Style Instructions:")
        lines.append(style_instructions)

    format_rules = _collect_string_list(style_profile.get("format_rules"))
    if format_rules:
        lines.append("Format Rules:")
        lines.extend([f"- {rule}" for rule in format_rules])

    dos = _collect_string_list(style_profile.get("dos"))
    if dos:
        lines.append("Do:")
        lines.extend([f"- {rule}" for rule in dos])

    donts = _collect_string_list(style_profile.get("donts"))
    if donts:
        lines.append("Do Not:")
        lines.extend([f"- {rule}" for rule in donts])

    example_analyses = style_profile.get("example_analyses") if isinstance(style_profile.get("example_analyses"), list) else []
    if example_analyses:
        lines.append("Question-Type Analysis from Saved Examples:")
        for idx, entry in enumerate(example_analyses, start=1):
            if not isinstance(entry, dict):
                continue
            nature = str(entry.get("nature") or "").strip()
            q_format = str(entry.get("format") or "").strip()
            depth = str(entry.get("depth") or "").strip()
            reasoning = str(entry.get("reasoning_pattern") or "").strip()
            option_pattern = str(entry.get("option_pattern") or "").strip()
            explanation_expectations = str(entry.get("explanation_expectations") or "").strip()
            headline_parts = [part for part in [nature, q_format, depth] if part]
            if headline_parts:
                lines.append(f"{idx}. Type/Profile: {' | '.join(headline_parts)}")
            if reasoning:
                lines.append(f"   Reasoning Pattern: {reasoning}")
            if option_pattern:
                lines.append(f"   Option Pattern: {option_pattern}")
            if explanation_expectations:
                lines.append(f"   Explanation Expectation: {explanation_expectations}")
            constraints = _collect_string_list(entry.get("constraints"))
            for constraint in constraints:
                lines.append(f"   Constraint: {constraint}")

    return "\n".join(lines).strip()


def _apply_example_analysis_to_generate_request(
    request: AIQuizGenerateRequest,
    example_analysis_row: Dict[str, Any],
) -> None:
    guidance = _example_analysis_guidance_text(example_analysis_row)
    if guidance:
        existing = str(request.formatting_instruction_text or "").strip()
        request.formatting_instruction_text = f"{existing}\n\n{guidance}".strip() if existing else guidance

    merged_examples: List[str] = []
    for text in (request.example_questions or []):
        cleaned = str(text).strip()
        if cleaned and cleaned not in merged_examples:
            merged_examples.append(cleaned)
    for text in _collect_string_list(example_analysis_row.get("example_questions")):
        if text not in merged_examples:
            merged_examples.append(text)
    if merged_examples:
        request.example_questions = merged_examples


def _normalize_category_meta(raw_meta: Any) -> Dict[str, Any]:
    meta = dict(raw_meta or {}) if isinstance(raw_meta, dict) else {}
    meta.pop("exam_ids", None)
    return meta


def _category_view(row: Dict[str, Any]) -> Dict[str, Any]:
    return {
        **row,
        "meta": _normalize_category_meta(row.get("meta")),
    }


def _load_exam_rows_by_ids(exam_ids: List[int], supabase: Client) -> List[Dict[str, Any]]:
    normalized_exam_ids = _normalize_exam_ids(exam_ids)
    if not normalized_exam_ids:
        raise HTTPException(status_code=400, detail="At least one exam ID must be provided.")
    try:
        rows = _rows(supabase.table(EXAMS_TABLE).select("*").in_("id", normalized_exam_ids).execute())
    except Exception as exc:
        if _is_missing_table_error(exc, EXAMS_TABLE):
            _raise_exams_migration_required(exc)
        raise
    rows_by_id: Dict[int, Dict[str, Any]] = {}
    for row in rows:
        try:
            row_id = int(row.get("id"))
        except (TypeError, ValueError):
            continue
        rows_by_id[row_id] = row
    missing_ids = [exam_id for exam_id in normalized_exam_ids if exam_id not in rows_by_id]
    if missing_ids:
        raise HTTPException(status_code=404, detail=f"Exam IDs not found: {missing_ids}")
    return [rows_by_id[exam_id] for exam_id in normalized_exam_ids]


def _sync_collection_exam_links(collection_id: int, exam_ids: List[int], supabase: Client) -> None:
    normalized_exam_ids = _normalize_exam_ids(exam_ids)
    try:
        supabase.table("collection_exams").delete().eq("collection_id", collection_id).execute()
        if normalized_exam_ids:
            supabase.table("collection_exams").insert(
                [{"collection_id": collection_id, "exam_id": exam_id} for exam_id in normalized_exam_ids]
            ).execute()
    except Exception:
        return


def _collection_exam_ids(row: Dict[str, Any], supabase: Client) -> List[int]:
    meta = dict(row.get("meta") or {}) if isinstance(row.get("meta"), dict) else {}
    merged_exam_ids = _normalize_exam_ids(meta.get("exam_ids"))
    collection_id = _safe_int(row.get("id"), 0)
    if collection_id > 0:
        try:
            mapping_rows = _safe_rows(
                supabase.table("collection_exams")
                .select("exam_id")
                .eq("collection_id", collection_id)
            )
            for mapping_row in mapping_rows:
                exam_id = _safe_int(mapping_row.get("exam_id"), 0)
                if exam_id > 0 and exam_id not in merged_exam_ids:
                    merged_exam_ids.append(exam_id)
        except Exception:
            pass
    return merged_exam_ids


def _find_existing_category(
    *,
    name: str,
    category_type: str,
    parent_id: Optional[int],
    supabase: Client,
) -> Optional[Dict[str, Any]]:
    rows = _rows(supabase.table("categories").select("*").eq("type", category_type).eq("name", name).execute())
    for row in rows:
        row_parent_id_raw = row.get("parent_id")
        try:
            row_parent_id = int(row_parent_id_raw) if row_parent_id_raw is not None else None
        except (TypeError, ValueError):
            continue
        if row_parent_id != parent_id:
            continue
        return row
    return None


def _create_premium_categories(
    *,
    quiz_type: str,
    parent_id: Optional[int],
    categories: List[Dict[str, Any]],
    supabase: Client,
) -> Tuple[List[Dict[str, Any]], List[str]]:
    if not categories:
        return [], []

    category_type = _category_type_from_quiz_type(quiz_type)
    if parent_id is not None:
        parent_row = _first(
            supabase.table("categories")
            .select("*")
            .eq("id", parent_id)
            .eq("type", category_type)
            .limit(1)
            .execute()
        )
        if not parent_row:
            raise HTTPException(status_code=400, detail=f"Parent category ID {parent_id} not found or wrong type.")

    created_categories: List[Dict[str, Any]] = []
    skipped_details: List[str] = []
    payload_seen: Set[str] = set()

    for category_data in categories:
        category_name = str(category_data.get("name") or "").strip()
        if not category_name:
            skipped_details.append("Skipped empty category name.")
            continue

        normalized_name = category_name.lower()
        if normalized_name in payload_seen:
            skipped_details.append(f"Duplicate name '{category_name}' provided more than once.")
            continue
        payload_seen.add(normalized_name)

        existing = _find_existing_category(
            name=category_name,
            category_type=category_type,
            parent_id=parent_id,
            supabase=supabase,
        )
        if existing:
            skipped_details.append(
                f"Category '{category_name}' already exists under this parent."
            )
            continue

        description_value = category_data.get("description")
        description = str(description_value).strip() if isinstance(description_value, str) else None
        if description == "":
            description = None

        meta_value = category_data.get("meta")
        meta = _normalize_category_meta(meta_value)

        slug_value = category_data.get("slug")
        slug: Optional[str] = None
        if isinstance(slug_value, str):
            base_slug = slug_value.strip()
            if base_slug:
                slug = base_slug

        create_payload = CategoryCreate(
            name=category_name,
            type=CategoryType(category_type),
            parent_id=parent_id,
            description=description,
            slug=slug,
            meta=meta,
        )
        try:
            created_row = create_category(create_payload, supabase)
        except Exception as exc:
            exc_text = str(exc).lower()
            if slug and "categories_slug_key" in exc_text and "duplicate key value violates unique constraint" in exc_text:
                skipped_details.append(f"Slug '{slug}' already exists.")
                continue
            raise
        created_categories.append(created_row)

    return created_categories, skipped_details


def _build_category_tree(rows: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    nodes: Dict[int, Dict[str, Any]] = {}
    for row in rows:
        node = {**row, "children": []}
        nodes[int(row["id"])] = node
    roots: List[Dict[str, Any]] = []
    for node in nodes.values():
        parent_id = node.get("parent_id")
        if parent_id is None or int(parent_id) not in nodes:
            roots.append(node)
            continue
        nodes[int(parent_id)]["children"].append(node)
    return roots


def _quiz_category_ids(question: QuizQuestionCreate, quiz_kind: QuizKind) -> List[int]:
    if quiz_kind == QuizKind.GK and question.premium_gk_category_ids:
        return _normalize_exam_ids(question.premium_gk_category_ids)
    if quiz_kind == QuizKind.MATHS and question.premium_maths_category_ids:
        return _normalize_exam_ids(question.premium_maths_category_ids)
    return _normalize_exam_ids(question.category_ids)


def _quiz_supplementary(question: QuizQuestionCreate) -> Optional[str]:
    return question.supp_question_statement or question.supplementary_statement


def _quiz_statements_facts(question: QuizQuestionCreate) -> List[str]:
    source = question.statements_facts if question.statements_facts is not None else question.statement_facts
    return source or []


def _quiz_explanation(question: QuizQuestionCreate) -> Optional[str]:
    return question.explanation_text or question.explanation


def _quiz_source_reference(question: QuizQuestionCreate) -> Optional[str]:
    return question.source_reference or question.source


SUPPORTED_AI_SETTING_CONTENT_TYPES = {
    AISystemInstructionContentType.PREMIUM_GK_QUIZ.value,
    AISystemInstructionContentType.PREMIUM_MATHS_QUIZ.value,
    AISystemInstructionContentType.PREMIUM_PASSAGE_QUIZ.value,
    AISystemInstructionContentType.MAINS_QUESTION_GENERATION.value,
    AISystemInstructionContentType.MAINS_EVALUATION.value,
}


def _parse_content_type(value: Any) -> AISystemInstructionContentType:
    try:
        return AISystemInstructionContentType(str(value))
    except Exception:
        return AISystemInstructionContentType.PREMIUM_GK_QUIZ


def _instruction_row_to_payload(row: Dict[str, Any]) -> Dict[str, Any]:
    # Preferred schema: premium_ai_quiz_instructions
    if "content_type" in row and "system_instructions" in row:
        provider_value = str(row.get("ai_provider") or AIProvider.GEMINI.value)
        try:
            provider_enum = AIProvider(provider_value)
        except Exception:
            provider_enum = AIProvider.GEMINI
        output_schema = row.get("output_schema") if isinstance(row.get("output_schema"), dict) else {}
        example_output = row.get("example_output") if isinstance(row.get("example_output"), dict) else {}
        input_schema = row.get("input_schema") if isinstance(row.get("input_schema"), dict) else {}
        return {
            "id": int(row["id"]),
            "content_type": _parse_content_type(row.get("content_type")),
            "ai_provider": provider_enum,
            "ai_model_name": str(row.get("ai_model_name") or "gemini-3-flash-preview"),
            "system_instructions": str(row.get("system_instructions") or ""),
            "input_schema": input_schema,
            "example_input": row.get("example_input"),
            "output_schema": output_schema,
            "example_output": example_output,
            "created_at": str(row.get("created_at") or ""),
            "updated_at": str(row.get("updated_at") or ""),
        }

    # Legacy schema fallback: ai_instructions
    raw_input = row.get("input_schema") or {}
    raw_output = row.get("output_schema") or {}
    input_schema = raw_input.get("schema") if isinstance(raw_input, dict) and "schema" in raw_input else raw_input
    output_schema = raw_output.get("schema") if isinstance(raw_output, dict) and "schema" in raw_output else raw_output
    example_output = raw_output.get("example_output") if isinstance(raw_output, dict) else {}
    if not isinstance(example_output, dict):
        example_output = {}
    ai_provider = raw_input.get("ai_provider") if isinstance(raw_input, dict) else None
    ai_model_name = raw_input.get("ai_model_name") if isinstance(raw_input, dict) else None
    example_input = raw_input.get("example_input") if isinstance(raw_input, dict) else None
    provider_value = str(ai_provider or AIProvider.GEMINI.value)
    try:
        provider_enum = AIProvider(provider_value)
    except Exception:
        provider_enum = AIProvider.GEMINI
    return {
        "id": int(row["id"]),
        "content_type": _parse_content_type(row.get("name")),
        "ai_provider": provider_enum,
        "ai_model_name": str(ai_model_name or "gemini-3-flash-preview"),
        "system_instructions": str(row.get("system_prompt") or ""),
        "input_schema": input_schema if isinstance(input_schema, dict) else {},
        "example_input": str(example_input) if isinstance(example_input, str) else None,
        "output_schema": output_schema if isinstance(output_schema, dict) else {},
        "example_output": example_output,
        "created_at": str(row.get("created_at") or ""),
        "updated_at": str(row.get("updated_at") or ""),
    }


def _quiz_kind_for_content_type(content_type: AISystemInstructionContentType) -> QuizKind:
    if content_type == AISystemInstructionContentType.PREMIUM_PASSAGE_QUIZ:
        return QuizKind.PASSAGE
    if content_type == AISystemInstructionContentType.PREMIUM_MATHS_QUIZ:
        return QuizKind.MATHS
    return QuizKind.GK


def _example_analysis_view(row: Dict[str, Any]) -> Dict[str, Any]:
    return {
        "id": int(row["id"]),
        "title": str(row.get("title") or ""),
        "description": row.get("description"),
        "tag_level1": row.get("tag_level1"),
        "tag_level2": row.get("tag_level2"),
        "content_type": _parse_content_type(row.get("content_type")),
        "style_profile": row.get("style_profile") or {},
        "example_questions": row.get("example_questions") or [],
        "tags": row.get("tags") or [],
        "exam_ids": _normalize_exam_ids(row.get("exam_ids")),
        "is_active": bool(row.get("is_active", True)),
        "author_id": row.get("author_id"),
        "created_at": str(row.get("created_at") or ""),
        "updated_at": str(row.get("updated_at") or ""),
    }


def _draft_content_type_for_kind(quiz_kind: QuizKind) -> AISystemInstructionContentType:
    if quiz_kind == QuizKind.MATHS:
        return AISystemInstructionContentType.PREMIUM_MATHS_QUIZ
    if quiz_kind == QuizKind.PASSAGE:
        return AISystemInstructionContentType.PREMIUM_PASSAGE_QUIZ
    return AISystemInstructionContentType.PREMIUM_GK_QUIZ


def _draft_quiz_kind_for_content_type(content_type: AISystemInstructionContentType) -> QuizKind:
    return _quiz_kind_for_content_type(content_type)


def _draft_view(row: Dict[str, Any]) -> Dict[str, Any]:
    content_type = _parse_content_type(row.get("content_type"))
    quiz_kind = _draft_quiz_kind_for_content_type(content_type)
    return {
        "id": int(row["id"]),
        "quiz_kind": quiz_kind,
        "content_type": content_type,
        "parsed_quiz_data": row.get("parsed_quiz_data") or {},
        "category_ids": _normalize_exam_ids(row.get("category_ids")),
        "exam_id": int(row["exam_id"]) if row.get("exam_id") is not None else None,
        "ai_instruction_id": int(row["ai_instruction_id"]) if row.get("ai_instruction_id") is not None else None,
        "source_url": row.get("source_url"),
        "source_pdf_id": int(row["source_pdf_id"]) if row.get("source_pdf_id") is not None else None,
        "notes": row.get("notes"),
        "created_at": str(row.get("created_at") or ""),
        "updated_at": str(row.get("updated_at") or "") or None,
    }


def _normalize_options_payload(raw_options: Any) -> List[Dict[str, str]]:
    options: List[Dict[str, str]] = []
    if isinstance(raw_options, list):
        for idx, option in enumerate(raw_options):
            label = chr(ord("A") + idx)
            if isinstance(option, dict):
                options.append(
                    {
                        "label": str(option.get("label") or label).upper(),
                        "text": str(option.get("text") or option.get("value") or ""),
                    }
                )
            elif option is not None:
                options.append({"label": label, "text": str(option)})
    return [opt for opt in options if opt["text"].strip()]


def _draft_question_content_data(parsed: Dict[str, Any], category_ids: List[int], exam_id: Optional[int]) -> Dict[str, Any]:
    options = _normalize_options_payload(parsed.get("options"))
    return {
        "question_statement": parsed.get("question_statement") or parsed.get("question"),
        "supp_question_statement": parsed.get("supp_question_statement") or parsed.get("supplementary_statement"),
        "supplementary_statement": parsed.get("supp_question_statement") or parsed.get("supplementary_statement"),
        "question_prompt": parsed.get("question_prompt"),
        "statements_facts": parsed.get("statements_facts") or parsed.get("statement_facts") or [],
        "statement_facts": parsed.get("statements_facts") or parsed.get("statement_facts") or [],
        "options": options,
        "correct_answer": _normalize_label(parsed.get("correct_answer") or parsed.get("answer")),
        "explanation": parsed.get("explanation_text") or parsed.get("explanation"),
        "explanation_text": parsed.get("explanation_text") or parsed.get("explanation"),
        "source_reference": parsed.get("source_reference") or parsed.get("source"),
        "source": parsed.get("source_reference") or parsed.get("source"),
        "category_ids": category_ids,
        "exam_id": exam_id,
    }


def _draft_passage_content_data(parsed: Dict[str, Any], category_ids: List[int], exam_id: Optional[int]) -> Dict[str, Any]:
    raw_questions = parsed.get("questions") or []
    questions = []
    if isinstance(raw_questions, list):
        for q in raw_questions:
            if not isinstance(q, dict):
                continue
            questions.append(
                {
                    "question_statement": q.get("question_statement") or q.get("question"),
                    "supp_question_statement": q.get("supp_question_statement") or q.get("supplementary_statement"),
                    "supplementary_statement": q.get("supp_question_statement") or q.get("supplementary_statement"),
                    "question_prompt": q.get("question_prompt"),
                    "statements_facts": q.get("statements_facts") or q.get("statement_facts") or [],
                    "statement_facts": q.get("statements_facts") or q.get("statement_facts") or [],
                    "options": _normalize_options_payload(q.get("options")),
                    "correct_answer": _normalize_label(q.get("correct_answer") or q.get("answer")),
                    "explanation": q.get("explanation_text") or q.get("explanation"),
                    "explanation_text": q.get("explanation_text") or q.get("explanation"),
                }
            )
    return {
        "passage_title": parsed.get("passage_title"),
        "passage_text": parsed.get("passage_text") or parsed.get("passage") or "",
        "source_reference": parsed.get("source_reference") or parsed.get("source"),
        "source": parsed.get("source_reference") or parsed.get("source"),
        "questions": questions,
        "category_ids": category_ids,
        "exam_id": exam_id,
    }


def _setting_row_for_content_type(content_type: AISystemInstructionContentType, supabase: Client) -> Optional[Dict[str, Any]]:
    row = _safe_first(
        supabase.table("premium_ai_quiz_instructions")
        .select("*")
        .eq("content_type", content_type.value)
        .limit(1)
    )
    if row is not None:
        return row
    return _safe_first(
        supabase.table("ai_instructions")
        .select("*")
        .eq("type", AIInstructionType.QUIZ_GEN.value)
        .eq("name", content_type.value)
        .limit(1)
    )


def _next_order(collection_id: int, supabase: Client) -> int:
    row = _first(
        supabase.table("collection_items")
        .select("order")
        .eq("collection_id", collection_id)
        .order("order", desc=True)
        .limit(1)
        .execute()
    )
    return int(row.get("order") or 0) + 1 if row else 0


def _collection_view(row: Dict[str, Any], supabase: Client) -> Dict[str, Any]:
    meta_value = row.get("meta")
    meta = meta_value if isinstance(meta_value, dict) else {}
    test_kind = _resolve_collection_test_kind(meta)
    test_label = "Mains Test" if test_kind == CollectionTestKind.MAINS else "Prelims Test"
    return {
        **row,
        "name": row.get("title"),
        "image_url": row.get("thumbnail_url"),
        "is_paid": row.get("is_premium"),
        "test_kind": test_kind.value,
        "test_label": test_label,
        "collection_mode": _normalize_collection_mode(meta.get("collection_mode")) or (
            "mains_ai" if test_kind == CollectionTestKind.MAINS else "prelims_quiz"
        ),
        "exam_ids": _collection_exam_ids(row, supabase),
        "category_ids": meta.get("category_ids", []),
        "source_list": meta.get("source_list", []),
        "source_category_ids": meta.get("source_category_ids", []),
        "source_pdf_url": meta.get("source_pdf_url"),
        "source_content_html": meta.get("source_content_html"),
        "admin_subpage_id": meta.get("admin_subpage_id"),
        "is_subscription": meta.get("is_subscription", False),
        "is_private_source": meta.get("is_private_source", False),
    }


def _fetch_collection(collection_id: int, supabase: Client) -> Dict[str, Any]:
    row = _first(
        supabase.table("collections").select("*").eq("id", collection_id).limit(1).execute()
    )
    if not row:
        raise HTTPException(status_code=404, detail="Collection not found")
    return row


def _fetch_collection_items(collection_id: int, supabase: Client) -> List[Dict[str, Any]]:
    rows = _rows(
        supabase.table("collection_items")
        .select("id, collection_id, content_item_id, order, section_title, content_items(*)")
        .eq("collection_id", collection_id)
        .order("order")
        .execute()
    )
    return [
        {
            "id": row.get("id"),
            "collection_id": row.get("collection_id"),
            "content_item_id": row.get("content_item_id"),
            "order": row.get("order"),
            "section_title": row.get("section_title"),
            "content_item": row.get("content_items"),
        }
        for row in rows
        if row.get("content_items")
    ]


def _public_app_origin() -> Optional[str]:
    for key in ("PUBLIC_APP_URL", "NEXT_PUBLIC_SITE_URL", "FRONTEND_PUBLIC_URL", "FRONTEND_URL"):
        value = str(os.getenv(key, "")).strip()
        if value:
            return value.rstrip("/")
    return None


def _build_public_url(path: str) -> Optional[str]:
    origin = _public_app_origin()
    if not origin:
        return None
    normalized_path = "/" + str(path or "").lstrip("/")
    return f"{origin}{normalized_path}"


def _hash_challenge_token(token: str) -> str:
    return hashlib.sha256(str(token or "").encode("utf-8")).hexdigest()


def _challenge_public_token_from_row(row: Dict[str, Any]) -> Optional[str]:
    try:
        challenge_id = int(row.get("id") or 0)
    except (TypeError, ValueError):
        return None
    token_hash = str(row.get("token_hash") or "").strip().lower()
    if challenge_id <= 0 or len(token_hash) < 16 or not re.fullmatch(r"[a-f0-9]+", token_hash):
        return None
    return f"c{challenge_id}-{token_hash[:16]}"


def _challenge_public_token_parts(token: str) -> Optional[Tuple[int, str]]:
    match = CHALLENGE_PUBLIC_TOKEN_RE.fullmatch(str(token or "").strip().lower())
    if not match:
        return None
    try:
        challenge_id = int(match.group("id"))
    except (TypeError, ValueError):
        return None
    if challenge_id <= 0:
        return None
    return challenge_id, match.group("prefix")


def _challenge_share_path(token: str) -> str:
    return f"/challenge/{token}"


def _challenge_attempt_path(token: str, attempt_id: int) -> str:
    return f"/challenge/{token}/result/{attempt_id}"


def _parse_datetime(value: Any) -> Optional[datetime]:
    text = str(value or "").strip()
    if not text:
        return None
    try:
        parsed = datetime.fromisoformat(text.replace("Z", "+00:00"))
    except ValueError:
        return None
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=timezone.utc)
    return parsed.astimezone(timezone.utc)


def _collection_author_id(collection_row: Dict[str, Any]) -> Optional[str]:
    meta = collection_row.get("meta") or {}
    if not isinstance(meta, dict):
        return None
    author_id = str(meta.get("author_id") or "").strip()
    return author_id or None


def _resolve_collection_creator_context(
    collection_row: Dict[str, Any],
    supabase: Client,
) -> Tuple[Optional[int], str]:
    raw_series_id = collection_row.get("series_id")
    try:
        series_id = int(raw_series_id) if raw_series_id is not None else None
    except (TypeError, ValueError):
        series_id = None
    if series_id and series_id > 0:
        series_row = _first(
            supabase.table(TEST_SERIES_TABLE)
            .select("id,provider_user_id")
            .eq("id", series_id)
            .limit(1)
            .execute()
        )
        provider_user_id = str((series_row or {}).get("provider_user_id") or "").strip()
        if provider_user_id:
            return series_id, provider_user_id

    author_id = _collection_author_id(collection_row) or str(collection_row.get("created_by") or "").strip()
    if author_id:
        return series_id, author_id
    raise HTTPException(status_code=400, detail="This test has no assigned creator.")


def _collection_title_map(collection_ids: List[int], supabase: Client) -> Dict[int, str]:
    normalized_ids = sorted({int(value) for value in collection_ids if int(value) > 0})
    if not normalized_ids:
        return {}
    query = supabase.table("collections").select("id,title")
    if len(normalized_ids) == 1:
        rows = _rows(query.eq("id", normalized_ids[0]).execute())
    else:
        rows = _rows(query.in_("id", normalized_ids).execute())
    output: Dict[int, str] = {}
    for row in rows:
        try:
            collection_id = int(row.get("id") or 0)
        except (TypeError, ValueError):
            continue
        if collection_id <= 0:
            continue
        output[collection_id] = str(row.get("title") or "").strip()
    return output


def _quiz_complaint_row_view(
    row: Dict[str, Any],
    *,
    collection_title: Optional[str] = None,
) -> QuizQuestionComplaintResponse:
    return QuizQuestionComplaintResponse(
        id=int(row.get("id") or 0),
        collection_id=int(row.get("collection_id") or 0),
        collection_title=collection_title or None,
        series_id=int(row.get("series_id") or 0) or None,
        creator_user_id=str(row.get("creator_user_id") or "").strip(),
        user_id=str(row.get("user_id") or "").strip(),
        attempt_id=int(row.get("attempt_id") or 0),
        question_item_id=int(row.get("question_item_id") or 0),
        question_number=int(row.get("question_number") or 0),
        question_text=str(row.get("question_text") or "").strip(),
        selected_option=str(row.get("selected_option") or "").strip() or None,
        correct_answer=str(row.get("correct_answer") or "").strip() or None,
        complaint_text=str(row.get("complaint_text") or "").strip(),
        status=QuizQuestionComplaintStatus(str(row.get("status") or QuizQuestionComplaintStatus.RECEIVED.value)),
        creator_note=str(row.get("creator_note") or "").strip() or None,
        created_at=str(row.get("created_at") or ""),
        updated_at=str(row.get("updated_at")) if row.get("updated_at") else None,
        resolved_at=str(row.get("resolved_at")) if row.get("resolved_at") else None,
    )


def _require_collection_owner_or_admin(
    *,
    collection_row: Dict[str, Any],
    user_ctx: Optional[Dict[str, Any]],
    require_active_subscription: bool = False,
) -> str:
    if not user_ctx:
        raise HTTPException(status_code=401, detail="Authentication required.")
    user_id = str(user_ctx.get("user_id") or "").strip()
    if not user_id:
        raise HTTPException(status_code=401, detail="Authentication required.")

    if bool(user_ctx.get("is_admin")):
        return user_id

    if require_active_subscription and not _is_active_subscription(user_ctx):
        raise HTTPException(status_code=403, detail="Active subscription required to create challenge links.")

    author_id = _collection_author_id(collection_row)
    if not author_id or author_id != user_id:
        raise HTTPException(status_code=403, detail="Only the collection owner can manage challenge links.")
    return user_id


def _challenge_row_view(row: Dict[str, Any], *, token: Optional[str] = None) -> Dict[str, Any]:
    challenge_token = token or _challenge_public_token_from_row(row)
    share_path = _challenge_share_path(challenge_token) if challenge_token else None
    share_url = _build_public_url(share_path) if share_path else None
    return {
        "id": int(row["id"]),
        "collection_id": int(row["collection_id"]),
        "owner_user_id": str(row.get("owner_user_id") or ""),
        "title": str(row.get("title") or "Challenge"),
        "description": row.get("description"),
        "is_active": bool(row.get("is_active", True)),
        "allow_anonymous": bool(row.get("allow_anonymous", True)),
        "require_login": bool(row.get("require_login", False)),
        "max_attempts_per_participant": int(row.get("max_attempts_per_participant") or 3),
        "expires_at": str(row.get("expires_at")) if row.get("expires_at") else None,
        "total_attempts": int(row.get("total_attempts") or 0),
        "created_at": str(row.get("created_at") or ""),
        "updated_at": str(row.get("updated_at")) if row.get("updated_at") else None,
        "share_path": share_path,
        "share_url": share_url,
    }


def _latest_live_challenge_row_for_collection(
    *,
    collection_id: int,
    supabase: Client,
) -> Optional[Dict[str, Any]]:
    try:
        rows = _rows(
            supabase.table(CHALLENGE_LINKS_TABLE)
            .select("*")
            .eq("collection_id", collection_id)
            .eq("is_active", True)
            .order("created_at", desc=True)
            .limit(12)
            .execute()
        )
    except Exception as exc:
        if _is_missing_table_like_error(exc, CHALLENGE_LINKS_TABLE):
            _raise_challenges_migration_required(exc)
        raise

    now = _utc_now()
    for row in rows:
        expires_at = _parse_datetime(row.get("expires_at"))
        if expires_at is not None and expires_at <= now:
            continue
        return row
    return None


def _fetch_challenge_by_token(
    *,
    token: str,
    supabase: Client,
    include_inactive: bool = False,
) -> Dict[str, Any]:
    row: Optional[Dict[str, Any]] = None
    public_token_parts = _challenge_public_token_parts(token)
    if public_token_parts:
        challenge_id, token_prefix = public_token_parts
        try:
            candidate_row = _first(
                supabase.table(CHALLENGE_LINKS_TABLE)
                .select("*")
                .eq("id", challenge_id)
                .limit(1)
                .execute()
            )
        except Exception as exc:
            if _is_missing_table_like_error(exc, CHALLENGE_LINKS_TABLE):
                _raise_challenges_migration_required(exc)
            raise
        candidate_hash = str((candidate_row or {}).get("token_hash") or "").strip().lower()
        if candidate_row and candidate_hash.startswith(token_prefix):
            row = candidate_row

    if not row:
        token_hash = _hash_challenge_token(token)
        try:
            row = _first(
                supabase.table(CHALLENGE_LINKS_TABLE)
                .select("*")
                .eq("token_hash", token_hash)
                .limit(1)
                .execute()
            )
        except Exception as exc:
            if _is_missing_table_like_error(exc, CHALLENGE_LINKS_TABLE):
                _raise_challenges_migration_required(exc)
            raise
    if not row:
        raise HTTPException(status_code=404, detail="Challenge link not found.")

    if include_inactive:
        return row

    if not bool(row.get("is_active", True)):
        raise HTTPException(status_code=410, detail="This challenge is no longer active.")
    expires_at = _parse_datetime(row.get("expires_at"))
    if expires_at is not None and expires_at <= _utc_now():
        raise HTTPException(status_code=410, detail="This challenge has expired.")
    return row


def _challenge_questions_payload(questions: List[CollectionTestQuestion]) -> List[ChallengeTestQuestion]:
    output: List[ChallengeTestQuestion] = []
    for question in questions:
        output.append(
            ChallengeTestQuestion(
                item_id=question.item_id,
                content_item_id=question.content_item_id,
                quiz_type=question.quiz_type,
                question_statement=question.question_statement,
                supplementary_statement=question.supplementary_statement,
                statements_facts=question.statements_facts,
                question_prompt=question.question_prompt,
                options=question.options,
                passage_title=question.passage_title,
                passage_text=question.passage_text,
            )
        )
    return output


def _public_challenge_row_view(
    *,
    challenge_row: Dict[str, Any],
    collection_row: Dict[str, Any],
    question_count: int,
) -> Optional[PublicChallengeListItemResponse]:
    public_token = _challenge_public_token_from_row(challenge_row)
    if not public_token:
        return None
    share_path = _challenge_share_path(public_token)
    share_url = _build_public_url(share_path)
    collection_meta = collection_row.get("meta") if isinstance(collection_row.get("meta"), dict) else {}
    return PublicChallengeListItemResponse(
        challenge_id=int(challenge_row.get("id") or 0),
        challenge_title=str(challenge_row.get("title") or "Challenge"),
        challenge_description=str(challenge_row.get("description") or "").strip() or None,
        collection_id=int(collection_row.get("id") or 0),
        collection_title=str(collection_row.get("title") or "Untitled Test"),
        collection_description=str(collection_row.get("description") or "").strip() or None,
        collection_thumbnail_url=str(collection_row.get("thumbnail_url") or "").strip() or None,
        test_kind=_resolve_collection_test_kind(collection_meta),
        question_count=max(0, int(question_count or 0)),
        total_attempts=int(challenge_row.get("total_attempts") or 0),
        expires_at=str(challenge_row.get("expires_at")) if challenge_row.get("expires_at") else None,
        share_path=share_path,
        share_url=share_url,
    )


def _score_expanded_questions(
    *,
    questions: List[CollectionTestQuestion],
    answers_payload: CollectionTestScoreRequest,
    supabase: Client,
) -> Tuple[CollectionTestScoreResponse, List[int]]:
    answers = {
        answer.item_id: _normalize_label(answer.selected_option) if answer.selected_option else None
        for answer in answers_payload.answers
    }
    correct = 0
    incorrect = 0
    unanswered = 0
    weak_areas: List[int] = []
    details: List[CollectionTestScoreDetail] = []
    category_stats: Dict[int, Dict[str, int]] = {}

    for question in questions:
        selected = answers.get(question.item_id)
        ok = bool(selected and selected == _normalize_label(question.correct_answer))
        question_category_ids = _normalize_exam_ids(question.category_ids)
        if not question_category_ids:
            question_category_ids = [0]
        if selected is None:
            unanswered += 1
        elif ok:
            correct += 1
        else:
            incorrect += 1
            if question.category_ids:
                weak_areas.extend(question.category_ids)

        for category_id in question_category_ids:
            bucket = category_stats.setdefault(
                category_id,
                {
                    "total": 0,
                    "correct": 0,
                    "incorrect": 0,
                    "unanswered": 0,
                },
            )
            bucket["total"] += 1
            if selected is None:
                bucket["unanswered"] += 1
            elif ok:
                bucket["correct"] += 1
            else:
                bucket["incorrect"] += 1

        details.append(
            CollectionTestScoreDetail(
                item_id=question.item_id,
                selected_option=selected,
                correct_answer=_normalize_label(question.correct_answer),
                is_correct=ok,
                explanation_text=question.explanation_text,
            )
        )

    category_name_map: Dict[int, str] = {0: "Uncategorized"}
    category_ids = [category_id for category_id in category_stats.keys() if category_id > 0]
    if category_ids:
        category_rows = _safe_rows(
            supabase.table("categories")
            .select("id, name")
            .in_("id", category_ids)
        )
        for row in category_rows:
            try:
                category_id = int(row.get("id"))
            except (TypeError, ValueError):
                continue
            category_name_map[category_id] = str(row.get("name") or f"Category {category_id}")

    category_wise_results = []
    for category_id, stat in sorted(
        category_stats.items(),
        key=lambda item: (item[0] == 0, -(item[1]["total"]), category_name_map.get(item[0], "")),
    ):
        total = int(stat["total"])
        accuracy = round((float(stat["correct"]) / float(total)) * 100.0, 2) if total else 0.0
        category_wise_results.append(
            {
                "category_id": category_id,
                "category_name": category_name_map.get(category_id, f"Category {category_id}"),
                "total": total,
                "correct": int(stat["correct"]),
                "incorrect": int(stat["incorrect"]),
                "unanswered": int(stat["unanswered"]),
                "accuracy": accuracy,
            }
        )

    response = CollectionTestScoreResponse(
        score=correct,
        total_questions=len(questions),
        correct_answers=correct,
        incorrect_answers=incorrect,
        unanswered=unanswered,
        details=details,
        category_wise_results=category_wise_results,
    )
    return response, list(set(weak_areas))


def _participant_key(user_id: Optional[str], participant_key: Optional[str], participant_name: Optional[str]) -> str:
    if user_id:
        return f"user:{user_id}"
    pkey = re.sub(r"[^a-z0-9_\-]", "", str(participant_key or "").strip().lower())[:64]
    if pkey:
        return f"guest:{pkey}"
    fallback = re.sub(r"[^a-z0-9_\-]", "", str(participant_name or "").strip().lower())[:64]
    return f"guest:{fallback or 'anonymous'}"


def _participant_name(user_ctx: Optional[Dict[str, Any]], submitted_name: Optional[str]) -> str:
    provided = str(submitted_name or "").strip()
    if provided:
        return provided[:80]
    if user_ctx:
        user_meta = user_ctx.get("user_metadata") or {}
        for key in ("full_name", "name", "display_name"):
            value = str(user_meta.get(key) or "").strip()
            if value:
                return value[:80]
        email = str(user_meta.get("email") or "").strip()
        if email:
            return email[:80]
    return "Anonymous Challenger"


def _challenge_attempt_rank_rows(
    *,
    challenge_id: int,
    supabase: Client,
    limit: int = 5000,
) -> List[Dict[str, Any]]:
    try:
        rows = _rows(
            supabase.table(CHALLENGE_ATTEMPTS_TABLE)
            .select("id, participant_name, score, total_questions, correct_answers, incorrect_answers, unanswered, created_at")
            .eq("challenge_id", challenge_id)
            .order("score", desc=True)
            .order("correct_answers", desc=True)
            .order("created_at", desc=False)
            .limit(limit)
            .execute()
        )
    except Exception as exc:
        if _is_missing_table_like_error(exc, CHALLENGE_ATTEMPTS_TABLE):
            _raise_challenges_migration_required(exc)
        raise
    return rows


def _compute_rank_percentile(rows: List[Dict[str, Any]], attempt_id: int) -> Tuple[int, int, float]:
    total = len(rows)
    if total <= 0:
        return 1, 1, 100.0
    rank = total
    for idx, row in enumerate(rows, start=1):
        if int(row.get("id") or 0) == int(attempt_id):
            rank = idx
            break
    if total == 1:
        percentile = 100.0
    else:
        percentile = round(((total - rank) / float(total - 1)) * 100.0, 2)
    return rank, total, percentile


def _challenge_score_response_from_attempt_row(
    *,
    challenge_row: Dict[str, Any],
    attempt_row: Dict[str, Any],
    token: str,
    supabase: Client,
) -> ChallengeScoreResponse:
    rank_rows = _challenge_attempt_rank_rows(challenge_id=int(challenge_row["id"]), supabase=supabase)
    rank, total_participants, percentile = _compute_rank_percentile(rank_rows, int(attempt_row["id"]))

    raw_details = attempt_row.get("details") if isinstance(attempt_row.get("details"), list) else []
    details = [CollectionTestScoreDetail(**detail) for detail in raw_details if isinstance(detail, dict)]

    raw_category_results = (
        attempt_row.get("category_wise_results")
        if isinstance(attempt_row.get("category_wise_results"), list)
        else []
    )
    category_wise_results = []
    for row in raw_category_results:
        if not isinstance(row, dict):
            continue
        category_wise_results.append(
            {
                "category_id": int(row.get("category_id") or 0),
                "category_name": str(row.get("category_name") or "Uncategorized"),
                "total": int(row.get("total") or 0),
                "correct": int(row.get("correct") or 0),
                "incorrect": int(row.get("incorrect") or 0),
                "unanswered": int(row.get("unanswered") or 0),
                "accuracy": float(row.get("accuracy") or 0.0),
            }
        )

    result_path = _challenge_attempt_path(token, int(attempt_row["id"]))
    result_url = _build_public_url(result_path)
    return ChallengeScoreResponse(
        attempt_id=int(attempt_row["id"]),
        challenge_id=int(challenge_row["id"]),
        challenge_title=str(challenge_row.get("title") or "Challenge"),
        collection_id=int(challenge_row["collection_id"]),
        collection_title=str(attempt_row.get("collection_title") or ""),
        participant_name=str(attempt_row.get("participant_name") or "Anonymous Challenger"),
        score=int(attempt_row.get("score") or 0),
        total_questions=int(attempt_row.get("total_questions") or 0),
        correct_answers=int(attempt_row.get("correct_answers") or 0),
        incorrect_answers=int(attempt_row.get("incorrect_answers") or 0),
        unanswered=int(attempt_row.get("unanswered") or 0),
        details=details,
        category_wise_results=category_wise_results,
        rank=rank,
        total_participants=total_participants,
        percentile=percentile,
        submitted_at=str(attempt_row.get("created_at") or ""),
        result_view_path=result_path,
        result_view_url=result_url,
    )


@router.get("/exams", response_model=List[ExamResponse])
@compat_router.get("/exams", response_model=List[ExamResponse])
def list_exams(
    active_only: bool = False,
    supabase: Client = Depends(get_supabase_client),
):
    try:
        query = supabase.table(EXAMS_TABLE).select("*").order("name")
        if active_only:
            query = query.eq("is_active", True)
        return _rows(query.execute())
    except Exception as exc:
        if _is_missing_table_error(exc, EXAMS_TABLE):
            _raise_exams_migration_required(exc)
        raise


@router.post("/exams", response_model=ExamResponse)
@compat_router.post("/exams", response_model=ExamResponse)
def create_exam(payload: ExamCreate, supabase: Client = Depends(get_supabase_client)):
    try:
        row = _first(supabase.table(EXAMS_TABLE).insert(payload.model_dump(exclude_none=True)).execute())
    except Exception as exc:
        if _is_missing_table_error(exc, EXAMS_TABLE):
            _raise_exams_migration_required(exc)
        raise
    if not row:
        raise HTTPException(status_code=400, detail="Failed to create exam")
    return row


@router.put("/exams/{exam_id}", response_model=ExamResponse)
@compat_router.put("/exams/{exam_id}", response_model=ExamResponse)
def update_exam(
    exam_id: int,
    payload: ExamUpdate,
    supabase: Client = Depends(get_supabase_client),
):
    updates = payload.model_dump(exclude_none=True)
    try:
        row = _first(supabase.table(EXAMS_TABLE).update(updates).eq("id", exam_id).execute())
    except Exception as exc:
        if _is_missing_table_error(exc, EXAMS_TABLE):
            _raise_exams_migration_required(exc)
        raise
    if not row:
        raise HTTPException(status_code=404, detail="Exam not found")
    return row


@router.delete("/exams/{exam_id}")
@compat_router.delete("/exams/{exam_id}")
def delete_exam(exam_id: int, supabase: Client = Depends(get_supabase_client)):
    try:
        row = _first(supabase.table(EXAMS_TABLE).delete().eq("id", exam_id).execute())
    except Exception as exc:
        if _is_missing_table_error(exc, EXAMS_TABLE):
            _raise_exams_migration_required(exc)
        raise
    if not row:
        raise HTTPException(status_code=404, detail="Exam not found")
    return {"ok": True}


@router.get("/categories")
def get_categories(
    type: Optional[CategoryType] = None,
    parent_id: Optional[int] = None,
    exam_id: Optional[int] = None,
    hierarchical: bool = False,
    supabase: Client = Depends(get_supabase_client),
):
    query = supabase.table("categories").select("*").eq("is_active", True).order("name")
    if type:
        query = query.eq("type", type.value)
    if parent_id is not None:
        query = query.eq("parent_id", parent_id)

    rows = _rows(query.execute())
    hydrated = [_category_view(row) for row in rows]

    if not hierarchical:
        return hydrated
    return _build_category_tree(hydrated)


@router.post("/categories", response_model=CategoryResponse)
def create_category(category: CategoryCreate, supabase: Client = Depends(get_supabase_client)):
    data = category.model_dump(exclude_none=True)
    data["type"] = category.type.value
    data["meta"] = _normalize_category_meta(data.get("meta"))

    row = _first(supabase.table("categories").insert(data).execute())
    if not row:
        raise HTTPException(status_code=400, detail="Failed to create category")

    return _category_view(row)


@router.put("/categories/{category_id}", response_model=CategoryResponse)
def update_category(
    category_id: int,
    payload: CategoryUpdate,
    supabase: Client = Depends(get_supabase_client),
):
    current = _first(supabase.table("categories").select("*").eq("id", category_id).limit(1).execute())
    if not current:
        raise HTTPException(status_code=404, detail="Category not found")

    updates = payload.model_dump(exclude_none=True)
    if isinstance(updates.get("type"), CategoryType):
        updates["type"] = updates["type"].value

    if "meta" in updates:
        updates["meta"] = _normalize_category_meta(updates.get("meta"))
    row = _first(supabase.table("categories").update(updates).eq("id", category_id).execute())
    if not row:
        raise HTTPException(status_code=404, detail="Category not found")

    return _category_view(row)


@router.delete("/categories/{category_id}")
def delete_category(category_id: int, supabase: Client = Depends(get_supabase_client)):
    row = _first(supabase.table("categories").delete().eq("id", category_id).execute())
    if not row:
        raise HTTPException(status_code=404, detail="Category not found")
    return {"ok": True}


@router.get("/categories/{category_id}/ai-sources", response_model=List[CategoryAISourceResponse])
def list_category_ai_sources(
    category_id: int,
    active_only: bool = False,
    supabase: Client = Depends(get_supabase_client),
):
    category_row = _first(
        supabase.table("categories")
        .select("id")
        .eq("id", category_id)
        .limit(1)
        .execute()
    )
    if not category_row:
        raise HTTPException(status_code=404, detail="Category not found")
    try:
        query = (
            supabase.table(CATEGORY_AI_SOURCES_TABLE)
            .select("*")
            .eq("category_id", category_id)
            .order("priority", desc=True)
            .order("id", desc=True)
        )
        if active_only:
            query = query.eq("is_active", True)
        rows = _rows(query.execute())
    except Exception as exc:
        if _is_missing_table_like_error(exc, CATEGORY_AI_SOURCES_TABLE):
            _raise_category_ai_sources_migration_required(exc)
        raise
    return [CategoryAISourceResponse(**_category_ai_source_view(row)) for row in rows]


@router.post("/categories/{category_id}/ai-sources", response_model=CategoryAISourceResponse)
def create_category_ai_source(
    category_id: int,
    payload: CategoryAISourceCreate,
    user_ctx: Dict[str, Any] = Depends(require_admin_user),
    supabase: Client = Depends(get_supabase_client),
):
    category_row = _first(
        supabase.table("categories")
        .select("id")
        .eq("id", category_id)
        .limit(1)
        .execute()
    )
    if not category_row:
        raise HTTPException(status_code=404, detail="Category not found")

    now_iso = _utc_now().isoformat()
    data = payload.model_dump(exclude_none=True)
    data["category_id"] = category_id
    data["source_kind"] = _normalized_source_kind(data.get("source_kind"))
    data["meta"] = data.get("meta") if isinstance(data.get("meta"), dict) else {}
    data["created_by"] = str(user_ctx.get("user_id") or "") or None
    data["created_at"] = now_iso
    data["updated_at"] = now_iso

    if data["source_kind"] == "text" and not str(data.get("source_text") or data.get("source_content_html") or "").strip():
        raise HTTPException(status_code=400, detail="source_text or source_content_html is required for text sources.")
    if data["source_kind"] == "url" and not str(data.get("source_url") or data.get("source_text") or "").strip():
        raise HTTPException(status_code=400, detail="source_url is required for url sources.")
    if data["source_kind"] == "content_item" and not (data.get("content_item_id") or str(data.get("source_text") or "").strip()):
        raise HTTPException(status_code=400, detail="content_item_id is required for content_item sources.")
    if data["source_kind"] == "url":
        normalized_url = _normalize_source_url(data.get("source_url"))
        if normalized_url:
            data["source_url"] = normalized_url
        current_text = str(data.get("source_text") or "").strip()
        if normalized_url and not current_text:
            fetched, fetch_details = _fetch_url_content_detailed(normalized_url)
            if not fetched:
                reason = str(fetch_details.get("error") or "fetch failed")
                raise HTTPException(
                    status_code=400,
                    detail=f"Could not extract content from URL ({reason}). Paste source_text manually or use a different URL.",
                )
            data["source_text"] = fetched
            meta = data.get("meta") if isinstance(data.get("meta"), dict) else {}
            meta.update(
                {
                    "url_snapshot_url": normalized_url,
                    "url_snapshot_fetched_at": _utc_now().isoformat(),
                    "url_snapshot_method": str(fetch_details.get("method") or "direct"),
                    "url_snapshot_chars": len(fetched),
                }
            )
            data["meta"] = meta

    try:
        row = _first(supabase.table(CATEGORY_AI_SOURCES_TABLE).insert(data).execute())
    except Exception as exc:
        if _is_missing_table_like_error(exc, CATEGORY_AI_SOURCES_TABLE):
            _raise_category_ai_sources_migration_required(exc)
        raise
    if not row:
        raise HTTPException(status_code=400, detail="Failed to create category source.")
    return CategoryAISourceResponse(**_category_ai_source_view(row))


@router.post("/categories/{category_id}/ai-sources/upload-pdfs", response_model=List[CategoryAISourceResponse])
async def upload_category_ai_source_pdfs(
    category_id: int,
    files: List[UploadFile] = File(...),
    use_ocr: bool = Query(True),
    priority: int = Query(0),
    is_active: bool = Query(True),
    user_ctx: Dict[str, Any] = Depends(require_admin_user),
    supabase: Client = Depends(get_supabase_client),
):
    category_row = _first(
        supabase.table("categories")
        .select("id")
        .eq("id", category_id)
        .limit(1)
        .execute()
    )
    if not category_row:
        raise HTTPException(status_code=404, detail="Category not found")

    valid_files = [item for item in files if item is not None]
    if not valid_files:
        raise HTTPException(status_code=400, detail="At least one PDF file is required.")
    if len(valid_files) > CATEGORY_PDF_SOURCE_MAX_FILES:
        raise HTTPException(
            status_code=400,
            detail=f"You can upload at most {CATEGORY_PDF_SOURCE_MAX_FILES} PDFs in one request.",
        )

    max_size_bytes = UPLOADED_PDF_MAX_SIZE_MB * 1024 * 1024
    now_iso = _utc_now().isoformat()
    user_id = str(user_ctx.get("user_id") or "").strip() or None
    insert_rows: List[Dict[str, Any]] = []
    skipped: List[str] = []

    for index, file in enumerate(valid_files):
        filename = str(file.filename or f"source-{index + 1}.pdf").strip() or f"source-{index + 1}.pdf"
        if not filename.lower().endswith(".pdf"):
            skipped.append(f"{filename}: not a PDF.")
            continue

        content = await file.read()
        if not content:
            skipped.append(f"{filename}: empty file.")
            continue
        if len(content) > max_size_bytes:
            skipped.append(f"{filename}: exceeds {UPLOADED_PDF_MAX_SIZE_MB} MB.")
            continue

        try:
            compact_text, page_count, used_ocr, original_chars = await _extract_pdf_text_for_category_source(
                file_bytes=content,
                use_ocr=use_ocr,
                max_chars=CATEGORY_PDF_SOURCE_MAX_CHARS,
            )
        except RuntimeError as exc:
            raise HTTPException(status_code=503, detail=str(exc))
        except Exception as exc:
            logger.warning("Failed to extract PDF for category source (%s): %s", filename, exc)
            skipped.append(f"{filename}: extraction failed.")
            continue

        compact_text = compact_text.strip()
        if not compact_text:
            skipped.append(f"{filename}: no text extracted.")
            continue

        insert_rows.append(
            {
                "category_id": category_id,
                "source_kind": "text",
                "title": filename,
                "source_text": compact_text,
                "priority": int(priority) - index,
                "is_active": bool(is_active),
                "meta": {
                    "source_asset_kind": "pdf",
                    "filename": filename,
                    "page_count": int(page_count),
                    "used_ocr": bool(used_ocr),
                    "original_text_chars": int(original_chars),
                    "stored_text_chars": len(compact_text),
                },
                "created_by": user_id,
                "created_at": now_iso,
                "updated_at": now_iso,
            }
        )

    if not insert_rows:
        detail = "No PDF sources were added."
        if skipped:
            detail = f"{detail} {'; '.join(skipped[:5])}"
        raise HTTPException(status_code=400, detail=detail)

    try:
        created_rows = _rows(supabase.table(CATEGORY_AI_SOURCES_TABLE).insert(insert_rows).execute())
    except Exception as exc:
        if _is_missing_table_like_error(exc, CATEGORY_AI_SOURCES_TABLE):
            _raise_category_ai_sources_migration_required(exc)
        raise
    if not created_rows:
        raise HTTPException(status_code=400, detail="Failed to create category PDF sources.")

    if skipped:
        logger.warning("Skipped some category PDF uploads for category %s: %s", category_id, "; ".join(skipped))
    return [CategoryAISourceResponse(**_category_ai_source_view(row)) for row in created_rows]


@router.put("/categories/{category_id}/ai-sources/{source_id}", response_model=CategoryAISourceResponse)
def update_category_ai_source(
    category_id: int,
    source_id: int,
    payload: CategoryAISourceUpdate,
    user_ctx: Dict[str, Any] = Depends(require_admin_user),
    supabase: Client = Depends(get_supabase_client),
):
    _ = user_ctx
    existing = _first(
        supabase.table(CATEGORY_AI_SOURCES_TABLE)
        .select("*")
        .eq("id", source_id)
        .eq("category_id", category_id)
        .limit(1)
        .execute()
    )
    if not existing:
        raise HTTPException(status_code=404, detail="Category source not found.")

    updates = payload.model_dump(exclude_none=True)
    if "source_kind" in updates:
        updates["source_kind"] = _normalized_source_kind(updates.get("source_kind"))
    if "meta" in updates and not isinstance(updates.get("meta"), dict):
        updates["meta"] = {}
    updates["updated_at"] = _utc_now().isoformat()

    next_kind = _normalized_source_kind(updates.get("source_kind", existing.get("source_kind")))
    next_source_text = str(updates.get("source_text", existing.get("source_text")) or "").strip()
    next_source_html = str(updates.get("source_content_html", existing.get("source_content_html")) or "").strip()
    next_source_url = _normalize_source_url(updates.get("source_url", existing.get("source_url")))
    next_content_item_id = updates.get("content_item_id", existing.get("content_item_id"))
    if "source_url" in updates:
        updates["source_url"] = next_source_url or None

    if next_kind == "url":
        existing_source_url = _normalize_source_url(existing.get("source_url"))
        url_changed = bool(next_source_url) and next_source_url != existing_source_url
        manual_updated_text = str(updates.get("source_text") or "").strip() if "source_text" in updates else ""
        should_refresh_snapshot = bool(next_source_url) and (url_changed or not next_source_text)
        if should_refresh_snapshot:
            fetched, fetch_details = _fetch_url_content_detailed(next_source_url)
            if fetched:
                updates["source_text"] = fetched
                next_source_text = fetched
                merged_meta = dict(existing.get("meta") or {})
                if "meta" in updates and isinstance(updates.get("meta"), dict):
                    merged_meta.update(updates.get("meta") or {})
                merged_meta.update(
                    {
                        "url_snapshot_url": next_source_url,
                        "url_snapshot_fetched_at": _utc_now().isoformat(),
                        "url_snapshot_method": str(fetch_details.get("method") or "direct"),
                        "url_snapshot_chars": len(fetched),
                    }
                )
                updates["meta"] = merged_meta
            else:
                reason = str(fetch_details.get("error") or "fetch failed")
                if url_changed and not manual_updated_text:
                    raise HTTPException(
                        status_code=400,
                        detail=(
                            f"URL changed but extraction failed ({reason}). "
                            "Paste source_text manually or provide another URL."
                        ),
                    )
                if not next_source_text:
                    raise HTTPException(
                        status_code=400,
                        detail=f"Could not extract content from URL ({reason}). Paste source_text manually or try another URL.",
                    )

    if next_kind == "text" and not (next_source_text or next_source_html):
        raise HTTPException(status_code=400, detail="source_text or source_content_html is required for text sources.")
    if next_kind == "url" and not (next_source_url or next_source_text):
        raise HTTPException(status_code=400, detail="source_url is required for url sources.")
    if next_kind == "content_item" and not (next_content_item_id or next_source_text):
        raise HTTPException(status_code=400, detail="content_item_id is required for content_item sources.")

    try:
        row = _first(
            supabase.table(CATEGORY_AI_SOURCES_TABLE)
            .update(updates)
            .eq("id", source_id)
            .eq("category_id", category_id)
            .execute()
        )
    except Exception as exc:
        if _is_missing_table_like_error(exc, CATEGORY_AI_SOURCES_TABLE):
            _raise_category_ai_sources_migration_required(exc)
        raise
    if not row:
        raise HTTPException(status_code=404, detail="Category source not found.")
    return CategoryAISourceResponse(**_category_ai_source_view(row))


@router.delete("/categories/{category_id}/ai-sources/{source_id}")
def delete_category_ai_source(
    category_id: int,
    source_id: int,
    user_ctx: Dict[str, Any] = Depends(require_admin_user),
    supabase: Client = Depends(get_supabase_client),
):
    _ = user_ctx
    try:
        row = _first(
            supabase.table(CATEGORY_AI_SOURCES_TABLE)
            .delete()
            .eq("id", source_id)
            .eq("category_id", category_id)
            .execute()
        )
    except Exception as exc:
        if _is_missing_table_like_error(exc, CATEGORY_AI_SOURCES_TABLE):
            _raise_category_ai_sources_migration_required(exc)
        raise
    if not row:
        raise HTTPException(status_code=404, detail="Category source not found.")
    return {"ok": True}


@router.get("/mains/categories")
def list_mains_categories(
    parent_id: Optional[int] = None,
    hierarchical: bool = False,
    active_only: bool = True,
    supabase: Client = Depends(get_supabase_client),
):
    try:
        query = supabase.table(MAINS_CATEGORIES_TABLE).select("*").order("name")
        if active_only:
            query = query.eq("is_active", True)
        if parent_id is not None:
            query = query.eq("parent_id", parent_id)
        rows = _rows(query.execute())
    except Exception as exc:
        if _is_missing_table_like_error(exc, MAINS_CATEGORIES_TABLE):
            _raise_mains_categories_migration_required(exc)
        raise
    shaped = [_mains_category_view(row) for row in rows]
    if not hierarchical:
        return shaped
    return _build_mains_category_tree(shaped)


@router.post("/mains/categories", response_model=MainsCategoryResponse)
def create_mains_category(
    payload: MainsCategoryCreate,
    user_ctx: Dict[str, Any] = Depends(require_admin_user),
    supabase: Client = Depends(get_supabase_client),
):
    _ = user_ctx
    data = payload.model_dump(exclude_none=True)
    data["meta"] = data.get("meta") if isinstance(data.get("meta"), dict) else {}
    data["created_at"] = _utc_now().isoformat()
    data["updated_at"] = data["created_at"]
    try:
        row = _first(supabase.table(MAINS_CATEGORIES_TABLE).insert(data).execute())
    except Exception as exc:
        if _is_missing_table_like_error(exc, MAINS_CATEGORIES_TABLE):
            _raise_mains_categories_migration_required(exc)
        raise
    if not row:
        raise HTTPException(status_code=400, detail="Failed to create mains category.")
    return MainsCategoryResponse(**_mains_category_view(row))


@router.put("/mains/categories/{category_id}", response_model=MainsCategoryResponse)
def update_mains_category(
    category_id: int,
    payload: MainsCategoryUpdate,
    user_ctx: Dict[str, Any] = Depends(require_admin_user),
    supabase: Client = Depends(get_supabase_client),
):
    _ = user_ctx
    existing = _first(
        supabase.table(MAINS_CATEGORIES_TABLE)
        .select("*")
        .eq("id", category_id)
        .limit(1)
        .execute()
    )
    if not existing:
        raise HTTPException(status_code=404, detail="Mains category not found.")
    updates = payload.model_dump(exclude_none=True)
    if "meta" in updates and not isinstance(updates.get("meta"), dict):
        updates["meta"] = {}
    updates["updated_at"] = _utc_now().isoformat()
    try:
        row = _first(
            supabase.table(MAINS_CATEGORIES_TABLE)
            .update(updates)
            .eq("id", category_id)
            .execute()
        )
    except Exception as exc:
        if _is_missing_table_like_error(exc, MAINS_CATEGORIES_TABLE):
            _raise_mains_categories_migration_required(exc)
        raise
    if not row:
        raise HTTPException(status_code=404, detail="Mains category not found.")
    return MainsCategoryResponse(**_mains_category_view(row))


@router.delete("/mains/categories/{category_id}")
def delete_mains_category(
    category_id: int,
    user_ctx: Dict[str, Any] = Depends(require_admin_user),
    supabase: Client = Depends(get_supabase_client),
):
    _ = user_ctx
    try:
        row = _first(
            supabase.table(MAINS_CATEGORIES_TABLE)
            .delete()
            .eq("id", category_id)
            .execute()
        )
    except Exception as exc:
        if _is_missing_table_like_error(exc, MAINS_CATEGORIES_TABLE):
            _raise_mains_categories_migration_required(exc)
        raise
    if not row:
        raise HTTPException(status_code=404, detail="Mains category not found.")
    return {"ok": True}


@router.get("/mains/categories/{category_id}/sources", response_model=List[MainsCategorySourceResponse])
def list_mains_category_sources(
    category_id: int,
    active_only: bool = False,
    supabase: Client = Depends(get_supabase_client),
):
    category_row = _first(
        supabase.table(MAINS_CATEGORIES_TABLE)
        .select("id")
        .eq("id", category_id)
        .limit(1)
        .execute()
    )
    if not category_row:
        raise HTTPException(status_code=404, detail="Mains category not found.")
    try:
        query = (
            supabase.table(MAINS_CATEGORY_SOURCES_TABLE)
            .select("*")
            .eq("mains_category_id", category_id)
            .order("priority", desc=True)
            .order("id", desc=True)
        )
        if active_only:
            query = query.eq("is_active", True)
        rows = _rows(query.execute())
    except Exception as exc:
        if _is_missing_table_like_error(exc, MAINS_CATEGORY_SOURCES_TABLE):
            _raise_mains_categories_migration_required(exc)
        raise
    return [MainsCategorySourceResponse(**_mains_category_source_view(row)) for row in rows]


@router.post("/mains/categories/{category_id}/sources", response_model=MainsCategorySourceResponse)
def create_mains_category_source(
    category_id: int,
    payload: MainsCategorySourceCreate,
    user_ctx: Dict[str, Any] = Depends(require_admin_user),
    supabase: Client = Depends(get_supabase_client),
):
    category_row = _first(
        supabase.table(MAINS_CATEGORIES_TABLE)
        .select("id")
        .eq("id", category_id)
        .limit(1)
        .execute()
    )
    if not category_row:
        raise HTTPException(status_code=404, detail="Mains category not found.")
    now_iso = _utc_now().isoformat()
    data = payload.model_dump(exclude_none=True)
    data["mains_category_id"] = category_id
    data["source_kind"] = _normalized_source_kind(data.get("source_kind"))
    data["meta"] = data.get("meta") if isinstance(data.get("meta"), dict) else {}
    data["created_by"] = str(user_ctx.get("user_id") or "") or None
    data["created_at"] = now_iso
    data["updated_at"] = now_iso

    if data["source_kind"] == "text" and not str(data.get("source_text") or data.get("source_content_html") or "").strip():
        raise HTTPException(status_code=400, detail="source_text or source_content_html is required for text sources.")
    if data["source_kind"] == "url" and not str(data.get("source_url") or data.get("source_text") or "").strip():
        raise HTTPException(status_code=400, detail="source_url is required for url sources.")
    if data["source_kind"] == "content_item" and not (data.get("content_item_id") or str(data.get("source_text") or "").strip()):
        raise HTTPException(status_code=400, detail="content_item_id is required for content_item sources.")
    if data["source_kind"] == "url":
        normalized_url = _normalize_source_url(data.get("source_url"))
        if normalized_url:
            data["source_url"] = normalized_url
        current_text = str(data.get("source_text") or "").strip()
        if normalized_url and not current_text:
            fetched, fetch_details = _fetch_url_content_detailed(normalized_url)
            if not fetched:
                reason = str(fetch_details.get("error") or "fetch failed")
                raise HTTPException(
                    status_code=400,
                    detail=f"Could not extract content from URL ({reason}). Paste source_text manually or use a different URL.",
                )
            data["source_text"] = fetched
            meta = data.get("meta") if isinstance(data.get("meta"), dict) else {}
            meta.update(
                {
                    "url_snapshot_url": normalized_url,
                    "url_snapshot_fetched_at": _utc_now().isoformat(),
                    "url_snapshot_method": str(fetch_details.get("method") or "direct"),
                    "url_snapshot_chars": len(fetched),
                }
            )
            data["meta"] = meta

    try:
        row = _first(supabase.table(MAINS_CATEGORY_SOURCES_TABLE).insert(data).execute())
    except Exception as exc:
        if _is_missing_table_like_error(exc, MAINS_CATEGORY_SOURCES_TABLE):
            _raise_mains_categories_migration_required(exc)
        raise
    if not row:
        raise HTTPException(status_code=400, detail="Failed to create mains category source.")
    return MainsCategorySourceResponse(**_mains_category_source_view(row))


@router.post("/mains/categories/{category_id}/sources/upload-pdfs", response_model=List[MainsCategorySourceResponse])
async def upload_mains_category_source_pdfs(
    category_id: int,
    files: List[UploadFile] = File(...),
    use_ocr: bool = Query(True),
    priority: int = Query(0),
    is_active: bool = Query(True),
    user_ctx: Dict[str, Any] = Depends(require_admin_user),
    supabase: Client = Depends(get_supabase_client),
):
    category_row = _first(
        supabase.table(MAINS_CATEGORIES_TABLE)
        .select("id")
        .eq("id", category_id)
        .limit(1)
        .execute()
    )
    if not category_row:
        raise HTTPException(status_code=404, detail="Mains category not found.")

    valid_files = [item for item in files if item is not None]
    if not valid_files:
        raise HTTPException(status_code=400, detail="At least one PDF file is required.")
    if len(valid_files) > CATEGORY_PDF_SOURCE_MAX_FILES:
        raise HTTPException(
            status_code=400,
            detail=f"You can upload at most {CATEGORY_PDF_SOURCE_MAX_FILES} PDFs in one request.",
        )

    max_size_bytes = UPLOADED_PDF_MAX_SIZE_MB * 1024 * 1024
    now_iso = _utc_now().isoformat()
    user_id = str(user_ctx.get("user_id") or "").strip() or None
    insert_rows: List[Dict[str, Any]] = []
    skipped: List[str] = []

    for index, file in enumerate(valid_files):
        filename = str(file.filename or f"mains-source-{index + 1}.pdf").strip() or f"mains-source-{index + 1}.pdf"
        if not filename.lower().endswith(".pdf"):
            skipped.append(f"{filename}: not a PDF.")
            continue

        content = await file.read()
        if not content:
            skipped.append(f"{filename}: empty file.")
            continue
        if len(content) > max_size_bytes:
            skipped.append(f"{filename}: exceeds {UPLOADED_PDF_MAX_SIZE_MB} MB.")
            continue

        try:
            compact_text, page_count, used_ocr, original_chars = await _extract_pdf_text_for_category_source(
                file_bytes=content,
                use_ocr=use_ocr,
                max_chars=MAINS_CATEGORY_PDF_SOURCE_MAX_CHARS,
            )
        except RuntimeError as exc:
            raise HTTPException(status_code=503, detail=str(exc))
        except Exception as exc:
            logger.warning("Failed to extract PDF for mains source (%s): %s", filename, exc)
            skipped.append(f"{filename}: extraction failed.")
            continue

        compact_text = compact_text.strip()
        if not compact_text:
            skipped.append(f"{filename}: no text extracted.")
            continue

        insert_rows.append(
            {
                "mains_category_id": category_id,
                "source_kind": "text",
                "title": filename,
                "source_text": compact_text,
                "priority": int(priority) - index,
                "is_active": bool(is_active),
                "meta": {
                    "source_asset_kind": "pdf",
                    "filename": filename,
                    "page_count": int(page_count),
                    "used_ocr": bool(used_ocr),
                    "original_text_chars": int(original_chars),
                    "stored_text_chars": len(compact_text),
                },
                "created_by": user_id,
                "created_at": now_iso,
                "updated_at": now_iso,
            }
        )

    if not insert_rows:
        detail = "No PDF sources were added."
        if skipped:
            detail = f"{detail} {'; '.join(skipped[:5])}"
        raise HTTPException(status_code=400, detail=detail)

    try:
        created_rows = _rows(supabase.table(MAINS_CATEGORY_SOURCES_TABLE).insert(insert_rows).execute())
    except Exception as exc:
        if _is_missing_table_like_error(exc, MAINS_CATEGORY_SOURCES_TABLE):
            _raise_mains_categories_migration_required(exc)
        raise
    if not created_rows:
        raise HTTPException(status_code=400, detail="Failed to create mains category PDF sources.")

    if skipped:
        logger.warning("Skipped some mains PDF uploads for category %s: %s", category_id, "; ".join(skipped))
    return [MainsCategorySourceResponse(**_mains_category_source_view(row)) for row in created_rows]


@router.put("/mains/categories/{category_id}/sources/{source_id}", response_model=MainsCategorySourceResponse)
def update_mains_category_source(
    category_id: int,
    source_id: int,
    payload: MainsCategorySourceUpdate,
    user_ctx: Dict[str, Any] = Depends(require_admin_user),
    supabase: Client = Depends(get_supabase_client),
):
    _ = user_ctx
    existing = _first(
        supabase.table(MAINS_CATEGORY_SOURCES_TABLE)
        .select("*")
        .eq("id", source_id)
        .eq("mains_category_id", category_id)
        .limit(1)
        .execute()
    )
    if not existing:
        raise HTTPException(status_code=404, detail="Mains category source not found.")

    updates = payload.model_dump(exclude_none=True)
    if "source_kind" in updates:
        updates["source_kind"] = _normalized_source_kind(updates.get("source_kind"))
    if "meta" in updates and not isinstance(updates.get("meta"), dict):
        updates["meta"] = {}
    updates["updated_at"] = _utc_now().isoformat()

    next_kind = _normalized_source_kind(updates.get("source_kind", existing.get("source_kind")))
    next_source_text = str(updates.get("source_text", existing.get("source_text")) or "").strip()
    next_source_html = str(updates.get("source_content_html", existing.get("source_content_html")) or "").strip()
    next_source_url = _normalize_source_url(updates.get("source_url", existing.get("source_url")))
    next_content_item_id = updates.get("content_item_id", existing.get("content_item_id"))
    if "source_url" in updates:
        updates["source_url"] = next_source_url or None

    if next_kind == "url":
        existing_source_url = _normalize_source_url(existing.get("source_url"))
        url_changed = bool(next_source_url) and next_source_url != existing_source_url
        manual_updated_text = str(updates.get("source_text") or "").strip() if "source_text" in updates else ""
        should_refresh_snapshot = bool(next_source_url) and (url_changed or not next_source_text)
        if should_refresh_snapshot:
            fetched, fetch_details = _fetch_url_content_detailed(next_source_url)
            if fetched:
                updates["source_text"] = fetched
                next_source_text = fetched
                merged_meta = dict(existing.get("meta") or {})
                if "meta" in updates and isinstance(updates.get("meta"), dict):
                    merged_meta.update(updates.get("meta") or {})
                merged_meta.update(
                    {
                        "url_snapshot_url": next_source_url,
                        "url_snapshot_fetched_at": _utc_now().isoformat(),
                        "url_snapshot_method": str(fetch_details.get("method") or "direct"),
                        "url_snapshot_chars": len(fetched),
                    }
                )
                updates["meta"] = merged_meta
            else:
                reason = str(fetch_details.get("error") or "fetch failed")
                if url_changed and not manual_updated_text:
                    raise HTTPException(
                        status_code=400,
                        detail=(
                            f"URL changed but extraction failed ({reason}). "
                            "Paste source_text manually or provide another URL."
                        ),
                    )
                if not next_source_text:
                    raise HTTPException(
                        status_code=400,
                        detail=f"Could not extract content from URL ({reason}). Paste source_text manually or try another URL.",
                    )

    if next_kind == "text" and not (next_source_text or next_source_html):
        raise HTTPException(status_code=400, detail="source_text or source_content_html is required for text sources.")
    if next_kind == "url" and not (next_source_url or next_source_text):
        raise HTTPException(status_code=400, detail="source_url is required for url sources.")
    if next_kind == "content_item" and not (next_content_item_id or next_source_text):
        raise HTTPException(status_code=400, detail="content_item_id is required for content_item sources.")

    try:
        row = _first(
            supabase.table(MAINS_CATEGORY_SOURCES_TABLE)
            .update(updates)
            .eq("id", source_id)
            .eq("mains_category_id", category_id)
            .execute()
        )
    except Exception as exc:
        if _is_missing_table_like_error(exc, MAINS_CATEGORY_SOURCES_TABLE):
            _raise_mains_categories_migration_required(exc)
        raise
    if not row:
        raise HTTPException(status_code=404, detail="Mains category source not found.")
    return MainsCategorySourceResponse(**_mains_category_source_view(row))


@router.delete("/mains/categories/{category_id}/sources/{source_id}")
def delete_mains_category_source(
    category_id: int,
    source_id: int,
    user_ctx: Dict[str, Any] = Depends(require_admin_user),
    supabase: Client = Depends(get_supabase_client),
):
    _ = user_ctx
    try:
        row = _first(
            supabase.table(MAINS_CATEGORY_SOURCES_TABLE)
            .delete()
            .eq("id", source_id)
            .eq("mains_category_id", category_id)
            .execute()
        )
    except Exception as exc:
        if _is_missing_table_like_error(exc, MAINS_CATEGORY_SOURCES_TABLE):
            _raise_mains_categories_migration_required(exc)
        raise
    if not row:
        raise HTTPException(status_code=404, detail="Mains category source not found.")
    return {"ok": True}


@compat_router.get("/premium-categories/{quiz_type}/")
def get_premium_categories(
    quiz_type: str,
    exam_id: Optional[int] = None,
    parent_id: Optional[int] = None,
    hierarchical: bool = False,
    supabase: Client = Depends(get_supabase_client),
):
    category_type = _category_type_from_quiz_type(quiz_type)
    query = supabase.table("categories").select("*").eq("is_active", True).eq("type", category_type).order("name")
    if parent_id is not None:
        query = query.eq("parent_id", parent_id)
    rows = _rows(query.execute())
    hydrated = [_category_view(row) for row in rows]
    if hierarchical:
        return _build_category_tree(hydrated)
    return hydrated


@compat_router.post("/premium-categories/{quiz_type}/")
def create_premium_category(
    quiz_type: str,
    payload: CategoryCreate,
    supabase: Client = Depends(get_supabase_client),
):
    created_categories, skipped_details = _create_premium_categories(
        quiz_type=quiz_type,
        parent_id=payload.parent_id,
        categories=[
            {
                "name": payload.name,
                "description": payload.description,
                "slug": payload.slug,
                "meta": payload.meta if isinstance(payload.meta, dict) else {},
            }
        ],
        supabase=supabase,
    )
    if not created_categories:
        detail = "; ".join(sorted(set(skipped_details))) or "No categories created."
        raise HTTPException(status_code=409, detail=detail)
    return created_categories[0]


@compat_router.post("/premium-categories/{quiz_type}/bulk/", response_model=CategoryBulkCreateResponse)
def create_premium_categories_bulk(
    quiz_type: str,
    payload: CategoryBulkCreateRequest,
    supabase: Client = Depends(get_supabase_client),
):
    if not payload.categories:
        raise HTTPException(status_code=400, detail="At least one category definition is required.")

    categories_payload = [
        {
            "name": category.name,
            "description": category.description,
        }
        for category in payload.categories
    ]

    created_categories, skipped_details = _create_premium_categories(
        quiz_type=quiz_type,
        parent_id=payload.parent_id,
        categories=categories_payload,
        supabase=supabase,
    )

    if not created_categories and skipped_details:
        raise HTTPException(status_code=409, detail="; ".join(sorted(set(skipped_details))))

    message_parts = [f"Successfully created {len(created_categories)} categories."]
    unique_skipped = sorted(set(skipped_details))
    if unique_skipped:
        preview = "; ".join(unique_skipped[:5])
        if len(unique_skipped) > 5:
            preview += f" (and {len(unique_skipped) - 5} more)"
        message_parts.append(f"Skipped {len(unique_skipped)} entries: {preview}")

    return CategoryBulkCreateResponse(
        message=" ".join(message_parts),
        created_count=len(created_categories),
        created_categories=created_categories,
        skipped_details=unique_skipped,
    )


@compat_router.post("/premium-categories/{quiz_type}/bulk-delete/", response_model=CategoryBulkDeleteResponse)
def delete_premium_categories_bulk(
    quiz_type: str,
    payload: CategoryBulkDeleteRequest,
    supabase: Client = Depends(get_supabase_client),
):
    requested_ids = _normalize_exam_ids(payload.category_ids)
    if not requested_ids:
        raise HTTPException(status_code=400, detail="At least one category ID is required.")

    category_type = _category_type_from_quiz_type(quiz_type)
    expanded_ids, names_by_id = _expand_category_ids_with_descendants(
        requested_ids,
        category_type=category_type,
        supabase=supabase,
    )

    missing_ids = [category_id for category_id in requested_ids if category_id not in names_by_id]
    if not expanded_ids:
        detail = f"No matching categories found for IDs: {missing_ids}" if missing_ids else "No matching categories found."
        raise HTTPException(status_code=404, detail=detail)

    try:
        supabase.table("categories").delete().in_("id", expanded_ids).eq("type", category_type).execute()
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc))

    skipped_details = [f"Category ID {category_id} not found." for category_id in missing_ids]
    descendant_count = max(0, len(expanded_ids) - len([category_id for category_id in requested_ids if category_id in names_by_id]))
    message_parts = [f"Deleted {len(expanded_ids)} categories."]
    if descendant_count > 0:
        message_parts.append(f"Included {descendant_count} descendant categories.")
    if skipped_details:
        message_parts.append(f"Skipped {len(skipped_details)} missing selections.")

    return CategoryBulkDeleteResponse(
        message=" ".join(message_parts),
        deleted_count=len(expanded_ids),
        deleted_category_ids=expanded_ids,
        skipped_details=skipped_details,
    )


@compat_router.get("/premium-categories/{quiz_type}/{category_id}")
def get_premium_category(
    quiz_type: str,
    category_id: int,
    supabase: Client = Depends(get_supabase_client),
):
    category_type = _category_type_from_quiz_type(quiz_type)
    row = _first(
        supabase.table("categories")
        .select("*")
        .eq("id", category_id)
        .eq("type", category_type)
        .limit(1)
        .execute()
    )
    if not row:
        raise HTTPException(status_code=404, detail="Category not found")
    return _category_view(row)


@compat_router.put("/premium-categories/{quiz_type}/{category_id}")
def update_premium_category(
    quiz_type: str,
    category_id: int,
    payload: CategoryUpdate,
    supabase: Client = Depends(get_supabase_client),
):
    category_type = _category_type_from_quiz_type(quiz_type)
    row = _first(
        supabase.table("categories")
        .select("id")
        .eq("id", category_id)
        .eq("type", category_type)
        .limit(1)
        .execute()
    )
    if not row:
        raise HTTPException(status_code=404, detail="Category not found")
    return update_category(category_id, payload, supabase)


@compat_router.delete("/premium-categories/{quiz_type}/{category_id}")
def delete_premium_category(
    quiz_type: str,
    category_id: int,
    supabase: Client = Depends(get_supabase_client),
):
    category_type = _category_type_from_quiz_type(quiz_type)
    row = _first(
        supabase.table("categories")
        .select("id")
        .eq("id", category_id)
        .eq("type", category_type)
        .limit(1)
        .execute()
    )
    if not row:
        raise HTTPException(status_code=404, detail="Category not found")
    return delete_category(category_id, supabase)


# list_premium_ai_settings moved to premium_settings_compat.py


# get_premium_ai_setting moved to premium_settings_compat.py


# create_premium_ai_setting moved to premium_settings_compat.py


# update_premium_ai_setting moved to premium_settings_compat.py


# delete_premium_ai_setting moved to premium_settings_compat.py


@compat_router.get("/premium-ai-quizzes/example-analyses", response_model=PremiumAIExampleAnalysisListResponse)
def list_premium_ai_example_analyses(
    content_type: AISystemInstructionContentType,
    include_admin: bool = True,
    tag_level1: Optional[str] = None,
    tag_level2: Optional[str] = None,
    search: Optional[str] = None,
    limit: int = Query(default=100, ge=1, le=500),
    user_ctx: Optional[Dict[str, Any]] = Depends(get_user_context),
    supabase: Client = Depends(get_supabase_client),
):
    allow_admin_scope = include_admin and bool(user_ctx and user_ctx.get("is_admin"))
    try:
        query = supabase.table(EXAMPLE_ANALYSES_TABLE).select("*").eq("content_type", content_type.value).order("updated_at", desc=True).limit(limit)
        if not allow_admin_scope:
            query = query.eq("is_active", True)
        if tag_level1:
            query = query.eq("tag_level1", tag_level1.strip().lower())
        if tag_level2:
            query = query.eq("tag_level2", tag_level2.strip().lower())
        rows = _rows(query.execute())
    except Exception as exc:
        if _is_missing_table_error(exc, EXAMPLE_ANALYSES_TABLE):
            logger.warning("premium_ai_example_analyses missing; returning empty list")
            return {"items": [], "total": 0}
        raise

    if search:
        needle = search.strip().lower()
        rows = [row for row in rows if needle in str(row.get("title") or "").lower() or needle in str(row.get("description") or "").lower()]
    items = [_example_analysis_view(row) for row in rows]
    return {"items": items, "total": len(items)}


@compat_router.post("/premium-ai-quizzes/example-analyses", response_model=PremiumAIExampleAnalysis)
def create_premium_ai_example_analysis(
    payload: PremiumAIExampleAnalysisCreate,
    user_ctx: Dict[str, Any] = Depends(require_admin_user),
    supabase: Client = Depends(get_supabase_client),
):
    normalized_l1, normalized_l2 = _validate_tag_hierarchy(payload.tag_level1, payload.tag_level2)
    exam_ids = _normalize_exam_ids(payload.exam_ids)
    if exam_ids:
        _load_exam_rows_by_ids(exam_ids, supabase)
    try:
        row = _first(
            supabase.table(EXAMPLE_ANALYSES_TABLE)
            .insert(
                {
                    "title": payload.title,
                    "description": payload.description,
                    "tag_level1": normalized_l1,
                    "tag_level2": normalized_l2,
                    "content_type": payload.content_type.value,
                    "style_profile": payload.style_profile,
                    "example_questions": payload.example_questions,
                    "tags": [str(tag).strip().lower() for tag in payload.tags if str(tag).strip()],
                    "exam_ids": exam_ids,
                    "is_active": payload.is_active,
                }
            )
            .execute()
        )
    except Exception as exc:
        if _is_missing_table_error(exc, EXAMPLE_ANALYSES_TABLE):
            _raise_example_analyses_migration_required(exc)
        raise
    if not row:
        raise HTTPException(status_code=400, detail="Could not create example analysis")
    return _example_analysis_view(row)


@compat_router.get("/premium-ai-quizzes/example-analyses/{analysis_id}", response_model=PremiumAIExampleAnalysis)
def get_premium_ai_example_analysis(
    analysis_id: int,
    supabase: Client = Depends(get_supabase_client),
):
    try:
        row = _first(supabase.table(EXAMPLE_ANALYSES_TABLE).select("*").eq("id", analysis_id).limit(1).execute())
    except Exception as exc:
        if _is_missing_table_error(exc, EXAMPLE_ANALYSES_TABLE):
            _raise_example_analyses_migration_required(exc)
        raise
    if not row:
        raise HTTPException(status_code=404, detail="Example analysis not found.")
    return _example_analysis_view(row)


@compat_router.put("/premium-ai-quizzes/example-analyses/{analysis_id}", response_model=PremiumAIExampleAnalysis)
def update_premium_ai_example_analysis(
    analysis_id: int,
    payload: PremiumAIExampleAnalysisUpdate,
    user_ctx: Dict[str, Any] = Depends(require_admin_user),
    supabase: Client = Depends(get_supabase_client),
):
    current = _first(supabase.table(EXAMPLE_ANALYSES_TABLE).select("*").eq("id", analysis_id).limit(1).execute())
    if not current:
        raise HTTPException(status_code=404, detail="Example analysis not found.")

    updates = payload.model_dump(exclude_none=True)
    next_l1 = updates.get("tag_level1", current.get("tag_level1"))
    next_l2 = updates.get("tag_level2", current.get("tag_level2"))
    normalized_l1, normalized_l2 = _validate_tag_hierarchy(next_l1, next_l2)
    if "tag_level1" in updates:
        updates["tag_level1"] = normalized_l1
    if "tag_level2" in updates:
        updates["tag_level2"] = normalized_l2
    if "tags" in updates:
        updates["tags"] = [str(tag).strip().lower() for tag in updates["tags"] if str(tag).strip()]
    if "exam_ids" in updates:
        updates["exam_ids"] = _normalize_exam_ids(updates.get("exam_ids"))
        if updates["exam_ids"]:
            _load_exam_rows_by_ids(updates["exam_ids"], supabase)
    try:
        row = _first(supabase.table(EXAMPLE_ANALYSES_TABLE).update(updates).eq("id", analysis_id).execute())
    except Exception as exc:
        if _is_missing_table_error(exc, EXAMPLE_ANALYSES_TABLE):
            _raise_example_analyses_migration_required(exc)
        raise
    if not row:
        raise HTTPException(status_code=404, detail="Example analysis not found.")
    return _example_analysis_view(row)


@compat_router.delete("/premium-ai-quizzes/example-analyses/{analysis_id}")
def delete_premium_ai_example_analysis(
    analysis_id: int,
    user_ctx: Dict[str, Any] = Depends(require_admin_user),
    supabase: Client = Depends(get_supabase_client),
):
    try:
        row = _first(supabase.table(EXAMPLE_ANALYSES_TABLE).delete().eq("id", analysis_id).execute())
    except Exception as exc:
        if _is_missing_table_error(exc, EXAMPLE_ANALYSES_TABLE):
            _raise_example_analyses_migration_required(exc)
        raise
    if not row:
        raise HTTPException(status_code=404, detail="Example analysis not found.")
    return {"message": "Deleted"}


def _utc_now() -> datetime:
    return datetime.now(timezone.utc)


def _uploaded_pdf_view(row: Dict[str, Any]) -> Dict[str, Any]:
    return {
        "id": int(row["id"]),
        "filename": str(row.get("filename") or "uploaded.pdf"),
        "extracted_text": str(row.get("extracted_text") or ""),
        "uploader_id": str(row.get("uploader_id") or ""),
        "page_count": int(row["page_count"]) if row.get("page_count") is not None else None,
        "used_ocr": bool(row.get("used_ocr") or False),
        "created_at": str(row.get("created_at") or ""),
        "expires_at": str(row.get("expires_at") or "") or None,
    }


def _cleanup_expired_uploaded_pdfs(
    *,
    supabase: Client,
    user_id: str,
) -> None:
    now_iso = _utc_now().isoformat()
    try:
        supabase.table(UPLOADED_PDFS_TABLE).delete().eq("uploader_id", user_id).lt("expires_at", now_iso).execute()
    except Exception as exc:
        if _is_missing_table_error(exc, UPLOADED_PDFS_TABLE):
            _raise_uploaded_pdfs_migration_required(exc)
        logger.warning("Failed to cleanup expired uploaded PDFs for %s: %s", user_id, exc)


def _extract_text_from_pdf_bytes(file_bytes: bytes) -> tuple[str, int]:
    try:
        import pypdf  # noqa: WPS433
    except Exception as exc:
        raise RuntimeError("Missing dependency 'pypdf'. Add it to backend requirements.") from exc
    reader = pypdf.PdfReader(io.BytesIO(file_bytes))
    page_count = len(reader.pages)
    pieces: List[str] = []
    for page in reader.pages:
        try:
            chunk = (page.extract_text() or "").strip()
        except Exception:
            chunk = ""
        if chunk:
            pieces.append(chunk)
    text = "\n\n".join(pieces).strip()
    return text, page_count


async def _ocr_pdf_bytes(
    file_bytes: bytes,
    *,
    ai_provider: AIProvider = AIProvider.GEMINI,
    ai_model_name: str = "gemini-3-flash-preview",
    max_pages: int = UPLOADED_PDF_OCR_MAX_PAGES,
) -> str:
    try:
        import fitz  # type: ignore # noqa: WPS433
    except Exception as exc:
        raise RuntimeError("Missing dependency 'PyMuPDF'. Add it to backend requirements.") from exc

    doc = fitz.open(stream=file_bytes, filetype="pdf")
    images_base64: List[str] = []
    try:
        for page_index in range(min(max_pages, doc.page_count)):
            page = doc.load_page(page_index)
            pix = page.get_pixmap(matrix=fitz.Matrix(1.8, 1.8), alpha=False)
            image_bytes = pix.tobytes("png")
            images_base64.append(base64.b64encode(image_bytes).decode("utf-8"))
    finally:
        doc.close()

    if not images_base64:
        return ""

    ocr_request = OCRRequest(
        images_base64=images_base64,
        ai_provider=ai_provider,
        ai_model_name=ai_model_name,
    )
    return await extract_text_from_images(ocr_request)


async def _extract_text_from_pdf_with_optional_ocr(
    file_bytes: bytes,
    *,
    use_ocr: bool,
    ai_provider: AIProvider = AIProvider.GEMINI,
    ai_model_name: str = "gemini-3-flash-preview",
) -> tuple[str, int, bool]:
    extracted_text, page_count = _extract_text_from_pdf_bytes(file_bytes)
    used_ocr = False
    if use_ocr and len(extracted_text.strip()) < UPLOADED_PDF_MIN_TEXT_CHARS:
        ocr_text = await _ocr_pdf_bytes(
            file_bytes,
            ai_provider=ai_provider,
            ai_model_name=ai_model_name,
        )
        ocr_text = (ocr_text or "").strip()
        if ocr_text:
            used_ocr = True
            if extracted_text.strip():
                extracted_text = f"{extracted_text.strip()}\n\n{ocr_text}"
            else:
                extracted_text = ocr_text
    return extracted_text.strip(), page_count, used_ocr


def _compact_pdf_text_for_source(
    raw_text: str,
    *,
    max_chars: int,
) -> str:
    if not raw_text:
        return ""

    text = str(raw_text).replace("\r\n", "\n").replace("\r", "\n").replace("\x00", " ")
    lines = text.split("\n")
    seen: Set[str] = set()
    kept: List[str] = []
    current_len = 0
    truncation_note = "\n[Truncated from uploaded PDF]"

    for line in lines:
        normalized = re.sub(r"\s+", " ", line).strip()
        if not normalized:
            continue
        lowered = normalized.lower()
        if lowered in seen:
            continue
        if re.fullmatch(r"[\d\s\-_/.,:;()]+", normalized):
            continue
        if re.fullmatch(r"page\s*\d+(\s*of\s*\d+)?", lowered):
            continue
        seen.add(lowered)
        projected = current_len + len(normalized) + (1 if kept else 0)
        if projected > max_chars:
            break
        kept.append(normalized)
        current_len = projected

    merged = "\n".join(kept).strip()
    if len(merged) < len(text.strip()) and len(merged) + len(truncation_note) <= max_chars:
        merged = f"{merged}{truncation_note}".strip()
    return merged[:max_chars].strip()


async def _extract_pdf_text_for_category_source(
    *,
    file_bytes: bytes,
    use_ocr: bool,
    max_chars: int,
) -> Tuple[str, int, bool, int]:
    extracted_text, page_count, used_ocr = await _extract_text_from_pdf_with_optional_ocr(
        file_bytes,
        use_ocr=use_ocr,
    )
    normalized = extracted_text.strip()
    if not normalized:
        return "", page_count, used_ocr, 0
    compact_text = _compact_pdf_text_for_source(normalized, max_chars=max_chars).strip()
    if not compact_text:
        compact_text = normalized[:max_chars].strip()
    return compact_text, page_count, used_ocr, len(normalized)


def _resolve_preview_content(
    request: AIGenerateQuizRequest,
    *,
    supabase: Client,
    content_type: Optional[AISystemInstructionContentType] = None,
    requester_user_id: Optional[str] = None,
    requester_is_admin: bool = False,
) -> str:
    if request.use_category_source:
        if content_type is None:
            raise HTTPException(status_code=400, detail="content_type is required for category source mode.")
        quiz_kind = _quiz_kind_for_content_type(content_type)
        source_text, _source_meta = _resolve_quiz_category_source_content(
            category_ids=request.category_ids or [],
            quiz_kind=quiz_kind,
            supabase=supabase,
        )
        return source_text

    if request.content and request.content.strip():
        return request.content.strip()
    if request.uploaded_pdf_id is not None:
        pdf_id = int(request.uploaded_pdf_id)
        try:
            row = _first(
                supabase.table(UPLOADED_PDFS_TABLE)
                .select("*")
                .eq("id", pdf_id)
                .limit(1)
                .execute()
            )
        except Exception as exc:
            if _is_missing_table_error(exc, UPLOADED_PDFS_TABLE):
                _raise_uploaded_pdfs_migration_required(exc)
            raise
        if not row:
            raise HTTPException(status_code=404, detail="Uploaded PDF not found.")
        owner_id = str(row.get("uploader_id") or "")
        if requester_user_id and not requester_is_admin and owner_id and owner_id != requester_user_id:
            raise HTTPException(status_code=403, detail="You do not have access to this uploaded PDF.")
        expires_at_raw = row.get("expires_at")
        if expires_at_raw:
            try:
                expires_at = datetime.fromisoformat(str(expires_at_raw).replace("Z", "+00:00"))
                if _utc_now() >= expires_at:
                    raise HTTPException(status_code=410, detail="Uploaded PDF has expired. Please upload it again.")
            except HTTPException:
                raise
            except Exception:
                pass
        extracted_text = str(row.get("extracted_text") or "").strip()
        if not extracted_text:
            raise HTTPException(status_code=400, detail="Uploaded PDF has no extracted text.")
        return extracted_text
    if request.url and request.url.strip():
        url = request.url.strip()
        fetched, fetch_details = _fetch_url_content_detailed(url)
        if fetched:
            return fetched
        reason = str(fetch_details.get("error") or "fetch failed").strip()
        raise HTTPException(
            status_code=400,
            detail=(
                "Could not extract content from the provided URL "
                f"({reason}). Paste source text manually or use a different URL."
            ),
        )
    raise HTTPException(status_code=400, detail="At least one of content, url, or uploaded_pdf_id is required.")


def _normalize_source_url(raw_url: Any) -> str:
    candidate = str(raw_url or "").strip()
    if not candidate:
        return ""
    parsed = urlparse(candidate)
    if parsed.scheme in {"http", "https"}:
        return candidate
    if not parsed.scheme:
        if candidate.startswith("//"):
            return f"https:{candidate}"
        return f"https://{candidate}"
    return candidate


def _decode_http_response_bytes(raw_bytes: bytes, charset_hint: Optional[str]) -> str:
    encodings: List[str] = []
    if charset_hint:
        encodings.append(str(charset_hint))
    encodings.extend(["utf-8", "latin-1", "cp1252"])
    for encoding in encodings:
        try:
            return raw_bytes.decode(encoding, errors="ignore")
        except Exception:
            continue
    return raw_bytes.decode("utf-8", errors="ignore")


def _normalize_extracted_source_text(raw_text: Optional[str], *, max_chars: int = 30000) -> str:
    text = str(raw_text or "").replace("\r\n", "\n").replace("\r", "\n").strip()
    if not text:
        return ""

    legacy_prefix = re.match(
        r"(?is)^\s*(?:source\s+url:\s*.+?\n+)?(?:page\s+title:\s*.+?\n+)?extracted\s+content\s*:\s*",
        text,
    )
    if legacy_prefix:
        text = text[legacy_prefix.end() :].strip()

    lines: List[str] = []
    for raw_line in text.splitlines():
        line = str(raw_line or "").strip()
        if line.lower().startswith("source url:") or line.lower().startswith("page title:"):
            continue
        lines.append(raw_line.rstrip())
    cleaned = "\n".join(lines)

    cleaned = html.unescape(cleaned)
    cleaned = re.sub(r"[ \t\f\v]+", " ", cleaned)
    cleaned = re.sub(r"\n{3,}", "\n\n", cleaned)
    cleaned = cleaned.strip()
    if len(cleaned) > max_chars:
        cleaned = cleaned[:max_chars].rstrip()
    return cleaned


def _extract_text_from_html(html_content: str, max_chars: int = 30000) -> Optional[str]:
    if not html_content:
        return None
    try:
        soup = BeautifulSoup(html_content, "html.parser")
        for tag in soup(["script", "style", "noscript", "header", "footer", "nav", "aside", "form", "svg"]):
            tag.decompose()

        candidates: List[str] = []
        for selector in ["article", "main", "[role='main']", ".post-content", ".entry-content", ".article-content", "#content", ".content"]:
            for node in soup.select(selector)[:6]:
                text = re.sub(r"\s+", " ", node.get_text(separator=" ", strip=True)).strip()
                if len(text) >= 220:
                    candidates.append(text)

        if not candidates:
            body = soup.body if soup.body else soup
            body_text = re.sub(r"\s+", " ", body.get_text(separator=" ", strip=True)).strip()
            if body_text:
                candidates.append(body_text)

        if not candidates:
            return None
        longest = max(candidates, key=len)
        if not longest:
            return None
        normalized = _normalize_extracted_source_text(longest, max_chars=max_chars)
        return normalized if normalized else None
    except Exception:
        return None


def _fetch_url_content_detailed(url: str) -> Tuple[Optional[str], Dict[str, Any]]:
    normalized_url = _normalize_source_url(url)
    parsed = urlparse(normalized_url)
    details: Dict[str, Any] = {
        "requested_url": str(url or "").strip(),
        "normalized_url": normalized_url,
        "method": None,
        "error": None,
    }
    if not normalized_url:
        details["error"] = "Empty URL."
        return None, details
    if parsed.scheme not in {"http", "https"}:
        details["error"] = f"Unsupported URL scheme: {parsed.scheme or 'unknown'}"
        return None, details

    header_profiles = [
        {
            "User-Agent": (
                "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
                "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36"
            ),
            "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
            "Accept-Language": "en-US,en;q=0.9",
        },
        {
            "User-Agent": (
                "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) "
                "AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1"
            ),
            "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
            "Accept-Language": "en-US,en;q=0.9",
        },
    ]

    best_effort_text: Optional[str] = None
    best_effort_title = ""

    for profile in header_profiles:
        try:
            request = Request(normalized_url, headers=profile)
            with urlopen(request, timeout=URL_SOURCE_FETCH_TIMEOUT_SECONDS) as response:
                raw_bytes = response.read()
                content_type = str(response.headers.get("Content-Type") or "").lower()
                decoded = _decode_http_response_bytes(raw_bytes, response.headers.get_content_charset())

            if "text/html" in content_type or "application/xhtml+xml" in content_type or "<html" in decoded.lower():
                extracted = _extract_text_from_html(decoded)
                if extracted:
                    title = ""
                    try:
                        title_tag = BeautifulSoup(decoded, "html.parser").find("title")
                        if title_tag and title_tag.get_text(strip=True):
                            title = title_tag.get_text(strip=True)
                    except Exception:
                        title = ""

                    if len(extracted) >= URL_SOURCE_MIN_EXTRACT_CHARS:
                        details["method"] = "direct_html"
                        details["error"] = None
                        if title:
                            details["title"] = title
                        return extracted, details
                    if not best_effort_text or len(extracted) > len(best_effort_text):
                        best_effort_text = extracted
                        best_effort_title = title
            else:
                cleaned = _normalize_extracted_source_text(decoded, max_chars=30000)
                if cleaned:
                    if len(cleaned) >= URL_SOURCE_MIN_EXTRACT_CHARS:
                        details["method"] = "direct_non_html"
                        details["error"] = None
                        return cleaned, details
                    if not best_effort_text or len(cleaned) > len(best_effort_text):
                        best_effort_text = cleaned
                        best_effort_title = ""
        except (HTTPError, URLError, TimeoutError) as exc:
            details["error"] = str(exc)
            continue
        except Exception as exc:
            details["error"] = str(exc)
            continue

    reader_url = f"https://r.jina.ai/{normalized_url}"
    try:
        reader_request = Request(
            reader_url,
            headers={
                "User-Agent": "Mozilla/5.0",
                "Accept": "text/plain,*/*;q=0.8",
                "Accept-Language": "en-US,en;q=0.8",
            },
        )
        with urlopen(reader_request, timeout=URL_SOURCE_FETCH_TIMEOUT_SECONDS) as response:
            raw_bytes = response.read()
            decoded = _decode_http_response_bytes(raw_bytes, response.headers.get_content_charset())
        cleaned = _normalize_extracted_source_text(decoded, max_chars=30000)
        if cleaned and len(cleaned) >= URL_SOURCE_MIN_EXTRACT_CHARS:
            details["method"] = "reader_proxy"
            details["error"] = None
            return cleaned, details
    except Exception as exc:
        details["error"] = str(exc)

    if best_effort_text and len(best_effort_text) >= URL_SOURCE_MIN_EXTRACT_CHARS:
        details["method"] = "best_effort"
        details["error"] = None
        if best_effort_title:
            details["title"] = best_effort_title
        return best_effort_text, details

    if best_effort_text and not details.get("error"):
        details["error"] = (
            f"Only {len(best_effort_text)} characters of readable text could be extracted "
            f"(minimum {URL_SOURCE_MIN_EXTRACT_CHARS})."
        )

    return None, details


def _fetch_url_content(url: str) -> Optional[str]:
    content, details = _fetch_url_content_detailed(url)
    if content:
        return content
    logger.warning("Failed to fetch URL content (%s): %s", url, details.get("error") or "unknown error")
    return None


def _build_generate_request(
    request: AIGenerateQuizRequest,
    content_type: AISystemInstructionContentType,
    supabase: Client,
    *,
    resolved_content: Optional[str] = None,
    setting_override_row: Optional[Dict[str, Any]] = None,
    example_analysis_row: Optional[Dict[str, Any]] = None,
) -> tuple[AIQuizGenerateRequest, Optional[Dict[str, Any]]]:
    setting_override = setting_override_row
    if setting_override is None:
        if request.ai_instruction_id is not None:
            setting_override = _first(
                supabase.table("premium_ai_quiz_instructions")
                .select("*")
                .eq("id", request.ai_instruction_id)
                .limit(1)
                .execute()
            )
            if setting_override is None:
                setting_override = _first(
                    supabase.table("ai_instructions")
                    .select("*")
                    .eq("id", request.ai_instruction_id)
                    .limit(1)
                    .execute()
                )
        if setting_override is None:
            setting_override = _setting_row_for_content_type(content_type, supabase)

    instruction_payload = _instruction_row_to_payload(setting_override) if setting_override else None
    default_provider = instruction_payload["ai_provider"].value if instruction_payload else AIProvider.GEMINI.value
    default_model = instruction_payload["ai_model_name"] if instruction_payload else "gemini-3-flash-preview"
    example_questions = request.example_questions or ([] if not request.example_question else [request.example_question])
    desired_count = request.desired_question_count or 5
    quiz_kind = _quiz_kind_for_content_type(content_type)
    requested_category_ids = _normalize_exam_ids(request.category_ids or [])
    category_instruction_block = _category_structure_instruction_block(
        quiz_kind,
        supabase,
        requested_category_ids=requested_category_ids,
    )
    language_instruction_block = _language_instruction_block(request.output_language, scope="quiz")
    merged_user_instructions = _merge_instruction_parts(
        request.user_instructions,
        category_instruction_block or None,
        language_instruction_block,
    )

    generate_request = AIQuizGenerateRequest(
        content=resolved_content if resolved_content is not None else _resolve_preview_content(
            request,
            supabase=supabase,
            content_type=content_type,
        ),
        content_type=content_type.value,
        quiz_kind=quiz_kind,
        example_analysis_id=request.example_analysis_id,
        user_instructions=merged_user_instructions,
        formatting_instruction_text=request.formatting_instruction_text,
        example_questions=example_questions,
        recent_questions=request.recent_questions,
        instruction_type=AIInstructionType.QUIZ_GEN,
        instruction_id=request.ai_instruction_id,
        provider=request.ai_provider.value if request.ai_provider else default_provider,
        model=request.ai_model_name or default_model,
        category_id=requested_category_ids[0] if requested_category_ids else None,
        count=desired_count,
        output_language=request.output_language,
    )
    if request.example_analysis_id:
        resolved_example_analysis_row = example_analysis_row
        if resolved_example_analysis_row is None:
            resolved_example_analysis_row = _safe_first(
                supabase.table(EXAMPLE_ANALYSES_TABLE)
                .select("*")
                .eq("id", request.example_analysis_id)
                .eq("is_active", True)
                .limit(1)
            )
        if resolved_example_analysis_row:
            _apply_example_analysis_to_generate_request(generate_request, resolved_example_analysis_row)

    override_payload: Optional[Dict[str, Any]] = None
    if instruction_payload and instruction_payload.get("system_instructions"):
        override_payload = {
            "system_prompt": instruction_payload["system_instructions"],
            "user_prompt_template": None,
        }
    elif setting_override and setting_override.get("system_prompt"):
        override_payload = {
            "system_prompt": setting_override.get("system_prompt"),
            "user_prompt_template": setting_override.get("user_prompt_template"),
        }
    return generate_request, override_payload


async def _generate_preview_items(
    request: AIGenerateQuizRequest,
    content_type: AISystemInstructionContentType,
    supabase: Client,
    *,
    resolved_content: Optional[str] = None,
    setting_override_row: Optional[Dict[str, Any]] = None,
    example_analysis_row: Optional[Dict[str, Any]] = None,
) -> List[Dict[str, Any]]:
    generate_request, setting_override = _build_generate_request(
        request,
        content_type,
        supabase,
        resolved_content=resolved_content,
        setting_override_row=setting_override_row,
        example_analysis_row=example_analysis_row,
    )
    try:
        items = await generate_quiz_content(generate_request, instruction_override=setting_override)
    except RuntimeError as exc:
        raise HTTPException(status_code=503, detail=str(exc))
    if not items:
        raise HTTPException(
            status_code=502,
            detail="AI did not return parseable quiz data. Verify provider configuration and prompt quality.",
        )
    quiz_kind = _quiz_kind_for_content_type(content_type)
    return _assign_category_ids_to_generated_items(
        items,
        quiz_kind=quiz_kind,
        supabase=supabase,
        requested_category_ids=request.category_ids,
        source_text=generate_request.content,
    )


async def _preview_quiz(
    request: AIGenerateQuizRequest,
    content_type: AISystemInstructionContentType,
    supabase: Client,
    user_ctx: Optional[Dict[str, Any]] = None,
) -> PremiumPreviewResponse:
    user_id = str((user_ctx or {}).get("user_id") or "").strip() or None
    quiz_kind = _quiz_kind_for_content_type(content_type)
    request_for_generation = request.model_copy(deep=True)
    memory_before = _load_user_quiz_hint_memory(
        user_id=user_id,
        quiz_kind=quiz_kind,
        supabase=supabase,
    )
    _apply_user_hint_memory_to_preview_request(
        request_for_generation,
        memory=memory_before,
    )

    resolved_content = _resolve_preview_content(
        request_for_generation,
        supabase=supabase,
        content_type=content_type,
        requester_user_id=user_id,
        requester_is_admin=bool((user_ctx or {}).get("is_admin")),
    )
    items = await _generate_preview_items(
        request_for_generation,
        content_type,
        supabase,
        resolved_content=resolved_content,
    )
    fresh_hints = _collect_coverage_hints_from_items(items)
    fresh_recent_questions = _collect_question_texts_from_items(items)
    _update_user_quiz_hint_memory(
        user_id=user_id,
        quiz_kind=quiz_kind,
        hint_candidates=fresh_hints,
        recent_question_candidates=fresh_recent_questions,
        supabase=supabase,
    )
    return PremiumPreviewResponse(parsed_quiz_data=_preview_payload_for_items(items, content_type))


def _preview_payload_for_items(
    items: List[Dict[str, Any]],
    content_type: AISystemInstructionContentType,
) -> Dict[str, Any]:
    if not items:
        return {}

    if content_type == AISystemInstructionContentType.PREMIUM_PASSAGE_QUIZ:
        if len(items) == 1:
            return items[0]
        return {"passages": items}

    first = dict(items[0])
    first["questions"] = items
    return first


def _count_generated_questions(items: List[Dict[str, Any]]) -> int:
    count = 0
    for item in items:
        if not isinstance(item, dict):
            continue
        questions = item.get("questions")
        if isinstance(questions, list):
            count += sum(1 for candidate in questions if isinstance(candidate, dict))
            continue
        if str(item.get("question_statement") or item.get("question_text") or item.get("question") or "").strip():
            count += 1
    return count


def _collect_question_texts_from_items(items: List[Dict[str, Any]]) -> List[str]:
    output: List[str] = []
    for item in items:
        if not isinstance(item, dict):
            continue
        direct = item.get("question_statement") or item.get("question_text") or item.get("question")
        direct_text = str(direct or "").strip()
        if direct_text:
            output.append(direct_text)
        nested = item.get("questions")
        if isinstance(nested, list):
            for question in nested:
                if not isinstance(question, dict):
                    continue
                nested_text = str(
                    question.get("question_statement")
                    or question.get("question_text")
                    or question.get("question")
                    or ""
                ).strip()
                if nested_text:
                    output.append(nested_text)
    return output


def _as_string_list(value: Any) -> List[str]:
    if isinstance(value, list):
        output: List[str] = []
        for item in value:
            text = str(item or "").strip()
            if text:
                output.append(text)
        return output
    if isinstance(value, str):
        cleaned = value.strip()
        return [cleaned] if cleaned else []
    return []


def _plain_text_for_hint(value: Any) -> str:
    text = str(value or "")
    if not text:
        return ""
    text = re.sub(r"<[^>]+>", " ", text)
    text = html.unescape(text)
    return re.sub(r"\s+", " ", text).strip()


def _strip_statement_marker(text: str) -> str:
    cleaned = str(text or "").strip()
    if not cleaned:
        return ""
    cleaned = re.sub(
        r"^\s*(?:[-*•]\s*)?(?:(?:statement|fact)\s*)?(?:\(?[ivxlcdm]+\)?|\(?\d+\)?|[a-z])[\)\.\:\-]\s*",
        "",
        cleaned,
        flags=re.IGNORECASE,
    )
    return cleaned.strip()


def _compact_hint_phrase(text: Any, *, max_words: int) -> str:
    plain = _strip_statement_marker(_plain_text_for_hint(text))
    if not plain:
        return ""
    words = re.findall(r"[A-Za-z0-9()'/-]+", plain)
    if not words:
        return ""
    return " ".join(words[:max_words]).strip()


_GENERIC_HINT_PREFIXES: Tuple[str, ...] = (
    "consider the following statements",
    "consider the following",
    "which one of the following",
    "select the correct",
    "choose the correct",
    "mark the correct",
    "pick the correct",
)


def _is_generic_hint_phrase(text: str) -> bool:
    normalized = str(text or "").strip().lower()
    if not normalized:
        return True
    return any(normalized.startswith(prefix) for prefix in _GENERIC_HINT_PREFIXES)


def _normalize_hint_key(text: str) -> str:
    normalized = re.sub(r"[^a-z0-9\s]+", " ", str(text or "").lower())
    normalized = re.sub(r"\s+", " ", normalized).strip()
    return normalized


def _merge_unique_memory_values(
    existing: List[str],
    incoming: List[str],
    *,
    max_items: int,
    max_chars: int,
) -> List[str]:
    output: List[str] = []
    seen: Set[str] = set()
    for value in list(existing) + list(incoming):
        text = _plain_text_for_hint(value)
        if not text:
            continue
        if len(text) > max_chars:
            text = text[:max_chars].rstrip(" ,;|/")
        key = _normalize_hint_key(text)
        if not key or key in seen:
            continue
        seen.add(key)
        output.append(text)
    if len(output) > max_items:
        output = output[-max_items:]
    return output


def _collect_coverage_hints_from_question(question: Dict[str, Any]) -> Optional[str]:
    question_phrase = _compact_hint_phrase(
        question.get("question_statement") or question.get("question_text") or question.get("question"),
        max_words=14,
    )
    prompt_phrase = _compact_hint_phrase(question.get("question_prompt") or question.get("prompt"), max_words=12)
    statement_phrases: List[str] = []
    for raw_statement in _as_string_list(question.get("statements_facts") or question.get("statement_facts"))[:2]:
        phrase = _compact_hint_phrase(raw_statement, max_words=8)
        if phrase:
            statement_phrases.append(phrase)

    segments: List[str] = []
    if question_phrase and not _is_generic_hint_phrase(question_phrase):
        segments.append(question_phrase)
    if statement_phrases:
        segments.append(" / ".join(statement_phrases[:2]))
    elif prompt_phrase and not _is_generic_hint_phrase(prompt_phrase):
        prompt_key = _normalize_hint_key(prompt_phrase)
        question_key = _normalize_hint_key(question_phrase)
        if prompt_key and prompt_key != question_key:
            segments.append(prompt_phrase)

    if not segments and prompt_phrase:
        segments.append(prompt_phrase)
    if not segments:
        return None

    hint_text = " | ".join(segments).strip(" ,;|/")
    if not hint_text:
        return None
    if len(hint_text) > 120:
        hint_text = hint_text[:120].rstrip(" ,;|/")
    return hint_text or None


def _collect_coverage_hints_from_items(items: List[Dict[str, Any]]) -> List[str]:
    hints: List[str] = []
    for item in items:
        if not isinstance(item, dict):
            continue
        nested_questions = [q for q in (item.get("questions") or []) if isinstance(q, dict)]
        if nested_questions:
            for question in nested_questions:
                hint = _collect_coverage_hints_from_question(question)
                if hint:
                    hints.append(hint)
            continue
        hint = _collect_coverage_hints_from_question(item)
        if hint:
            hints.append(hint)
    return _merge_unique_memory_values([], hints, max_items=USER_AI_HINTS_MAX_HINTS, max_chars=120)


def _coverage_hints_instruction_block(hints: List[str]) -> Optional[str]:
    normalized_hints = _merge_unique_memory_values([], hints, max_items=6, max_chars=120)
    if not normalized_hints:
        return None
    lines = [
        "Recent coverage hints for this user (avoid repeating these same aspects):",
    ]
    for hint in normalized_hints:
        lines.append(f"- {hint}")
    lines.append("- Generate fresh sub-topics/angles and avoid minor rewording of these same points.")
    return "\n".join(lines)


def _load_user_quiz_hint_memory(
    *,
    user_id: Optional[str],
    quiz_kind: QuizKind,
    supabase: Client,
) -> Dict[str, List[str]]:
    empty = {"hints": [], "recent_questions": []}
    if not user_id:
        return empty

    try:
        row = _first(
            supabase.table(USER_AI_QUIZ_HINTS_TABLE)
            .select("hints, recent_questions")
            .eq("user_id", user_id)
            .eq("quiz_kind", quiz_kind.value)
            .limit(1)
            .execute()
        )
    except Exception as exc:
        if _is_missing_table_like_error(exc, USER_AI_QUIZ_HINTS_TABLE):
            _warn_user_hint_table_missing(exc)
        else:
            logger.warning("Failed to load user AI quiz hint memory for %s/%s: %s", user_id, quiz_kind.value, exc)
        return empty

    if not row:
        return empty

    hints = _merge_unique_memory_values(
        [],
        _as_string_list(row.get("hints")),
        max_items=USER_AI_HINTS_MAX_HINTS,
        max_chars=120,
    )
    recent_questions = _merge_unique_memory_values(
        [],
        _as_string_list(row.get("recent_questions")),
        max_items=USER_AI_HINTS_MAX_RECENT_QUESTIONS,
        max_chars=240,
    )
    return {"hints": hints, "recent_questions": recent_questions}


def _update_user_quiz_hint_memory(
    *,
    user_id: Optional[str],
    quiz_kind: QuizKind,
    hint_candidates: Optional[List[str]],
    recent_question_candidates: Optional[List[str]],
    supabase: Client,
) -> Dict[str, List[str]]:
    current = _load_user_quiz_hint_memory(user_id=user_id, quiz_kind=quiz_kind, supabase=supabase)
    merged_hints = _merge_unique_memory_values(
        current.get("hints") or [],
        hint_candidates or [],
        max_items=USER_AI_HINTS_MAX_HINTS,
        max_chars=120,
    )
    merged_recent_questions = _merge_unique_memory_values(
        current.get("recent_questions") or [],
        recent_question_candidates or [],
        max_items=USER_AI_HINTS_MAX_RECENT_QUESTIONS,
        max_chars=240,
    )

    if not user_id:
        return {"hints": merged_hints, "recent_questions": merged_recent_questions}

    now_iso = _utc_now().isoformat()
    try:
        existing = _first(
            supabase.table(USER_AI_QUIZ_HINTS_TABLE)
            .select("id")
            .eq("user_id", user_id)
            .eq("quiz_kind", quiz_kind.value)
            .limit(1)
            .execute()
        )
        payload = {
            "hints": merged_hints,
            "recent_questions": merged_recent_questions,
            "updated_at": now_iso,
        }
        if existing and existing.get("id") is not None:
            supabase.table(USER_AI_QUIZ_HINTS_TABLE).update(payload).eq("id", existing["id"]).execute()
        else:
            insert_payload = {
                "user_id": user_id,
                "quiz_kind": quiz_kind.value,
                "hints": merged_hints,
                "recent_questions": merged_recent_questions,
                "created_at": now_iso,
                "updated_at": now_iso,
            }
            supabase.table(USER_AI_QUIZ_HINTS_TABLE).insert(insert_payload).execute()
    except Exception as exc:
        if _is_missing_table_like_error(exc, USER_AI_QUIZ_HINTS_TABLE):
            _warn_user_hint_table_missing(exc)
        else:
            logger.warning("Failed to update user AI quiz hint memory for %s/%s: %s", user_id, quiz_kind.value, exc)

    return {"hints": merged_hints, "recent_questions": merged_recent_questions}


def _apply_user_hint_memory_to_preview_request(
    request: AIGenerateQuizRequest,
    *,
    memory: Dict[str, List[str]],
) -> None:
    request.recent_questions = _merge_unique_memory_values(
        memory.get("recent_questions") or [],
        list(request.recent_questions or []),
        max_items=USER_AI_HINTS_MAX_RECENT_QUESTIONS,
        max_chars=240,
    )
    hint_block = _coverage_hints_instruction_block(memory.get("hints") or [])
    request.user_instructions = _merge_instruction_parts(request.user_instructions, hint_block)


def _trim_passage_items_by_question_count(
    items: List[Dict[str, Any]],
    desired_question_count: int,
) -> List[Dict[str, Any]]:
    if desired_question_count <= 0:
        return []
    output: List[Dict[str, Any]] = []
    consumed = 0
    for item in items:
        if consumed >= desired_question_count:
            break
        if not isinstance(item, dict):
            continue
        questions = [candidate for candidate in (item.get("questions") or []) if isinstance(candidate, dict)]
        if not questions:
            continue
        remaining = desired_question_count - consumed
        if remaining <= 0:
            break
        trimmed_questions = questions[:remaining]
        if not trimmed_questions:
            continue
        payload = dict(item)
        payload["questions"] = trimmed_questions
        output.append(payload)
        consumed += len(trimmed_questions)
    return output


def _merge_instruction_parts(*parts: Optional[str]) -> Optional[str]:
    values = [str(value).strip() for value in parts if str(value or "").strip()]
    if not values:
        return None
    return "\n\n".join(values)


def _normalize_output_language(value: Any) -> LanguageCode:
    if isinstance(value, LanguageCode):
        return value
    try:
        return LanguageCode(str(value or "").strip().lower())
    except Exception:
        return LanguageCode.EN


def _language_instruction_block(
    value: Any,
    *,
    scope: str,
) -> str:
    language = _normalize_output_language(value)
    if scope == "quiz":
        if language == LanguageCode.HI:
            return (
                "Output Language Requirement (MANDATORY): Write all learner-visible quiz text in Hindi "
                "(Devanagari script), including passage title/text, question_statement, statements_facts, "
                "question_prompt, option text, and explanation fields. Keep JSON keys and option labels "
                "(A/B/C/D/E) unchanged. Do not use Hindi transliterated in Latin letters."
            )
        return (
            "Output Language Requirement (MANDATORY): Write all learner-visible quiz text in English. "
            "Keep JSON keys and option labels (A/B/C/D/E) unchanged."
        )
    if scope == "mains_generation":
        if language == LanguageCode.HI:
            return (
                "Output Language Requirement (MANDATORY): Return question_text, answer_approach, and "
                "model_answer in Hindi (Devanagari script). Keep JSON keys unchanged."
            )
        return (
            "Output Language Requirement (MANDATORY): Return question_text, answer_approach, and "
            "model_answer in English. Keep JSON keys unchanged."
        )
    if language == LanguageCode.HI:
        return (
            "Output Language Requirement (MANDATORY): Return feedback, strengths, and weaknesses in Hindi "
            "(Devanagari script). Keep JSON keys unchanged."
        )
    return (
        "Output Language Requirement (MANDATORY): Return feedback, strengths, and weaknesses in English. "
        "Keep JSON keys unchanged."
    )


@compat_router.post("/premium-ai-quizzes/preview/gk", response_model=PremiumPreviewResponse)
async def preview_premium_gk_quiz(
    request: AIGenerateQuizRequest,
    user_ctx: Dict[str, Any] = Depends(require_quiz_generation_access),
    supabase: Client = Depends(get_supabase_client),
):
    return await _preview_quiz(request, AISystemInstructionContentType.PREMIUM_GK_QUIZ, supabase, user_ctx=user_ctx)


@compat_router.post("/premium-ai-quizzes/preview/maths", response_model=PremiumPreviewResponse)
async def preview_premium_maths_quiz(
    request: AIGenerateQuizRequest,
    user_ctx: Dict[str, Any] = Depends(require_quiz_generation_access),
    supabase: Client = Depends(get_supabase_client),
):
    return await _preview_quiz(request, AISystemInstructionContentType.PREMIUM_MATHS_QUIZ, supabase, user_ctx=user_ctx)


@compat_router.post("/premium-ai-quizzes/preview/passage", response_model=PremiumPreviewResponse)
async def preview_premium_passage_quiz(
    request: AIGenerateQuizRequest,
    user_ctx: Dict[str, Any] = Depends(require_quiz_generation_access),
    supabase: Client = Depends(get_supabase_client),
):
    return await _preview_quiz(request, AISystemInstructionContentType.PREMIUM_PASSAGE_QUIZ, supabase, user_ctx=user_ctx)


@compat_router.post("/premium-ai-quizzes/upload-pdf", response_model=UploadedPDF)
async def upload_pdf_for_premium_ai_quiz(
    file: UploadFile = File(...),
    use_ocr: bool = Query(True),
    user_ctx: Dict[str, Any] = Depends(require_quiz_generation_access),
    supabase: Client = Depends(get_supabase_client),
):
    user_id = str(user_ctx.get("user_id") or "").strip()
    if not user_id:
        raise HTTPException(status_code=401, detail="Authentication required.")

    filename = str(file.filename or "uploaded.pdf")
    if not filename.lower().endswith(".pdf"):
        raise HTTPException(status_code=400, detail="Only PDF files are allowed.")

    content = await file.read()
    if not content:
        raise HTTPException(status_code=400, detail="Uploaded file is empty.")
    max_size_bytes = UPLOADED_PDF_MAX_SIZE_MB * 1024 * 1024
    if len(content) > max_size_bytes:
        raise HTTPException(
            status_code=413,
            detail=f"PDF is too large. Maximum size allowed is {UPLOADED_PDF_MAX_SIZE_MB} MB.",
        )

    _cleanup_expired_uploaded_pdfs(supabase=supabase, user_id=user_id)

    try:
        extracted_text, page_count, used_ocr = await _extract_text_from_pdf_with_optional_ocr(
            content,
            use_ocr=use_ocr,
        )
    except HTTPException:
        raise
    except RuntimeError as exc:
        raise HTTPException(status_code=503, detail=str(exc))
    except Exception as exc:
        logger.error("PDF extraction failed for user %s: %s", user_id, exc)
        raise HTTPException(status_code=500, detail=f"Failed to process PDF: {exc}")

    if not extracted_text.strip():
        raise HTTPException(status_code=422, detail="No text could be extracted from this PDF.")

    now = _utc_now()
    expires_at = now + timedelta(hours=UPLOADED_PDF_TTL_HOURS)
    insert_payload = {
        "filename": filename,
        "extracted_text": extracted_text,
        "uploader_id": user_id,
        "page_count": page_count,
        "used_ocr": used_ocr,
        "created_at": now.isoformat(),
        "expires_at": expires_at.isoformat(),
    }
    try:
        row = _first(supabase.table(UPLOADED_PDFS_TABLE).insert(insert_payload).execute())
    except Exception as exc:
        if _is_missing_table_error(exc, UPLOADED_PDFS_TABLE):
            _raise_uploaded_pdfs_migration_required(exc)
        raise
    if not row:
        raise HTTPException(status_code=500, detail="Failed to store uploaded PDF metadata.")

    view = _uploaded_pdf_view(row)
    view["message"] = (
        f"PDF is available for {UPLOADED_PDF_TTL_HOURS} hours. "
        "After expiry, upload it again for reuse."
    )
    return UploadedPDF(**view)


@compat_router.get("/premium-ai-quizzes/uploaded-pdfs", response_model=List[UploadedPDF])
def list_uploaded_pdfs_for_premium_ai_quiz(
    limit: int = Query(50, ge=1, le=200),
    user_ctx: Dict[str, Any] = Depends(require_quiz_generation_access),
    supabase: Client = Depends(get_supabase_client),
):
    user_id = str(user_ctx.get("user_id") or "").strip()
    if not user_id:
        raise HTTPException(status_code=401, detail="Authentication required.")

    _cleanup_expired_uploaded_pdfs(supabase=supabase, user_id=user_id)
    try:
        rows = _rows(
            supabase.table(UPLOADED_PDFS_TABLE)
            .select("*")
            .eq("uploader_id", user_id)
            .order("created_at", desc=True)
            .limit(limit)
            .execute()
        )
    except Exception as exc:
        if _is_missing_table_error(exc, UPLOADED_PDFS_TABLE):
            _raise_uploaded_pdfs_migration_required(exc)
        raise
    return [UploadedPDF(**_uploaded_pdf_view(row)) for row in rows]


@compat_router.delete("/premium-ai-quizzes/uploaded-pdfs/{uploaded_pdf_id}")
def delete_uploaded_pdf_for_premium_ai_quiz(
    uploaded_pdf_id: int,
    user_ctx: Dict[str, Any] = Depends(require_quiz_generation_access),
    supabase: Client = Depends(get_supabase_client),
):
    user_id = str(user_ctx.get("user_id") or "").strip()
    if not user_id:
        raise HTTPException(status_code=401, detail="Authentication required.")

    try:
        row = _first(
            supabase.table(UPLOADED_PDFS_TABLE)
            .select("*")
            .eq("id", uploaded_pdf_id)
            .limit(1)
            .execute()
        )
    except Exception as exc:
        if _is_missing_table_error(exc, UPLOADED_PDFS_TABLE):
            _raise_uploaded_pdfs_migration_required(exc)
        raise
    if not row:
        raise HTTPException(status_code=404, detail="Uploaded PDF not found.")
    owner_id = str(row.get("uploader_id") or "")
    if not bool(user_ctx.get("is_admin")) and owner_id != user_id:
        raise HTTPException(status_code=403, detail="You do not have access to this uploaded PDF.")

    try:
        supabase.table(UPLOADED_PDFS_TABLE).delete().eq("id", uploaded_pdf_id).execute()
    except Exception as exc:
        if _is_missing_table_error(exc, UPLOADED_PDFS_TABLE):
            _raise_uploaded_pdfs_migration_required(exc)
        raise
    return {"message": "Deleted"}


@compat_router.post("/premium-ai-quizzes/preview-jobs/{quiz_kind}", response_model=PremiumPreviewMixJobCreateResponse)
async def create_preview_mix_job(
    quiz_kind: QuizKind,
    request: PremiumPreviewMixJobCreateRequest,
    user_ctx: Dict[str, Any] = Depends(require_quiz_generation_access),
    supabase: Client = Depends(get_supabase_client),
):
    user_id = str(user_ctx.get("user_id") or "").strip()
    if not user_id:
        raise HTTPException(status_code=401, detail="Authentication required.")

    expected_content_type = _draft_content_type_for_kind(quiz_kind)
    if request.content_type != expected_content_type:
        raise HTTPException(
            status_code=400,
            detail=f"content_type '{request.content_type.value}' does not match quiz kind '{quiz_kind.value}'.",
        )

    total_requested = sum(max(1, int(plan.desired_question_count)) for plan in request.plans)
    if total_requested > MIX_PREVIEW_MAX_TOTAL_QUESTIONS:
        raise HTTPException(
            status_code=400,
            detail=(
                f"Requested {total_requested} questions exceeds the async mix limit "
                f"({MIX_PREVIEW_MAX_TOTAL_QUESTIONS})."
            ),
        )

    base_preview_request = AIGenerateQuizRequest(
        content=request.content,
        uploaded_pdf_id=request.uploaded_pdf_id,
        url=request.url,
        content_type=request.content_type,
        ai_instruction_id=request.ai_instruction_id,
        ai_provider=request.ai_provider,
        ai_model_name=request.ai_model_name,
        category_ids=request.category_ids,
        example_question=request.example_question,
        example_questions=request.example_questions,
        recent_questions=request.recent_questions,
        user_instructions=request.user_instructions,
        formatting_instruction_text=request.formatting_instruction_text,
        desired_question_count=1,
        use_category_source=request.use_category_source,
        output_language=request.output_language,
    )
    resolved_content = _resolve_preview_content(
        base_preview_request,
        supabase=supabase,
        content_type=request.content_type,
        requester_user_id=user_id,
        requester_is_admin=bool(user_ctx.get("is_admin")),
    )

    setting_override_row: Optional[Dict[str, Any]] = None
    if request.ai_instruction_id is not None:
        setting_override_row = _first(
            supabase.table("premium_ai_quiz_instructions")
            .select("*")
            .eq("id", request.ai_instruction_id)
            .limit(1)
            .execute()
        )
        if setting_override_row is None:
            setting_override_row = _first(
                supabase.table("ai_instructions")
                .select("*")
                .eq("id", request.ai_instruction_id)
                .limit(1)
                .execute()
            )
    if setting_override_row is None:
        setting_override_row = _setting_row_for_content_type(request.content_type, supabase)

    analysis_ids = sorted({int(plan.example_analysis_id) for plan in request.plans})
    analysis_rows: Dict[int, Dict[str, Any]] = {}
    if analysis_ids:
        fetched_rows = _safe_rows(
            supabase.table(EXAMPLE_ANALYSES_TABLE)
            .select("*")
            .in_("id", analysis_ids)
            .eq("is_active", True)
        )
        for row in fetched_rows:
            try:
                row_id = int(row.get("id"))
            except Exception:
                continue
            row_content_type = str(row.get("content_type") or "")
            if row_content_type != request.content_type.value:
                continue
            analysis_rows[row_id] = row
    missing_analysis_ids = [analysis_id for analysis_id in analysis_ids if analysis_id not in analysis_rows]
    if missing_analysis_ids:
        raise HTTPException(
            status_code=400,
            detail=f"Invalid example_analysis_id(s): {missing_analysis_ids}",
        )

    job = await mix_preview_jobs.create_job(
        owner_user_id=user_id,
        quiz_kind=quiz_kind,
        content_type=request.content_type,
        plans=request.plans,
        max_attempts=request.max_attempts,
    )

    persisted_memory = _load_user_quiz_hint_memory(
        user_id=user_id,
        quiz_kind=quiz_kind,
        supabase=supabase,
    )
    rolling_recent = _merge_unique_memory_values(
        persisted_memory.get("recent_questions") or [],
        list(request.recent_questions or []),
        max_items=USER_AI_HINTS_MAX_RECENT_QUESTIONS,
        max_chars=240,
    )
    rolling_hints = _merge_unique_memory_values(
        persisted_memory.get("hints") or [],
        [],
        max_items=USER_AI_HINTS_MAX_HINTS,
        max_chars=120,
    )

    async def _task_runner(task: _MixPreviewTaskRuntime) -> List[Dict[str, Any]]:
        hint_instruction = _coverage_hints_instruction_block(rolling_hints)
        task_request = AIGenerateQuizRequest(
            content=resolved_content,
            uploaded_pdf_id=request.uploaded_pdf_id,
            url=None,
            content_type=request.content_type,
            ai_instruction_id=request.ai_instruction_id,
            example_analysis_id=task.example_analysis_id,
            ai_provider=request.ai_provider,
            ai_model_name=request.ai_model_name,
            category_ids=request.category_ids,
            example_question=request.example_question,
            example_questions=request.example_questions,
            user_instructions=_merge_instruction_parts(
                request.user_instructions,
                task.user_instructions,
                hint_instruction,
            ),
            recent_questions=rolling_recent[-10:],
            formatting_instruction_text=_merge_instruction_parts(
                request.formatting_instruction_text,
                task.formatting_instruction_text,
            ),
            desired_question_count=task.requested_count,
            use_category_source=request.use_category_source,
            output_language=request.output_language,
        )
        items = await _generate_preview_items(
            task_request,
            request.content_type,
            supabase,
            resolved_content=resolved_content,
            setting_override_row=setting_override_row,
            example_analysis_row=analysis_rows.get(task.example_analysis_id),
        )
        if request.content_type == AISystemInstructionContentType.PREMIUM_PASSAGE_QUIZ:
            trimmed_items = _trim_passage_items_by_question_count(items, task.requested_count)
        else:
            trimmed_items = [candidate for candidate in items if isinstance(candidate, dict)][: task.requested_count]
        if not trimmed_items:
            raise RuntimeError("No valid questions were returned.")
        fresh_texts = _collect_question_texts_from_items(trimmed_items)
        if fresh_texts:
            rolling_recent[:] = _merge_unique_memory_values(
                rolling_recent,
                fresh_texts,
                max_items=USER_AI_HINTS_MAX_RECENT_QUESTIONS,
                max_chars=240,
            )
        fresh_hints = _collect_coverage_hints_from_items(trimmed_items)
        if fresh_hints:
            rolling_hints[:] = _merge_unique_memory_values(
                rolling_hints,
                fresh_hints,
                max_items=USER_AI_HINTS_MAX_HINTS,
                max_chars=120,
            )
        if fresh_texts or fresh_hints:
            _update_user_quiz_hint_memory(
                user_id=user_id,
                quiz_kind=quiz_kind,
                hint_candidates=fresh_hints,
                recent_question_candidates=fresh_texts,
                supabase=supabase,
            )
        return trimmed_items

    def _payload_builder(items: List[Dict[str, Any]]) -> Dict[str, Any]:
        return _preview_payload_for_items(items, request.content_type)

    asyncio.create_task(
        mix_preview_jobs.run_job(
            job_id=job.job_id,
            task_runner=_task_runner,
            payload_builder=_payload_builder,
        )
    )

    return PremiumPreviewMixJobCreateResponse(
        job_id=job.job_id,
        status=job.status,
        total_tasks=len(job.tasks),
        queued_at=job.created_at.isoformat(),
    )


@compat_router.get("/premium-ai-quizzes/preview-jobs/{job_id}", response_model=PremiumPreviewMixJobStatusResponse)
async def get_preview_mix_job_status(
    job_id: str,
    user_ctx: Dict[str, Any] = Depends(require_quiz_generation_access),
):
    user_id = str(user_ctx.get("user_id") or "").strip()
    if not user_id:
        raise HTTPException(status_code=401, detail="Authentication required.")

    job = await mix_preview_jobs.get_job(job_id)
    if not job:
        raise HTTPException(status_code=404, detail="Mix preview job not found or expired.")
    if not user_ctx.get("is_admin") and job.owner_user_id != user_id:
        raise HTTPException(status_code=403, detail="You do not have access to this job.")

    status_view = await mix_preview_jobs.get_status_view(job_id)
    if not status_view:
        raise HTTPException(status_code=404, detail="Mix preview job not found or expired.")
    return status_view


def _save_draft_quiz(
    quiz_kind: QuizKind,
    payload: SavePremiumDraftRequest,
    supabase: Client,
    author_id: str,
) -> Dict[str, Any]:
    normalized_author_id = str(author_id or "").strip()
    if not normalized_author_id:
        raise HTTPException(status_code=401, detail="Authentication required.")

    parsed = payload.parsed_quiz_data or {}
    if not isinstance(parsed, dict):
        raise HTTPException(status_code=400, detail="parsed_quiz_data must be an object.")
    content_type = _draft_content_type_for_kind(quiz_kind)

    def _resolved_draft_category_ids(parsed_payload: Dict[str, Any], explicit_category_ids: Optional[List[int]] = None) -> List[int]:
        explicit_ids = _normalize_exam_ids(explicit_category_ids or [])
        if explicit_ids:
            return explicit_ids
        existing_ids = _extract_category_ids_from_content_data(parsed_payload, quiz_kind)
        if existing_ids:
            return existing_ids
        return _infer_category_ids_for_text(
            _content_data_match_text(parsed_payload, quiz_kind),
            _category_type_for_quiz_kind(quiz_kind),
            supabase,
        )

    def _insert_draft(parsed_payload: Dict[str, Any]) -> Optional[Dict[str, Any]]:
        row_data = {
            "quiz_kind": quiz_kind.value,
            "content_type": content_type.value,
            "parsed_quiz_data": parsed_payload,
            "category_ids": _resolved_draft_category_ids(parsed_payload, payload.category_ids),
            "exam_id": payload.exam_id,
            "ai_instruction_id": payload.ai_instruction_id,
            "source_url": payload.source_url,
            "source_pdf_id": payload.source_pdf_id,
            "notes": payload.notes,
            "author_id": normalized_author_id,
        }
        try:
            return _first(supabase.table(DRAFT_QUIZZES_TABLE).insert(row_data).execute())
        except Exception as exc:
            if _is_missing_table_error(exc, DRAFT_QUIZZES_TABLE):
                _raise_draft_quizzes_migration_required(exc)
            if _is_missing_column_error(exc, DRAFT_QUIZZES_TABLE, "author_id"):
                _raise_draft_quizzes_ownership_migration_required(exc)
            raise

    if quiz_kind == QuizKind.PASSAGE and isinstance(parsed.get("passages"), list) and parsed["passages"]:
        created: Optional[Dict[str, Any]] = None
        for candidate in parsed["passages"]:
            if not isinstance(candidate, dict):
                continue
            if not str(candidate.get("passage_text") or "").strip():
                continue
            inserted = _insert_draft(candidate)
            if inserted:
                created = inserted
        if not created:
            raise HTTPException(status_code=400, detail="No valid passage objects to save.")
        return _draft_view(created)

    if quiz_kind != QuizKind.PASSAGE and isinstance(parsed.get("questions"), list) and parsed["questions"]:
        created = None
        for candidate in parsed["questions"]:
            if not isinstance(candidate, dict):
                continue
            if not str(candidate.get("question_statement") or candidate.get("question") or "").strip():
                continue
            if not isinstance(candidate.get("options"), list) or len(candidate.get("options") or []) < 2:
                continue
            inserted = _insert_draft(candidate)
            if inserted:
                created = inserted
        if not created:
            raise HTTPException(status_code=400, detail="No valid question objects to save.")
        return _draft_view(created)

    if quiz_kind == QuizKind.PASSAGE:
        if not str(parsed.get("passage_text") or "").strip():
            raise HTTPException(status_code=400, detail="Passage draft requires passage_text.")
    else:
        if not str(parsed.get("question_statement") or parsed.get("question") or "").strip():
            raise HTTPException(status_code=400, detail="Question draft requires question_statement.")
        if not isinstance(parsed.get("options"), list) or len(parsed.get("options") or []) < 2:
            raise HTTPException(status_code=400, detail="Question draft requires at least two options.")

    row = _insert_draft(parsed)
    if not row:
        raise HTTPException(status_code=400, detail="Could not save draft.")
    return _draft_view(row)


@compat_router.post("/premium-ai-quizzes/save-draft/gk", response_model=PremiumAIDraftQuiz)
def save_premium_gk_draft(
    payload: SavePremiumDraftRequest,
    user_ctx: Dict[str, Any] = Depends(require_quiz_generation_access),
    supabase: Client = Depends(get_supabase_client),
):
    user_id = str(user_ctx.get("user_id") or "").strip()
    return _save_draft_quiz(QuizKind.GK, payload, supabase, author_id=user_id)


@compat_router.post("/premium-ai-quizzes/save-draft/maths", response_model=PremiumAIDraftQuiz)
def save_premium_maths_draft(
    payload: SavePremiumDraftRequest,
    user_ctx: Dict[str, Any] = Depends(require_quiz_generation_access),
    supabase: Client = Depends(get_supabase_client),
):
    user_id = str(user_ctx.get("user_id") or "").strip()
    return _save_draft_quiz(QuizKind.MATHS, payload, supabase, author_id=user_id)


@compat_router.post("/premium-ai-quizzes/save-draft/passage", response_model=PremiumAIDraftQuiz)
def save_premium_passage_draft(
    payload: SavePremiumDraftRequest,
    user_ctx: Dict[str, Any] = Depends(require_quiz_generation_access),
    supabase: Client = Depends(get_supabase_client),
):
    user_id = str(user_ctx.get("user_id") or "").strip()
    return _save_draft_quiz(QuizKind.PASSAGE, payload, supabase, author_id=user_id)


def _draft_owner_id(row: Dict[str, Any]) -> Optional[str]:
    owner_id = str(row.get("author_id") or row.get("user_id") or "").strip()
    return owner_id or None


def _require_draft_owner_or_admin(row: Dict[str, Any], user_ctx: Dict[str, Any]) -> None:
    user_id = str(user_ctx.get("user_id") or "").strip()
    if not user_id:
        raise HTTPException(status_code=401, detail="Authentication required.")
    if bool(user_ctx.get("is_admin")):
        return

    owner_id = _draft_owner_id(row)
    if owner_id and owner_id == user_id:
        return
    raise HTTPException(status_code=403, detail="You do not have access to this draft.")


@compat_router.get("/premium-ai-quizzes/draft-quizzes", response_model=PremiumAIDraftQuizListResponse)
def list_premium_ai_draft_quizzes(
    content_type: Optional[AISystemInstructionContentType] = None,
    skip: int = Query(default=0, ge=0),
    limit: int = Query(default=100, ge=1, le=500),
    user_ctx: Dict[str, Any] = Depends(require_quiz_generation_access),
    supabase: Client = Depends(get_supabase_client),
):
    user_id = str(user_ctx.get("user_id") or "").strip()
    if not user_id:
        raise HTTPException(status_code=401, detail="Authentication required.")

    try:
        query = supabase.table(DRAFT_QUIZZES_TABLE).select("*").order("created_at", desc=True)
        if content_type is not None:
            query = query.eq("content_type", content_type.value)
        if not bool(user_ctx.get("is_admin")):
            query = query.eq("author_id", user_id)
        rows = _rows(query.range(skip, max(skip + limit - 1, skip)).execute())
    except Exception as exc:
        if _is_missing_table_error(exc, DRAFT_QUIZZES_TABLE):
            _raise_draft_quizzes_migration_required(exc)
        if _is_missing_column_error(exc, DRAFT_QUIZZES_TABLE, "author_id"):
            _raise_draft_quizzes_ownership_migration_required(exc)
        raise
    items = [_draft_view(row) for row in rows]
    return {"items": items, "total": len(items)}


def _get_single_draft_or_404(
    draft_id: int,
    expected_kind: Optional[QuizKind],
    supabase: Client,
    user_ctx: Optional[Dict[str, Any]] = None,
) -> Dict[str, Any]:
    try:
        row = _first(supabase.table(DRAFT_QUIZZES_TABLE).select("*").eq("id", draft_id).limit(1).execute())
    except Exception as exc:
        if _is_missing_table_error(exc, DRAFT_QUIZZES_TABLE):
            _raise_draft_quizzes_migration_required(exc)
        raise
    if not row:
        raise HTTPException(status_code=404, detail="Draft not found.")
    row_kind = str(row.get("quiz_kind") or "").strip().lower()
    if expected_kind is not None and row_kind != expected_kind.value:
        raise HTTPException(status_code=404, detail="Draft not found.")
    if user_ctx is not None:
        _require_draft_owner_or_admin(row, user_ctx)
    return row


def _update_draft_or_404(
    draft_id: int,
    update: PremiumAIDraftQuizUpdate,
    expected_kind: Optional[QuizKind],
    supabase: Client,
    user_ctx: Dict[str, Any],
) -> Dict[str, Any]:
    existing_row = _get_single_draft_or_404(draft_id, expected_kind, supabase, user_ctx=user_ctx)
    updates = update.model_dump(exclude_none=True)
    if "category_ids" in updates:
        updates["category_ids"] = _normalize_exam_ids(updates["category_ids"])
    elif "parsed_quiz_data" in updates and isinstance(updates["parsed_quiz_data"], dict):
        resolved_kind = expected_kind
        if resolved_kind is None:
            try:
                resolved_kind = QuizKind(str(existing_row.get("quiz_kind") or "").strip().lower())
            except Exception:
                resolved_kind = None
        if resolved_kind is not None:
            updates["category_ids"] = _extract_category_ids_from_content_data(updates["parsed_quiz_data"], resolved_kind)
            if not updates["category_ids"]:
                updates["category_ids"] = _infer_category_ids_for_text(
                    _content_data_match_text(updates["parsed_quiz_data"], resolved_kind),
                    _category_type_for_quiz_kind(resolved_kind),
                    supabase,
                )
    try:
        row = _first(supabase.table(DRAFT_QUIZZES_TABLE).update(updates).eq("id", draft_id).execute())
    except Exception as exc:
        if _is_missing_table_error(exc, DRAFT_QUIZZES_TABLE):
            _raise_draft_quizzes_migration_required(exc)
        raise
    if not row:
        raise HTTPException(status_code=404, detail="Draft not found.")
    return _draft_view(row)


def _delete_draft_or_404(
    draft_id: int,
    expected_kind: Optional[QuizKind],
    supabase: Client,
    user_ctx: Dict[str, Any],
) -> Dict[str, Any]:
    _get_single_draft_or_404(draft_id, expected_kind, supabase, user_ctx=user_ctx)
    try:
        row = _first(supabase.table(DRAFT_QUIZZES_TABLE).delete().eq("id", draft_id).execute())
    except Exception as exc:
        if _is_missing_table_error(exc, DRAFT_QUIZZES_TABLE):
            _raise_draft_quizzes_migration_required(exc)
        raise
    if not row:
        raise HTTPException(status_code=404, detail="Draft not found.")
    return {"message": "Deleted"}


@compat_router.get("/premium-ai-quizzes/draft-gk-quizzes/{draft_id}", response_model=PremiumAIDraftQuiz)
def get_premium_gk_draft(
    draft_id: int,
    user_ctx: Dict[str, Any] = Depends(require_quiz_generation_access),
    supabase: Client = Depends(get_supabase_client),
):
    row = _get_single_draft_or_404(draft_id, QuizKind.GK, supabase, user_ctx=user_ctx)
    return _draft_view(row)


@compat_router.put("/premium-ai-quizzes/draft-gk-quizzes/{draft_id}", response_model=PremiumAIDraftQuiz)
def update_premium_gk_draft(
    draft_id: int,
    update: PremiumAIDraftQuizUpdate,
    user_ctx: Dict[str, Any] = Depends(require_quiz_generation_access),
    supabase: Client = Depends(get_supabase_client),
):
    return _update_draft_or_404(draft_id, update, QuizKind.GK, supabase, user_ctx=user_ctx)


@compat_router.delete("/premium-ai-quizzes/draft-gk-quizzes/{draft_id}")
def delete_premium_gk_draft(
    draft_id: int,
    user_ctx: Dict[str, Any] = Depends(require_quiz_generation_access),
    supabase: Client = Depends(get_supabase_client),
):
    return _delete_draft_or_404(draft_id, QuizKind.GK, supabase, user_ctx=user_ctx)


@compat_router.get("/premium-ai-quizzes/draft-maths-quizzes/{draft_id}", response_model=PremiumAIDraftQuiz)
def get_premium_maths_draft(
    draft_id: int,
    user_ctx: Dict[str, Any] = Depends(require_quiz_generation_access),
    supabase: Client = Depends(get_supabase_client),
):
    row = _get_single_draft_or_404(draft_id, QuizKind.MATHS, supabase, user_ctx=user_ctx)
    return _draft_view(row)


@compat_router.put("/premium-ai-quizzes/draft-maths-quizzes/{draft_id}", response_model=PremiumAIDraftQuiz)
def update_premium_maths_draft(
    draft_id: int,
    update: PremiumAIDraftQuizUpdate,
    user_ctx: Dict[str, Any] = Depends(require_quiz_generation_access),
    supabase: Client = Depends(get_supabase_client),
):
    return _update_draft_or_404(draft_id, update, QuizKind.MATHS, supabase, user_ctx=user_ctx)


@compat_router.delete("/premium-ai-quizzes/draft-maths-quizzes/{draft_id}")
def delete_premium_maths_draft(
    draft_id: int,
    user_ctx: Dict[str, Any] = Depends(require_quiz_generation_access),
    supabase: Client = Depends(get_supabase_client),
):
    return _delete_draft_or_404(draft_id, QuizKind.MATHS, supabase, user_ctx=user_ctx)


@compat_router.get("/premium-ai-quizzes/draft-passage-quizzes/{draft_id}", response_model=PremiumAIDraftQuiz)
def get_premium_passage_draft(
    draft_id: int,
    user_ctx: Dict[str, Any] = Depends(require_quiz_generation_access),
    supabase: Client = Depends(get_supabase_client),
):
    row = _get_single_draft_or_404(draft_id, QuizKind.PASSAGE, supabase, user_ctx=user_ctx)
    return _draft_view(row)


@compat_router.put("/premium-ai-quizzes/draft-passage-quizzes/{draft_id}", response_model=PremiumAIDraftQuiz)
def update_premium_passage_draft(
    draft_id: int,
    update: PremiumAIDraftQuizUpdate,
    user_ctx: Dict[str, Any] = Depends(require_quiz_generation_access),
    supabase: Client = Depends(get_supabase_client),
):
    return _update_draft_or_404(draft_id, update, QuizKind.PASSAGE, supabase, user_ctx=user_ctx)


@compat_router.delete("/premium-ai-quizzes/draft-passage-quizzes/{draft_id}")
def delete_premium_passage_draft(
    draft_id: int,
    user_ctx: Dict[str, Any] = Depends(require_quiz_generation_access),
    supabase: Client = Depends(get_supabase_client),
):
    return _delete_draft_or_404(draft_id, QuizKind.PASSAGE, supabase, user_ctx=user_ctx)


@compat_router.post("/premium-ai-quizzes/convert-draft-to-premium-quiz", response_model=ConvertDraftToPremiumQuizResponse)
def convert_draft_to_premium_quiz(
    payload: ConvertDraftToPremiumQuizRequest,
    user_ctx: Dict[str, Any] = Depends(require_admin_user),
    supabase: Client = Depends(get_supabase_client),
):
    row = _get_single_draft_or_404(payload.draft_quiz_id, None, supabase, user_ctx=user_ctx)
    view = _draft_view(row)
    quiz_kind = view["quiz_kind"]
    parsed = view["parsed_quiz_data"] or {}
    category_ids = _normalize_exam_ids(view["category_ids"])
    if not category_ids and isinstance(parsed, dict):
        category_ids = _extract_category_ids_from_content_data(parsed, quiz_kind)
    if not category_ids and isinstance(parsed, dict):
        category_ids = _infer_category_ids_for_text(
            _content_data_match_text(parsed, quiz_kind),
            _category_type_for_quiz_kind(quiz_kind),
            supabase,
        )
    exam_id = view["exam_id"]

    if quiz_kind == QuizKind.PASSAGE:
        data = _draft_passage_content_data(parsed, category_ids, exam_id)
        created = _first(
            supabase.table("content_items")
            .insert(
                {
                    "title": str(data.get("passage_title") or f"AI Draft Passage #{view['id']}")[:200],
                    "type": ContentType.QUIZ_PASSAGE.value,
                    "data": data,
                }
            )
            .execute()
        )
        if not created:
            raise HTTPException(status_code=400, detail="Failed to convert passage draft.")
        _delete_draft_or_404(int(view["id"]), QuizKind.PASSAGE, supabase, user_ctx=user_ctx)
        return {
            "message": "Converted to Premium Passage Quiz",
            "new_quiz_id": int(created["id"]),
            "quiz_type": "premium_passage",
        }

    data = _draft_question_content_data(parsed, category_ids, exam_id)
    content_type = ContentType.QUIZ_GK.value if quiz_kind == QuizKind.GK else ContentType.QUIZ_MATHS.value
    quiz_type = "premium_gk" if quiz_kind == QuizKind.GK else "premium_maths"
    created = _first(
        supabase.table("content_items")
        .insert(
            {
                "title": str(data.get("question_statement") or f"AI Draft Quiz #{view['id']}")[:200],
                "type": content_type,
                "data": data,
            }
        )
        .execute()
    )
    if not created:
        raise HTTPException(status_code=400, detail="Failed to convert question draft.")
    _delete_draft_or_404(int(view["id"]), quiz_kind, supabase, user_ctx=user_ctx)
    return {
        "message": "Converted to Premium Quiz",
        "new_quiz_id": int(created["id"]),
        "quiz_type": quiz_type,
    }


@router.get("/collections")
def list_collections(
    include_items: bool = False,
    only_public: bool = False,
    mine_only: bool = True,
    test_kind: Optional[CollectionTestKind] = None,
    user_id: Optional[str] = Depends(get_user_id),
    supabase: Client = Depends(get_supabase_client),
):
    if mine_only and not user_id:
        return []
    query = supabase.table("collections").select("*").order("created_at", desc=True)
    if only_public:
        query = query.eq("is_public", True)
    if mine_only and user_id:
        query = query.contains("meta", {"author_id": user_id})
    rows = _rows(query.execute())
    output = []
    for row in rows:
        shaped = _collection_view(row, supabase)
        if test_kind and str(shaped.get("test_kind") or "") != test_kind.value:
            continue
        if include_items:
            shaped["items"] = _fetch_collection_items(int(row["id"]), supabase)
        output.append(shaped)
    return output


@router.post("/collections")
def create_collection(
    payload: CollectionCreate,
    user_id: Optional[str] = Depends(get_user_id),
    supabase: Client = Depends(get_supabase_client),
):
    exam_ids = _normalize_exam_ids(payload.exam_ids)
    if exam_ids:
        _load_exam_rows_by_ids(exam_ids, supabase)
    meta = dict(payload.meta or {})
    meta.update(
        {
            "exam_ids": exam_ids,
            "category_ids": payload.category_ids,
            "source_list": [item.model_dump(exclude_none=True) for item in payload.source_list],
            "source_category_ids": payload.source_category_ids,
            "source_pdf_url": payload.source_pdf_url,
            "source_content_html": payload.source_content_html,
            "admin_subpage_id": payload.admin_subpage_id,
            "is_subscription": payload.is_subscription,
            "is_private_source": payload.is_private_source,
        }
    )
    if user_id:
        meta["author_id"] = user_id
    resolved_test_kind = payload.test_kind or _resolve_collection_test_kind(meta)
    meta = _apply_collection_test_kind_meta(meta, resolved_test_kind)
    row = _first(
        supabase.table("collections")
        .insert(
            {
                "title": payload.title,
                "description": payload.description,
                "type": payload.type.value,
                "thumbnail_url": payload.thumbnail_url,
                "is_premium": payload.is_premium or payload.price > 0,
                "is_public": payload.is_public,
                "price": payload.price,
                "is_finalized": payload.is_finalized,
                "parent_id": payload.parent_id,
                "meta": meta,
            }
        )
        .execute()
    )
    if not row:
        raise HTTPException(status_code=400, detail="Failed to create collection")
    _sync_collection_exam_links(int(row["id"]), exam_ids, supabase)
    return _collection_view(row, supabase)


@router.get("/collections/{collection_id}")
def get_collection(
    collection_id: int,
    include_items: bool = True,
    supabase: Client = Depends(get_supabase_client),
):
    row = _fetch_collection(collection_id, supabase)
    shaped = _collection_view(row, supabase)
    if include_items:
        shaped["items"] = _fetch_collection_items(collection_id, supabase)
    return shaped


@router.put("/collections/{collection_id}")
def update_collection(
    collection_id: int,
    payload: CollectionUpdate,
    supabase: Client = Depends(get_supabase_client),
):
    current = _fetch_collection(collection_id, supabase)
    updates = payload.model_dump(exclude_none=True, exclude={"meta", "test_kind"})
    if isinstance(updates.get("type"), str):
        pass
    elif updates.get("type") is not None:
        updates["type"] = updates["type"].value
    if "price" in updates and "is_premium" not in updates:
        updates["is_premium"] = float(updates["price"]) > 0

    meta_updates_requested = any(
        (
            payload.meta is not None,
            payload.exam_ids is not None,
            payload.category_ids is not None,
            payload.source_list is not None,
            payload.source_category_ids is not None,
            payload.source_pdf_url is not None,
            payload.source_content_html is not None,
            payload.admin_subpage_id is not None,
            payload.is_subscription is not None,
            payload.is_private_source is not None,
            payload.test_kind is not None,
        )
    )
    if meta_updates_requested:
        merged_meta = dict(current.get("meta") or {})
        if payload.meta is not None:
            merged_meta.update(payload.meta)
        if payload.exam_ids is not None:
            exam_ids = _normalize_exam_ids(payload.exam_ids)
            if exam_ids:
                _load_exam_rows_by_ids(exam_ids, supabase)
            merged_meta["exam_ids"] = exam_ids
        if payload.category_ids is not None:
            merged_meta["category_ids"] = payload.category_ids
        if payload.source_list is not None:
            merged_meta["source_list"] = [item.model_dump(exclude_none=True) for item in payload.source_list]
        if payload.source_category_ids is not None:
            merged_meta["source_category_ids"] = payload.source_category_ids
        if payload.source_pdf_url is not None:
            merged_meta["source_pdf_url"] = payload.source_pdf_url
        if payload.source_content_html is not None:
            merged_meta["source_content_html"] = payload.source_content_html
        if payload.admin_subpage_id is not None:
            merged_meta["admin_subpage_id"] = payload.admin_subpage_id
        if payload.is_subscription is not None:
            merged_meta["is_subscription"] = payload.is_subscription
        if payload.is_private_source is not None:
            merged_meta["is_private_source"] = payload.is_private_source
        resolved_test_kind = payload.test_kind or _resolve_collection_test_kind(merged_meta)
        merged_meta = _apply_collection_test_kind_meta(merged_meta, resolved_test_kind)
        updates["meta"] = merged_meta

    row = _first(supabase.table("collections").update(updates).eq("id", collection_id).execute())
    if not row:
        raise HTTPException(status_code=404, detail="Collection not found")
    if payload.exam_ids is not None:
        _sync_collection_exam_links(collection_id, _normalize_exam_ids(payload.exam_ids), supabase)
    return _collection_view(row, supabase)


@router.get("/collections/{collection_id}/items")
def get_collection_items(collection_id: int, supabase: Client = Depends(get_supabase_client)):
    _fetch_collection(collection_id, supabase)
    return _fetch_collection_items(collection_id, supabase)

@router.post("/collections/{collection_id}/items")
def add_collection_item(
    collection_id: int,
    payload: CollectionItemAddRequest,
    supabase: Client = Depends(get_supabase_client),
):
    _fetch_collection(collection_id, supabase)
    exists = _first(
        supabase.table("content_items").select("id").eq("id", payload.content_item_id).limit(1).execute()
    )
    if not exists:
        raise HTTPException(status_code=404, detail="Content item not found")

    row = _first(
        supabase.table("collection_items")
        .insert(
            {
                "collection_id": collection_id,
                "content_item_id": payload.content_item_id,
                "order": payload.order if payload.order >= 0 else _next_order(collection_id, supabase),
                "section_title": payload.section_title,
            }
        )
        .execute()
    )
    if not row:
        raise HTTPException(status_code=400, detail="Failed to add collection item")
    return row


@router.post("/collections/{collection_id}/items/bulk-add")
def bulk_add_collection_items(
    collection_id: int,
    payload: CollectionItemsBulkAddRequest,
    supabase: Client = Depends(get_supabase_client),
):
    added = []
    next_order = _next_order(collection_id, supabase)
    for item in payload.items:
        row = _first(
            supabase.table("collection_items")
            .insert(
                {
                    "collection_id": collection_id,
                    "content_item_id": item.content_item_id,
                    "order": item.order if item.order >= 0 else next_order,
                    "section_title": item.section_title,
                }
            )
            .execute()
        )
        if row:
            added.append(row)
            next_order += 1
    return {"items": added, "count": len(added)}


def _content_item_matches_search(
    row: Dict[str, Any],
    needle: str,
) -> bool:
    normalized = needle.strip().lower()
    if not normalized:
        return True

    if normalized in str(row.get("id") or "").lower():
        return True
    if normalized in str(row.get("title") or "").lower():
        return True
    if normalized in str(row.get("type") or "").lower():
        return True

    data = row.get("data")
    if not isinstance(data, dict):
        return False

    simple_keys = [
        "question_statement",
        "supplementary_statement",
        "question_prompt",
        "question_text",
        "passage_title",
        "passage_text",
        "source_reference",
        "title",
    ]
    for key in simple_keys:
        value = data.get(key)
        if isinstance(value, str) and normalized in value.lower():
            return True

    questions = data.get("questions")
    if isinstance(questions, list):
        for item in questions:
            if isinstance(item, dict):
                for key in ("question_statement", "question_prompt", "question_text"):
                    candidate = item.get(key)
                    if isinstance(candidate, str) and normalized in candidate.lower():
                        return True
            elif isinstance(item, str) and normalized in item.lower():
                return True

    return normalized in str(data).lower()


def _extract_mains_category_ids_from_content_data(data: Any) -> List[int]:
    if not isinstance(data, dict):
        return []

    candidates: List[Any] = []
    for key in ("mains_category_ids", "category_ids"):
        value = data.get(key)
        if isinstance(value, list):
            candidates.extend(value)

    single_value = data.get("mains_category_id")
    if single_value is not None:
        candidates.append(single_value)

    category_ids: List[int] = []
    for value in candidates:
        try:
            parsed = int(value)
        except (TypeError, ValueError):
            continue
        if parsed <= 0 or parsed in category_ids:
            continue
        category_ids.append(parsed)
    return category_ids


@router.get("/content", response_model=List[ContentItemResponse])
def get_content_items(
    collection_id: Optional[int] = None,
    quiz_kind: Optional[QuizKind] = None,
    search: Optional[str] = None,
    limit: int = Query(default=200, ge=1, le=1000),
    supabase: Client = Depends(get_supabase_client),
):
    if collection_id is not None:
        rows = [item["content_item"] for item in _fetch_collection_items(collection_id, supabase)]
        if search:
            needle = search.strip().lower()
            rows = [row for row in rows if _content_item_matches_search(row, needle)]
        return rows[:limit]

    query = supabase.table("content_items").select("*").order("created_at", desc=True)
    if quiz_kind:
        query = query.eq("type", QUIZ_KIND_TO_CONTENT_TYPE[quiz_kind])

    if search:
        needle = search.strip().lower()
        candidate_limit = min(max(limit * 5, limit), 1000)
        rows = _rows(query.limit(candidate_limit).execute())
        rows = [row for row in rows if _content_item_matches_search(row, needle)]
        return rows[:limit]

    return _rows(query.limit(limit).execute())


@router.get("/mains/questions", response_model=List[ContentItemResponse])
def list_mains_questions(
    category_id: Optional[int] = None,
    collection_id: Optional[int] = None,
    search: Optional[str] = None,
    limit: int = Query(default=200, ge=1, le=1000),
    supabase: Client = Depends(get_supabase_client),
):
    needle = str(search or "").strip().lower()
    candidate_limit = min(max(limit * 5, limit), 1000)

    if collection_id is not None:
        rows = [item["content_item"] for item in _fetch_collection_items(collection_id, supabase)]
    else:
        rows = _rows(
            supabase.table("content_items")
            .select("*")
            .eq("type", ContentType.QUESTION.value)
            .order("created_at", desc=True)
            .limit(candidate_limit)
            .execute()
        )

    filtered: List[Dict[str, Any]] = []
    for row in rows:
        data = row.get("data") if isinstance(row.get("data"), dict) else {}
        if not _is_mains_collection_content(row.get("type"), data):
            continue
        if category_id is not None:
            mains_category_ids = _extract_mains_category_ids_from_content_data(data)
            if category_id not in mains_category_ids:
                continue
        if needle and not _content_item_matches_search(row, needle):
            continue
        filtered.append(row)
        if len(filtered) >= limit:
            break
    return filtered


@router.post("/content", response_model=ContentItemResponse)
def create_content_item(item: ContentItemCreate, supabase: Client = Depends(get_supabase_client)):
    data = item.model_dump(exclude_none=True, exclude={"collection_id", "category_id"})
    data["type"] = item.type.value

    collection_row: Optional[Dict[str, Any]] = None
    if item.collection_id:
        collection_row = _fetch_collection(item.collection_id, supabase)

    quiz_kind = _quiz_kind_from_content_item_type(data.get("type"))
    payload_data = data.get("data") if isinstance(data.get("data"), dict) else {}
    if quiz_kind and isinstance(payload_data, dict):
        explicit_category_ids: List[int] = []
        if item.category_id is not None:
            try:
                explicit_category_id = int(item.category_id)
                if explicit_category_id > 0:
                    explicit_category_ids = [explicit_category_id]
            except (TypeError, ValueError):
                explicit_category_ids = []

        existing_category_ids = _extract_category_ids_from_content_data(payload_data, quiz_kind)
        collection_category_ids = _normalize_exam_ids(
            ((collection_row or {}).get("meta") or {}).get("category_ids")
        )
        resolved_category_ids = existing_category_ids or explicit_category_ids or collection_category_ids
        if not resolved_category_ids:
            resolved_category_ids = _infer_category_ids_for_text(
                _content_data_match_text(payload_data, quiz_kind),
                _category_type_for_quiz_kind(quiz_kind),
                supabase,
            )
        if resolved_category_ids:
            _apply_category_ids_to_content_data(payload_data, quiz_kind, resolved_category_ids)
            data["data"] = payload_data
    elif isinstance(payload_data, dict) and _is_mains_collection_content(data.get("type"), payload_data):
        explicit_mains_category_ids: List[int] = []
        if item.category_id is not None:
            try:
                explicit_category_id = int(item.category_id)
                if explicit_category_id > 0:
                    explicit_mains_category_ids = [explicit_category_id]
            except (TypeError, ValueError):
                explicit_mains_category_ids = []

        resolved_mains_category_ids = _extract_mains_category_ids_from_content_data(payload_data) or explicit_mains_category_ids
        if not resolved_mains_category_ids:
            resolved_mains_category_ids = _infer_mains_category_ids_for_text(
                _mains_question_match_text(payload_data),
                supabase,
            )
        if resolved_mains_category_ids:
            _apply_mains_category_ids_to_content_data(payload_data, resolved_mains_category_ids)
            data["data"] = payload_data

    row = _first(supabase.table("content_items").insert(data).execute())
    if not row:
        raise HTTPException(status_code=400, detail="Failed to create content item")
    if item.collection_id:
        supabase.table("collection_items").insert(
            {
                "collection_id": item.collection_id,
                "content_item_id": row["id"],
                "order": _next_order(item.collection_id, supabase),
            }
        ).execute()
    return row


@router.post("/quizzes/{quiz_kind}/bulk")
def create_quizzes_bulk(
    quiz_kind: QuizKind,
    payload: QuizBulkCreateRequest,
    supabase: Client = Depends(get_supabase_client),
):
    if quiz_kind == QuizKind.PASSAGE:
        raise HTTPException(status_code=400, detail="Use /quizzes/passage for passage creation")
    content_type = QUIZ_KIND_TO_CONTENT_TYPE[quiz_kind]
    created = []
    next_order = _next_order(payload.collection_id, supabase) if payload.collection_id else 0
    for idx, question in enumerate(payload.items, start=1):
        supplementary = _quiz_supplementary(question)
        statements_facts = _quiz_statements_facts(question)
        explanation = _quiz_explanation(question)
        source_reference = _quiz_source_reference(question)
        category_ids = _quiz_category_ids(question, quiz_kind)
        options = [
            {"label": "A", "text": question.option_a},
            {"label": "B", "text": question.option_b},
            {"label": "C", "text": question.option_c},
            {"label": "D", "text": question.option_d},
            *([{"label": "E", "text": question.option_e}] if question.option_e else []),
        ]
        row = _first(
            supabase.table("content_items")
            .insert(
                {
                    "title": f"{payload.title_prefix or quiz_kind.value.upper()} #{idx}",
                    "type": content_type,
                    "data": {
                        "question_statement": question.question_statement,
                        "supp_question_statement": supplementary,
                        "supplementary_statement": supplementary,
                        "statements_facts": statements_facts,
                        "statement_facts": statements_facts,
                        "question_prompt": question.question_prompt,
                        "options": options,
                        "correct_answer": _normalize_label(question.correct_answer),
                        "explanation": explanation,
                        "explanation_text": explanation,
                        "source_reference": source_reference,
                        "source": source_reference,
                        "category_ids": category_ids,
                        "premium_gk_category_ids": category_ids if quiz_kind == QuizKind.GK else [],
                        "premium_maths_category_ids": category_ids if quiz_kind == QuizKind.MATHS else [],
                        "alpha_cat_ids": question.alpha_cat_ids,
                        "exam_id": payload.exam_id,
                    },
                }
            )
            .execute()
        )
        if not row:
            continue
        created.append(row)
        if payload.collection_id:
            supabase.table("collection_items").insert(
                {
                    "collection_id": payload.collection_id,
                    "content_item_id": row["id"],
                    "order": next_order,
                }
            ).execute()
            next_order += 1
    return {"items": created, "count": len(created)}


@router.post("/quizzes/passage")
def create_passage_quiz(payload: PassageQuizCreateRequest, supabase: Client = Depends(get_supabase_client)):
    category_ids = (
        _normalize_exam_ids(payload.premium_passage_category_ids)
        if payload.premium_passage_category_ids
        else _normalize_exam_ids(payload.category_ids)
    )
    questions = []
    for question in payload.questions:
        options = [opt.model_dump() for opt in (question.options or [])]
        if not options:
            base_options = [
                ("A", question.option_a),
                ("B", question.option_b),
                ("C", question.option_c),
                ("D", question.option_d),
                ("E", question.option_e),
            ]
            options = [
                {"label": label, "text": text}
                for label, text in base_options
                if text is not None and str(text).strip()
            ]
        questions.append(
            {
                "question_statement": question.question_statement,
                "supp_question_statement": question.supp_question_statement or question.supplementary_statement,
                "question_prompt": question.question_prompt,
                "statements_facts": question.statements_facts or question.statement_facts or [],
                "statement_facts": question.statements_facts or question.statement_facts or [],
                "options": options,
                "correct_answer": _normalize_label(question.correct_answer),
                "explanation": question.explanation or question.explanation_text,
                "explanation_text": question.explanation or question.explanation_text,
                "source_reference": question.source_reference or question.source,
            }
        )
    row = _first(
        supabase.table("content_items")
        .insert(
            {
                "title": payload.passage_title or "Passage Quiz",
                "type": ContentType.QUIZ_PASSAGE.value,
                "data": {
                    "passage_title": payload.passage_title,
                    "passage_text": payload.passage_text,
                    "source_reference": payload.source_reference,
                    "source": payload.source_reference,
                    "category_ids": category_ids,
                    "premium_passage_category_ids": category_ids,
                    "alpha_cat_ids": payload.alpha_cat_ids,
                    "exam_id": payload.exam_id,
                    "questions": questions,
                },
            }
        )
        .execute()
    )
    if not row:
        raise HTTPException(status_code=400, detail="Failed to create passage quiz")
    if payload.collection_id:
        supabase.table("collection_items").insert(
            {
                "collection_id": payload.collection_id,
                "content_item_id": row["id"],
                "order": _next_order(payload.collection_id, supabase),
            }
        ).execute()
    return row


@router.get("/quizzes/{quiz_kind}")
def list_quizzes(
    quiz_kind: QuizKind,
    limit: int = Query(default=200, ge=1, le=1000),
    category_id: Optional[int] = None,
    exam_id: Optional[int] = None,
    supabase: Client = Depends(get_supabase_client),
):
    rows = _rows(
        supabase.table("content_items")
        .select("*")
        .eq("type", QUIZ_KIND_TO_CONTENT_TYPE[quiz_kind])
        .order("created_at", desc=True)
        .limit(limit)
        .execute()
    )
    if category_id is None and exam_id is None:
        return rows

    filtered = []
    for row in rows:
        data = row.get("data") or {}
        candidate_category_ids = _normalize_exam_ids(data.get("category_ids"))
        if not candidate_category_ids and quiz_kind == QuizKind.GK:
            candidate_category_ids = _normalize_exam_ids(data.get("premium_gk_category_ids"))
        if not candidate_category_ids and quiz_kind == QuizKind.MATHS:
            candidate_category_ids = _normalize_exam_ids(data.get("premium_maths_category_ids"))
        if not candidate_category_ids and quiz_kind == QuizKind.PASSAGE:
            candidate_category_ids = _normalize_exam_ids(data.get("premium_passage_category_ids"))
        if category_id is not None and category_id not in candidate_category_ids:
            continue
        if exam_id is not None and int(data.get("exam_id") or 0) != exam_id:
            continue
        filtered.append(row)
    return filtered


def _expand_questions(collection_id: int, supabase: Client) -> List[CollectionTestQuestion]:
    questions: List[CollectionTestQuestion] = []
    items = _fetch_collection_items(collection_id, supabase)
    for item in items:
        content = item["content_item"]
        data = content.get("data") or {}
        base = int(item["id"]) * 1000
        ctype = content.get("type")

        if ctype == ContentType.QUIZ_PASSAGE.value and isinstance(data.get("questions"), list):
            for idx, q in enumerate(data["questions"], start=1):
                options = q.get("options") or []
                supp = q.get("supp_question_statement") or q.get("supplementary_statement") or q.get("supplementary")
                statements = q.get("statements_facts") or q.get("statement_facts") or []
                explanation = q.get("explanation") or q.get("explanation_text")
                questions.append(
                    CollectionTestQuestion(
                        item_id=base + idx,
                        content_item_id=content["id"],
                        quiz_type=QuizKind.PASSAGE,
                        question_statement=str(q.get("question_statement") or q.get("question") or ""),
                        supplementary_statement=supp,
                        statements_facts=statements,
                        question_prompt=q.get("question_prompt") or q.get("prompt"),
                        options=[{"label": str(o.get("label") or ""), "text": str(o.get("text") or "")} for o in options if isinstance(o, dict)],
                        correct_answer=_normalize_label(q.get("correct_answer")),
                        explanation_text=explanation,
                        category_ids=data.get("category_ids") or data.get("premium_passage_category_ids") or [],
                        passage_title=data.get("passage_title"),
                        passage_text=data.get("passage_text"),
                    )
                )
            continue

        if ctype not in {ContentType.QUIZ_GK.value, ContentType.QUIZ_MATHS.value}:
            continue

        options = data.get("options") or []
        quiz_type = QuizKind.GK if ctype == ContentType.QUIZ_GK.value else QuizKind.MATHS
        supp = data.get("supp_question_statement") or data.get("supplementary_statement") or data.get("supplementary")
        statements = data.get("statements_facts") or data.get("statement_facts") or []
        explanation = data.get("explanation_text") or data.get("explanation")
        category_ids = data.get("category_ids") or []
        if not category_ids and quiz_type == QuizKind.GK:
            category_ids = data.get("premium_gk_category_ids") or []
        if not category_ids and quiz_type == QuizKind.MATHS:
            category_ids = data.get("premium_maths_category_ids") or []
        questions.append(
            CollectionTestQuestion(
                item_id=base,
                content_item_id=content["id"],
                quiz_type=quiz_type,
                question_statement=str(data.get("question_statement") or data.get("question") or ""),
                supplementary_statement=supp,
                statements_facts=statements,
                question_prompt=data.get("question_prompt") or data.get("prompt"),
                options=[{"label": str(o.get("label") or ""), "text": str(o.get("text") or "")} for o in options if isinstance(o, dict)],
                correct_answer=_normalize_label(data.get("correct_answer")),
                explanation_text=explanation,
                category_ids=category_ids,
            )
        )
    return questions


def _is_mains_collection_content(content_type: Any, data: Dict[str, Any]) -> bool:
    if str(content_type or "").strip().lower() != ContentType.QUESTION.value:
        return False
    mode = str(data.get("mode") or data.get("kind") or "").strip().lower()
    if mode in {"mains_ai", "mains_ai_question", "mains_question"}:
        return True
    question_text = str(
        data.get("question_text")
        or data.get("question_statement")
        or data.get("question")
        or ""
    ).strip()
    return bool(question_text and ("model_answer" in data or "answer_approach" in data))


def _normalize_mains_question_max_marks(value: Any, fallback: float = 10.0) -> float:
    try:
        parsed = float(value)
    except (TypeError, ValueError):
        parsed = fallback
    return parsed if parsed > 0 else fallback


def _can_view_mains_reference_material(user_ctx: Optional[Dict[str, Any]]) -> bool:
    if not user_ctx:
        return False
    if _is_admin_or_moderator(user_ctx):
        return True
    return _has_quiz_master_access(user_ctx) or _has_mains_mentor_access(user_ctx)


def _resolve_series_id_from_collection_row(collection: Dict[str, Any]) -> Optional[int]:
    direct_value = _safe_int(collection.get("series_id"), 0)
    if direct_value > 0:
        return direct_value
    meta = collection.get("meta")
    if isinstance(meta, dict):
        meta_value = _safe_int(meta.get("series_id"), 0)
        if meta_value > 0:
            return meta_value
    return None


def _active_series_enrollment_exists(*, series_id: int, user_id: str, supabase: Client) -> bool:
    if series_id <= 0 or not str(user_id or "").strip():
        return False
    row = _first(
        supabase.table(TEST_SERIES_ENROLLMENTS_TABLE)
        .select("id")
        .eq("series_id", series_id)
        .eq("user_id", user_id)
        .eq("status", "active")
        .limit(1)
        .execute()
    )
    return row is not None


def _is_series_open_access(series_row: Dict[str, Any]) -> bool:
    if not bool(series_row.get("is_public")) or not bool(series_row.get("is_active", True)):
        return False
    access_type = _as_role(series_row.get("access_type")) or ""
    if access_type == "free":
        return True
    return _safe_float(series_row.get("price")) <= 0


def _can_access_series_linked_collection(
    *,
    collection: Dict[str, Any],
    user_ctx: Optional[Dict[str, Any]],
    supabase: Client,
) -> bool:
    series_id = _resolve_series_id_from_collection_row(collection)
    if not series_id:
        return True

    series_row = _first(
        supabase.table(TEST_SERIES_TABLE)
        .select("id,provider_user_id,access_type,price,is_public,is_active")
        .eq("id", series_id)
        .limit(1)
        .execute()
    )
    if not series_row:
        return False
    if _is_series_open_access(series_row):
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
    return _active_series_enrollment_exists(series_id=series_id, user_id=user_id, supabase=supabase)


def _ensure_series_collection_access(
    *,
    collection: Dict[str, Any],
    user_ctx: Optional[Dict[str, Any]],
    supabase: Client,
) -> None:
    if _can_access_series_linked_collection(collection=collection, user_ctx=user_ctx, supabase=supabase):
        return
    raise HTTPException(status_code=403, detail="Activate series access before opening this test.")


def _expand_mains_collection_questions(
    collection_id: int,
    supabase: Client,
    *,
    include_reference_material: bool = True,
) -> List[MainsCollectionTestQuestion]:
    questions: List[MainsCollectionTestQuestion] = []
    items = _fetch_collection_items(collection_id, supabase)
    for item in items:
        content = item["content_item"] or {}
        if not isinstance(content, dict):
            continue
        data = content.get("data") or {}
        if not isinstance(data, dict):
            continue
        if not _is_mains_collection_content(content.get("type"), data):
            continue

        question_text = str(
            data.get("question_text")
            or data.get("question_statement")
            or data.get("question")
            or ""
        ).strip()
        if not question_text:
            continue

        try:
            word_limit = int(data.get("word_limit") or 150)
            if word_limit <= 0:
                word_limit = 150
        except (TypeError, ValueError):
            word_limit = 150

        max_marks = _normalize_mains_question_max_marks(
            data.get("max_marks") or data.get("marks") or data.get("question_marks"),
            fallback=10.0,
        )

        questions.append(
            MainsCollectionTestQuestion(
                item_id=int(item["id"]) * 1000,
                content_item_id=int(content.get("id") or 0),
                question_number=len(questions) + 1,
                question_text=question_text,
                answer_approach=(str(data.get("answer_approach") or "").strip() or None) if include_reference_material else None,
                model_answer=(str(data.get("model_answer") or "").strip() or None) if include_reference_material else None,
                word_limit=word_limit,
                max_marks=max_marks,
                answer_style_guidance=(str(data.get("answer_style_guidance") or "").strip() or None) if include_reference_material else None,
            )
        )
    return questions


@router.get("/collections/{collection_id}/test", response_model=CollectionTestResponse)
def get_collection_test(
    collection_id: int,
    user_ctx: Optional[Dict[str, Any]] = Depends(get_user_context),
    supabase: Client = Depends(get_supabase_client),
):
    collection = _fetch_collection(collection_id, supabase)
    if _resolve_collection_test_kind(collection.get("meta")) == CollectionTestKind.MAINS:
        raise HTTPException(
            status_code=400,
            detail="This is a Mains Test. Use /collections/{collection_id}/mains-test instead.",
        )
    _ensure_series_collection_access(collection=collection, user_ctx=user_ctx, supabase=supabase)
    questions = _expand_questions(collection_id, supabase)
    return CollectionTestResponse(
        collection_id=collection_id,
        collection_title=collection.get("title") or "",
        total_questions=len(questions),
        questions=questions,
    )


@router.post("/collections/{collection_id}/test/score", response_model=CollectionTestScoreResponse)
def score_collection_test(
    collection_id: int,
    payload: CollectionTestScoreRequest,
    user_ctx: Optional[Dict[str, Any]] = Depends(get_user_context),
    supabase: Client = Depends(get_supabase_client),
):
    collection = _fetch_collection(collection_id, supabase)
    if _resolve_collection_test_kind(collection.get("meta")) == CollectionTestKind.MAINS:
        raise HTTPException(
            status_code=400,
            detail="This is a Mains Test. Use /collections/{collection_id}/mains-test/score instead.",
        )
    _ensure_series_collection_access(collection=collection, user_ctx=user_ctx, supabase=supabase)
    user_id = str(user_ctx.get("user_id") or "").strip() if user_ctx else None
    questions = _expand_questions(collection_id, supabase)
    score_response, weak_areas = _score_expanded_questions(
        questions=questions,
        answers_payload=payload,
        supabase=supabase,
    )

    # Save attempt if user is authenticated
    attempt_id: Optional[int] = None
    if user_id:
        try:
            # We save the details as JSON
            details_json = [d.model_dump() for d in score_response.details]
            attempt_row = _first(
                supabase.table("user_quiz_attempts").insert({
                    "user_id": user_id,
                    "collection_id": collection_id,
                    "score": score_response.score,
                    "total_questions": len(questions),
                    "correct_answers": score_response.correct_answers,
                    "incorrect_answers": score_response.incorrect_answers,
                    "unanswered": score_response.unanswered,
                    "details": details_json,
                    "weak_areas": list(set(weak_areas)) # De-duplicate
                }).execute()
            )
            if attempt_row:
                attempt_id = int(attempt_row.get("id") or 0) or None
        except Exception as e:
            logger.error(f"Failed to save quiz attempt: {e}")
    return score_response.model_copy(update={"attempt_id": attempt_id})


@router.post("/collections/{collection_id}/quiz-complaints", response_model=QuizQuestionComplaintResponse)
def create_collection_quiz_complaint(
    collection_id: int,
    payload: QuizQuestionComplaintCreate,
    user_ctx: Dict[str, Any] = Depends(require_authenticated_user),
    supabase: Client = Depends(get_supabase_client),
):
    collection = _fetch_collection(collection_id, supabase)
    if _resolve_collection_test_kind(collection.get("meta")) == CollectionTestKind.MAINS:
        raise HTTPException(status_code=400, detail="Quiz complaints are available only for prelims tests.")
    _ensure_series_collection_access(collection=collection, user_ctx=user_ctx, supabase=supabase)

    user_id = str(user_ctx.get("user_id") or "").strip()
    attempt_row = _first(
        supabase.table("user_quiz_attempts")
        .select("id,user_id,collection_id,details")
        .eq("id", payload.attempt_id)
        .limit(1)
        .execute()
    )
    if not attempt_row:
        raise HTTPException(status_code=404, detail="Attempt not found.")
    if str(attempt_row.get("user_id") or "").strip() != user_id:
        raise HTTPException(status_code=403, detail="You can raise complaints only for your own attempts.")
    if int(attempt_row.get("collection_id") or 0) != collection_id:
        raise HTTPException(status_code=400, detail="Attempt does not belong to this test.")

    questions = _expand_questions(collection_id, supabase)
    question_lookup: Dict[int, Tuple[int, CollectionTestQuestion]] = {
        int(question.item_id): (index + 1, question)
        for index, question in enumerate(questions)
    }
    question_meta = question_lookup.get(int(payload.question_item_id))
    if not question_meta:
        raise HTTPException(status_code=400, detail="Question not found in this test.")
    question_number, question = question_meta

    details = attempt_row.get("details") if isinstance(attempt_row.get("details"), list) else []
    selected_option: Optional[str] = None
    correct_answer: Optional[str] = question.correct_answer
    for detail in details:
        if not isinstance(detail, dict):
            continue
        if int(detail.get("item_id") or 0) != int(payload.question_item_id):
            continue
        selected_option = str(detail.get("selected_option") or "").strip() or None
        correct_answer = str(detail.get("correct_answer") or question.correct_answer or "").strip() or None
        break

    complaint_text = str(payload.complaint_text or "").strip()
    if len(complaint_text) < 8:
        raise HTTPException(status_code=400, detail="Complaint text must be at least 8 characters long.")

    try:
        existing = _first(
            supabase.table(QUIZ_COMPLAINTS_TABLE)
            .select("id")
            .eq("attempt_id", payload.attempt_id)
            .eq("question_item_id", payload.question_item_id)
            .eq("user_id", user_id)
            .limit(1)
            .execute()
        )
    except Exception as exc:
        if _is_missing_table_error(exc, QUIZ_COMPLAINTS_TABLE):
            raise HTTPException(status_code=500, detail=QUIZ_COMPLAINTS_MIGRATION_HINT) from exc
        raise
    if existing:
        raise HTTPException(status_code=409, detail="A complaint already exists for this question in this attempt.")

    series_id, creator_user_id = _resolve_collection_creator_context(collection, supabase)
    question_text = str(question.question_statement or "").strip()
    if question.supplementary_statement:
        question_text = f"{question_text}\n{str(question.supplementary_statement).strip()}".strip()

    now_iso = _utc_now_iso()
    insert_payload = {
        "collection_id": collection_id,
        "series_id": series_id,
        "attempt_id": int(payload.attempt_id),
        "creator_user_id": creator_user_id,
        "user_id": user_id,
        "question_item_id": int(payload.question_item_id),
        "question_number": question_number,
        "question_text": question_text,
        "selected_option": selected_option,
        "correct_answer": correct_answer,
        "complaint_text": complaint_text,
        "status": QuizQuestionComplaintStatus.RECEIVED.value,
        "created_at": now_iso,
        "updated_at": now_iso,
    }
    try:
        row = _first(supabase.table(QUIZ_COMPLAINTS_TABLE).insert(insert_payload).execute())
    except Exception as exc:
        if _is_missing_table_error(exc, QUIZ_COMPLAINTS_TABLE):
            raise HTTPException(status_code=500, detail=QUIZ_COMPLAINTS_MIGRATION_HINT) from exc
        raise
    if not row:
        raise HTTPException(status_code=400, detail="Failed to create complaint.")
    return _quiz_complaint_row_view(row, collection_title=str(collection.get("title") or "").strip() or None)


@router.get("/collections/{collection_id}/quiz-complaints/me", response_model=List[QuizQuestionComplaintResponse])
def list_my_collection_quiz_complaints(
    collection_id: int,
    attempt_id: Optional[int] = Query(default=None, ge=1),
    user_ctx: Dict[str, Any] = Depends(require_authenticated_user),
    supabase: Client = Depends(get_supabase_client),
):
    collection = _fetch_collection(collection_id, supabase)
    if _resolve_collection_test_kind(collection.get("meta")) == CollectionTestKind.MAINS:
        return []
    _ensure_series_collection_access(collection=collection, user_ctx=user_ctx, supabase=supabase)

    user_id = str(user_ctx.get("user_id") or "").strip()
    try:
        query = (
            supabase.table(QUIZ_COMPLAINTS_TABLE)
            .select("*")
            .eq("collection_id", collection_id)
            .eq("user_id", user_id)
            .order("created_at", desc=True)
        )
        if attempt_id:
            query = query.eq("attempt_id", attempt_id)
        rows = _rows(query.execute())
    except Exception as exc:
        if _is_missing_table_error(exc, QUIZ_COMPLAINTS_TABLE):
            raise HTTPException(status_code=500, detail=QUIZ_COMPLAINTS_MIGRATION_HINT) from exc
        raise
    collection_title = str(collection.get("title") or "").strip() or None
    return [_quiz_complaint_row_view(row, collection_title=collection_title) for row in rows]


@router.get("/quiz-complaints/creator", response_model=List[QuizQuestionComplaintResponse])
def list_creator_quiz_complaints(
    status: Optional[QuizQuestionComplaintStatus] = Query(default=None),
    user_ctx: Dict[str, Any] = Depends(require_authenticated_user),
    supabase: Client = Depends(get_supabase_client),
):
    if not (_is_admin_or_moderator(user_ctx) or _has_quiz_master_access(user_ctx)):
        raise HTTPException(status_code=403, detail="Quiz Master access is required.")

    user_id = str(user_ctx.get("user_id") or "").strip()
    try:
        query = supabase.table(QUIZ_COMPLAINTS_TABLE).select("*").order("created_at", desc=True)
        if not _is_admin_or_moderator(user_ctx):
            query = query.eq("creator_user_id", user_id)
        if status:
            query = query.eq("status", status.value)
        rows = _rows(query.execute())
    except Exception as exc:
        if _is_missing_table_error(exc, QUIZ_COMPLAINTS_TABLE):
            raise HTTPException(status_code=500, detail=QUIZ_COMPLAINTS_MIGRATION_HINT) from exc
        raise

    title_map = _collection_title_map([int(row.get("collection_id") or 0) for row in rows], supabase)
    return [
        _quiz_complaint_row_view(row, collection_title=title_map.get(int(row.get("collection_id") or 0)))
        for row in rows
    ]


@router.patch("/quiz-complaints/{complaint_id}", response_model=QuizQuestionComplaintResponse)
def update_quiz_complaint(
    complaint_id: int,
    payload: QuizQuestionComplaintUpdate,
    user_ctx: Dict[str, Any] = Depends(require_authenticated_user),
    supabase: Client = Depends(get_supabase_client),
):
    try:
        row = _first(
            supabase.table(QUIZ_COMPLAINTS_TABLE)
            .select("*")
            .eq("id", complaint_id)
            .limit(1)
            .execute()
        )
    except Exception as exc:
        if _is_missing_table_error(exc, QUIZ_COMPLAINTS_TABLE):
            raise HTTPException(status_code=500, detail=QUIZ_COMPLAINTS_MIGRATION_HINT) from exc
        raise
    if not row:
        raise HTTPException(status_code=404, detail="Complaint not found.")

    creator_user_id = str(row.get("creator_user_id") or "").strip()
    current_user_id = str(user_ctx.get("user_id") or "").strip()
    if not _is_admin_or_moderator(user_ctx):
        if not _has_quiz_master_access(user_ctx) or creator_user_id != current_user_id:
            raise HTTPException(status_code=403, detail="Only the assigned creator can update this complaint.")

    if payload.status is None and payload.creator_note is None:
        raise HTTPException(status_code=400, detail="Provide a complaint status or creator note.")

    now_iso = _utc_now_iso()
    updates: Dict[str, Any] = {"updated_at": now_iso}
    if payload.status is not None:
        updates["status"] = payload.status.value
        updates["resolved_at"] = now_iso if payload.status == QuizQuestionComplaintStatus.RESOLVED else None
    if payload.creator_note is not None:
        updates["creator_note"] = str(payload.creator_note or "").strip() or None

    updated = _first(
        supabase.table(QUIZ_COMPLAINTS_TABLE)
        .update(updates)
        .eq("id", complaint_id)
        .execute()
    )
    if not updated:
        raise HTTPException(status_code=400, detail="Failed to update complaint.")

    collection_title = None
    collection_id = int(updated.get("collection_id") or 0)
    if collection_id > 0:
        collection_title = _collection_title_map([collection_id], supabase).get(collection_id)
    return _quiz_complaint_row_view(updated, collection_title=collection_title)


@router.get("/collections/{collection_id}/mains-test", response_model=MainsCollectionTestResponse)
def get_collection_mains_test(
    collection_id: int,
    user_ctx: Optional[Dict[str, Any]] = Depends(get_user_context),
    supabase: Client = Depends(get_supabase_client),
):
    collection = _fetch_collection(collection_id, supabase)
    _ensure_series_collection_access(collection=collection, user_ctx=user_ctx, supabase=supabase)
    declared_kind = _resolve_collection_test_kind(collection.get("meta"))
    questions = _expand_mains_collection_questions(
        collection_id,
        supabase,
        include_reference_material=_can_view_mains_reference_material(user_ctx),
    )
    if declared_kind != CollectionTestKind.MAINS and len(questions) == 0:
        raise HTTPException(
            status_code=400,
            detail="This is a Prelims Test. Use /collections/{collection_id}/test instead.",
        )
    return MainsCollectionTestResponse(
        collection_id=collection_id,
        series_id=_resolve_series_id_from_collection_row(collection),
        collection_title=str(collection.get("title") or ""),
        total_questions=len(questions),
        questions=questions,
    )


@router.post("/collections/{collection_id}/mains-test/score", response_model=MainsCollectionTestScoreResponse)
async def score_collection_mains_test(
    collection_id: int,
    payload: MainsCollectionTestScoreRequest,
    user_ctx: Dict[str, Any] = Depends(require_mains_generation_access),
    supabase: Client = Depends(get_supabase_client),
):
    user_id = str(user_ctx.get("user_id") or "").strip() or None
    collection = _fetch_collection(collection_id, supabase)
    _ensure_series_collection_access(collection=collection, user_ctx=user_ctx, supabase=supabase)
    declared_kind = _resolve_collection_test_kind(collection.get("meta"))
    questions = _expand_mains_collection_questions(collection_id, supabase, include_reference_material=True)
    if declared_kind != CollectionTestKind.MAINS and len(questions) == 0:
        raise HTTPException(
            status_code=400,
            detail="This is a Prelims Test. Use /collections/{collection_id}/test/score instead.",
        )
    question_map: Dict[int, MainsCollectionTestQuestion] = {question.item_id: question for question in questions}
    submitted_answers: Dict[int, str] = {}
    for answer in payload.answers:
        text = str(answer.answer_text or "").strip()
        if answer.item_id in question_map:
            submitted_answers[answer.item_id] = text

    base_instructions = _resolve_ai_instruction_text(
        supabase,
        content_type=AISystemInstructionContentType.MAINS_EVALUATION,
        fallback_text=_default_mains_evaluation_instructions(),
    )

    details: List[MainsCollectionTestScoreDetail] = []
    attempted = 0
    evaluated = 0
    total_score = 0.0
    max_total_score = 0.0

    for question in questions:
        answer_text = submitted_answers.get(question.item_id) or ""
        if not answer_text:
            details.append(
                MainsCollectionTestScoreDetail(
                    item_id=question.item_id,
                    content_item_id=question.content_item_id,
                    question_text=question.question_text,
                    answer_text=None,
                    score=0.0,
                    max_score=question.max_marks,
                    feedback="No answer submitted.",
                    strengths=[],
                    weaknesses=[],
                    reference_model_answer=question.model_answer,
                )
            )
            continue

        attempted += 1
        request = MainsEvaluationRequest(
            mains_question_id=None,
            question_text=question.question_text,
            answer_text=answer_text,
            model_answer=question.model_answer,
            instructions=None,
            answer_formatting_guidance=question.answer_style_guidance,
            example_evaluation_id=None,
        )
        try:
            evaluation = await evaluate_mains_answer(request, base_instructions)
            score_raw = evaluation.get("score", 0)
            max_score_raw = evaluation.get("max_score", question.max_marks)
            try:
                score_value = float(score_raw)
            except (TypeError, ValueError):
                score_value = 0.0
            try:
                max_score_value = float(max_score_raw)
            except (TypeError, ValueError):
                max_score_value = 10.0

            evaluated += 1
            total_score += score_value
            max_total_score += max_score_value

            feedback_text = str(evaluation.get("feedback") or "").strip()
            strengths = [str(item).strip() for item in (evaluation.get("strengths") or []) if str(item).strip()]
            weaknesses = [str(item).strip() for item in (evaluation.get("weaknesses") or []) if str(item).strip()]

            details.append(
                MainsCollectionTestScoreDetail(
                    item_id=question.item_id,
                    content_item_id=question.content_item_id,
                    question_text=question.question_text,
                    answer_text=answer_text,
                    score=round(score_value, 2),
                    max_score=round(max_score_value, 2),
                    feedback=feedback_text or "Evaluation completed.",
                    strengths=strengths,
                    weaknesses=weaknesses,
                    reference_model_answer=question.model_answer,
                )
            )
        except Exception as exc:
            details.append(
                MainsCollectionTestScoreDetail(
                    item_id=question.item_id,
                    content_item_id=question.content_item_id,
                    question_text=question.question_text,
                    answer_text=answer_text,
                    score=0.0,
                    max_score=question.max_marks,
                    feedback=f"Evaluation failed: {str(exc)}",
                    strengths=[],
                    weaknesses=[],
                    reference_model_answer=question.model_answer,
                )
            )

    if user_id:
        try:
            save_rows = []
            for detail in details:
                if not detail.answer_text:
                    continue
                save_rows.append(
                    {
                        "user_id": user_id,
                        "question_id": detail.content_item_id,
                        "question_text": detail.question_text,
                        "answer_text": detail.answer_text,
                        "score": detail.score,
                        "max_score": detail.max_score,
                        "feedback": detail.feedback,
                        "strengths": detail.strengths,
                        "weaknesses": detail.weaknesses,
                        "improved_answer": detail.reference_model_answer,
                    }
                )
            if save_rows:
                supabase.table("user_mains_evaluations").insert(save_rows).execute()
        except Exception as exc:
            logger.error("Failed to save mains collection test evaluations: %s", exc)

    average_score = round(total_score / float(evaluated), 2) if evaluated > 0 else 0.0
    return MainsCollectionTestScoreResponse(
        total_questions=len(questions),
        attempted=attempted,
        evaluated=evaluated,
        average_score=average_score,
        total_score=round(total_score, 2),
        max_total_score=round(max_total_score, 2),
        details=details,
    )


@router.post("/collections/{collection_id}/challenges", response_model=ChallengeLinkResponse)
def create_collection_challenge(
    collection_id: int,
    payload: ChallengeLinkCreateRequest,
    user_ctx: Optional[Dict[str, Any]] = Depends(get_user_context),
    supabase: Client = Depends(get_supabase_client),
):
    collection = _fetch_collection(collection_id, supabase)
    if _resolve_collection_test_kind(collection.get("meta")) == CollectionTestKind.MAINS:
        raise HTTPException(status_code=400, detail="Challenge mode is available only for Prelims Tests.")
    owner_user_id = _require_collection_owner_or_admin(
        collection_row=collection,
        user_ctx=user_ctx,
        require_active_subscription=True,
    )
    questions = _expand_questions(collection_id, supabase)
    if not questions:
        raise HTTPException(status_code=400, detail="Collection has no attemptable quiz questions.")

    now = _utc_now()
    if not bool(collection.get("is_public")) or not bool(collection.get("is_finalized")):
        try:
            promoted_collection = _first(
                supabase.table("collections")
                .update(
                    {
                        "is_public": True,
                        "is_finalized": True,
                        "updated_at": now.isoformat(),
                    }
                )
                .eq("id", collection_id)
                .execute()
            )
        except Exception as exc:
            raise HTTPException(status_code=500, detail=f"Failed to prepare collection for public challenge: {exc}")
        if promoted_collection:
            collection = promoted_collection

    existing_live_row = _latest_live_challenge_row_for_collection(collection_id=collection_id, supabase=supabase)
    if existing_live_row:
        return ChallengeLinkResponse(**_challenge_row_view(existing_live_row))

    title = str(payload.title or "").strip() or f"{collection.get('title') or 'Test'} Challenge"
    expires_at: Optional[datetime] = None
    if payload.expires_in_hours is not None:
        expires_at = now + timedelta(hours=int(payload.expires_in_hours))
    elif CHALLENGE_DEFAULT_EXPIRY_HOURS > 0:
        expires_at = now + timedelta(hours=CHALLENGE_DEFAULT_EXPIRY_HOURS)

    raw_token: Optional[str] = None
    token_hash: Optional[str] = None
    created_row: Optional[Dict[str, Any]] = None

    for _ in range(5):
        candidate_token = secrets.token_urlsafe(24)
        candidate_hash = _hash_challenge_token(candidate_token)
        insert_payload = {
            "collection_id": collection_id,
            "owner_user_id": owner_user_id,
            "token_hash": candidate_hash,
            "title": title,
            "description": payload.description,
            "is_active": True,
            "allow_anonymous": bool(payload.allow_anonymous),
            "require_login": bool(payload.require_login),
            "max_attempts_per_participant": int(payload.max_attempts_per_participant),
            "total_attempts": 0,
            "created_at": now.isoformat(),
            "updated_at": now.isoformat(),
            "expires_at": expires_at.isoformat() if expires_at else None,
        }
        try:
            created_row = _first(supabase.table(CHALLENGE_LINKS_TABLE).insert(insert_payload).execute())
        except Exception as exc:
            if _is_missing_table_like_error(exc, CHALLENGE_LINKS_TABLE):
                _raise_challenges_migration_required(exc)
            if "duplicate key value violates unique constraint" in str(exc).lower():
                continue
            raise
        if created_row:
            raw_token = candidate_token
            token_hash = candidate_hash
            break
    if not created_row or not raw_token or not token_hash:
        raise HTTPException(status_code=500, detail="Failed to create challenge link.")
    return ChallengeLinkResponse(**_challenge_row_view(created_row, token=raw_token))


@router.get("/collections/{collection_id}/challenges", response_model=List[ChallengeLinkResponse])
def list_collection_challenges(
    collection_id: int,
    user_ctx: Optional[Dict[str, Any]] = Depends(get_user_context),
    supabase: Client = Depends(get_supabase_client),
):
    collection = _fetch_collection(collection_id, supabase)
    _require_collection_owner_or_admin(
        collection_row=collection,
        user_ctx=user_ctx,
        require_active_subscription=False,
    )
    try:
        rows = _rows(
            supabase.table(CHALLENGE_LINKS_TABLE)
            .select("*")
            .eq("collection_id", collection_id)
            .order("created_at", desc=True)
            .execute()
        )
    except Exception as exc:
        if _is_missing_table_like_error(exc, CHALLENGE_LINKS_TABLE):
            _raise_challenges_migration_required(exc)
        raise
    return [ChallengeLinkResponse(**_challenge_row_view(row)) for row in rows]


@router.patch("/collections/{collection_id}/challenges/{challenge_id}", response_model=ChallengeLinkResponse)
def update_collection_challenge(
    collection_id: int,
    challenge_id: int,
    payload: ChallengeLinkUpdateRequest,
    user_ctx: Optional[Dict[str, Any]] = Depends(get_user_context),
    supabase: Client = Depends(get_supabase_client),
):
    collection = _fetch_collection(collection_id, supabase)
    _require_collection_owner_or_admin(
        collection_row=collection,
        user_ctx=user_ctx,
        require_active_subscription=False,
    )
    try:
        existing = _first(
            supabase.table(CHALLENGE_LINKS_TABLE)
            .select("*")
            .eq("id", challenge_id)
            .eq("collection_id", collection_id)
            .limit(1)
            .execute()
        )
    except Exception as exc:
        if _is_missing_table_like_error(exc, CHALLENGE_LINKS_TABLE):
            _raise_challenges_migration_required(exc)
        raise
    if not existing:
        raise HTTPException(status_code=404, detail="Challenge not found.")

    updates = payload.model_dump(exclude_none=True)
    if updates.get("expires_at") is not None:
        parsed = _parse_datetime(updates["expires_at"])
        updates["expires_at"] = parsed.isoformat() if parsed else None
    updates["updated_at"] = _utc_now().isoformat()

    try:
        row = _first(
            supabase.table(CHALLENGE_LINKS_TABLE)
            .update(updates)
            .eq("id", challenge_id)
            .eq("collection_id", collection_id)
            .execute()
        )
    except Exception as exc:
        if _is_missing_table_like_error(exc, CHALLENGE_LINKS_TABLE):
            _raise_challenges_migration_required(exc)
        raise
    if not row:
        raise HTTPException(status_code=404, detail="Challenge not found.")
    return ChallengeLinkResponse(**_challenge_row_view(row))


@router.get("/challenges/public", response_model=List[PublicChallengeListItemResponse])
def list_public_challenges(
    limit: int = Query(default=24, ge=1, le=100),
    supabase: Client = Depends(get_supabase_client),
):
    try:
        challenge_rows = _rows(
            supabase.table(CHALLENGE_LINKS_TABLE)
            .select("*")
            .eq("is_active", True)
            .order("created_at", desc=True)
            .limit(max(limit * 3, limit))
            .execute()
        )
    except Exception as exc:
        if _is_missing_table_like_error(exc, CHALLENGE_LINKS_TABLE):
            _raise_challenges_migration_required(exc)
        raise

    now = _utc_now()
    active_rows: List[Dict[str, Any]] = []
    collection_ids: Set[int] = set()
    seen_collection_ids: Set[int] = set()
    for row in challenge_rows:
        expires_at = _parse_datetime(row.get("expires_at"))
        if expires_at is not None and expires_at <= now:
            continue
        try:
            collection_id = int(row.get("collection_id") or 0)
        except (TypeError, ValueError):
            continue
        if collection_id <= 0:
            continue
        if collection_id in seen_collection_ids:
            continue
        active_rows.append(row)
        seen_collection_ids.add(collection_id)
        collection_ids.add(collection_id)

    collection_map: Dict[int, Dict[str, Any]] = {}
    if collection_ids:
        collection_query = supabase.table("collections").select("*")
        if len(collection_ids) == 1:
            collection_rows = _rows(collection_query.eq("id", next(iter(collection_ids))).execute())
        else:
            collection_rows = _rows(collection_query.in_("id", sorted(collection_ids)).execute())
        for row in collection_rows:
            try:
                collection_id = int(row.get("id") or 0)
            except (TypeError, ValueError):
                continue
            if collection_id <= 0:
                continue
            collection_map[collection_id] = row

    items: List[PublicChallengeListItemResponse] = []
    for challenge_row in active_rows:
        try:
            collection_id = int(challenge_row.get("collection_id") or 0)
        except (TypeError, ValueError):
            continue
        collection_row = collection_map.get(collection_id)
        if not collection_row:
            continue
        if not bool(collection_row.get("is_public")) or not bool(collection_row.get("is_finalized")):
            continue
        collection_meta = collection_row.get("meta") if isinstance(collection_row.get("meta"), dict) else {}
        if _resolve_collection_test_kind(collection_meta) == CollectionTestKind.MAINS:
            continue
        question_count = len(_expand_questions(collection_id, supabase))
        item = _public_challenge_row_view(
            challenge_row=challenge_row,
            collection_row=collection_row,
            question_count=question_count,
        )
        if not item:
            continue
        items.append(item)
        if len(items) >= limit:
            break

    return items


@router.get("/challenge/{token}", response_model=ChallengeTestResponse)
def get_public_challenge_test(
    token: str,
    user_ctx: Optional[Dict[str, Any]] = Depends(get_user_context),
    supabase: Client = Depends(get_supabase_client),
):
    challenge = _fetch_challenge_by_token(token=token, supabase=supabase, include_inactive=False)
    if bool(challenge.get("require_login")) and not user_ctx:
        raise HTTPException(status_code=401, detail="Login required to attempt this challenge.")

    collection_id = int(challenge["collection_id"])
    collection = _fetch_collection(collection_id, supabase)
    questions = _expand_questions(collection_id, supabase)
    sanitized_questions = _challenge_questions_payload(questions)
    return ChallengeTestResponse(
        challenge_id=int(challenge["id"]),
        challenge_title=str(challenge.get("title") or "Challenge"),
        challenge_description=challenge.get("description"),
        collection_id=collection_id,
        collection_title=str(collection.get("title") or ""),
        total_questions=len(sanitized_questions),
        total_attempts=int(challenge.get("total_attempts") or 0),
        questions=sanitized_questions,
    )


@router.post("/challenge/{token}/submit", response_model=ChallengeScoreResponse)
def submit_public_challenge(
    token: str,
    payload: ChallengeAttemptSubmitRequest,
    user_ctx: Optional[Dict[str, Any]] = Depends(get_user_context),
    supabase: Client = Depends(get_supabase_client),
):
    challenge = _fetch_challenge_by_token(token=token, supabase=supabase, include_inactive=False)
    if bool(challenge.get("require_login")) and not user_ctx:
        raise HTTPException(status_code=401, detail="Login required to attempt this challenge.")
    if not bool(challenge.get("allow_anonymous", True)) and not user_ctx:
        raise HTTPException(status_code=403, detail="Anonymous attempts are disabled for this challenge.")

    user_id = str((user_ctx or {}).get("user_id") or "").strip() or None
    participant_name = _participant_name(user_ctx, payload.participant_name)
    participant_key = _participant_key(user_id, payload.participant_key, participant_name)
    max_attempts = int(challenge.get("max_attempts_per_participant") or 3)

    try:
        previous_attempts = _rows(
            supabase.table(CHALLENGE_ATTEMPTS_TABLE)
            .select("id")
            .eq("challenge_id", int(challenge["id"]))
            .eq("participant_key", participant_key)
            .execute()
        )
    except Exception as exc:
        if _is_missing_table_like_error(exc, CHALLENGE_ATTEMPTS_TABLE):
            _raise_challenges_migration_required(exc)
        raise
    if len(previous_attempts) >= max_attempts:
        raise HTTPException(status_code=429, detail="Attempt limit reached for this challenge.")

    collection_id = int(challenge["collection_id"])
    collection = _fetch_collection(collection_id, supabase)
    questions = _expand_questions(collection_id, supabase)
    score_payload = CollectionTestScoreRequest(answers=payload.answers)
    score_response, _weak_areas = _score_expanded_questions(
        questions=questions,
        answers_payload=score_payload,
        supabase=supabase,
    )

    now_iso = _utc_now().isoformat()
    try:
        attempt_row = _first(
            supabase.table(CHALLENGE_ATTEMPTS_TABLE).insert(
                {
                    "challenge_id": int(challenge["id"]),
                    "collection_id": collection_id,
                    "participant_user_id": user_id,
                    "participant_name": participant_name,
                    "participant_key": participant_key,
                    "score": score_response.score,
                    "total_questions": score_response.total_questions,
                    "correct_answers": score_response.correct_answers,
                    "incorrect_answers": score_response.incorrect_answers,
                    "unanswered": score_response.unanswered,
                    "details": [detail.model_dump() for detail in score_response.details],
                    "category_wise_results": score_response.category_wise_results,
                    "collection_title": str(collection.get("title") or ""),
                    "created_at": now_iso,
                }
            ).execute()
        )
    except Exception as exc:
        if _is_missing_table_like_error(exc, CHALLENGE_ATTEMPTS_TABLE):
            _raise_challenges_migration_required(exc)
        raise
    if not attempt_row:
        raise HTTPException(status_code=500, detail="Failed to record challenge attempt.")

    try:
        supabase.table(CHALLENGE_LINKS_TABLE).update(
            {
                "total_attempts": int(challenge.get("total_attempts") or 0) + 1,
                "updated_at": now_iso,
            }
        ).eq("id", int(challenge["id"])).execute()
    except Exception as exc:
        if _is_missing_table_like_error(exc, CHALLENGE_LINKS_TABLE):
            _raise_challenges_migration_required(exc)
        raise

    return _challenge_score_response_from_attempt_row(
        challenge_row=challenge,
        attempt_row=attempt_row,
        token=token,
        supabase=supabase,
    )


@router.get("/challenge/{token}/attempts/{attempt_id}", response_model=ChallengeScoreResponse)
def get_challenge_attempt_result(
    token: str,
    attempt_id: int,
    supabase: Client = Depends(get_supabase_client),
):
    challenge = _fetch_challenge_by_token(token=token, supabase=supabase, include_inactive=True)
    try:
        attempt_row = _first(
            supabase.table(CHALLENGE_ATTEMPTS_TABLE)
            .select("*")
            .eq("id", attempt_id)
            .eq("challenge_id", int(challenge["id"]))
            .limit(1)
            .execute()
        )
    except Exception as exc:
        if _is_missing_table_like_error(exc, CHALLENGE_ATTEMPTS_TABLE):
            _raise_challenges_migration_required(exc)
        raise
    if not attempt_row:
        raise HTTPException(status_code=404, detail="Challenge attempt not found.")

    return _challenge_score_response_from_attempt_row(
        challenge_row=challenge,
        attempt_row=attempt_row,
        token=token,
        supabase=supabase,
    )


@router.get("/challenge/{token}/leaderboard", response_model=ChallengeLeaderboardResponse)
def get_challenge_leaderboard(
    token: str,
    limit: int = Query(default=10, ge=1, le=100),
    supabase: Client = Depends(get_supabase_client),
):
    challenge = _fetch_challenge_by_token(token=token, supabase=supabase, include_inactive=True)
    collection = _fetch_collection(int(challenge["collection_id"]), supabase)
    rows = _challenge_attempt_rank_rows(challenge_id=int(challenge["id"]), supabase=supabase, limit=CHALLENGE_MAX_LEADERBOARD_SIZE)
    entries: List[ChallengeLeaderboardEntry] = []
    for idx, row in enumerate(rows[:limit], start=1):
        entries.append(
            ChallengeLeaderboardEntry(
                rank=idx,
                participant_name=str(row.get("participant_name") or "Anonymous Challenger"),
                score=int(row.get("score") or 0),
                total_questions=int(row.get("total_questions") or 0),
                correct_answers=int(row.get("correct_answers") or 0),
                incorrect_answers=int(row.get("incorrect_answers") or 0),
                unanswered=int(row.get("unanswered") or 0),
                submitted_at=str(row.get("created_at") or ""),
            )
        )
    return ChallengeLeaderboardResponse(
        challenge_id=int(challenge["id"]),
        challenge_title=str(challenge.get("title") or "Challenge"),
        collection_id=int(challenge["collection_id"]),
        collection_title=str(collection.get("title") or ""),
        total_participants=len(rows),
        top_entries=entries,
    )


@router.get("/ai/instructions", response_model=List[AIInstructionResponse])
def list_ai_instructions(
    type: Optional[AIInstructionType] = None,
    active_only: bool = True,
    supabase: Client = Depends(get_supabase_client),
):
    query = supabase.table("ai_instructions").select("*").order("created_at", desc=True)
    if type:
        query = query.eq("type", type.value)
    if active_only:
        query = query.eq("is_active", True)
    return _rows(query.execute())


@router.post("/ai/instructions", response_model=AIInstructionResponse)
def create_ai_instruction(payload: AIInstructionCreate, supabase: Client = Depends(get_supabase_client)):
    data = payload.model_dump(exclude_none=True)
    data["type"] = payload.type.value
    row = _first(supabase.table("ai_instructions").insert(data).execute())
    if not row:
        raise HTTPException(status_code=400, detail="Failed to create AI instruction")
    return row


@router.put("/ai/instructions/{instruction_id}", response_model=AIInstructionResponse)
def update_ai_instruction(
    instruction_id: int,
    payload: AIInstructionUpdate,
    supabase: Client = Depends(get_supabase_client),
):
    updates = payload.model_dump(exclude_none=True)
    if updates.get("type") is not None:
        updates["type"] = updates["type"].value
    row = _first(supabase.table("ai_instructions").update(updates).eq("id", instruction_id).execute())
    if not row:
        raise HTTPException(status_code=404, detail="AI instruction not found")
    return row


@router.post("/ai/generate", response_model=AIQuizGenerateResponse)
async def generate_ai_content(
    request: AIQuizGenerateRequest,
    user_ctx: Dict[str, Any] = Depends(require_generation_access),
    supabase: Client = Depends(get_supabase_client),
):
    instruction_override = None
    if request.instruction_id is not None:
        instruction_override = _first(
            supabase.table("ai_instructions")
            .select("*")
            .eq("id", request.instruction_id)
            .limit(1)
            .execute()
        )

    if request.example_analysis_id:
        example_analysis_row = _first(
            supabase.table("premium_ai_example_analyses")
            .select("*")
            .eq("id", request.example_analysis_id)
            .limit(1)
            .execute()
        )
        if example_analysis_row:
            _apply_example_analysis_to_generate_request(request, example_analysis_row)

    kind = request.quiz_kind
    if kind is None:
        lower = request.content_type.lower()
        kind = QuizKind.PASSAGE if "passage" in lower else (QuizKind.MATHS if "math" in lower else QuizKind.GK)
    explicit_request_category_ids = [request.category_id] if request.category_id else []
    category_instruction_block = _category_structure_instruction_block(
        kind,
        supabase,
        requested_category_ids=explicit_request_category_ids,
    )
    language_instruction_block = _language_instruction_block(request.output_language, scope="quiz")
    request.user_instructions = _merge_instruction_parts(
        request.user_instructions,
        category_instruction_block or None,
        language_instruction_block,
    )

    try:
        items = await generate_quiz_content(request, instruction_override=instruction_override)
    except RuntimeError as exc:
        raise HTTPException(status_code=503, detail=str(exc))
    items = _assign_category_ids_to_generated_items(
        items,
        quiz_kind=kind,
        supabase=supabase,
        requested_category_ids=explicit_request_category_ids,
        source_text=request.content or request.url,
    )
    saved_content_item_ids: List[int] = []

    if request.save_to_collection_id and items:
        collection_row = _fetch_collection(request.save_to_collection_id, supabase)
        collection_category_ids = _normalize_exam_ids(
            ((collection_row.get("meta") or {}).get("category_ids"))
        )

        content_type = QUIZ_KIND_TO_CONTENT_TYPE[kind]
        next_order = _next_order(request.save_to_collection_id, supabase)

        for idx, item in enumerate(items, start=1):
            if kind == QuizKind.PASSAGE and isinstance(item.get("questions"), list):
                questions_payload = []
                for q in item.get("questions") or []:
                    if not isinstance(q, dict):
                        continue
                    options = q.get("options") or []
                    normalized = []
                    for o_idx, option in enumerate(options):
                        label = chr(ord("A") + o_idx)
                        if isinstance(option, dict):
                            normalized.append({"label": str(option.get("label") or label), "text": str(option.get("text") or "")})
                        else:
                            normalized.append({"label": label, "text": str(option)})
                    questions_payload.append(
                        {
                            "question_statement": q.get("question_statement") or q.get("question"),
                            "supp_question_statement": q.get("supp_question_statement") or q.get("supplementary_statement"),
                            "supplementary_statement": q.get("supp_question_statement") or q.get("supplementary_statement"),
                            "question_prompt": q.get("question_prompt"),
                            "statements_facts": q.get("statements_facts") or q.get("statement_facts") or [],
                            "statement_facts": q.get("statements_facts") or q.get("statement_facts") or [],
                            "options": normalized,
                            "correct_answer": _normalize_label(q.get("correct_answer") or q.get("answer")),
                            "explanation": q.get("explanation_text") or q.get("explanation"),
                            "explanation_text": q.get("explanation_text") or q.get("explanation"),
                        }
                    )
                passage_data = {
                    "passage_title": item.get("passage_title"),
                    "passage_text": item.get("passage_text") or request.content,
                    "source_reference": item.get("source_reference"),
                    "category_ids": _normalize_exam_ids(
                        item.get("category_ids") or item.get("premium_passage_category_ids")
                    ),
                    "questions": questions_payload,
                }
                resolved_category_ids = (
                    collection_category_ids
                    or _extract_category_ids_from_content_data(passage_data, QuizKind.PASSAGE)
                    or explicit_request_category_ids
                    or _infer_category_ids_for_text(
                        _content_data_match_text(passage_data, QuizKind.PASSAGE),
                        CategoryType.PASSAGE.value,
                        supabase,
                    )
                )
                _apply_category_ids_to_content_data(passage_data, QuizKind.PASSAGE, resolved_category_ids)
                created = _first(
                    supabase.table("content_items")
                    .insert(
                        {
                            "title": str(item.get("passage_title") or f"AI Generated Passage #{idx}")[:200],
                            "type": ContentType.QUIZ_PASSAGE.value,
                            "data": passage_data,
                        }
                    )
                    .execute()
                )
                if created:
                    saved_content_item_ids.append(int(created["id"]))
                    supabase.table("collection_items").insert(
                        {
                            "collection_id": request.save_to_collection_id,
                            "content_item_id": created["id"],
                            "order": next_order,
                        }
                    ).execute()
                    next_order += 1
                continue

            options = item.get("options") or []
            normalized_options = []
            for o_idx, option in enumerate(options):
                label = chr(ord("A") + o_idx)
                if isinstance(option, dict):
                    normalized_options.append({"label": str(option.get("label") or label), "text": str(option.get("text") or "")})
                else:
                    normalized_options.append({"label": label, "text": str(option)})
            data = {
                "question_statement": item.get("question_statement") or item.get("question"),
                "supp_question_statement": item.get("supp_question_statement") or item.get("supplementary_statement"),
                "supplementary_statement": item.get("supp_question_statement") or item.get("supplementary_statement"),
                "question_prompt": item.get("question_prompt"),
                "statements_facts": item.get("statements_facts") or item.get("statement_facts") or [],
                "statement_facts": item.get("statements_facts") or item.get("statement_facts") or [],
                "options": normalized_options,
                "correct_answer": _normalize_label(item.get("correct_answer") or item.get("answer")),
                "explanation": item.get("explanation_text") or item.get("explanation"),
                "explanation_text": item.get("explanation_text") or item.get("explanation"),
                "source_reference": item.get("source_reference") or item.get("source"),
                "source": item.get("source_reference") or item.get("source"),
                "category_ids": _normalize_exam_ids(
                    item.get("category_ids")
                    or item.get("premium_gk_category_ids")
                    or item.get("premium_maths_category_ids")
                ),
            }
            resolved_category_ids = (
                collection_category_ids
                or _extract_category_ids_from_content_data(data, kind)
                or explicit_request_category_ids
                or _infer_category_ids_for_text(
                    _content_data_match_text(data, kind),
                    _category_type_for_quiz_kind(kind),
                    supabase,
                )
            )
            _apply_category_ids_to_content_data(data, kind, resolved_category_ids)
            created = _first(
                supabase.table("content_items")
                .insert(
                    {
                        "title": str(data.get("question_statement") or f"AI Generated Question #{idx}")[:200],
                        "type": content_type,
                        "data": data,
                    }
                )
                .execute()
            )
            if created:
                saved_content_item_ids.append(int(created["id"]))
                supabase.table("collection_items").insert(
                    {
                        "collection_id": request.save_to_collection_id,
                        "content_item_id": created["id"],
                        "order": next_order,
                    }
                ).execute()
                next_order += 1

    return AIQuizGenerateResponse(items=items, saved_content_item_ids=saved_content_item_ids)


def _default_mains_question_generation_instructions() -> str:
    return (
        "You are an expert UPSC Civil Services Mains Question setter. "
        "Generate high-quality questions based on the provided content."
    )


def _default_mains_evaluation_instructions() -> str:
    return (
        "You are an expert UPSC Mains Answer Evaluator. Evaluate the student's answer based on the Question and Model Answer. "
        "STRICTLY FOLLOW THESE RULES:\n"
        "1. **Context Check & Zero Tolerance**: Check if the student answer addresses the specific context of the question.\n"
        "2. **Evaluation Format (Section-wise)**: Overall Verdict, Introduction Analysis, Body Analysis, Conclusion Analysis.\n"
        "3. **Keywords & Structure**: Identify keywords and explain their demand.\n"
        "4. **Model Answer Handling**: Do NOT create a new model/improved answer during evaluation; use the provided model answer only as reference.\n"
        "5. **Output Format**: Return a JSON object with: score (number), max_score (number), feedback (markdown string), strengths (list of strings), weaknesses (list of strings), improved_answer (string|null). "
        "Set improved_answer to the provided model answer if available, otherwise null."
    )


def _resolve_ai_instruction_text(
    supabase: Client,
    *,
    content_type: AISystemInstructionContentType,
    fallback_text: str,
) -> str:
    try:
        row = _first(
            supabase.table("ai_instructions")
            .select("*")
            .eq("content_type", content_type.value)
            .limit(1)
            .execute()
        )
    except Exception:
        row = None
    if row and str(row.get("system_instructions") or "").strip():
        return str(row.get("system_instructions")).strip()
    return fallback_text


def _extract_style_instructions_from_analysis(row: Optional[Dict[str, Any]]) -> str:
    if not row:
        return ""
    style_profile = row.get("style_profile")
    if not isinstance(style_profile, dict):
        return ""
    return str(style_profile.get("style_instructions") or "").strip()


def _extract_mains_question_generation_guidance(
    row: Optional[Dict[str, Any]],
) -> Tuple[str, str]:
    if not row:
        return ("", "")
    style_profile = row.get("style_profile")
    if not isinstance(style_profile, dict):
        return ("", "")

    question_style = str(
        style_profile.get("question_style_instructions")
        or style_profile.get("question_style")
        or style_profile.get("style_instructions")
        or ""
    ).strip()
    answer_style = str(
        style_profile.get("answer_style_instructions")
        or style_profile.get("answer_style")
        or ""
    ).strip()
    return (question_style, answer_style)


def _extract_mains_example_questions_for_guidance(
    row: Optional[Dict[str, Any]],
    *,
    max_examples: int = 4,
    max_chars: int = 280,
) -> List[str]:
    if not row:
        return []
    raw = row.get("example_questions")
    if not isinstance(raw, list):
        return []
    output: List[str] = []
    for item in raw:
        text = str(item or "").strip()
        if not text:
            continue
        collapsed = re.sub(r"\s+", " ", text)
        if len(collapsed) > max_chars:
            collapsed = collapsed[: max_chars - 3].rstrip() + "..."
        output.append(collapsed)
        if len(output) >= max_examples:
            break
    return output


def _load_user_mains_reference_questions(
    *,
    user_id: str,
    supabase: Client,
    max_items: int = USER_AI_HINTS_MAX_RECENT_QUESTIONS,
) -> List[str]:
    normalized_user_id = str(user_id or "").strip()
    if not normalized_user_id:
        return []

    try:
        rows = _rows(
            supabase.table("user_ai_mains_questions")
            .select("question_text")
            .eq("author_id", normalized_user_id)
            .order("created_at", desc=True)
            .limit(max(max_items * 2, max_items))
            .execute()
        )
    except Exception:
        # Backward compatibility for deployments where historical rows used user_id.
        try:
            rows = _rows(
                supabase.table("user_ai_mains_questions")
                .select("question_text")
                .eq("user_id", normalized_user_id)
                .order("created_at", desc=True)
                .limit(max(max_items * 2, max_items))
                .execute()
            )
        except Exception:
            return []

    return _merge_unique_memory_values(
        [],
        [str(row.get("question_text") or "") for row in rows],
        max_items=max_items,
        max_chars=240,
    )


def _find_matching_mains_evaluation_analysis(
    question_example_analysis: Optional[Dict[str, Any]],
    supabase: Client,
) -> Optional[Dict[str, Any]]:
    if not question_example_analysis:
        return None

    tag_level1 = str(question_example_analysis.get("tag_level1") or "").strip().lower() or None
    tag_level2 = str(question_example_analysis.get("tag_level2") or "").strip().lower() or None
    if not tag_level1 and not tag_level2:
        return None

    try:
        query = (
            supabase.table(EXAMPLE_ANALYSES_TABLE)
            .select("*")
            .eq("content_type", AISystemInstructionContentType.MAINS_EVALUATION.value)
            .eq("is_active", True)
            .order("updated_at", desc=True)
            .limit(20)
        )
        if tag_level1:
            query = query.eq("tag_level1", tag_level1)
        if tag_level2:
            query = query.eq("tag_level2", tag_level2)
        rows = _rows(query.execute())
    except Exception:
        rows = []

    if rows:
        return rows[0]
    if not tag_level1:
        return None

    try:
        rows = _rows(
            supabase.table(EXAMPLE_ANALYSES_TABLE)
            .select("*")
            .eq("content_type", AISystemInstructionContentType.MAINS_EVALUATION.value)
            .eq("is_active", True)
            .eq("tag_level1", tag_level1)
            .order("updated_at", desc=True)
            .limit(1)
            .execute()
        )
    except Exception:
        rows = []
    return rows[0] if rows else None


def _trim_prompt_block(text: str, max_chars: int = 6000) -> str:
    cleaned = str(text or "").strip()
    if len(cleaned) <= max_chars:
        return cleaned
    return cleaned[: max_chars - 20].rstrip() + "\n...[truncated]"


def _build_mains_evaluation_sync_guidance(
    evaluation_instructions: str,
    evaluation_style_guidance: Optional[str],
) -> str:
    lines: List[str] = [
        "Apply evaluator mindset while drafting answer_approach and model_answer.",
        "Goal: maximize alignment with strict evaluation criteria without reducing depth, originality, or structure quality.",
        "Cover all explicit demands of the question, including directive keyword requirements and missing-dimension checks.",
        "Use this only as internal drafting guidance; do not print checklist language in the final answer text.",
        "",
        "Baseline Evaluator Rubric:",
        _trim_prompt_block(evaluation_instructions),
    ]

    style_text = _trim_prompt_block(str(evaluation_style_guidance or ""))
    if style_text:
        lines.extend(["", "Evaluator Persona Guidance:", style_text])

    return "\n".join(lines).strip()


@router.post("/ai-evaluation/ocr", response_model=OCRResponse)
async def ai_evaluation_ocr(
    request: OCRRequest,
    user_ctx: Dict[str, Any] = Depends(require_generation_access),
    supabase: Client = Depends(get_supabase_client),
):
    try:
        text = await extract_text_from_images(request)
        return OCRResponse(extracted_text=text)
    except Exception as e:
        logger.error(f"OCR Error: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/ai-evaluation/evaluate-mains", response_model=MainsEvaluationResponse)
async def evaluate_mains_endpoint(
    request: MainsEvaluationRequest,
    supabase: Client = Depends(get_supabase_client),
    user_ctx: Dict[str, Any] = Depends(require_mains_generation_access),
):
    user_id = str(user_ctx.get("user_id") or "")
    if not user_id:
        raise HTTPException(status_code=401, detail="Authentication required.")

    if request.mains_question_id:
    # ... (existing logic truncated in prompt, keeping it same)
        db_q = _first(
            supabase.table("user_ai_mains_questions")
            .select("*")
            .eq("id", request.mains_question_id)
            .limit(1)
            .execute()
        )
        if db_q:
            request.question_text = db_q.get("question_text") or request.question_text
            request.model_answer = db_q.get("model_answer") or request.model_answer

    instructions = request.instructions
    if not instructions:
        instructions = _resolve_ai_instruction_text(
            supabase,
            content_type=AISystemInstructionContentType.MAINS_EVALUATION,
            fallback_text=_default_mains_evaluation_instructions(),
        )

    if request.example_evaluation_id:
        example_analysis = _first(
            supabase.table("premium_ai_example_analyses")
            .select("*")
            .eq("id", request.example_evaluation_id)
            .limit(1)
            .execute()
        )
        if example_analysis:
            guidance = example_analysis.get("style_profile", {}).get("style_instructions")
            if guidance:
                instructions = f"{instructions}\n\nEvaluation Style Instructions:\n{guidance}"
    if request.answer_formatting_guidance:
        answer_style_guidance = str(request.answer_formatting_guidance or "").strip()
        if answer_style_guidance:
            instructions = (
                f"{instructions}\n\n"
                "Answer Writing Style Rubric (MANDATORY for evaluation):\n"
                f"{answer_style_guidance}\n"
                "Use this as a rubric to evaluate structure, tone, and depth alignment. "
                "Do not generate a new model/improved answer."
            )
    instructions = _merge_instruction_parts(
        instructions,
        _language_instruction_block(request.output_language, scope="mains_evaluation"),
    ) or instructions
    instructions = (
        f"{instructions}\n\n"
        "Critical Policy:\n"
        "- Never generate a fresh model/improved answer during evaluation.\n"
        "- Use the model answer supplied in input as reference only.\n"
        "- In output, set improved_answer to that same supplied model answer (or null if absent)."
    )

    try:
        evaluation = await evaluate_mains_answer(request, instructions)
        evaluation["improved_answer"] = request.model_answer or None
        
        # Save evaluation if user is authenticated
        if user_id:
            try:
                supabase.table("user_mains_evaluations").insert({
                    "user_id": user_id,
                    "question_id": request.mains_question_id,
                    "question_text": request.question_text,
                    "answer_text": request.answer_text,
                    "score": evaluation.get("score"),
                    "max_score": evaluation.get("max_score", 10.0),
                    "feedback": evaluation.get("feedback"),
                    "strengths": evaluation.get("strengths", []),
                    "weaknesses": evaluation.get("weaknesses", []),
                    "improved_answer": evaluation.get("improved_answer")
                }).execute()
            except Exception as e:
                logger.error(f"Failed to save mains evaluation: {e}")

        return MainsEvaluationResponse(**evaluation)
    except Exception as e:
        logger.error(f"Evaluation Error: {e}")
        # Return a partially structured response if AI output was unusable but had some text
        if isinstance(e, ValueError):
             raise HTTPException(status_code=400, detail=str(e))
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/ai/style-profile")
async def analyze_style_persona(
    request: Dict[str, Any],
    supabase: Client = Depends(get_supabase_client),
):
    ctype = str(request.get("content_type", "mains_evaluation") or "mains_evaluation").strip()
    examples = request.get("example_questions", [])
    provider = request.get("ai_provider", "gemini")
    model = request.get("ai_model_name", "gemini-3-flash-preview")

    analysis_prompt_override = str(request.get("style_analysis_prompt") or "").strip() or None
    if not analysis_prompt_override:
        try:
            row = _first(
                supabase.table("premium_ai_quiz_instructions")
                .select("style_analysis_system_prompt")
                .eq("content_type", ctype)
                .order("updated_at", desc=True)
                .order("created_at", desc=True)
                .limit(1)
                .execute()
            )
            if row:
                analysis_prompt_override = str(row.get("style_analysis_system_prompt") or "").strip() or None
        except Exception as exc:
            if not _is_missing_table_error(exc, "premium_ai_quiz_instructions"):
                logger.warning("Failed to load default style analysis prompt for %s: %s", ctype, exc)
    try:
        return await analyze_style_profile(ctype, examples, provider, model, system_prompt_override=analysis_prompt_override)
    except Exception as e:
        logger.error(f"Style Analysis Error: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/ai/style-profile/refine")
async def refine_style_persona(
    request: Dict[str, Any],
    supabase: Client = Depends(get_supabase_client),
):
    profile = request.get("style_profile", {})
    feedback = request.get("feedback", "")
    provider = request.get("ai_provider", "gemini")
    model = request.get("ai_model_name", "gemini-3-flash-preview")

    try:
        return await refine_style_profile(profile, feedback, provider, model)
    except Exception as e:
        logger.error(f"Style Refinement Error: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/ai/example-analyses", response_model=PremiumAIExampleAnalysisListResponse)
def list_example_analyses(
    limit: int = 20,
    offset: int = 0,
    content_type: Optional[AISystemInstructionContentType] = None,
    is_active: Optional[bool] = None,
    supabase: Client = Depends(get_supabase_client),
):
    query = supabase.table(EXAMPLE_ANALYSES_TABLE).select("*", count="exact")
    if content_type:
        query = query.eq("content_type", content_type.value)
    if is_active is not None:
        query = query.eq("is_active", is_active)
    
    query = query.order("created_at", desc=True).range(offset, offset + limit - 1)
    
    try:
        result = query.execute()
        items = [PremiumAIExampleAnalysis(**_example_analysis_view(row)) for row in (result.data or [])]
        return PremiumAIExampleAnalysisListResponse(items=items, total=result.count or 0)
    except Exception as e:
        if _is_missing_table_error(e, EXAMPLE_ANALYSES_TABLE):
            _raise_example_analyses_migration_required(e)
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/ai/example-analyses", response_model=PremiumAIExampleAnalysis)
def create_example_analysis(
    payload: PremiumAIExampleAnalysisCreate,
    supabase: Client = Depends(get_supabase_client),
    user_id: Optional[str] = Depends(get_user_id),
):
    normalized_l1, normalized_l2 = _validate_tag_hierarchy(payload.tag_level1, payload.tag_level2)
    data = payload.model_dump()
    data["content_type"] = payload.content_type.value
    data["tag_level1"] = normalized_l1
    data["tag_level2"] = normalized_l2
    data["tags"] = [str(tag).strip().lower() for tag in payload.tags if str(tag).strip()]
    data["exam_ids"] = _normalize_exam_ids(payload.exam_ids)
    if data["exam_ids"]:
        _load_exam_rows_by_ids(data["exam_ids"], supabase)
    if user_id:
        data["author_id"] = user_id

    try:
        row = _first(supabase.table(EXAMPLE_ANALYSES_TABLE).insert(data).execute())
        if not row:
            raise HTTPException(status_code=400, detail="Failed to create analysis")
        return PremiumAIExampleAnalysis(**_example_analysis_view(row))
    except Exception as e:
        if _is_missing_table_error(e, EXAMPLE_ANALYSES_TABLE):
            _raise_example_analyses_migration_required(e)
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/ai/example-analyses/{analysis_id}", response_model=PremiumAIExampleAnalysis)
def get_example_analysis(
    analysis_id: int,
    supabase: Client = Depends(get_supabase_client),
):
    try:
        row = _first(supabase.table(EXAMPLE_ANALYSES_TABLE).select("*").eq("id", analysis_id).limit(1).execute())
        if not row:
            raise HTTPException(status_code=404, detail="Analysis not found")
        return PremiumAIExampleAnalysis(**_example_analysis_view(row))
    except Exception as e:
        if _is_missing_table_error(e, EXAMPLE_ANALYSES_TABLE):
             _raise_example_analyses_migration_required(e)
        raise HTTPException(status_code=500, detail=str(e))


@router.put("/ai/example-analyses/{analysis_id}", response_model=PremiumAIExampleAnalysis)
def update_example_analysis(
    analysis_id: int,
    payload: PremiumAIExampleAnalysisUpdate,
    supabase: Client = Depends(get_supabase_client),
):
    updates = payload.model_dump(exclude_unset=True)
    if not updates:
        raise HTTPException(status_code=400, detail="No updates provided")

    current = _first(supabase.table(EXAMPLE_ANALYSES_TABLE).select("*").eq("id", analysis_id).limit(1).execute())
    if not current:
        raise HTTPException(status_code=404, detail="Analysis not found")

    next_l1 = updates.get("tag_level1", current.get("tag_level1"))
    next_l2 = updates.get("tag_level2", current.get("tag_level2"))
    normalized_l1, normalized_l2 = _validate_tag_hierarchy(next_l1, next_l2)
    if "tag_level1" in updates:
        updates["tag_level1"] = normalized_l1
    if "tag_level2" in updates:
        updates["tag_level2"] = normalized_l2
    if "tags" in updates:
        updates["tags"] = [str(tag).strip().lower() for tag in updates["tags"] if str(tag).strip()]
    if "exam_ids" in updates:
        updates["exam_ids"] = _normalize_exam_ids(updates.get("exam_ids"))
        if updates["exam_ids"]:
            _load_exam_rows_by_ids(updates["exam_ids"], supabase)
        
    try:
        row = _first(supabase.table(EXAMPLE_ANALYSES_TABLE).update(updates).eq("id", analysis_id).execute())
        if not row:
             raise HTTPException(status_code=404, detail="Analysis not found or update failed")
        return PremiumAIExampleAnalysis(**_example_analysis_view(row))
    except Exception as e:
        if _is_missing_table_error(e, EXAMPLE_ANALYSES_TABLE):
             _raise_example_analyses_migration_required(e)
        raise HTTPException(status_code=500, detail=str(e))


@router.delete("/ai/example-analyses/{analysis_id}")
def delete_example_analysis(
    analysis_id: int,
    supabase: Client = Depends(get_supabase_client),
):
    try:
        supabase.table(EXAMPLE_ANALYSES_TABLE).delete().eq("id", analysis_id).execute()
        return {"ok": True}
    except Exception as e:
        if _is_missing_table_error(e, EXAMPLE_ANALYSES_TABLE):
             _raise_example_analyses_migration_required(e)
        raise HTTPException(status_code=500, detail=str(e))

def _normalize_word_limit(value: Any, fallback: int = 150) -> int:
    try:
        parsed = int(value)
        if parsed > 0:
            return parsed
    except (TypeError, ValueError):
        pass
    return max(1, int(fallback))


def _normalize_optional_text(value: Any) -> Optional[str]:
    text = str(value or "").strip()
    return text or None


def _mains_question_row_payload(
    raw_question: Dict[str, Any],
    *,
    default_word_limit: int,
    source_reference: Optional[str],
    author_id: Optional[str],
    category_ids: Optional[List[int]] = None,
) -> Dict[str, Any]:
    question_text = str(raw_question.get("question_text") or "").strip()
    normalized_category_ids = _normalize_exam_ids(
        category_ids or _extract_mains_category_ids_from_content_data(raw_question)
    )
    return {
        "question_text": question_text,
        "answer_approach": _normalize_optional_text(raw_question.get("answer_approach")),
        "model_answer": _normalize_optional_text(raw_question.get("model_answer")),
        "word_limit": _normalize_word_limit(raw_question.get("word_limit"), fallback=default_word_limit),
        "source_reference": source_reference or _normalize_optional_text(raw_question.get("source_reference")),
        "mains_category_ids": normalized_category_ids,
        "mains_category_id": normalized_category_ids[0] if normalized_category_ids else None,
        "category_ids": normalized_category_ids,
        "description": question_text or None,
        "author_id": author_id,
    }


async def _generate_mains_questions_core(
    request: MainsAIGenerateRequest,
    *,
    user_ctx: Dict[str, Any],
    supabase: Client,
    persist_generated: bool,
) -> MainsAIGenerateResponse:
    user_id = str(user_ctx.get("user_id") or "").strip()
    if not user_id:
        raise HTTPException(status_code=401, detail="Authentication required.")

    working_request = request.model_copy(deep=True)
    source_reference = _normalize_optional_text(working_request.url)

    if working_request.use_mains_category_source:
        resolved_mains_content, _source_meta = _resolve_mains_category_source_content(
            mains_category_ids=working_request.mains_category_ids or [],
            supabase=supabase,
        )
        working_request.content = resolved_mains_content
        working_request.url = None
        working_request.uploaded_pdf_id = None
    elif not str(working_request.content or "").strip():
        preview_like_request = AIGenerateQuizRequest(
            content=working_request.content,
            uploaded_pdf_id=working_request.uploaded_pdf_id,
            url=working_request.url,
            content_type=AISystemInstructionContentType.PREMIUM_GK_QUIZ,
            use_category_source=False,
            output_language=working_request.output_language,
        )
        resolved_input_content = _resolve_preview_content(
            preview_like_request,
            supabase=supabase,
            requester_user_id=user_id,
            requester_is_admin=bool(user_ctx.get("is_admin")),
        )
        working_request.content = resolved_input_content
        working_request.url = None
        working_request.uploaded_pdf_id = None

    system_instructions = _resolve_ai_instruction_text(
        supabase,
        content_type=AISystemInstructionContentType.MAINS_QUESTION_GENERATION,
        fallback_text=_default_mains_question_generation_instructions(),
    )
    system_instructions = _merge_instruction_parts(
        system_instructions,
        _mains_category_structure_instruction_block(
            supabase,
            requested_mains_category_ids=working_request.mains_category_ids,
        ) or None,
    ) or system_instructions

    if working_request.user_instructions:
        system_instructions += f"\n\nUser Instructions: {working_request.user_instructions}"
    system_instructions = _merge_instruction_parts(
        system_instructions,
        _language_instruction_block(working_request.output_language, scope="mains_generation"),
    ) or system_instructions

    user_reference_questions = _load_user_mains_reference_questions(
        user_id=user_id,
        supabase=supabase,
    )
    working_request.recent_questions = _merge_unique_memory_values(
        user_reference_questions,
        _as_string_list(working_request.recent_questions),
        max_items=USER_AI_HINTS_MAX_RECENT_QUESTIONS,
        max_chars=240,
    )

    question_example_analysis: Optional[Dict[str, Any]] = None
    if working_request.example_format_id:
        question_example_analysis = _first(
            supabase.table(EXAMPLE_ANALYSES_TABLE)
            .select("*")
            .eq("id", working_request.example_format_id)
            .eq("content_type", AISystemInstructionContentType.MAINS_QUESTION_GENERATION.value)
            .limit(1)
            .execute()
        )
        question_style_guidance, answer_style_guidance = _extract_mains_question_generation_guidance(
            question_example_analysis
        )
        if question_style_guidance:
            working_request.example_formatting_guidance = question_style_guidance
        example_snippets = _extract_mains_example_questions_for_guidance(question_example_analysis)
        if example_snippets:
            format_examples_block = (
                "Reference Example Formats (template only; do NOT copy facts or wording):\n- "
                + "\n- ".join(example_snippets)
            )
            if working_request.example_formatting_guidance:
                working_request.example_formatting_guidance = (
                    f"{working_request.example_formatting_guidance}\n\n{format_examples_block}"
                )
            else:
                working_request.example_formatting_guidance = format_examples_block
        if answer_style_guidance:
            working_request.answer_formatting_guidance = answer_style_guidance

    selected_evaluation_analysis: Optional[Dict[str, Any]] = None
    if working_request.evaluation_example_id:
        selected_evaluation_analysis = _first(
            supabase.table(EXAMPLE_ANALYSES_TABLE)
            .select("*")
            .eq("id", working_request.evaluation_example_id)
            .eq("content_type", AISystemInstructionContentType.MAINS_EVALUATION.value)
            .limit(1)
            .execute()
        )
    if working_request.sync_with_evaluator and not selected_evaluation_analysis:
        selected_evaluation_analysis = _find_matching_mains_evaluation_analysis(
            question_example_analysis,
            supabase,
        )

    evaluation_sync_guidance: Optional[str] = None
    if working_request.sync_with_evaluator:
        evaluation_instructions = _resolve_ai_instruction_text(
            supabase,
            content_type=AISystemInstructionContentType.MAINS_EVALUATION,
            fallback_text=_default_mains_evaluation_instructions(),
        )
        evaluation_sync_guidance = _build_mains_evaluation_sync_guidance(
            evaluation_instructions=evaluation_instructions,
            evaluation_style_guidance=_extract_style_instructions_from_analysis(selected_evaluation_analysis),
        )

    questions_data = await generate_mains_questions(
        working_request,
        system_instructions,
        evaluation_sync_guidance=evaluation_sync_guidance,
    )

    requested_mains_category_ids = _normalize_exam_ids(working_request.mains_category_ids or [])
    source_inferred_mains_category_ids = requested_mains_category_ids
    if not source_inferred_mains_category_ids:
        source_inferred_mains_category_ids = _infer_mains_category_ids_for_text(
            str(working_request.content or "").strip(),
            supabase,
        )

    created_questions: List[UserAIMainsQuestion] = []
    for raw_question in questions_data:
        if not isinstance(raw_question, dict):
            continue
        resolved_category_ids = requested_mains_category_ids or _extract_mains_category_ids_from_content_data(raw_question)
        if not resolved_category_ids:
            resolved_category_ids = _infer_mains_category_ids_for_text(
                _mains_question_match_text(raw_question),
                supabase,
                fallback_category_ids=source_inferred_mains_category_ids,
            )
        question_row = _mains_question_row_payload(
            raw_question,
            default_word_limit=working_request.word_limit,
            source_reference=source_reference,
            author_id=user_id if persist_generated else None,
            category_ids=resolved_category_ids,
        )
        if not question_row["question_text"]:
            continue
        if persist_generated:
            try:
                row = _first(supabase.table("user_ai_mains_questions").insert(question_row).execute())
                if row:
                    created_questions.append(UserAIMainsQuestion(**row))
                    continue
            except Exception as exc:
                if any(
                    _is_missing_column_error(exc, "user_ai_mains_questions", column_name)
                    for column_name in ("mains_category_ids", "mains_category_id", "category_ids", "description")
                ):
                    legacy_row = {
                        key: question_row[key]
                        for key in ("question_text", "answer_approach", "model_answer", "word_limit", "source_reference", "author_id")
                    }
                    try:
                        row = _first(supabase.table("user_ai_mains_questions").insert(legacy_row).execute())
                        if row:
                            row.update({
                                "mains_category_ids": question_row.get("mains_category_ids") or [],
                                "mains_category_id": question_row.get("mains_category_id"),
                                "category_ids": question_row.get("category_ids") or [],
                                "description": question_row.get("description"),
                            })
                            created_questions.append(UserAIMainsQuestion(**row))
                            continue
                    except Exception:
                        pass
        created_questions.append(UserAIMainsQuestion(**question_row))

    return MainsAIGenerateResponse(questions=created_questions)


@router.post("/ai-mains-questions/generate", response_model=MainsAIGenerateResponse)
async def generate_mains_questions_endpoint(
    request: MainsAIGenerateRequest,
    user_ctx: Dict[str, Any] = Depends(require_mains_generation_access),
    supabase: Client = Depends(get_supabase_client),
):
    return await _generate_mains_questions_core(
        request,
        user_ctx=user_ctx,
        supabase=supabase,
        persist_generated=True,
    )


@router.post("/mains/questions/parse", response_model=MainsAIGenerateResponse)
async def parse_mains_questions_endpoint(
    request: MainsAIGenerateRequest,
    user_ctx: Dict[str, Any] = Depends(require_mains_generation_access),
    supabase: Client = Depends(get_supabase_client),
):
    return await _generate_mains_questions_core(
        request,
        user_ctx=user_ctx,
        supabase=supabase,
        persist_generated=False,
    )


@router.get("/ai-mains-questions/user", response_model=List[UserAIMainsQuestion])
async def list_user_mains_questions(
    user_ctx: Dict[str, Any] = Depends(require_mains_generation_access),
    supabase: Client = Depends(get_supabase_client),
):
    user_id = str(user_ctx.get("user_id") or "")
    if not user_id:
        raise HTTPException(status_code=401, detail="Authentication required.")
    try:
        rows = _rows(
            supabase.table("user_ai_mains_questions")
            .select("*")
            .eq("author_id", user_id)
            .order("created_at", desc=True)
            .execute()
        )
    except Exception:
        # Backward compatibility if historical rows were written with user_id.
        try:
            rows = _rows(
                supabase.table("user_ai_mains_questions")
                .select("*")
                .eq("user_id", user_id)
                .order("created_at", desc=True)
                .execute()
            )
        except Exception:
            rows = []
    return [UserAIMainsQuestion(**row) for row in rows]


# User Progress Tracking Endpoints

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


def _dashboard_text(value: Any, *, max_chars: int = 110) -> str:
    cleaned = _plain_text_for_hint(value)
    if not cleaned:
        return ""
    if len(cleaned) <= max_chars:
        return cleaned
    return f"{cleaned[: max_chars - 3].rstrip()}..."


def _date_key_from_iso(value: Any) -> str:
    parsed = _parse_datetime(value)
    if parsed is None:
        parsed = _utc_now()
    return parsed.date().isoformat()


def _format_day_label(date_key: str) -> str:
    try:
        parsed = datetime.fromisoformat(f"{date_key}T00:00:00+00:00")
    except ValueError:
        return date_key
    return parsed.strftime("%d %b")


def _build_quiz_trend_points(
    daily_stats: Dict[str, Dict[str, int]],
    *,
    days: int,
) -> List[Dict[str, Any]]:
    today = _utc_now().date()
    output: List[Dict[str, Any]] = []
    for offset in range(days - 1, -1, -1):
        point_date = today - timedelta(days=offset)
        key = point_date.isoformat()
        bucket = daily_stats.get(key) or {}
        question_count = max(0, _safe_int(bucket.get("question_count")))
        correct_count = max(0, _safe_int(bucket.get("correct_count")))
        activity_count = max(0, _safe_int(bucket.get("activity_count")))
        accuracy = round((float(correct_count) / float(question_count)) * 100.0, 2) if question_count else 0.0
        output.append(
            {
                "date": key,
                "label": _format_day_label(key),
                "value": accuracy,
                "activity_count": activity_count,
                "question_count": question_count,
            }
        )
    return output


def _build_mains_trend_points(
    daily_stats: Dict[str, Dict[str, float]],
    *,
    days: int,
) -> List[Dict[str, Any]]:
    today = _utc_now().date()
    output: List[Dict[str, Any]] = []
    for offset in range(days - 1, -1, -1):
        point_date = today - timedelta(days=offset)
        key = point_date.isoformat()
        bucket = daily_stats.get(key) or {}
        activity_count = max(0, _safe_int(bucket.get("activity_count")))
        total_score = max(0.0, _safe_float(bucket.get("total_score")))
        max_total_score = max(0.0, _safe_float(bucket.get("max_total_score")))
        average_score = round((total_score / float(activity_count)), 2) if activity_count > 0 else 0.0
        score_percent = round((total_score / max_total_score) * 100.0, 2) if max_total_score > 0 else 0.0
        output.append(
            {
                "date": key,
                "label": _format_day_label(key),
                "value": average_score,
                "activity_count": activity_count,
                "score_percent": score_percent,
            }
        )
    return output


def _performance_band(
    score: float,
    sample_size: int,
    *,
    low_threshold: float = 50.0,
    high_threshold: float = 75.0,
    min_sample_size: int = 3,
) -> str:
    if sample_size < min_sample_size:
        return "average"
    if score >= high_threshold:
        return "best"
    if score < low_threshold:
        return "bad"
    return "average"


def _build_dashboard_recommendation_plugs(sections: Dict[str, Dict[str, Any]]) -> List[Dict[str, Any]]:
    plugs: List[Dict[str, Any]] = []
    for quiz_type in ("gk", "maths", "passage"):
        section = sections.get(quiz_type) or {}
        weak_areas = section.get("weak_areas") if isinstance(section.get("weak_areas"), list) else []
        if weak_areas:
            first = weak_areas[0] if isinstance(weak_areas[0], dict) else {}
            weak_area_id = _safe_int(first.get("id"), 0)
            weak_area_name = str(first.get("name") or "").strip()
            if weak_area_name:
                plugs.append(
                    {
                        "plug_key": f"{quiz_type}-practice-weak-area",
                        "plug_type": "practice_weak_area",
                        "section": quiz_type,
                        "title": f"Practice: {weak_area_name}",
                        "description": f"Focused drill recommended for {section.get('label') or quiz_type.upper()}.",
                        "priority": "high",
                        "payload": {
                            "content_type": quiz_type,
                            "weak_area_id": weak_area_id if weak_area_id > 0 else None,
                            "weak_area_name": weak_area_name,
                        },
                    }
                )

    mains_section = sections.get("mains") or {}
    mains_weak_areas = mains_section.get("weak_areas") if isinstance(mains_section.get("weak_areas"), list) else []
    if mains_weak_areas:
        first_issue = mains_weak_areas[0] if isinstance(mains_weak_areas[0], dict) else {}
        issue_name = str(first_issue.get("name") or "").strip()
        if issue_name:
            plugs.append(
                {
                    "plug_key": "mains-mentorship-support",
                    "plug_type": "mentorship_support",
                    "section": "mains",
                    "title": "Mentorship Support: Mains Improvement",
                    "description": "Use mentorship/courses plug to work on recurring mains answer issues.",
                    "priority": "high",
                    "payload": {
                        "content_type": "mains",
                        "focus_issue": issue_name,
                    },
                }
            )

    quiz_accuracies = [
        _safe_float((sections.get(quiz_type) or {}).get("accuracy"), 0.0)
        for quiz_type in ("gk", "maths", "passage")
        if _safe_int((sections.get(quiz_type) or {}).get("question_count")) > 0
    ]
    if quiz_accuracies and min(quiz_accuracies) < 70:
        plugs.append(
            {
                "plug_key": "course-foundation-revision",
                "plug_type": "course_enrollment",
                "section": "global",
                "title": "Enroll in Foundation Revision",
                "description": "Recommended if quiz accuracy is not stable across sections.",
                "priority": "medium",
                "payload": {
                    "content_type": "quiz",
                    "target_accuracy": 70,
                },
            }
        )

    return plugs[:8]


def _build_dashboard_purchase_overview(
    *,
    user_id: str,
    supabase: Client,
) -> Dict[str, Any]:
    overview: Dict[str, Any] = {
        "total_enrollments": 0,
        "active_enrollments": 0,
        "active_prelims_enrollments": 0,
        "active_mains_enrollments": 0,
        "active_hybrid_enrollments": 0,
        "active_series": [],
    }

    enrollments = _safe_rows(
        supabase.table("test_series_enrollments")
        .select("id,series_id,status,access_source,subscribed_until,created_at,updated_at")
        .eq("user_id", user_id)
        .order("created_at", desc=True)
        .limit(300)
    )
    if not enrollments:
        return overview

    overview["total_enrollments"] = len(enrollments)

    series_ids = sorted(
        {
            _safe_int(row.get("series_id"))
            for row in enrollments
            if _safe_int(row.get("series_id")) > 0
        }
    )
    series_rows: List[Dict[str, Any]] = []
    if series_ids:
        series_rows = _safe_rows(
            supabase.table("test_series")
            .select("id,title,series_kind,access_type,provider_user_id,is_active,is_public,price")
            .in_("id", series_ids)
        )

    series_map: Dict[int, Dict[str, Any]] = {}
    provider_user_ids: Set[str] = set()
    for row in series_rows:
        series_id = _safe_int(row.get("id"), -1)
        if series_id <= 0:
            continue
        series_map[series_id] = row
        provider_user_id = str(row.get("provider_user_id") or "").strip()
        if provider_user_id:
            provider_user_ids.add(provider_user_id)

    provider_name_map: Dict[str, str] = {}
    if provider_user_ids:
        profile_rows = _safe_rows(
            supabase.table(PROFILES_TABLE)
            .select("user_id,display_name")
            .in_("user_id", sorted(provider_user_ids))
        )
        for profile_row in profile_rows:
            profile_user_id = str(profile_row.get("user_id") or "").strip()
            display_name = str(profile_row.get("display_name") or "").strip()
            if profile_user_id and display_name and profile_user_id not in provider_name_map:
                provider_name_map[profile_user_id] = display_name

    active_series_by_id: Dict[int, Dict[str, Any]] = {}
    active_prelims = 0
    active_mains = 0
    active_hybrid = 0

    for enrollment in enrollments:
        status = _as_role(enrollment.get("status")) or "active"
        if status != "active":
            continue
        series_id = _safe_int(enrollment.get("series_id"))
        if series_id <= 0 or series_id in active_series_by_id:
            continue

        series_row = series_map.get(series_id) or {}
        series_kind = _as_role(series_row.get("series_kind")) or "quiz"
        access_type = _as_role(series_row.get("access_type")) or "subscription"
        provider_user_id = str(series_row.get("provider_user_id") or "").strip()

        if series_kind == "mains":
            active_mains += 1
        elif series_kind == "hybrid":
            active_hybrid += 1
        else:
            active_prelims += 1

        active_series_by_id[series_id] = {
            "enrollment_id": _safe_int(enrollment.get("id")),
            "series_id": series_id,
            "title": str(series_row.get("title") or f"Series {series_id}"),
            "series_kind": series_kind,
            "access_type": access_type,
            "price": round(_safe_float(series_row.get("price")), 2),
            "provider_user_id": provider_user_id or None,
            "provider_display_name": provider_name_map.get(provider_user_id) if provider_user_id else None,
            "status": status,
            "access_source": _as_role(enrollment.get("access_source")) or "manual",
            "subscribed_until": str(enrollment.get("subscribed_until")) if enrollment.get("subscribed_until") else None,
            "series_is_active": bool(series_row.get("is_active")) if series_row else None,
            "series_is_public": bool(series_row.get("is_public")) if series_row else None,
            "created_at": str(enrollment.get("created_at") or ""),
            "updated_at": str(enrollment.get("updated_at")) if enrollment.get("updated_at") else None,
        }

    overview["active_enrollments"] = len(active_series_by_id)
    overview["active_prelims_enrollments"] = active_prelims
    overview["active_mains_enrollments"] = active_mains
    overview["active_hybrid_enrollments"] = active_hybrid
    overview["active_series"] = list(active_series_by_id.values())[:24]
    return overview


def _build_quiz_section_recommendations(section: Dict[str, Any]) -> List[str]:
    recommendations: List[str] = []
    activity_count = _safe_int(section.get("activity_count"))
    question_count = _safe_int(section.get("question_count"))
    accuracy = _safe_float(section.get("accuracy"))
    unanswered = _safe_int(section.get("unanswered_count"))

    if activity_count == 0 or question_count == 0:
        return ["Attempt at least 2 timed tests in this section to build a reliable baseline."]

    if accuracy < 55:
        recommendations.append("Revise fundamentals first, then solve a short focused drill before full tests.")
    elif accuracy < 70:
        recommendations.append("Use targeted mixed practice to move accuracy above 70%.")
    else:
        recommendations.append("Maintain current momentum with spaced revision and periodic mixed mocks.")

    unanswered_ratio = (float(unanswered) / float(question_count)) if question_count else 0.0
    if unanswered_ratio >= 0.2:
        recommendations.append("High unanswered ratio detected; use stricter time checkpoints per question.")

    weak_areas = section.get("weak_areas") or []
    if weak_areas:
        names = [str(item.get("name") or "").strip() for item in weak_areas[:2] if isinstance(item, dict)]
        names = [name for name in names if name]
        if names:
            recommendations.append(f"Prioritize {', '.join(names)} in your next revision block.")

    recurring = section.get("recurring_errors") or []
    if recurring:
        recommendations.append("Create an error log from repeated mistakes and review it before every test.")

    return recommendations[:4]


def _build_mains_section_recommendations(section: Dict[str, Any]) -> List[str]:
    recommendations: List[str] = []
    activity_count = _safe_int(section.get("activity_count"))
    question_count = _safe_int(section.get("question_count"))
    average_score = _safe_float(section.get("average_score"))

    if activity_count == 0 or question_count == 0:
        return ["Submit at least 3 mains answers to activate meaningful answer-writing analytics."]

    if average_score < 4.5:
        recommendations.append("Rebuild answer structure: intro, 3-4 analytical body points, and crisp conclusion.")
    elif average_score < 6.0:
        recommendations.append("Increase depth with better examples, data points, and stronger interlinkages.")
    else:
        recommendations.append("Sustain quality by practicing varied directives and maintaining balanced arguments.")

    weak_areas = section.get("weak_areas") or []
    if weak_areas:
        labels = [str(item.get("name") or "").strip() for item in weak_areas[:2] if isinstance(item, dict)]
        labels = [label for label in labels if label]
        if labels:
            recommendations.append(f"Address recurring mains issues: {', '.join(labels)}.")

    recurring = section.get("recurring_errors") or []
    if recurring:
        recommendations.append("Use a fixed self-review checklist before submission to reduce repeated errors.")

    return recommendations[:4]


def _performance_metric_stats_template(*, is_quiz: bool) -> Dict[str, Any]:
    if is_quiz:
        return {
            "question_count": 0,
            "correct_count": 0,
            "incorrect_count": 0,
            "unanswered_count": 0,
        }
    return {
        "question_count": 0,
        "total_score": 0.0,
        "max_total_score": 0.0,
    }


def _accumulate_quiz_performance_stats(stats: Dict[str, Any], outcome: str) -> None:
    stats["question_count"] = _safe_int(stats.get("question_count")) + 1
    if outcome == "correct":
        stats["correct_count"] = _safe_int(stats.get("correct_count")) + 1
        return
    if outcome == "incorrect":
        stats["incorrect_count"] = _safe_int(stats.get("incorrect_count")) + 1
        return
    stats["unanswered_count"] = _safe_int(stats.get("unanswered_count")) + 1


def _accumulate_mains_performance_stats(stats: Dict[str, Any], *, score: float, max_score: float) -> None:
    stats["question_count"] = _safe_int(stats.get("question_count")) + 1
    stats["total_score"] = _safe_float(stats.get("total_score")) + max(0.0, score)
    stats["max_total_score"] = _safe_float(stats.get("max_total_score")) + max(0.0, max_score)


def _build_quiz_performance_summary(stats: Dict[str, Any]) -> Dict[str, Any]:
    total_questions = max(0, _safe_int(stats.get("question_count")))
    correct_count = max(0, _safe_int(stats.get("correct_count")))
    incorrect_count = max(0, _safe_int(stats.get("incorrect_count")))
    unanswered_count = max(0, _safe_int(stats.get("unanswered_count")))
    attempted_questions = correct_count + incorrect_count
    percentage = round((float(correct_count) / float(total_questions)) * 100.0, 2) if total_questions else 0.0
    return {
        "total_questions": total_questions,
        "attempted_questions": attempted_questions,
        "correct_count": correct_count,
        "incorrect_count": incorrect_count,
        "unanswered_count": unanswered_count,
        "percentage": percentage,
    }


def _build_mains_performance_summary(stats: Dict[str, Any]) -> Dict[str, Any]:
    total_questions = max(0, _safe_int(stats.get("question_count")))
    total_score = round(max(0.0, _safe_float(stats.get("total_score"))), 2)
    max_total_score = round(max(0.0, _safe_float(stats.get("max_total_score"))), 2)
    percentage = round((total_score / max_total_score) * 100.0, 2) if max_total_score > 0 else 0.0
    return {
        "total_questions": total_questions,
        "total_score": total_score,
        "max_total_score": max_total_score,
        "percentage": percentage,
    }


def _performance_proficiency_label(percentage: float) -> str:
    if percentage >= 85.0:
        return "Advanced"
    if percentage >= 70.0:
        return "Stable"
    if percentage >= 55.0:
        return "Developing"
    return "Needs Focus"


def _fetch_category_hierarchy_nodes(
    *,
    table_name: str,
    supabase: Client,
) -> Dict[int, Dict[str, Any]]:
    rows = _safe_rows(
        supabase.table(table_name)
        .select("id, name, parent_id")
        .eq("is_active", True)
        .order("name")
        .limit(4000)
    )
    nodes: Dict[int, Dict[str, Any]] = {}
    for row in rows:
        category_id = _safe_int(row.get("id"), -1)
        if category_id <= 0:
            continue
        parent_raw = row.get("parent_id")
        try:
            parent_id = int(parent_raw) if parent_raw is not None else None
        except (TypeError, ValueError):
            parent_id = None
        nodes[category_id] = {
            "id": category_id,
            "name": str(row.get("name") or f"Category {category_id}"),
            "parent_id": parent_id,
        }
    return nodes


def _resolve_category_root_and_second(
    category_id: int,
    *,
    nodes: Dict[int, Dict[str, Any]],
) -> Tuple[int, int]:
    if category_id <= 0 or category_id not in nodes:
        return 0, 0

    path: List[int] = []
    visited: Set[int] = set()
    current = category_id
    while current > 0 and current not in visited and current in nodes:
        visited.add(current)
        path.append(current)
        parent_id = nodes[current].get("parent_id")
        if parent_id is None or parent_id not in nodes:
            break
        current = int(parent_id)

    if not path:
        return 0, 0

    root_id = path[-1]
    second_level_id = path[-2] if len(path) >= 2 else root_id
    return root_id, second_level_id


def _resolve_category_hierarchy_pairs(
    category_ids: List[int],
    *,
    nodes: Dict[int, Dict[str, Any]],
) -> List[Tuple[int, int]]:
    resolved_pairs: List[Tuple[int, int]] = []
    seen: Set[Tuple[int, int]] = set()
    for category_id in _normalize_exam_ids(category_ids):
        root_id, second_level_id = _resolve_category_root_and_second(category_id, nodes=nodes)
        pair = (root_id, second_level_id)
        if pair in seen:
            continue
        seen.add(pair)
        resolved_pairs.append(pair)
    return resolved_pairs or [(0, 0)]


def _mains_question_text_from_content_data(data: Dict[str, Any]) -> str:
    return str(
        data.get("question_text")
        or data.get("question_statement")
        or data.get("question")
        or ""
    ).strip()


def _collection_performance_source_kind(collection_row: Optional[Dict[str, Any]]) -> str:
    if not isinstance(collection_row, dict):
        return "ai"
    return "program" if (_resolve_series_id_from_collection_row(collection_row) or 0) > 0 else "ai"


def _build_performance_category_analysis(
    *,
    category_name: str,
    content_label: str,
    source_kind: str,
    is_quiz: bool,
    subcategories: List[Dict[str, Any]],
) -> Dict[str, Any]:
    sorted_rows = sorted(
        subcategories,
        key=lambda row: (-_safe_float(row.get("percentage")), -_safe_int(row.get("total_questions")), str(row.get("name") or "").lower()),
    )
    if not sorted_rows:
        return {
            "title": f"{category_name} AI Analysis",
            "summary": f"No sub-category performance has been recorded for {category_name} yet.",
            "points": [
                f"Attempt more {content_label.lower()} items inside {category_name} to activate analysis.",
            ],
        }

    strongest = sorted_rows[0]
    weakest = min(
        sorted_rows,
        key=lambda row: (_safe_float(row.get("percentage")), -_safe_int(row.get("total_questions")), str(row.get("name") or "").lower()),
    )
    source_label = "AI-based" if source_kind == "ai" else "program-based"

    if is_quiz:
        summary = (
            f"{source_label.capitalize()} {content_label} performance in {category_name} is strongest in "
            f"{strongest.get('name')} at {_safe_float(strongest.get('percentage')):.1f}%, while "
            f"{weakest.get('name')} is currently the biggest marks-leak zone."
        )
        points = [
            f"Best conversion is in {strongest.get('name')} with {max(0, _safe_int(strongest.get('correct_count')))} correct answers.",
            f"Rework {weakest.get('name')}: incorrect {max(0, _safe_int(weakest.get('incorrect_count')))}, unanswered {max(0, _safe_int(weakest.get('unanswered_count')))}.",
        ]
    else:
        summary = (
            f"{source_label.capitalize()} mains performance in {category_name} shows the best marks conversion in "
            f"{strongest.get('name')} at {_safe_float(strongest.get('percentage')):.1f}%, while "
            f"{weakest.get('name')} needs the most correction work."
        )
        points = [
            f"Highest return is {strongest.get('name')} with {_safe_float(strongest.get('total_score')):.1f}/{_safe_float(strongest.get('max_total_score')):.1f}.",
            f"Priority repair area is {weakest.get('name')} where the current score is {_safe_float(weakest.get('total_score')):.1f}/{_safe_float(weakest.get('max_total_score')):.1f}.",
        ]

    if strongest.get("name") != weakest.get("name"):
        points.append(
            f"Bridge the gap by borrowing the answer pattern from {strongest.get('name')} and applying it to {weakest.get('name')} next."
        )
    return {
        "title": f"{category_name} AI Analysis",
        "summary": summary,
        "points": points[:3],
    }


def _build_user_performance_audit_bundle(
    *,
    user_id: str,
    supabase: Client,
    limit: int,
) -> Dict[str, Any]:
    attempts = _safe_rows(
        supabase.table("user_quiz_attempts")
        .select("id, collection_id, details, created_at")
        .eq("user_id", user_id)
        .order("created_at", desc=True)
        .limit(limit)
    )
    evaluations = _safe_rows(
        supabase.table("user_mains_evaluations")
        .select("id, question_id, question_text, score, max_score, created_at")
        .eq("user_id", user_id)
        .order("created_at", desc=True)
        .limit(limit)
    )

    quiz_nodes = _fetch_category_hierarchy_nodes(table_name="categories", supabase=supabase)
    mains_nodes = _fetch_category_hierarchy_nodes(table_name=MAINS_CATEGORIES_TABLE, supabase=supabase)
    quiz_name_map = {0: "Uncategorized", **{category_id: str(node.get("name") or f"Category {category_id}") for category_id, node in quiz_nodes.items()}}
    mains_name_map = {0: "Uncategorized", **{category_id: str(node.get("name") or f"Mains Category {category_id}") for category_id, node in mains_nodes.items()}}

    collection_ids = sorted({
        _safe_int(row.get("collection_id"))
        for row in attempts
        if _safe_int(row.get("collection_id")) > 0
    })
    collection_map: Dict[int, Dict[str, Any]] = {}
    if collection_ids:
        collection_rows = _safe_rows(
            supabase.table("collections")
            .select("id, title, series_id, meta")
            .in_("id", collection_ids)
        )
        for row in collection_rows:
            collection_id = _safe_int(row.get("id"), -1)
            if collection_id <= 0:
                continue
            collection_map[collection_id] = row

    expanded_cache: Dict[int, Dict[int, CollectionTestQuestion]] = {}
    for collection_id in collection_ids:
        try:
            expanded_questions = _expand_questions(collection_id, supabase)
        except Exception:
            expanded_questions = []
        expanded_cache[collection_id] = {
            _safe_int(question.item_id): question
            for question in expanded_questions
            if _safe_int(question.item_id) > 0
        }

    section_labels = {
        "gk": "GK Quiz",
        "maths": "Maths Quiz",
        "passage": "Passage Quiz",
        "mains": "Mains Questions",
    }
    source_buckets: Dict[str, Dict[str, Dict[str, Any]]] = {
        content_type: {
            "ai": {
                "summary": _performance_metric_stats_template(is_quiz=content_type != "mains"),
                "first_level": {},
                "second_level": {},
            },
            "program": {
                "summary": _performance_metric_stats_template(is_quiz=content_type != "mains"),
                "first_level": {},
                "second_level": {},
            },
        }
        for content_type in ("gk", "maths", "passage", "mains")
    }

    def _ensure_bucket(content_type: str, source_kind: str, first_id: int, second_id: int) -> Tuple[Dict[str, Any], Dict[str, Any]]:
        bucket = source_buckets[content_type][source_kind]
        first_stats = bucket["first_level"].setdefault(first_id, _performance_metric_stats_template(is_quiz=content_type != "mains"))
        second_level_map = bucket["second_level"].setdefault(first_id, {})
        second_stats = second_level_map.setdefault(second_id, _performance_metric_stats_template(is_quiz=content_type != "mains"))
        return first_stats, second_stats

    for attempt in attempts:
        collection_id = _safe_int(attempt.get("collection_id"))
        collection_row = collection_map.get(collection_id)
        source_kind = _collection_performance_source_kind(collection_row)
        details = attempt.get("details") if isinstance(attempt.get("details"), list) else []
        question_map = expanded_cache.get(collection_id, {})

        for detail in details:
            if not isinstance(detail, dict):
                continue
            item_id = _safe_int(detail.get("item_id"), -1)
            if item_id <= 0:
                continue
            question = question_map.get(item_id)
            if not question:
                continue
            quiz_type = (
                question.quiz_type.value
                if hasattr(question.quiz_type, "value")
                else str(question.quiz_type or "")
            ).strip().lower()
            if quiz_type not in {"gk", "maths", "passage"}:
                continue

            selected_option = detail.get("selected_option")
            is_correct = bool(detail.get("is_correct"))
            if selected_option in (None, ""):
                outcome = "unanswered"
            elif is_correct:
                outcome = "correct"
            else:
                outcome = "incorrect"

            _accumulate_quiz_performance_stats(source_buckets[quiz_type][source_kind]["summary"], outcome)
            resolved_pairs = _resolve_category_hierarchy_pairs(question.category_ids, nodes=quiz_nodes)
            for first_id, second_id in resolved_pairs:
                first_stats, second_stats = _ensure_bucket(quiz_type, source_kind, first_id, second_id)
                _accumulate_quiz_performance_stats(first_stats, outcome)
                _accumulate_quiz_performance_stats(second_stats, outcome)

    evaluation_question_ids = sorted({
        _safe_int(row.get("question_id"))
        for row in evaluations
        if _safe_int(row.get("question_id")) > 0
    })
    ai_mains_map: Dict[int, Dict[str, Any]] = {}
    if evaluation_question_ids:
        ai_rows = _safe_rows(
            supabase.table("user_ai_mains_questions")
            .select("id, question_text, mains_category_ids, category_ids, author_id")
            .eq("author_id", user_id)
            .in_("id", evaluation_question_ids)
        )
        for row in ai_rows:
            question_id = _safe_int(row.get("id"), -1)
            if question_id <= 0:
                continue
            ai_mains_map[question_id] = row

    content_item_map: Dict[int, Dict[str, Any]] = {}
    content_item_collection_rows: Dict[int, List[int]] = {}
    if evaluation_question_ids:
        content_rows = _safe_rows(
            supabase.table("content_items")
            .select("id, type, data")
            .in_("id", evaluation_question_ids)
        )
        for row in content_rows:
            content_id = _safe_int(row.get("id"), -1)
            if content_id <= 0:
                continue
            content_item_map[content_id] = row

        collection_item_rows = _safe_rows(
            supabase.table("collection_items")
            .select("content_item_id, collection_id")
            .in_("content_item_id", evaluation_question_ids)
        )
        for row in collection_item_rows:
            content_item_id = _safe_int(row.get("content_item_id"), -1)
            collection_id = _safe_int(row.get("collection_id"), -1)
            if content_item_id <= 0 or collection_id <= 0:
                continue
            content_item_collection_rows.setdefault(content_item_id, []).append(collection_id)

        mains_collection_ids = sorted({
            collection_id
            for rows in content_item_collection_rows.values()
            for collection_id in rows
            if collection_id > 0
        })
        if mains_collection_ids:
            mains_collection_rows = _safe_rows(
                supabase.table("collections")
                .select("id, title, series_id, meta")
                .in_("id", mains_collection_ids)
            )
            for row in mains_collection_rows:
                collection_id = _safe_int(row.get("id"), -1)
                if collection_id <= 0:
                    continue
                collection_map[collection_id] = row

    for evaluation in evaluations:
        question_id = _safe_int(evaluation.get("question_id"))
        score = max(0.0, _safe_float(evaluation.get("score"), 0.0))
        max_score = _safe_float(evaluation.get("max_score"), 10.0)
        if max_score <= 0:
            max_score = 10.0

        selected_source_kind = "ai"
        selected_category_ids: List[int] = []

        ai_row = ai_mains_map.get(question_id)
        content_item_row = content_item_map.get(question_id)
        content_data = content_item_row.get("data") if isinstance(content_item_row, dict) and isinstance(content_item_row.get("data"), dict) else {}
        content_question_text = _mains_question_text_from_content_data(content_data) if isinstance(content_data, dict) else ""
        evaluation_text = str(evaluation.get("question_text") or "").strip()
        ai_question_text = str((ai_row or {}).get("question_text") or "").strip()

        content_collection_ids = content_item_collection_rows.get(question_id, [])
        content_collection = next((collection_map.get(collection_id) for collection_id in content_collection_ids if collection_id in collection_map), None)
        content_source_kind = _collection_performance_source_kind(content_collection)

        if ai_row and content_item_row:
            if evaluation_text and ai_question_text and evaluation_text == ai_question_text and evaluation_text != content_question_text:
                selected_source_kind = "ai"
            elif evaluation_text and content_question_text and evaluation_text == content_question_text and evaluation_text != ai_question_text:
                selected_source_kind = content_source_kind
            elif content_source_kind == "program":
                selected_source_kind = "program"
            else:
                selected_source_kind = "ai"
        elif content_item_row:
            selected_source_kind = content_source_kind
        elif ai_row:
            selected_source_kind = "ai"

        if selected_source_kind == "ai" and ai_row:
            selected_category_ids = _normalize_exam_ids(
                ai_row.get("mains_category_ids") or ai_row.get("category_ids") or []
            )
        elif content_item_row and isinstance(content_data, dict):
            selected_category_ids = _extract_mains_category_ids_from_content_data(content_data)

        _accumulate_mains_performance_stats(source_buckets["mains"][selected_source_kind]["summary"], score=score, max_score=max_score)
        resolved_pairs = _resolve_category_hierarchy_pairs(selected_category_ids, nodes=mains_nodes)
        for first_id, second_id in resolved_pairs:
            first_stats, second_stats = _ensure_bucket("mains", selected_source_kind, first_id, second_id)
            _accumulate_mains_performance_stats(first_stats, score=score, max_score=max_score)
            _accumulate_mains_performance_stats(second_stats, score=score, max_score=max_score)

    overview_sections: Dict[str, Any] = {}
    detail_index: Dict[str, Dict[str, Dict[int, Dict[str, Any]]]] = {
        content_type: {"ai": {}, "program": {}}
        for content_type in ("gk", "maths", "passage", "mains")
    }

    for content_type in ("gk", "maths", "passage", "mains"):
        is_quiz = content_type != "mains"
        name_map = quiz_name_map if is_quiz else mains_name_map
        overview_sources: Dict[str, Any] = {}

        for source_kind in ("ai", "program"):
            bucket = source_buckets[content_type][source_kind]
            first_categories: List[Dict[str, Any]] = []
            for first_id, stats in bucket["first_level"].items():
                metric_payload = (
                    _build_quiz_performance_summary(stats)
                    if is_quiz
                    else _build_mains_performance_summary(stats)
                )
                detail_rows = bucket["second_level"].get(first_id) or {}
                has_children = len([key for key in detail_rows.keys() if key != first_id]) > 0
                first_categories.append(
                    {
                        "id": first_id if first_id > 0 else None,
                        "name": name_map.get(first_id, "Uncategorized"),
                        "has_children": has_children,
                        **metric_payload,
                    }
                )

                subcategories: List[Dict[str, Any]] = []
                for second_id, second_stats in detail_rows.items():
                    second_payload = (
                        _build_quiz_performance_summary(second_stats)
                        if is_quiz
                        else _build_mains_performance_summary(second_stats)
                    )
                    second_name = name_map.get(second_id, "Uncategorized")
                    if second_id == first_id and any(key != first_id for key in detail_rows.keys()):
                        second_name = f"{second_name} (General)"
                    subcategories.append(
                        {
                            "id": second_id if second_id > 0 else None,
                            "name": second_name,
                            "proficiency_label": _performance_proficiency_label(_safe_float(second_payload.get("percentage"))),
                            **second_payload,
                        }
                    )

                subcategories.sort(
                    key=lambda row: (
                        -_safe_int(row.get("total_questions")),
                        -_safe_float(row.get("percentage")),
                        str(row.get("name") or "").lower(),
                    )
                )
                detail_index[content_type][source_kind][first_id] = {
                    "category": {
                        "id": first_id if first_id > 0 else None,
                        "name": name_map.get(first_id, "Uncategorized"),
                    },
                    "summary": {
                        **metric_payload,
                    },
                    "subcategories": subcategories,
                    "analysis": _build_performance_category_analysis(
                        category_name=name_map.get(first_id, "Uncategorized"),
                        content_label=section_labels[content_type],
                        source_kind=source_kind,
                        is_quiz=is_quiz,
                        subcategories=subcategories,
                    ),
                }

            first_categories.sort(
                key=lambda row: (
                    -_safe_int(row.get("total_questions")),
                    -_safe_float(row.get("percentage")),
                    str(row.get("name") or "").lower(),
                )
            )
            overview_sources[source_kind] = {
                "source_kind": source_kind,
                **(
                    _build_quiz_performance_summary(bucket["summary"])
                    if is_quiz
                    else _build_mains_performance_summary(bucket["summary"])
                ),
                "first_level_categories": first_categories,
            }

        overview_sections[content_type] = {
            "content_type": content_type,
            "label": section_labels[content_type],
            "is_quiz": is_quiz,
            "sources": overview_sources,
        }

    return {
        "overview": {
            "generated_at": _utc_now().isoformat(),
            "sections": overview_sections,
        },
        "detail_index": detail_index,
    }


@router.get("/user/performance-audit")
def get_user_performance_audit(
    limit: int = Query(default=180, ge=20, le=500),
    supabase: Client = Depends(get_supabase_client),
    user_id: Optional[str] = Depends(get_user_id),
):
    if not user_id:
        raise HTTPException(status_code=401, detail="Authentication required")
    bundle = _build_user_performance_audit_bundle(user_id=user_id, supabase=supabase, limit=limit)
    return bundle["overview"]


@router.get("/user/performance-audit/{content_type}/sources/{source_kind}/categories/{category_id}")
def get_user_performance_category_detail(
    content_type: str,
    source_kind: str,
    category_id: int,
    limit: int = Query(default=180, ge=20, le=500),
    supabase: Client = Depends(get_supabase_client),
    user_id: Optional[str] = Depends(get_user_id),
):
    if not user_id:
        raise HTTPException(status_code=401, detail="Authentication required")
    normalized_content_type = str(content_type or "").strip().lower()
    normalized_source_kind = str(source_kind or "").strip().lower()
    if normalized_content_type not in {"gk", "maths", "passage", "mains"}:
        raise HTTPException(status_code=404, detail="Unsupported content type")
    if normalized_source_kind not in {"ai", "program"}:
        raise HTTPException(status_code=404, detail="Unsupported source type")

    bundle = _build_user_performance_audit_bundle(user_id=user_id, supabase=supabase, limit=limit)
    detail_payload = (
        bundle["detail_index"]
        .get(normalized_content_type, {})
        .get(normalized_source_kind, {})
        .get(category_id)
    )
    if not detail_payload:
        raise HTTPException(status_code=404, detail="Category detail not found")

    overview_section = bundle["overview"]["sections"][normalized_content_type]
    source_overview = overview_section["sources"][normalized_source_kind]
    return {
        "generated_at": bundle["overview"]["generated_at"],
        "content_type": normalized_content_type,
        "label": overview_section["label"],
        "source_kind": normalized_source_kind,
        "source_summary": {
            key: value
            for key, value in source_overview.items()
            if key != "first_level_categories"
        },
        **detail_payload,
    }


@router.get("/user/dashboard-analytics")
def get_user_dashboard_analytics(
    limit: int = Query(default=120, ge=20, le=500),
    supabase: Client = Depends(get_supabase_client),
    user_id: Optional[str] = Depends(get_user_id),
):
    if not user_id:
        raise HTTPException(status_code=401, detail="Authentication required")

    attempts = _safe_rows(
        supabase.table("user_quiz_attempts")
        .select("id, collection_id, score, total_questions, correct_answers, incorrect_answers, unanswered, details, weak_areas, created_at")
        .eq("user_id", user_id)
        .order("created_at", desc=True)
        .limit(limit)
    )
    evaluations = _safe_rows(
        supabase.table("user_mains_evaluations")
        .select("id, question_text, score, max_score, weaknesses, strengths, created_at")
        .eq("user_id", user_id)
        .order("created_at", desc=True)
        .limit(limit)
    )

    sections: Dict[str, Dict[str, Any]] = {
        "gk": {
            "content_type": "gk",
            "label": "GK Quiz",
            "activity_count": 0,
            "question_count": 0,
            "correct_count": 0,
            "incorrect_count": 0,
            "unanswered_count": 0,
            "accuracy": 0.0,
            "weak_areas": [],
            "recurring_errors": [],
            "recommendations": [],
            "trend_7d": [],
            "trend_30d": [],
            "category_performance": [],
            "performance_groups": {"best": [], "average": [], "bad": []},
        },
        "maths": {
            "content_type": "maths",
            "label": "Maths Quiz",
            "activity_count": 0,
            "question_count": 0,
            "correct_count": 0,
            "incorrect_count": 0,
            "unanswered_count": 0,
            "accuracy": 0.0,
            "weak_areas": [],
            "recurring_errors": [],
            "recommendations": [],
            "trend_7d": [],
            "trend_30d": [],
            "category_performance": [],
            "performance_groups": {"best": [], "average": [], "bad": []},
        },
        "passage": {
            "content_type": "passage",
            "label": "Passage Quiz",
            "activity_count": 0,
            "question_count": 0,
            "correct_count": 0,
            "incorrect_count": 0,
            "unanswered_count": 0,
            "accuracy": 0.0,
            "weak_areas": [],
            "recurring_errors": [],
            "recommendations": [],
            "trend_7d": [],
            "trend_30d": [],
            "category_performance": [],
            "performance_groups": {"best": [], "average": [], "bad": []},
        },
        "mains": {
            "content_type": "mains",
            "label": "Mains",
            "activity_count": 0,
            "question_count": 0,
            "total_score": 0.0,
            "max_total_score": 0.0,
            "average_score": 0.0,
            "score_percent": 0.0,
            "weak_areas": [],
            "recurring_errors": [],
            "recommendations": [],
            "trend_7d": [],
            "trend_30d": [],
            "category_performance": [],
            "area_performance": [],
            "performance_groups": {"best": [], "average": [], "bad": []},
        },
    }

    weak_category_counts: Dict[str, Dict[int, int]] = {"gk": {}, "maths": {}, "passage": {}}
    quiz_category_stats: Dict[str, Dict[int, Dict[str, int]]] = {"gk": {}, "maths": {}, "passage": {}}
    recurring_quiz_errors: Dict[str, Dict[str, int]] = {"gk": {}, "maths": {}, "passage": {}}
    mains_issue_counts: Dict[str, int] = {}
    mains_area_stats: Dict[str, Dict[str, int]] = {}
    quiz_daily_stats: Dict[str, Dict[str, Dict[str, int]]] = {"gk": {}, "maths": {}, "passage": {}}
    mains_daily_stats: Dict[str, Dict[str, float]] = {}
    recent_activity: List[Dict[str, Any]] = []

    collection_ids = sorted(
        {
            _safe_int(row.get("collection_id"))
            for row in attempts
            if _safe_int(row.get("collection_id")) > 0
        }
    )
    collection_title_map: Dict[int, str] = {}
    if collection_ids:
        collection_rows = _safe_rows(
            supabase.table("collections")
            .select("id, title")
            .in_("id", collection_ids)
        )
        for row in collection_rows:
            cid = _safe_int(row.get("id"), -1)
            if cid <= 0:
                continue
            collection_title_map[cid] = str(row.get("title") or f"Collection {cid}")

    expanded_cache: Dict[int, Dict[int, CollectionTestQuestion]] = {}
    for collection_id in collection_ids:
        try:
            expanded_questions = _expand_questions(collection_id, supabase)
        except Exception:
            expanded_questions = []
        expanded_cache[collection_id] = {
            _safe_int(question.item_id): question
            for question in expanded_questions
            if _safe_int(question.item_id) > 0
        }

    overall_quiz_total = 0
    overall_quiz_correct = 0
    overall_quiz_incorrect = 0
    overall_quiz_unanswered = 0

    for attempt in attempts:
        created_at = str(attempt.get("created_at") or "")
        date_key = _date_key_from_iso(created_at)
        collection_id = _safe_int(attempt.get("collection_id"))
        details = attempt.get("details") if isinstance(attempt.get("details"), list) else []
        question_map = expanded_cache.get(collection_id, {})
        attempt_types: Set[str] = set()

        for detail in details:
            if not isinstance(detail, dict):
                continue
            item_id = _safe_int(detail.get("item_id"), -1)
            if item_id <= 0:
                continue
            question = question_map.get(item_id)
            if not question:
                continue
            quiz_type = (
                question.quiz_type.value
                if hasattr(question.quiz_type, "value")
                else str(question.quiz_type or "")
            ).strip().lower()
            if quiz_type not in {"gk", "maths", "passage"}:
                continue
            section = sections[quiz_type]
            section["question_count"] += 1
            attempt_types.add(quiz_type)
            day_bucket = quiz_daily_stats[quiz_type].setdefault(
                date_key,
                {
                    "activity_count": 0,
                    "question_count": 0,
                    "correct_count": 0,
                },
            )
            day_bucket["question_count"] += 1

            category_ids = _normalize_exam_ids(question.category_ids)
            if not category_ids:
                category_ids = [0]
            category_stats_map = quiz_category_stats[quiz_type]
            for category_id in category_ids:
                stats = category_stats_map.setdefault(
                    category_id,
                    {
                        "total": 0,
                        "correct": 0,
                        "incorrect": 0,
                        "unanswered": 0,
                    },
                )
                stats["total"] += 1

            selected_option = detail.get("selected_option")
            is_correct = bool(detail.get("is_correct"))
            if selected_option in (None, ""):
                section["unanswered_count"] += 1
                for category_id in category_ids:
                    category_stats_map[category_id]["unanswered"] += 1
                continue
            if is_correct:
                section["correct_count"] += 1
                day_bucket["correct_count"] += 1
                for category_id in category_ids:
                    category_stats_map[category_id]["correct"] += 1
                continue
            section["incorrect_count"] += 1
            for category_id in category_ids:
                category_stats_map[category_id]["incorrect"] += 1
                weak_category_counts[quiz_type][category_id] = weak_category_counts[quiz_type].get(category_id, 0) + 1

            question_label = _dashboard_text(question.question_statement, max_chars=110)
            if question_label:
                recurring_quiz_errors[quiz_type][question_label] = recurring_quiz_errors[quiz_type].get(question_label, 0) + 1

        if not attempt_types and question_map:
            type_counts: Dict[str, int] = {}
            for question in question_map.values():
                quiz_type = (
                    question.quiz_type.value
                    if hasattr(question.quiz_type, "value")
                    else str(question.quiz_type or "")
                ).strip().lower()
                if quiz_type not in {"gk", "maths", "passage"}:
                    continue
                type_counts[quiz_type] = type_counts.get(quiz_type, 0) + 1
            if type_counts:
                dominant_type = max(type_counts.items(), key=lambda item: item[1])[0]
                attempt_types.add(dominant_type)

        for quiz_type in attempt_types:
            sections[quiz_type]["activity_count"] += 1
            day_bucket = quiz_daily_stats[quiz_type].setdefault(
                date_key,
                {
                    "activity_count": 0,
                    "question_count": 0,
                    "correct_count": 0,
                },
            )
            day_bucket["activity_count"] += 1

        score = _safe_int(attempt.get("score"))
        total_questions = max(0, _safe_int(attempt.get("total_questions")))
        correct_answers = max(0, _safe_int(attempt.get("correct_answers")))
        incorrect_answers = max(0, _safe_int(attempt.get("incorrect_answers")))
        unanswered_answers = max(0, _safe_int(attempt.get("unanswered")))
        overall_quiz_total += total_questions
        overall_quiz_correct += correct_answers
        overall_quiz_incorrect += incorrect_answers
        overall_quiz_unanswered += unanswered_answers
        accuracy = round((float(correct_answers) / float(total_questions)) * 100.0, 2) if total_questions else 0.0
        if attempt_types:
            type_label = sorted(attempt_types)[0] if len(attempt_types) == 1 else "mixed_quiz"
            recent_activity.append(
                {
                    "type": type_label,
                    "created_at": created_at,
                    "title": collection_title_map.get(collection_id, "Collection Test"),
                    "score_text": f"{score}/{total_questions}",
                    "accuracy": accuracy,
                }
            )

    for evaluation in evaluations:
        section = sections["mains"]
        section["activity_count"] += 1
        section["question_count"] += 1
        score = max(0.0, _safe_float(evaluation.get("score"), 0.0))
        max_score = _safe_float(evaluation.get("max_score"), 10.0)
        if max_score <= 0:
            max_score = 10.0
        section["total_score"] += score
        section["max_total_score"] += max_score
        date_key = _date_key_from_iso(evaluation.get("created_at"))
        mains_day_bucket = mains_daily_stats.setdefault(
            date_key,
            {
                "activity_count": 0.0,
                "total_score": 0.0,
                "max_total_score": 0.0,
            },
        )
        mains_day_bucket["activity_count"] += 1.0
        mains_day_bucket["total_score"] += score
        mains_day_bucket["max_total_score"] += max_score

        strengths = evaluation.get("strengths") if isinstance(evaluation.get("strengths"), list) else []
        weaknesses = evaluation.get("weaknesses") if isinstance(evaluation.get("weaknesses"), list) else []

        for strength in strengths:
            label = _dashboard_text(strength, max_chars=90)
            if not label:
                continue
            area_row = mains_area_stats.setdefault(
                label,
                {
                    "strength_count": 0,
                    "weakness_count": 0,
                },
            )
            area_row["strength_count"] += 1

        for weak in weaknesses:
            label = _dashboard_text(weak, max_chars=90)
            if not label:
                continue
            mains_issue_counts[label] = mains_issue_counts.get(label, 0) + 1
            area_row = mains_area_stats.setdefault(
                label,
                {
                    "strength_count": 0,
                    "weakness_count": 0,
                },
            )
            area_row["weakness_count"] += 1

        recent_activity.append(
            {
                "type": "mains",
                "created_at": str(evaluation.get("created_at") or ""),
                "title": _dashboard_text(evaluation.get("question_text"), max_chars=100) or "Mains Evaluation",
                "score_text": f"{score:.1f}/{max_score:.1f}",
                "accuracy": round((score / max_score) * 100.0, 2) if max_score else 0.0,
            }
        )

    all_category_ids: Set[int] = set()
    for type_counts in weak_category_counts.values():
        for category_id in type_counts.keys():
            if category_id > 0:
                all_category_ids.add(category_id)
    for type_stats in quiz_category_stats.values():
        for category_id in type_stats.keys():
            if category_id > 0:
                all_category_ids.add(category_id)
    category_name_map: Dict[int, str] = {0: "Uncategorized"}
    if all_category_ids:
        category_rows = _safe_rows(
            supabase.table("categories")
            .select("id, name")
            .in_("id", sorted(all_category_ids))
        )
        for row in category_rows:
            category_id = _safe_int(row.get("id"), -1)
            if category_id <= 0:
                continue
            category_name_map[category_id] = str(row.get("name") or f"Category {category_id}")

    for quiz_type in ("gk", "maths", "passage"):
        section = sections[quiz_type]
        question_count = _safe_int(section.get("question_count"))
        correct_count = _safe_int(section.get("correct_count"))
        section["accuracy"] = round((float(correct_count) / float(question_count)) * 100.0, 2) if question_count else 0.0

        category_rows: List[Dict[str, Any]] = []
        for category_id, stats in quiz_category_stats[quiz_type].items():
            total = max(0, _safe_int(stats.get("total")))
            correct = max(0, _safe_int(stats.get("correct")))
            incorrect = max(0, _safe_int(stats.get("incorrect")))
            unanswered = max(0, _safe_int(stats.get("unanswered")))
            accuracy = round((float(correct) / float(total)) * 100.0, 2) if total else 0.0
            band = _performance_band(accuracy, total)
            category_rows.append(
                {
                    "id": category_id if category_id > 0 else None,
                    "name": category_name_map.get(category_id, f"Category {category_id}"),
                    "total": total,
                    "correct": correct,
                    "incorrect": incorrect,
                    "unanswered": unanswered,
                    "accuracy": accuracy,
                    "band": band,
                }
            )
        category_rows.sort(
            key=lambda row: (
                -_safe_int(row.get("total")),
                -_safe_float(row.get("accuracy")),
                str(row.get("name") or "").lower(),
            )
        )
        section["category_performance"] = category_rows
        section["performance_groups"] = {
            "best": [
                row
                for row in sorted(
                    [item for item in category_rows if str(item.get("band")) == "best"],
                    key=lambda item: (-_safe_float(item.get("accuracy")), -_safe_int(item.get("total")), str(item.get("name") or "").lower()),
                )
            ],
            "average": [
                row
                for row in sorted(
                    [item for item in category_rows if str(item.get("band")) == "average"],
                    key=lambda item: (-_safe_int(item.get("total")), -_safe_float(item.get("accuracy")), str(item.get("name") or "").lower()),
                )
            ],
            "bad": [
                row
                for row in sorted(
                    [item for item in category_rows if str(item.get("band")) == "bad"],
                    key=lambda item: (_safe_float(item.get("accuracy")), -_safe_int(item.get("total")), str(item.get("name") or "").lower()),
                )
            ],
        }

        category_counts = weak_category_counts[quiz_type]
        weak_areas = sorted(category_counts.items(), key=lambda item: (-item[1], str(category_name_map.get(item[0], ""))))
        section["weak_areas"] = [
            {
                "id": category_id,
                "name": category_name_map.get(category_id, f"Category {category_id}"),
                "count": count,
            }
            for category_id, count in weak_areas[:6]
        ]

        recurring_rows = sorted(
            recurring_quiz_errors[quiz_type].items(),
            key=lambda item: (-item[1], item[0].lower()),
        )
        recurring_rows = [row for row in recurring_rows if row[1] >= 2][:6]
        section["recurring_errors"] = [
            {
                "name": label,
                "count": count,
            }
            for label, count in recurring_rows
        ]
        section["recommendations"] = _build_quiz_section_recommendations(section)
        section["trend_7d"] = _build_quiz_trend_points(quiz_daily_stats[quiz_type], days=7)
        section["trend_30d"] = _build_quiz_trend_points(quiz_daily_stats[quiz_type], days=30)

    mains_section = sections["mains"]
    mains_question_count = _safe_int(mains_section.get("question_count"))
    mains_total_score = _safe_float(mains_section.get("total_score"))
    mains_max_total = _safe_float(mains_section.get("max_total_score"))
    mains_section["average_score"] = round((mains_total_score / float(mains_question_count)), 2) if mains_question_count else 0.0
    mains_section["score_percent"] = round((mains_total_score / mains_max_total) * 100.0, 2) if mains_max_total > 0 else 0.0

    mains_issues_sorted = sorted(mains_issue_counts.items(), key=lambda item: (-item[1], item[0].lower()))
    mains_section["weak_areas"] = [{"name": label, "count": count} for label, count in mains_issues_sorted[:6]]
    mains_section["recurring_errors"] = [{"name": label, "count": count} for label, count in mains_issues_sorted if count >= 2][:6]

    mains_area_rows: List[Dict[str, Any]] = []
    for label, stats in mains_area_stats.items():
        strength_count = max(0, _safe_int(stats.get("strength_count")))
        weakness_count = max(0, _safe_int(stats.get("weakness_count")))
        total_mentions = strength_count + weakness_count
        strength_ratio = round((float(strength_count) / float(total_mentions)) * 100.0, 2) if total_mentions else 0.0
        band = _performance_band(
            strength_ratio,
            total_mentions,
            low_threshold=40.0,
            high_threshold=65.0,
            min_sample_size=2,
        )
        mains_area_rows.append(
            {
                "name": label,
                "strength_count": strength_count,
                "weakness_count": weakness_count,
                "total_mentions": total_mentions,
                "strength_ratio": strength_ratio,
                "band": band,
            }
        )
    mains_area_rows.sort(
        key=lambda row: (
            -_safe_int(row.get("total_mentions")),
            -_safe_float(row.get("strength_ratio")),
            str(row.get("name") or "").lower(),
        )
    )
    mains_section["area_performance"] = mains_area_rows
    mains_section["category_performance"] = mains_area_rows
    mains_section["performance_groups"] = {
        "best": [
            row
            for row in sorted(
                [item for item in mains_area_rows if str(item.get("band")) == "best"],
                key=lambda item: (-_safe_float(item.get("strength_ratio")), -_safe_int(item.get("total_mentions")), str(item.get("name") or "").lower()),
            )
        ],
        "average": [
            row
            for row in sorted(
                [item for item in mains_area_rows if str(item.get("band")) == "average"],
                key=lambda item: (-_safe_int(item.get("total_mentions")), -_safe_float(item.get("strength_ratio")), str(item.get("name") or "").lower()),
            )
        ],
        "bad": [
            row
            for row in sorted(
                [item for item in mains_area_rows if str(item.get("band")) == "bad"],
                key=lambda item: (_safe_float(item.get("strength_ratio")), -_safe_int(item.get("total_mentions")), str(item.get("name") or "").lower()),
            )
        ],
    }

    mains_section["recommendations"] = _build_mains_section_recommendations(mains_section)
    mains_section["trend_7d"] = _build_mains_trend_points(mains_daily_stats, days=7)
    mains_section["trend_30d"] = _build_mains_trend_points(mains_daily_stats, days=30)

    recent_activity.sort(
        key=lambda row: _parse_datetime(row.get("created_at")) or datetime.min.replace(tzinfo=timezone.utc),
        reverse=True,
    )
    recent_activity = recent_activity[:30]

    overall_quiz_accuracy = (
        round((float(overall_quiz_correct) / float(overall_quiz_total)) * 100.0, 2)
        if overall_quiz_total
        else 0.0
    )
    overall_mains_average = mains_section["average_score"]

    global_recommendations: List[str] = []
    weakest_quiz_rows = [
        (quiz_type, _safe_float(sections[quiz_type].get("accuracy")), _safe_int(sections[quiz_type].get("question_count")))
        for quiz_type in ("gk", "maths", "passage")
        if _safe_int(sections[quiz_type].get("question_count")) > 0
    ]
    if weakest_quiz_rows:
        weakest_quiz_rows.sort(key=lambda item: (item[1], item[2]))
        weakest_type, weakest_accuracy, _ = weakest_quiz_rows[0]
        if weakest_accuracy < 70:
            global_recommendations.append(
                f"{sections[weakest_type]['label']} is your weakest quiz section currently; schedule a focused revision sprint this week."
            )
    if mains_question_count > 0 and _safe_float(overall_mains_average) < 6.0:
        global_recommendations.append(
            "Mains scores are below target; prioritize structured answer-writing practice with post-evaluation correction."
        )
    top_global_weak = []
    for quiz_type in ("gk", "maths", "passage"):
        for area in sections[quiz_type].get("weak_areas") or []:
            if isinstance(area, dict):
                name = str(area.get("name") or "").strip()
                count = _safe_int(area.get("count"))
                if name and count > 0:
                    top_global_weak.append((name, count))
    top_global_weak.sort(key=lambda item: (-item[1], item[0].lower()))
    if top_global_weak:
        picked = [name for name, _count in top_global_weak[:2]]
        global_recommendations.append(
            f"Recurring weakness detected in {', '.join(picked)}; use targeted practice sets before full mocks."
        )
    if not global_recommendations:
        global_recommendations.append("Keep consistent practice across all sections to maintain your current performance trend.")

    recommendation_plugs = _build_dashboard_recommendation_plugs(sections)
    purchase_overview = _build_dashboard_purchase_overview(user_id=user_id, supabase=supabase)

    return {
        "generated_at": _utc_now().isoformat(),
        "summary": {
            "total_quiz_attempts": len(attempts),
            "total_mains_evaluations": len(evaluations),
            "overall_quiz_accuracy": overall_quiz_accuracy,
            "overall_mains_average_score": overall_mains_average,
            "overall_quiz_correct": overall_quiz_correct,
            "overall_quiz_incorrect": overall_quiz_incorrect,
            "overall_quiz_unanswered": overall_quiz_unanswered,
            "overall_quiz_questions": overall_quiz_total,
        },
        "sections": sections,
        "recent_activity": recent_activity,
        "recommendations": global_recommendations[:5],
        "recommendation_plugs": recommendation_plugs,
        "purchase_overview": purchase_overview,
    }


@router.get("/user/dashboard-ai-analysis")
async def get_user_dashboard_ai_analysis(
    limit: int = Query(default=120, ge=20, le=500),
    scope: str = Query(default="all", pattern="^(all|prelims|mains)$"),
    ai_provider: str = Query(default="gemini", pattern="^(gemini|openai)$"),
    ai_model_name: str = Query(default="gemini-3-flash-preview"),
    supabase: Client = Depends(get_supabase_client),
    user_id: Optional[str] = Depends(get_user_id),
):
    if not user_id:
        raise HTTPException(status_code=401, detail="Authentication required")

    analytics_payload = get_user_dashboard_analytics(limit=limit, supabase=supabase, user_id=user_id)
    analysis_payload = await generate_dashboard_performance_analysis(
        analytics_payload,
        scope=scope,
        provider=ai_provider,
        model_name=ai_model_name,
    )

    return {
        "generated_at": _utc_now().isoformat(),
        "analytics_generated_at": analytics_payload.get("generated_at"),
        "scope": scope,
        **analysis_payload,
    }

@router.get("/user/progress")
def get_user_progress(
    supabase: Client = Depends(get_supabase_client),
    user_id: Optional[str] = Depends(get_user_id),
):
    if not user_id:
         raise HTTPException(status_code=401, detail="Authentication required")
    
    # Fetch quiz attempts (limit 20)
    attempts = _rows(supabase.table("user_quiz_attempts").select("*").eq("user_id", user_id).order("created_at", desc=True).limit(20).execute())
    
    # Fetch mains evaluations (limit 20)
    evaluations = _rows(supabase.table("user_mains_evaluations").select("*").eq("user_id", user_id).order("created_at", desc=True).limit(20).execute())
    
    return {
        "quiz_attempts": attempts,
        "mains_evaluations": evaluations
    }

@router.get("/user/quiz-attempt-counts")
def get_user_quiz_attempt_counts(
    collection_ids: Optional[str] = Query(default=None),
    supabase: Client = Depends(get_supabase_client),
    user_id: Optional[str] = Depends(get_user_id),
):
    if not user_id:
         raise HTTPException(status_code=401, detail="Authentication required")

    parsed_collection_ids: List[int] = []
    seen_collection_ids: Set[int] = set()
    for raw_value in str(collection_ids or "").split(","):
        chunk = str(raw_value or "").strip()
        if not chunk:
            continue
        try:
            collection_id = int(chunk)
        except (TypeError, ValueError):
            continue
        if collection_id <= 0 or collection_id in seen_collection_ids:
            continue
        seen_collection_ids.add(collection_id)
        parsed_collection_ids.append(collection_id)

    if not parsed_collection_ids:
        return {"counts": {}}

    attempts = _rows(
        supabase.table("user_quiz_attempts")
        .select("collection_id")
        .eq("user_id", user_id)
        .in_("collection_id", parsed_collection_ids)
        .execute()
    )

    counts: Dict[str, int] = {str(collection_id): 0 for collection_id in parsed_collection_ids}
    for attempt in attempts:
        try:
            collection_id = int(attempt.get("collection_id") or 0)
        except (TypeError, ValueError):
            continue
        if collection_id <= 0:
            continue
        key = str(collection_id)
        counts[key] = counts.get(key, 0) + 1

    return {"counts": counts}

@router.get("/user/weak-areas")
def get_user_weak_areas(
    supabase: Client = Depends(get_supabase_client),
    user_id: Optional[str] = Depends(get_user_id),
):
    if not user_id:
         raise HTTPException(status_code=401, detail="Authentication required")

    # Aggregate weak areas from recent attempts (limit 50)
    try:
        attempts = _rows(supabase.table("user_quiz_attempts").select("weak_areas").eq("user_id", user_id).order("created_at", desc=True).limit(50).execute())
    except Exception:
        attempts = []
        
    weakness_counts: Dict[int, int] = {}
    for attempt in attempts:
        areas = attempt.get("weak_areas") or []
        for area_id in areas:
            try:
                aid = int(area_id)
                weakness_counts[aid] = weakness_counts.get(aid, 0) + 1
            except (ValueError, TypeError):
                continue
            
    if not weakness_counts:
        return []
        
    sorted_ids = sorted(weakness_counts.keys(), key=lambda k: weakness_counts[k], reverse=True)
    
    # Fetch category details
    categories = []
    if sorted_ids:
        try:
            categories = _rows(supabase.table("categories").select("id, name, type").in_("id", sorted_ids).execute())
        except Exception:
            categories = []
        
    cat_map = {int(c["id"]): c for c in categories}
    
    result = []
    for cid in sorted_ids:
        if cid in cat_map:
            cat = cat_map[cid]
            result.append({
                "id": cid,
                "name": cat["name"],
                "type": cat["type"],
                "count": weakness_counts[cid]
            })
            
    return result

# Premium AI Settings Endpoints for Frontend Compatibility

@compat_router.get("/admin/premium-ai-settings/", response_model=List[PremiumAIQuizInstruction])
def list_premium_ai_settings(
    limit: int = 100,
    offset: int = 0,
    user_ctx: Dict[str, Any] = Depends(require_admin_user),
    supabase: Client = Depends(get_supabase_client),
):
    try:
        query = supabase.table("premium_ai_quiz_instructions").select("*").range(offset, offset + limit - 1).order("created_at", desc=True)
        return _rows(query.execute())
    except Exception as e:
        if _is_missing_table_error(e, "premium_ai_quiz_instructions"):
            raise HTTPException(status_code=503, detail="Table 'premium_ai_quiz_instructions' is missing. Run migration.")
        raise HTTPException(status_code=500, detail=str(e))

@compat_router.post("/admin/premium-ai-settings/", response_model=PremiumAIQuizInstruction)
def create_premium_ai_setting(
    payload: PremiumAIQuizInstructionCreate,
    user_ctx: Dict[str, Any] = Depends(require_admin_user),
    supabase: Client = Depends(get_supabase_client),
):
    try:
        data = payload.model_dump()
        data["content_type"] = payload.content_type.value
        data["ai_provider"] = payload.ai_provider.value
        row = _first(supabase.table("premium_ai_quiz_instructions").insert(data).execute())
        if not row:
            raise HTTPException(status_code=400, detail="Failed to create instruction")
        return PremiumAIQuizInstruction(**row)
    except Exception as e:
        if _is_missing_table_error(e, "premium_ai_quiz_instructions"):
             raise HTTPException(status_code=503, detail="Table 'premium_ai_quiz_instructions' is missing. Run migration.")
        raise HTTPException(status_code=500, detail=str(e))

@compat_router.put("/admin/premium-ai-settings/{instruction_id}", response_model=PremiumAIQuizInstruction)
def update_premium_ai_setting(
    instruction_id: int,
    payload: PremiumAIQuizInstructionUpdate,
    user_ctx: Dict[str, Any] = Depends(require_admin_user),
    supabase: Client = Depends(get_supabase_client),
):
    try:
        updates = payload.model_dump(exclude_unset=True)
        if "content_type" in updates and updates["content_type"]:
             updates["content_type"] = updates["content_type"].value
        if "ai_provider" in updates and updates["ai_provider"]:
             updates["ai_provider"] = updates["ai_provider"].value
        
        row = _first(supabase.table("premium_ai_quiz_instructions").update(updates).eq("id", instruction_id).execute())
        if not row:
            raise HTTPException(status_code=404, detail="Instruction not found or update failed")
        return PremiumAIQuizInstruction(**row)
    except Exception as e:
        if _is_missing_table_error(e, "premium_ai_quiz_instructions"):
             raise HTTPException(status_code=503, detail="Table 'premium_ai_quiz_instructions' is missing. Run migration.")
        raise HTTPException(status_code=500, detail=str(e))

@compat_router.delete("/admin/premium-ai-settings/{instruction_id}")
def delete_premium_ai_setting(
    instruction_id: int,
    user_ctx: Dict[str, Any] = Depends(require_admin_user),
    supabase: Client = Depends(get_supabase_client),
):
    try:
        supabase.table("premium_ai_quiz_instructions").delete().eq("id", instruction_id).execute()
        return {"ok": True}
    except Exception as e:
        if _is_missing_table_error(e, "premium_ai_quiz_instructions"):
             raise HTTPException(status_code=503, detail="Table 'premium_ai_quiz_instructions' is missing. Run migration.")
        raise HTTPException(status_code=500, detail=str(e))

# --- PDF Generation Helpers & Endpoint ---

class PDFGenerationRequest(BaseModel):
    items: List[Dict[str, Any]]
    title: str = "Generated Quiz"

def clean_text_for_document(raw_text: Optional[str], content_type: str = "generic") -> str:
    if not raw_text:
        return ""

    # 1. Unescape HTML entities
    text = html.unescape(raw_text)

    # 2. Strip HTML tags using BeautifulSoup
    soup = BeautifulSoup(text, 'html.parser')
    plain_text = soup.get_text(separator=' ', strip=True)
    # 3. Remove specific placeholders
    plain_text = re.sub(r"^(Q:|Question:|Statement:)\s*", "", plain_text, flags=re.IGNORECASE).strip()
    
    if content_type == 'prompt':
        plain_text = re.sub(r"^(Prompt:)\s*", "", plain_text, flags=re.IGNORECASE).strip()
    elif content_type == 'fact':
        plain_text = re.sub(r"^(Statements\/Facts:|Facts\/Statements:|Facts\/Statement:|Facts:)\s*", "", plain_text, flags=re.IGNORECASE).strip()
    elif content_type == "option":
        plain_text = re.sub(
            r"^\s*[\(\[]?(?:option\s+)?(?:[A-E]|[1-5])[\)\].:-]?\s*",
            "",
            plain_text,
            flags=re.IGNORECASE,
        ).strip()
    
    return plain_text


def _split_statement_structure_for_document(text: str) -> tuple[str, List[str], Optional[str]]:
    if not text:
        return "", [], None
    raw_text = str(text).strip()
    if not raw_text:
        return "", [], None

    lines = [line.strip() for line in raw_text.splitlines() if line and line.strip()]
    if not lines:
        lines = [re.sub(r"\s+", " ", raw_text)]

    statement_line_re = re.compile(
        r"^\s*(?:statement\s*(?:\d+|[ivxlcdm]+)|\d+|[ivxlcdm]+)\s*[:\).-]\s+",
        flags=re.IGNORECASE,
    )
    statements: List[str] = []
    statement_indices: List[int] = []
    prompt_idx: Optional[int] = None
    prompt_text: Optional[str] = None

    for idx, line in enumerate(lines):
        if statement_line_re.match(line):
            statement_indices.append(idx)
            statements.append(line)

    for idx, line in enumerate(lines):
        if idx in statement_indices:
            continue
        lowered = line.lower()
        if ("?" in line and re.search(r"\b(which|select|correct|following|above|how many)\b", lowered)) or re.search(
            r"\bwhich one of the following\b|\bselect the correct answer\b|\bcorrect in respect of the above\b|\bhow many of the above\b",
            lowered,
        ):
            prompt_idx = idx
            prompt_text = line
            break

    lead = " ".join([line for idx, line in enumerate(lines) if idx not in statement_indices and idx != prompt_idx]).strip()
    if statements:
        return lead, statements, prompt_text

    compact = re.sub(r"\s+", " ", raw_text)
    marker_pattern = r"statement\s*(?:\d+|[ivxlcdm]+)\s*[:\).-]"
    inline_re = re.compile(
        rf"(?is)\b({marker_pattern})\s*(.+?)(?=(?:\b{marker_pattern}\s*|\bwhich one of the following\b|\bwhich of the following\b|\bhow many of the above\b|\bhow many\b|\bselect(?:\s+the)?\s+correct\b|$))"
    )
    inline_matches = list(inline_re.finditer(compact))
    if len(inline_matches) >= 2:
        inline_statements: List[str] = []
        for match in inline_matches:
            prefix = re.sub(r"\s+", " ", str(match.group(1) or "").strip())
            body = re.sub(r"\s+", " ", str(match.group(2) or "").strip(" .;"))
            candidate = f"{prefix} {body}".strip()
            if candidate:
                inline_statements.append(candidate)
        if inline_statements:
            first_idx = inline_matches[0].start()
            lead_inline = compact[:first_idx].strip(" :-")
            tail = compact[inline_matches[-1].end():].strip()
            inline_prompt = tail or None
            if not inline_prompt:
                prompt_match = re.search(
                    r"(which one of the following[^?]*\?|which of the following[^?]*\?|how many of the above[^?]*\?|select(?:\s+the)?\s+correct[^?]*\?)",
                    compact,
                    flags=re.IGNORECASE,
                )
                if prompt_match:
                    inline_prompt = prompt_match.group(1).strip()
            return lead_inline, inline_statements, inline_prompt

    return lead, [], prompt_text


def _looks_like_prompt_for_document(text: str) -> bool:
    cleaned = str(text or "").strip()
    if not cleaned:
        return False
    lowered = cleaned.lower()
    if "?" in cleaned:
        return True
    return bool(
        re.search(
            r"^(which|what|how many|how much|who|whom|where|when|select|choose|identify|find|determine|correct|true|false)\b",
            lowered,
        )
    )


def _normalize_question_parts_for_document(question: Dict[str, Any]) -> Dict[str, Any]:
    question_text = clean_text_for_document(str(question.get("question_statement") or ""), "generic")
    prompt = clean_text_for_document(str(question.get("question_prompt") or ""), "prompt")
    supplementary = clean_text_for_document(str(question.get("supplementary_statement") or ""), "generic")
    raw_statements = question.get("statements_facts")
    statements: List[str] = []
    if isinstance(raw_statements, list):
        statements = [clean_text_for_document(str(statement), "fact") for statement in raw_statements if str(statement).strip()]

    lead, extracted_statements, extracted_prompt = _split_statement_structure_for_document(question_text)
    if extracted_statements and not statements:
        statements = extracted_statements
    if statements and re.search(r"\bstatement\s*(?:\d+|[ivxlcdm]+)\b", question_text, flags=re.IGNORECASE):
        question_text = lead or "Consider the following statements:"
    elif lead and extracted_statements:
        question_text = lead
    if not prompt and extracted_prompt:
        prompt = clean_text_for_document(extracted_prompt, "prompt")

    if statements:
        if question_text and prompt and _looks_like_prompt_for_document(question_text) and not _looks_like_prompt_for_document(prompt):
            question_text, prompt = prompt, question_text
        if question_text and _looks_like_prompt_for_document(question_text):
            if not prompt:
                prompt = question_text
            question_text = "Consider the following statements:"
        elif not question_text:
            if prompt and not _looks_like_prompt_for_document(prompt):
                question_text = prompt
                prompt = ""
            else:
                question_text = "Consider the following statements:"
        if prompt and not _looks_like_prompt_for_document(prompt) and _looks_like_prompt_for_document(question_text):
            question_text, prompt = prompt, question_text

    return {
        **question,
        "question_statement": question_text.strip(),
        "question_prompt": prompt.strip(),
        "supplementary_statement": supplementary.strip(),
        "statements_facts": [statement for statement in statements if statement],
    }

@router.post("/generate-pdf")
def generate_pdf_from_items(
    request: PDFGenerationRequest,
    supabase: Client = Depends(get_supabase_client),
):
    questions_data = []

    def _option_sort_key(raw_label: Any) -> int:
        label = str(raw_label or "").strip().upper()
        if label in {"A", "B", "C", "D", "E"}:
            return ord(label) - ord("A")
        if label in {"1", "2", "3", "4", "5"}:
            return int(label) - 1
        return 99

    def _append_options(raw_opts: Any, target: Dict[str, Any]) -> None:
        if isinstance(raw_opts, list):
            for opt in raw_opts:
                if isinstance(opt, dict):
                    target["options"].append({"text": opt.get("text") or opt.get("value") or "", "label": opt.get("label") or ""})
                else:
                    target["options"].append({"text": str(opt), "label": ""})
            return
        if isinstance(raw_opts, dict):
            option_rows: List[Dict[str, str]] = []
            for raw_label, raw_value in raw_opts.items():
                label = str(raw_label or "").strip().upper()
                if label.startswith("OPTION "):
                    label = label.replace("OPTION ", "").strip()
                if label in {"1", "2", "3", "4", "5"}:
                    label = chr(ord("A") + int(label) - 1)
                if isinstance(raw_value, dict):
                    text = str(raw_value.get("text") or raw_value.get("value") or "").strip()
                    label = str(raw_value.get("label") or label).strip().upper()
                else:
                    text = str(raw_value or "").strip()
                option_rows.append({"label": label, "text": text})
            option_rows.sort(key=lambda row: _option_sort_key(row.get("label")))
            target["options"].extend(option_rows)
    
    # Fetch content for all items
    for item in request.items:
        row = None
        data: Dict[str, Any] = {}
        ctype = None

        item_id = item.get("id")
        if item_id:
            row = _first(supabase.table("content_items").select("*").eq("id", item_id).limit(1).execute())

        if row:
            data = row.get("data") or {}
            ctype = row.get("type")
        else:
            if isinstance(item.get("data"), dict):
                data = item.get("data") or {}
                ctype = item.get("type") or item.get("content_type")
            else:
                data = item if isinstance(item, dict) else {}
                ctype = item.get("type") or item.get("content_type") if isinstance(item, dict) else None
        
        q_data = {}
        
        if ctype == ContentType.QUIZ_PASSAGE.value or isinstance(data.get("questions"), list):
             # Passage quiz - iterate questions
             passage_text = data.get("passage_text") or data.get("passage") or ""
             passage_title = data.get("passage_title") or ""
             
             questions_list = data.get("questions") or []
             for q in questions_list:
                 if not isinstance(q, dict): continue
                 
                 q_data = {
                    "question_statement": q.get("question_statement") or q.get("question_text") or q.get("question") or "",
                    "supplementary_statement": q.get("supp_question_statement") or q.get("supplementary_statement") or q.get("supplementary") or "",
                    "options": [],
                    "statements_facts": q.get("statements_facts") or q.get("statement_facts") or [],
                    "question_prompt": q.get("question_prompt") or q.get("prompt") or "",
                    "correct_answer": q.get("correct_answer") or "",
                    "explanation": q.get("explanation_text") or q.get("explanation") or "",
                    "passage_text": passage_text,
                    "passage_title": passage_title,
                 }
                 
                 _append_options(q.get("options") or [], q_data)
                             
                 questions_data.append(q_data)
             continue
        
        # Single Question logic
        q_data = {
            "question_statement": data.get("question_statement") or data.get("question_text") or data.get("question") or "",
            "supplementary_statement": data.get("supp_question_statement") or data.get("supplementary_statement") or data.get("supplementary") or "",
            "options": [],
            "statements_facts": data.get("statements_facts") or data.get("statement_facts") or [],
            "question_prompt": data.get("question_prompt") or data.get("prompt") or "",
            "correct_answer": data.get("correct_answer") or "",
            "explanation": data.get("explanation_text") or data.get("explanation") or "",
        }
        
        _append_options(data.get("options") or [], q_data)
                     
        questions_data.append(q_data)

    if not questions_data:
        raise HTTPException(status_code=404, detail="No content found for the selected items.")

    questions_data = [_normalize_question_parts_for_document(q_data) for q_data in questions_data]

    # Generate PDF
    html_content = f"<html><body><h1>{request.title}</h1>"
    html_content += f"<p>Total Questions: {len(questions_data)}</p><br/>"

    # Section 1: Questions Only
    for i, q_data in enumerate(questions_data):
        html_content += f"<h2>Question {i+1}</h2>"
        if q_data.get("passage_text"):
            if q_data.get("passage_title"):
                html_content += f"<p><b>{clean_text_for_document(q_data.get('passage_title', ''), 'generic')}</b></p>"
            html_content += f"<p>{clean_text_for_document(q_data['passage_text'], 'generic')}</p><br/>"

        if q_data.get("question_statement"):
            html_content += f"<p>{clean_text_for_document(q_data['question_statement'], 'statement')}</p>"
        
        if q_data.get("supplementary_statement"):
            html_content += f"<p>{clean_text_for_document(q_data['supplementary_statement'], 'statement_supp')}</p>"
        
        if q_data.get("statements_facts"):
            html_content += "<ul>"
            statements = q_data["statements_facts"]
            if isinstance(statements, list):
                 for statement in statements:
                    html_content += f"<li>{clean_text_for_document(statement, 'fact')}</li>"
            html_content += "</ul>"
        
        if q_data.get("question_prompt"):
            html_content += f"<p><i>{clean_text_for_document(q_data['question_prompt'], 'prompt')}</i></p>"

        if q_data.get("options"):
            html_content += "<ol style='list-style-type: upper-alpha;'>"
            for option in q_data["options"]:
                txt = option.get('text', '') if isinstance(option, dict) else str(option)
                html_content += f"<li>{clean_text_for_document(txt, 'option')}</li>"
            html_content += "</ol>"
        
        html_content += "<br/><hr/><br/>"

    # Section 2: Answer Key
    html_content += "<div style='page-break-before: always;'></div>"
    html_content += "<h1>Answer Key & Explanations</h1>"
    
    for i, q_data in enumerate(questions_data):
        html_content += f"<h3>Question {i+1}</h3>"
        html_content += f"<p><b>Correct Answer:</b> {clean_text_for_document(str(q_data.get('correct_answer')), 'generic')}</p>"
        if q_data.get("explanation"):
            html_content += f"<p><b>Explanation:</b> {clean_text_for_document(q_data['explanation'], 'explanation')}</p>"
        html_content += "<hr/>"

    html_content += "</body></html>"

    file_stream = io.BytesIO()
    pisa_status = pisa.CreatePDF(html_content, dest=file_stream)
    if pisa_status.err:
        raise HTTPException(status_code=500, detail="Could not generate PDF.")
    file_stream.seek(0)
    
    filename = f"{request.title.replace(' ', '_').lower()}.pdf"
    return StreamingResponse(
        file_stream, 
        media_type="application/pdf", 
        headers={"Content-Disposition": f"attachment; filename={filename}"}
    )

@router.get("/collections/{collection_id}/pdf")
def generate_collection_pdf(
    collection_id: int,
    supabase: Client = Depends(get_supabase_client),
):
    # Fetch collection details
    collection = _fetch_collection(collection_id, supabase)
    title = collection.get("title") or f"Collection {collection_id}"
    
    # Fetch items
    rows = _fetch_collection_items(collection_id, supabase)
    items = [r.get("content_item") for r in rows if r.get("content_item")]
    
    # Construct request for PDF generator
    pdf_req = PDFGenerationRequest(title=title, items=items)
    
    return generate_pdf_from_items(pdf_req, supabase)
