import requests
import json

URL = "http://localhost:8002/api/v1/premium/ai/generate"

def test_gen():
    payload = {
        "content_type": "gk_quiz",
        "count": 3,
        "content": "The Constitution of India is the supreme law of India.",
        "quiz_kind": "gk",
        "user_instructions": "Focus on Article 19.",
        # Simulating what frontend might send
        "provider": "gemini", 
        "model": "gemini-1.5-flash"
    }
    
    print(f"Sending request to {URL}...")
    try:
        resp = requests.post(URL, json=payload, timeout=60)
        print(f"Status Code: {resp.status_code}")
        print("Response Body:")
        print(resp.text)
    except Exception as e:
        print(f"Request failed: {e}")

if __name__ == "__main__":
    test_gen()
