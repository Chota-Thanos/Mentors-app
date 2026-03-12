
import os
import time
from supabase import create_client, Client
from dotenv import load_dotenv

load_dotenv()

url: str = os.environ.get("SUPABASE_URL")
key: str = os.environ.get("SUPABASE_KEY")

if not url or not key:
    print("Error: SUPABASE_URL or SUPABASE_KEY not found in .env")
    exit(1)

supabase: Client = create_client(url, key)

email = "admin@upsc.com"
password = "admin123"

def create_admin():
    print(f"Attempting to create/update admin user: {email}")
    
    # 1. Try to find the user first
    user_id = None
    try:
        # List users (defaults to page 1, which should be fine for now)
        # Note: gotrue-py structure for list_users return value might vary by version
        # It typically returns a UserList object or list of users
        response = supabase.auth.admin.list_users()
        # Check if response is a list or object with .users
        users = response.users if hasattr(response, 'users') else response
        
        for u in users:
            if u.email == email:
                user_id = u.id
                break
    except Exception as e:
        print(f"Warning: Could not list users. Error: {e}")

    if user_id:
        print(f"User already exists ({user_id}). Updating role to admin...")
        try:
            supabase.auth.admin.update_user_by_id(
                user_id, 
                {
                    "app_metadata": {"role": "admin", "admin": True},
                    "password": password  # Update password to ensure we know it
                }
            )
            print("Admin user updated successfully.")
        except Exception as e:
            print(f"Error updating admin user: {e}")
    else:
        print("User not found. Creating new admin user...")
        try:
            attributes = {
                "email": email,
                "password": password,
                "email_confirm": True,
                "user_metadata": {"full_name": "Admin User"},
                "app_metadata": {"role": "admin", "admin": True}
            }
            # Determine if this version of library supports this signature
            response = supabase.auth.admin.create_user(attributes)
            print(f"Admin user created successfully. ID: {response.user.id}")
        except Exception as e:
            print(f"Error creating admin user: {e}")

if __name__ == "__main__":
    create_admin()
