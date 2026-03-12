import os
from supabase import create_client, Client
from dotenv import load_dotenv

load_dotenv()
url = os.environ.get("SUPABASE_URL")
key = os.environ.get("SUPABASE_KEY")
supabase: Client = create_client(url, key)

print("Checking for required tables...")
tables = [
    "premium_ai_quiz_instructions",
    "premium_ai_example_analyses",
    "premium_ai_draft_quizzes",
    "content_items"
]

for table in tables:
    try:
        # Try a simple select to see if it exists
        supabase.table(table).select("*").limit(1).execute()
        print(f"Table '{table}' exists.")
    except Exception as e:
        print(f"Table '{table}' ERROR: {e}")
