import asyncio
import os
from app.ai_logic import generate_quiz_content
from app.models import AIQuizGenerateRequest, QuizKind, AIInstructionType

async def test_gen():
    req = AIQuizGenerateRequest(
        content="The Indian Parliament is the supreme legislative body of the Republic of India.",
        content_type="premium_gk_quiz",
        quiz_kind=QuizKind.GK,
        user_instructions="Focus on Rajya Sabha.",
        count=1,
        provider="gemini",
        model="gemini-3-flash-preview", 
        instruction_type=AIInstructionType.QUIZ_GEN
    )
    
    print("Starting AI generation test with GEMINI...")
    
    try:
        results = await generate_quiz_content(req)
        print("\nResults:")
        import json
        print(json.dumps(results, indent=2))
    except Exception as e:
        print(f"\nFAILED! Error: {e}")

if __name__ == "__main__":
    asyncio.run(test_gen())
