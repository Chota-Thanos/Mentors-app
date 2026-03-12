import os
from supabase import create_client, Client
from dotenv import load_dotenv

# Load environment variables
load_dotenv()

# We access these from os.environ
url: str = os.environ.get("SUPABASE_URL", "")
key: str = os.environ.get("SUPABASE_KEY", "")

def get_supabase_client() -> Client:
    """Create a fresh Supabase client per dependency resolution.

    Reusing one long-lived client across the whole process can leave us with
    stale pooled HTTP connections, which show up intermittently as
    httpx.RemoteProtocolError: Server disconnected.
    """
    if not url or not key:
        raise RuntimeError("SUPABASE_URL or SUPABASE_KEY is not configured.")
    return create_client(url, key)
