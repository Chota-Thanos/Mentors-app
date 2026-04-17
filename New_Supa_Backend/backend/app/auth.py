"""
Auth dependencies for FastAPI routes.

Every protected endpoint declares:
    current_profile: ProfileRow = Depends(require_auth)

This:
  1. Reads the Bearer JWT from the Authorization header
  2. Verifies it against Supabase
  3. Resolves the row in `public.profiles` (gives us profile.id, profile.role)
  4. Injects it into the route handler
"""

from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from supabase import Client

from .db import get_anon_client, get_admin_client

bearer_scheme = HTTPBearer(auto_error=False)


class ProfileRow:
    """Lightweight profile object injected into route handlers."""

    def __init__(self, data: dict):
        self.id: int = data["id"]
        self.auth_user_id: str = data["auth_user_id"]
        self.role: str = data.get("role", "user")
        self.full_name: str = data.get("full_name", "")
        self.email: str = data.get("email", "")
        self._raw = data

    @property
    def is_admin(self) -> bool:
        return self.role == "admin"

    @property
    def is_moderator(self) -> bool:
        return self.role in ("admin", "moderator")

    @property
    def is_prelims_expert(self) -> bool:
        return self.role in ("admin", "prelims_expert")

    @property
    def is_mains_expert(self) -> bool:
        return self.role in ("admin", "mains_expert")

    @property
    def is_creator(self) -> bool:
        return self.role in ("admin", "moderator", "prelims_expert", "mains_expert")


async def _resolve_profile(token: str) -> ProfileRow:
    """Verify JWT and fetch the profile row."""
    admin = get_admin_client()

    # Verify token with Supabase auth
    try:
        user_resp = admin.auth.get_user(token)
        auth_user = user_resp.user
        if not auth_user:
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Invalid or expired token",
            )
    except Exception:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Token verification failed",
        )

    # Fetch profile row
    resp = (
        admin.table("profiles")
        .select("*")
        .eq("auth_user_id", auth_user.id)
        .single()
        .execute()
    )
    if not resp.data:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Profile not found. Complete onboarding first.",
        )

    return ProfileRow(resp.data)


async def require_auth(
    credentials: HTTPAuthorizationCredentials = Depends(bearer_scheme),
) -> ProfileRow:
    """Dependency: requires a valid Supabase JWT. Returns the profile row."""
    if not credentials or not credentials.credentials:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Authorization header missing",
            headers={"WWW-Authenticate": "Bearer"},
        )
    return await _resolve_profile(credentials.credentials)


async def require_admin(profile: ProfileRow = Depends(require_auth)) -> ProfileRow:
    """Dependency: requires admin or moderator role."""
    if not profile.is_moderator:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Requires admin or moderator role",
        )
    return profile


async def require_creator(profile: ProfileRow = Depends(require_auth)) -> ProfileRow:
    """Dependency: requires any creator role (prelims_expert, mains_expert, admin)."""
    if not profile.is_creator:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Requires creator role",
        )
    return profile


async def optional_auth(
    credentials: HTTPAuthorizationCredentials = Depends(bearer_scheme),
) -> ProfileRow | None:
    """Dependency: auth is optional. Returns profile if token present, else None."""
    if not credentials or not credentials.credentials:
        return None
    try:
        return await _resolve_profile(credentials.credentials)
    except HTTPException:
        return None
