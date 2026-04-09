import unittest
from types import SimpleNamespace
from typing import Any, Dict, List

from app.models import SavePremiumDraftRequest
from app.routers import premium


class FakeQuery:
    def __init__(self, table_name: str, store: Dict[str, List[Dict[str, Any]]]):
        self.table_name = table_name
        self.store = store
        self.rows = list(store.get(table_name, []))
        self.inserted_row: Dict[str, Any] | None = None

    def select(self, _fields: str = "*"):
        return self

    def eq(self, field: str, value: Any):
        self.rows = [row for row in self.rows if row.get(field) == value]
        return self

    def in_(self, field: str, values: List[Any]):
        allowed = set(values)
        self.rows = [row for row in self.rows if row.get(field) in allowed]
        return self

    def order(self, field: str, desc: bool = False):
        self.rows = sorted(self.rows, key=lambda row: row.get(field) or 0, reverse=desc)
        return self

    def limit(self, count: int):
        self.rows = self.rows[:count]
        return self

    def insert(self, payload: Dict[str, Any]):
        next_row = dict(payload)
        next_row.setdefault("id", len(self.store.setdefault(self.table_name, [])) + 1)
        self.store[self.table_name].append(next_row)
        self.inserted_row = next_row
        return self

    def execute(self):
        if self.inserted_row is not None:
            return SimpleNamespace(data=[self.inserted_row])
        return SimpleNamespace(data=list(self.rows))


class FakeSupabase:
    def __init__(self, store: Dict[str, List[Dict[str, Any]]]):
        self.store = store

    def table(self, name: str) -> FakeQuery:
        self.store.setdefault(name, [])
        return FakeQuery(name, self.store)


class CategoryAssignmentTests(unittest.TestCase):
    def test_quiz_inference_uses_category_source_hints(self) -> None:
        supabase = FakeSupabase(
            {
                "categories": [
                    {"id": 1, "name": "Ancient History", "slug": "ancient-history", "parent_id": None, "description": "", "meta": {}, "type": "gk", "is_active": True},
                    {"id": 2, "name": "Geography", "slug": "geography", "parent_id": None, "description": "", "meta": {}, "type": "gk", "is_active": True},
                ],
                "category_ai_sources": [
                    {"id": 10, "category_id": 1, "title": "Mauryan Notes", "source_text": "Ashoka Mauryan empire dhamma administration", "priority": 10, "is_active": True, "meta": {}},
                    {"id": 11, "category_id": 2, "title": "Relief", "source_text": "plateau river monsoon rainfall", "priority": 8, "is_active": True, "meta": {}},
                ],
            }
        )

        resolved = premium._infer_category_ids_for_text(
            "Ashoka's dhamma and Mauryan administration were central to imperial governance.",
            premium.CategoryType.GK.value,
            supabase,
        )

        self.assertEqual(resolved, [1])

    def test_generated_items_can_fall_back_to_source_level_category_match(self) -> None:
        supabase = FakeSupabase(
            {
                "categories": [
                    {"id": 2, "name": "Geography", "slug": "geography", "parent_id": None, "description": "Physical geography", "meta": {"keywords": ["monsoon, plateau, western ghats"]}, "type": "gk", "is_active": True},
                    {"id": 3, "name": "Polity", "slug": "polity", "parent_id": None, "description": "Constitution", "meta": {"keywords": ["parliament, constitution"]}, "type": "gk", "is_active": True},
                ],
                "category_ai_sources": [
                    {"id": 21, "category_id": 2, "title": "Climate", "source_text": "Indian monsoon western ghats orographic rainfall", "priority": 10, "is_active": True, "meta": {}},
                ],
            }
        )

        items = [
            {
                "question_statement": "Which of the following statements is correct?",
                "options": [{"label": "A", "text": "Statement 1"}, {"label": "B", "text": "Statement 2"}],
                "correct_answer": "A",
            }
        ]

        resolved = premium._assign_category_ids_to_generated_items(
            items,
            quiz_kind=premium.QuizKind.GK,
            supabase=supabase,
            source_text="The Indian monsoon and western ghats shape orographic rainfall patterns.",
        )

        self.assertEqual(resolved[0]["category_ids"], [2])
        self.assertEqual(resolved[0]["premium_gk_category_ids"], [2])

    def test_mains_inference_uses_mains_category_sources(self) -> None:
        supabase = FakeSupabase(
            {
                "mains_categories": [
                    {"id": 11, "name": "Agriculture", "slug": "agriculture", "parent_id": None, "description": "", "meta": {}, "is_active": True},
                    {"id": 12, "name": "Governance", "slug": "governance", "parent_id": None, "description": "", "meta": {}, "is_active": True},
                ],
                "mains_category_sources": [
                    {"id": 30, "mains_category_id": 11, "title": "Farm Policy", "source_text": "MSP procurement crop diversification irrigation", "priority": 9, "is_active": True, "meta": {}},
                    {"id": 31, "mains_category_id": 12, "title": "Institutions", "source_text": "civil service accountability transparency", "priority": 8, "is_active": True, "meta": {}},
                ],
            }
        )

        resolved = premium._infer_mains_category_ids_for_text(
            "Discuss the role of MSP, procurement, and crop diversification in Indian agriculture.",
            supabase,
        )

        self.assertEqual(resolved, [11])

    def test_save_draft_preserves_inferred_categories_when_request_is_empty(self) -> None:
        supabase = FakeSupabase(
            {
                "categories": [
                    {"id": 1, "name": "Ancient History", "slug": "ancient-history", "parent_id": None, "description": "", "meta": {"keywords": ["Mauryan, Ashoka"]}, "type": "gk", "is_active": True},
                ],
                "category_ai_sources": [],
                premium.DRAFT_QUIZZES_TABLE: [],
            }
        )

        payload = SavePremiumDraftRequest(
            parsed_quiz_data={
                "questions": [
                    {
                        "question_statement": "Which Mauryan ruler popularized dhamma inscriptions across the empire?",
                        "options": [
                            {"label": "A", "text": "Ashoka"},
                            {"label": "B", "text": "Bindusara"},
                        ],
                        "correct_answer": "A",
                    }
                ]
            },
            category_ids=[],
        )

        draft = premium._save_draft_quiz(
            premium.QuizKind.GK,
            payload,
            supabase,
            author_id="user-1",
        )

        self.assertEqual(draft["category_ids"], [1])


if __name__ == "__main__":
    unittest.main()
