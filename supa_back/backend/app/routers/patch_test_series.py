import re
import os

filepath = "e:/Working projects/new-app/quiz-parser-test/upsc-app/supa_back/backend/app/routers/test_series.py"
with open(filepath, "r", encoding="utf-8") as f:
    code = f.read()

ZOOM_CODE_APPENDIX = """

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

"""

if "handle_zoom_webhook" not in code:
    with open(filepath, "a", encoding="utf-8") as f:
        f.write(ZOOM_CODE_APPENDIX)
    print("Appended zoom routes.")

    with open(filepath, "r", encoding="utf-8") as f:
        code = f.read()

# Pattern for _schedule_mentorship_request_with_slot and start_mentorship_request_now:
# Find:
#     if existing_session:
#         session_row = _first(
# Replace with:
#     try:
#         session_payload = _provision_call_provider_session(session_payload, provider_user_id, supabase)
#     except Exception as e:
#         raise HTTPException(status_code=400, detail=str(e))
#
#     if existing_session:
#         session_row = _first(

pattern1 = re.compile(
    r'    if existing_session:\n        session_row = _first\(',
    re.MULTILINE
)

def patch_str(match):
    return """
    try:
        session_payload = _provision_call_provider_session(session_payload, provider_user_id, supabase)
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))

    """ + match.group(0).lstrip("\n")

if "session_payload = _provision_call_provider_session" not in code:
    code = pattern1.sub(patch_str, code)
    with open(filepath, "w", encoding="utf-8") as f:
        f.write(code)
    print("Patched payload provisioning.")
else:
    print("Already patched.")

