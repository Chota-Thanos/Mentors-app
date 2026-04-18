
from supabase import create_client
import os

url = os.environ.get("SUPABASE_URL")
key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY")
supabase = create_client(url, key)

email = "simplifyprep@gmail.com"
print(f"--- Investigating user: {email} ---")

# 1. Check Profile
profile = supabase.table("profiles").select("*").eq("email", email).execute()
if profile.data:
    p = profile.data[0]
    print(f"Profile found: ID={p['id']}, Role={p['role']}, Verified={p['is_verified']}")
    
    # 2. Check Applications for this profile ID
    apps = supabase.table("creator_applications").select("*").eq("user_id", p['id']).execute()
    if apps.data:
        for a in apps.data:
            print(f"Application: ID={a['id']}, Status={a['status']}, DesiredRole={a['desired_role']}")
    else:
        print("No applications found for this profile ID.")
else:
    print("Profile not found.")
