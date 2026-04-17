"""
Analytics Router — rebuild performance snapshots after quiz attempts.
POST /analytics/rebuild-snapshot   — recalculate user performance for a domain/category
GET  /analytics/me                 — get current user's full performance summary
GET  /analytics/weak-areas         — get AI-tagged weak areas
"""

import logging
from fastapi import APIRouter, Depends, BackgroundTasks
from pydantic import BaseModel

from ..auth import ProfileRow, require_auth
from ..db import get_admin_client

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/analytics", tags=["Analytics"])


# ── Snapshot rebuild ────────────────────────────────────────────────────────────

def _rebuild_snapshot(user_id: int, quiz_domain: str, category_id: int | None = None):
    """
    Recompute accuracy stats from quiz_attempt_answers and upsert into
    user_performance_snapshots. Runs in background after each attempt.
    """
    admin = get_admin_client()

    # Build query
    query = (
        admin.table("quiz_attempt_answers")
        .select("is_correct,is_skipped,time_spent_secs,category_id,attempt_id")
        .eq("quiz_domain", quiz_domain) if False  # placeholder — see below
        else admin.table("quiz_attempt_answers")
        .select("is_correct,is_skipped,time_spent_secs,category_id")
    )

    # Filter by user via test_attempts join using admin RPC
    answers_resp = admin.rpc("get_user_answers_for_snapshot", {
        "p_user_id": user_id,
        "p_domain": quiz_domain,
        "p_category_id": category_id,
    }).execute()

    if not answers_resp.data:
        return

    answers = answers_resp.data
    total = len(answers)
    correct = sum(1 for a in answers if a.get("is_correct"))
    incorrect = sum(1 for a in answers if not a.get("is_correct") and not a.get("is_skipped"))
    skipped = sum(1 for a in answers if a.get("is_skipped"))
    times = [a["time_spent_secs"] for a in answers if a.get("time_spent_secs")]
    accuracy = round((correct / max(total - skipped, 1)) * 100, 2) if total > 0 else 0.0
    avg_time = round(sum(times) / len(times), 2) if times else None

    from datetime import datetime, timezone
    snapshot = {
        "user_id": user_id,
        "quiz_domain": quiz_domain,
        "category_id": category_id,
        "total_attempts": total,
        "total_questions": total,
        "correct_count": correct,
        "incorrect_count": incorrect,
        "skipped_count": skipped,
        "accuracy": accuracy,
        "avg_time_secs": avg_time,
        "last_attempted": datetime.now(timezone.utc).isoformat(),
        "updated_at": datetime.now(timezone.utc).isoformat(),
    }

    admin.table("user_performance_snapshots").upsert(
        snapshot, on_conflict="user_id,quiz_domain,category_id"
    ).execute()

    # Tag as weak area if accuracy < 50%
    if accuracy < 50 and category_id:
        severity = "critical" if accuracy < 30 else "moderate"
        admin.table("user_weak_areas").upsert({
            "user_id": user_id,
            "category_id": category_id,
            "quiz_domain": quiz_domain,
            "accuracy": accuracy,
            "severity": severity,
            "generated_at": datetime.now(timezone.utc).isoformat(),
        }, on_conflict="user_id,category_id,quiz_domain").execute()


# ── Schemas ────────────────────────────────────────────────────────────────────

class RebuildRequest(BaseModel):
    quiz_domain: str
    category_id: int | None = None


# ── Routes ─────────────────────────────────────────────────────────────────────

@router.post("/rebuild-snapshot")
async def rebuild_snapshot(
    body: RebuildRequest,
    background_tasks: BackgroundTasks,
    profile: ProfileRow = Depends(require_auth),
):
    """Queue a background rebuild of the user's performance snapshot."""
    background_tasks.add_task(
        _rebuild_snapshot,
        profile.id,
        body.quiz_domain,
        body.category_id,
    )
    return {"message": "Snapshot rebuild queued", "domain": body.quiz_domain}


@router.get("/me")
async def get_my_analytics(profile: ProfileRow = Depends(require_auth)):
    """Get current user's performance snapshots across all domains."""
    admin = get_admin_client()
    resp = (
        admin.table("user_performance_snapshots")
        .select("*, categories(name,domain)")
        .eq("user_id", profile.id)
        .order("accuracy", desc=False)   # worst first
        .execute()
    )
    return {"snapshots": resp.data or []}


@router.get("/weak-areas")
async def get_weak_areas(profile: ProfileRow = Depends(require_auth)):
    """Get user's AI-tagged weak areas."""
    admin = get_admin_client()
    resp = (
        admin.table("user_weak_areas")
        .select("*, categories(name,domain)")
        .eq("user_id", profile.id)
        .order("severity", desc=True)
        .execute()
    )
    return {"weak_areas": resp.data or []}
