import unittest

from app.ai_logic import _normalize_items
from app.models import AIInstructionType, AIQuizGenerateRequest, QuizKind


def build_request(example_questions: list[str] | None = None) -> AIQuizGenerateRequest:
    return AIQuizGenerateRequest(
        content="Source content",
        content_type="premium_gk_quiz",
        quiz_kind=QuizKind.GK,
        instruction_type=AIInstructionType.QUIZ_GEN,
        count=1,
        example_questions=example_questions,
    )


class QuestionFieldMappingTests(unittest.TestCase):
    def test_keeps_question_statement_when_it_is_the_actual_ask(self) -> None:
        request = build_request(
            [
                "Consider the following statements:\n"
                "1. Statement one.\n"
                "2. Statement two.\n"
                "Which of the statements given above is/are correct?"
            ]
        )
        normalized = _normalize_items(
            [
                {
                    "question_statement": "Which of the statements given above is/are correct?",
                    "statements_facts": [
                        "1. Statement one.",
                        "2. Statement two.",
                    ],
                    "options": [
                        {"label": "A", "text": "1 only"},
                        {"label": "B", "text": "2 only"},
                        {"label": "C", "text": "Both 1 and 2"},
                        {"label": "D", "text": "Neither 1 nor 2"},
                    ],
                    "correct_answer": "C",
                }
            ],
            AIInstructionType.QUIZ_GEN,
            request=request,
        )

        self.assertEqual(len(normalized), 1)
        question = normalized[0]
        self.assertEqual(
            question["question_statement"],
            "Which of the statements given above is/are correct?",
        )
        self.assertIsNone(question["question_prompt"])
        self.assertEqual(
            question["statements_facts"],
            [
                "1. Statement one.",
                "2. Statement two.",
            ],
        )

    def test_splits_inline_statement_structure_without_rewriting_text(self) -> None:
        normalized = _normalize_items(
            [
                {
                    "question_statement": (
                        "Consider the following statements:\n"
                        "1. Statement one.\n"
                        "2. Statement two.\n"
                        "Which of the statements given above is/are correct?"
                    ),
                    "options": [
                        {"label": "A", "text": "1 only"},
                        {"label": "B", "text": "2 only"},
                        {"label": "C", "text": "Both 1 and 2"},
                        {"label": "D", "text": "Neither 1 nor 2"},
                    ],
                    "correct_answer": "C",
                }
            ],
            AIInstructionType.QUIZ_GEN,
            request=build_request(),
        )

        self.assertEqual(len(normalized), 1)
        question = normalized[0]
        self.assertEqual(question["question_statement"], "Consider the following statements:")
        self.assertEqual(
            question["statements_facts"],
            [
                "1. Statement one.",
                "2. Statement two.",
            ],
        )
        self.assertEqual(
            question["question_prompt"],
            "Which of the statements given above is/are correct?",
        )


if __name__ == "__main__":
    unittest.main()
