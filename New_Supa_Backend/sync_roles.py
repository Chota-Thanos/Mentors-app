import asyncio
from backend.app.db import get_admin_client

async def sync():
    admin = get_admin_client()
    
    # 1. Fetch all profiles
    print("Fetching profiles...")
    resp = admin.table("profiles").select("auth_user_id, role").execute()
    profiles = resp.data
    
    print(f"Found {len(profiles)} profiles to sync.")
    
    # 2. Iterate and update auth.users metadata
    for p in profiles:
        uid = p["auth_user_id"]
        role = p["role"]
        
        try:
            # Update user via Auth Admin API
            admin.auth.admin.update_user_by_id(
                uid,
                attributes={
                    "app_metadata": {"role": role}
                }
            )
            print(f"Synced role '{role}' for user {uid}")
        except Exception as e:
            print(f"Failed to sync user {uid}: {e}")
            
    print("Sync complete.")

if __name__ == "__main__":
    asyncio.run(sync())
