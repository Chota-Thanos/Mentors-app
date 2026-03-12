import os
import time
import uuid
import json
import base64
import hmac
import hashlib
from typing import Dict, Any, Optional, Tuple
from urllib.request import Request, urlopen
from urllib.error import HTTPError
from urllib.parse import urlencode
from datetime import datetime, timezone
from fastapi import HTTPException
from supabase import Client

ZOOM_CLIENT_ID = os.getenv("ZOOM_CLIENT_ID", "")
ZOOM_CLIENT_SECRET = os.getenv("ZOOM_CLIENT_SECRET", "")
ZOOM_SDK_KEY = os.getenv("ZOOM_SDK_KEY", "")
ZOOM_SDK_SECRET = os.getenv("ZOOM_SDK_SECRET", "")
ZOOM_WEBHOOK_SECRET = os.getenv("ZOOM_WEBHOOK_SECRET", "")

ZOOM_AUTHORIZE_URL = "https://zoom.us/oauth/authorize"
ZOOM_TOKEN_URL = "https://zoom.us/oauth/token"
ZOOM_API_ROOT = "https://api.zoom.us/v2"

MENTOR_ZOOM_CONNECTIONS_TABLE = "mentor_zoom_connections"
MENTORSHIP_SESSIONS_TABLE = "mentorship_sessions"

def _zoom_request(method: str, url: str, headers: Dict[str, str] = None, data: Any = None) -> Dict[str, Any]:
    req = Request(url, method=method)
    if headers:
        for k, v in headers.items():
            req.add_header(k, v)
    body = None
    if data:
        if isinstance(data, dict):
            body = json.dumps(data).encode("utf-8")
            req.add_header("Content-Type", "application/json")
        else:
            body = data
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

def refresh_zoom_token(user_id: str, supabase: Client) -> Dict[str, Any]:
    # Need _first() and _utc_now_iso() from globals, but simulating here
    pass

def generate_zoom_sdk_signature(session_name: str, role: int = 0) -> str:
    iat = int(time.time()) - 30
    exp = iat + 60 * 60 * 24
    header = {"alg": "HS256", "typ": "JWT"}
    payload = {
        "app_key": ZOOM_SDK_KEY,
        "tpc": session_name,
        "role_type": role,
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
    return f"{encoded_header}.{encoded_payload}.{base64url_encode(signature)}"
