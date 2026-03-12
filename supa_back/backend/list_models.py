import google.generativeai as genai
import os
from dotenv import load_dotenv

load_dotenv()
genai.configure(api_key=os.getenv("GEMINI_API_KEY"))

print("Detailed list of Gemini models:")
try:
    for m in genai.list_models():
        print(f"Name: {m.name}")
        print(f"  Methods: {m.supported_generation_methods}")
        print(f"  Description: {m.description}")
except Exception as e:
    print(f"Failed to list models: {e}")
