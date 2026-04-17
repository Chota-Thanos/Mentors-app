"""
Agora Live Room Router
POST /live/token     — generate an Agora RTC token for a room
POST /live/rooms     — create a live room (creator only)
PATCH /live/rooms/{id}/status — update room status (start/end)
GET  /live/rooms/{id}         — get room details
"""

import logging
import time
from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel

from ..auth import ProfileRow, require_auth, require_creator
from ..config import get_settings
from ..db import get_admin_client

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/live", tags=["Live Rooms"])
_settings = get_settings()

TOKEN_EXPIRY_SECONDS = 3600 * 4  # 4 hours


def _generate_agora_token(channel: str, uid: int, role: str = "publisher") -> str:
    """Generate an Agora RTC token using agora-token-builder."""
    try:
        from agora_token_builder import RtcTokenBuilder, Role_Publisher, Role_Subscriber
        expiry = int(time.time()) + TOKEN_EXPIRY_SECONDS
        role_value = Role_Publisher if role == "publisher" else Role_Subscriber
        token = RtcTokenBuilder.buildTokenWithUid(
            _settings.agora_app_id,
            _settings.agora_app_certificate,
            channel,
            uid,
            role_value,
            expiry,
        )
        return token
    except Exception as exc:
        logger.error("Agora token generation failed: %s", exc)
        raise HTTPException(status.HTTP_503_SERVICE_UNAVAILABLE, "Could not generate live token")


# ── Schemas ────────────────────────────────────────────────────────────────────

class TokenRequest(BaseModel):
    room_id: int
    role: str = "subscriber"   # 'publisher' | 'subscriber'


class CreateRoomRequest(BaseModel):
    series_id: int | None = None
    unit_step_id: int | None = None
    title: str
    description: str | None = None
    scheduled_for: str | None = None


class UpdateRoomStatusRequest(BaseModel):
    status: str   # 'live' | 'ended' | 'cancelled'


# ── Routes ─────────────────────────────────────────────────────────────────────

@router.post("/token")
async def get_live_token(
    body: TokenRequest,
    profile: ProfileRow = Depends(require_auth),
):
    """Generate an Agora RTC token for the user to join a room."""
    if not _settings.agora_app_id or not _settings.agora_app_certificate:
        raise HTTPException(503, "Agora not configured")

    admin = get_admin_client()
    room = admin.table("live_rooms").select("agora_channel_name,status,series_id").eq("id", body.room_id).single().execute()
    if not room.data:
        raise HTTPException(404, "Room not found")

    room_data = room.data
    if room_data["status"] not in ("scheduled", "live"):
        raise HTTPException(403, "Room is not active")

    # Check series access
    if room_data.get("series_id"):
        access = admin.rpc("can_access_test_series", {"target_id": room_data["series_id"]}).execute()
        if not (access.data or profile.is_moderator):
            raise HTTPException(403, "You do not have access to this live class")

    # Determine role: creator of the series = publisher, others = subscriber
    role = body.role
    if profile.is_moderator:
        role = "publisher"

    token = _generate_agora_token(
        channel=room_data["agora_channel_name"],
        uid=profile.id,
        role=role,
    )

    return {
        "token": token,
        "channel": room_data["agora_channel_name"],
        "uid": profile.id,
        "app_id": _settings.agora_app_id,
        "role": role,
    }


@router.post("/rooms")
async def create_live_room(
    body: CreateRoomRequest,
    profile: ProfileRow = Depends(require_creator),
):
    """Create a new live room (creator/admin only)."""
    import uuid
    admin = get_admin_client()

    channel_name = f"room-{uuid.uuid4().hex[:12]}"

    row = {
        "title": body.title,
        "description": body.description,
        "series_id": body.series_id,
        "unit_step_id": body.unit_step_id,
        "agora_channel_name": channel_name,
        "status": "scheduled",
        "created_by": profile.id,
    }
    if body.scheduled_for:
        row["scheduled_for"] = body.scheduled_for

    resp = admin.table("live_rooms").insert(row).execute()
    return resp.data[0]


@router.patch("/rooms/{room_id}/status")
async def update_room_status(
    room_id: int,
    body: UpdateRoomStatusRequest,
    profile: ProfileRow = Depends(require_auth),
):
    """Update a live room's status (only the room's creator or admin)."""
    admin = get_admin_client()
    room = admin.table("live_rooms").select("created_by,status").eq("id", room_id).single().execute()
    if not room.data:
        raise HTTPException(404, "Room not found")

    if room.data["created_by"] != profile.id and not profile.is_moderator:
        raise HTTPException(403, "Only the room creator can update status")

    from datetime import datetime, timezone
    now = datetime.now(timezone.utc).isoformat()
    update = {"status": body.status}
    if body.status == "live":
        update["started_at"] = now
    elif body.status in ("ended", "cancelled"):
        update["ended_at"] = now

    resp = admin.table("live_rooms").update(update).eq("id", room_id).execute()
    return resp.data[0]


@router.get("/rooms/{room_id}")
async def get_room(room_id: int, profile: ProfileRow = Depends(require_auth)):
    """Get live room details."""
    admin = get_admin_client()
    room = admin.table("live_rooms").select("*").eq("id", room_id).single().execute()
    if not room.data:
        raise HTTPException(404, "Room not found")
    return room.data
