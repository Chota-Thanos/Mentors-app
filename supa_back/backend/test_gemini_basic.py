import google.generativeai as genai
import os
from dotenv import load_dotenv

load_dotenv()
genai.configure(api_key=os.getenv("GEMINI_API_KEY"))

model = genai.GenerativeModel('gemini-1.5-flash')
try:
    response = model.generate_content("Say hello")
    print(f"Response: {response.text}")
except Exception as e:
    print(f"Failed with gemini-1.5-flash: {e}")

model2 = genai.GenerativeModel('models/gemini-3-flash-preview')
try:
    response = model2.generate_content("Say hello")
    print(f"Response: {response.text}")
except Exception as e:
    print(f"Failed with gemini-3-flash-preview: {e}")
