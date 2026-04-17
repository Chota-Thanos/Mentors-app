"""
Supabase client factory.

Two clients:
  - anon_client : uses the anon key, respects RLS (for operations proxied on
                  behalf of a user after we've set their JWT)
  - admin_client: uses the service role key, bypasses RLS (server-side writes
                  like granting access after a successful payment)
"""

from supabase import create_client, Client
from .config import get_settings

_settings = get_settings()


def get_anon_client() -> Client:
    """Fresh anon client per request (avoids stale connections)."""
    return create_client(_settings.supabase_url, _settings.supabase_anon_key)


def get_admin_client() -> Client:
    """Service-role client — bypasses RLS. Use only for trusted server logic."""
    return create_client(_settings.supabase_url, _settings.supabase_service_key)
