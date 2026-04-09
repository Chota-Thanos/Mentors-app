import logging
import uuid
from typing import Any, Dict, List, Optional
from fastapi import APIRouter, Depends, HTTPException, Body
from supabase import Client

from ..models import (
    AIGenerateQuizRequest,
    AIQuizGenerateRequest,
    PremiumPreviewResponse,
    QuizKind,
    AISystemInstructionContentType,
    AIInstructionType,
    AIProvider,
    PremiumAIExampleAnalysis,
    PremiumAIExampleAnalysisCreate,
    PremiumAIExampleAnalysisUpdate,
    PremiumAIExampleAnalysisListResponse,
    PremiumAIDraftQuiz,
    SavePremiumDraftRequest,
    ContentType,
    ConvertDraftToPremiumQuizResponse,
    ConvertDraftToPremiumQuizRequest,
)
from ..ai_logic import generate_quiz_content
from ..supabase_client import get_supabase_client

router = APIRouter(prefix="/api/v1/premium-ai-quizzes", tags=["Premium AI Quizzes"])
logger = logging.getLogger(__name__)

# --- Helpers ---

def _rows(response: Any) -> List[Dict[str, Any]]:
    data = getattr(response, "data", None)
    if isinstance(data, list):
        return data
    if isinstance(data, dict):
        return [data]
    return []

def _first(response: Any) -> Optional[Dict[str, Any]]:
    rows = _rows(response)
    return rows[0] if rows else None

def _parse_content_type(value: Any) -> AISystemInstructionContentType:
    try:
        if hasattr(value, "value"):
            return AISystemInstructionContentType(value.value)
        return AISystemInstructionContentType(str(value))
    except Exception:
        return AISystemInstructionContentType.PREMIUM_GK_QUIZ


def _normalize_exam_ids(raw_ids: Any) -> List[int]:
    values: List[int] = []
    if raw_ids is None:
        return values
    if isinstance(raw_ids, (str, bytes)):
        raw_values = str(raw_ids).split(",")
    elif isinstance(raw_ids, list):
        raw_values = raw_ids
    else:
        raw_values = [raw_ids]
    for item in raw_values:
        try:
            parsed = int(item)
        except (TypeError, ValueError):
            continue
        if parsed > 0 and parsed not in values:
            values.append(parsed)
    return values


def _validate_exam_ids(exam_ids: List[int], supabase: Client) -> List[int]:
    normalized_exam_ids = _normalize_exam_ids(exam_ids)
    if not normalized_exam_ids:
        return []
    rows = _rows(
        supabase.table("exams")
        .select("id")
        .in_("id", normalized_exam_ids)
        .execute()
    )
    valid_ids = sorted({int(row.get("id") or 0) for row in rows if int(row.get("id") or 0) > 0})
    missing_ids = [exam_id for exam_id in normalized_exam_ids if exam_id not in valid_ids]
    if missing_ids:
        raise HTTPException(status_code=404, detail=f"Exam IDs not found: {missing_ids}")
    return normalized_exam_ids

def _example_analysis_view(row: Dict[str, Any]) -> Dict[str, Any]:
    return {
        "id": int(row["id"]),
        "title": str(row.get("title") or ""),
        "description": row.get("description"),
        "tag_level1": row.get("tag_level1"),
        "tag_level2": row.get("tag_level2"),
        "content_type": _parse_content_type(row.get("content_type")),
        "style_profile": row.get("style_profile") or {},
        "example_questions": row.get("example_questions") or [],
        "tags": row.get("tags") or [],
        "exam_ids": _normalize_exam_ids(row.get("exam_ids")),
        "is_active": bool(row.get("is_active", True)),
        "author_id": row.get("author_id"),
        "created_at": str(row.get("created_at") or ""),
        "updated_at": str(row.get("updated_at") or ""),
    }

def _draft_view(row: Dict[str, Any]) -> Dict[str, Any]:
    content_type_val = row.get("content_type")
    # Try to parse content_type, default to Premium GK
    try:
        content_type = AISystemInstructionContentType(content_type_val)
    except Exception:
        content_type = AISystemInstructionContentType.PREMIUM_GK_QUIZ
        
    # Infer quiz_kind from content_type or row
    quiz_kind_val = row.get("quiz_kind")
    if quiz_kind_val:
        try:
             quiz_kind = QuizKind(quiz_kind_val)
        except:
             quiz_kind = QuizKind.GK
    else:
         if "math" in content_type.value: quiz_kind = QuizKind.MATHS
         elif "passage" in content_type.value: quiz_kind = QuizKind.PASSAGE
         else: quiz_kind = QuizKind.GK

    return {
        "id": int(row["id"]),
        "quiz_kind": quiz_kind,
        "content_type": content_type,
        "parsed_quiz_data": row.get("parsed_quiz_data") or {},
        "category_ids": row.get("category_ids") or [],
        "exam_id": row.get("exam_id"),
        "ai_instruction_id": row.get("ai_instruction_id"),
        "source_url": row.get("source_url"),
        "source_pdf_id": row.get("source_pdf_id"),
        "notes": row.get("notes"),
        "created_at": str(row.get("created_at") or ""),
        "updated_at": str(row.get("updated_at") or "") or None,
    }

def _normalize_label(value: Optional[str]) -> str:
    label = (value or "").strip().upper()
    if label in {"A", "B", "C", "D", "E"}:
        return label
    return label[:1] if label else "A"


# --- Endpoints ---

@router.post("/preview/{quiz_kind}", response_model=PremiumPreviewResponse)
async def preview_ai_quiz(
    quiz_kind: str,
    payload: AIGenerateQuizRequest,
    supabase: Client = Depends(get_supabase_client)
):
    count = payload.desired_question_count or 5
    content_type_val = payload.content_type.value if hasattr(payload.content_type, 'value') else str(payload.content_type)
    
    try:
        kind_enum = QuizKind(quiz_kind.lower())
    except ValueError:
         kind_enum = QuizKind.GK

    instruction_override = None
    if payload.ai_instruction_id:
         res = supabase.table("ai_instructions").select("*").eq("id", payload.ai_instruction_id).execute()
         if _rows(res):
             row = _rows(res)[0]
             instruction_override = {
                 "system_prompt": row.get("system_prompt"),
                 "user_prompt_template": row.get("user_prompt_template")
             }
    
    provider_str = "gemini"
    if payload.ai_provider:
        if hasattr(payload.ai_provider, 'value'):
            provider_str = payload.ai_provider.value
        else:
            provider_str = str(payload.ai_provider)

    internal_req = AIQuizGenerateRequest(
        content=payload.content or "",
        content_type=content_type_val,
        quiz_kind=kind_enum,
        user_instructions=payload.user_instructions,
        formatting_instruction_text=payload.formatting_instruction_text,
        example_questions=payload.example_questions,
        recent_questions=payload.recent_questions,
        instruction_type=AIInstructionType.QUIZ_GEN,
        instruction_id=payload.ai_instruction_id,
        provider=provider_str,
        model=payload.ai_model_name or "gemini-3-flash-preview",
        category_id=None,
        count=count,
        url=payload.url,
        uploaded_pdf_id=payload.uploaded_pdf_id,
        save_to_collection_id=None
    )

    items = await generate_quiz_content(internal_req, instruction_override=instruction_override)
    
    if len(items) == 0:
        return PremiumPreviewResponse(parsed_quiz_data={})

    # For AIStudio preview, typically return the first item or the passage object
    return PremiumPreviewResponse(parsed_quiz_data=items[0])


@router.get("/example-analyses", response_model=PremiumAIExampleAnalysisListResponse)
def list_example_analyses(
    content_type: Optional[str] = None,
    include_admin: bool = False,
    limit: int = 100,
    offset: int = 0,
    supabase: Client = Depends(get_supabase_client),
):
    query = supabase.table("premium_ai_example_analyses").select("*").range(offset, offset + limit - 1).order("created_at", desc=True)
    
    if content_type:
         query = query.eq("content_type", content_type)
    
    # active filter? mostly yes.
    # if not include_admin: query = query.eq("is_active", True)
    
    data = _rows(query.execute())
    items = [_example_analysis_view(row) for row in data]
    return PremiumAIExampleAnalysisListResponse(items=items, total=len(items))


@router.post("/example-analyses", response_model=PremiumAIExampleAnalysis)
def create_example_analysis(
    payload: PremiumAIExampleAnalysisCreate,
    supabase: Client = Depends(get_supabase_client)
):
    data = payload.model_dump()
    if hasattr(payload.content_type, 'value'):
        data["content_type"] = payload.content_type.value
    data["exam_ids"] = _validate_exam_ids(payload.exam_ids, supabase)
    
    row = _first(supabase.table("premium_ai_example_analyses").insert(data).execute())
    if not row:
        raise HTTPException(status_code=400, detail="Failed to create analysis")
    return _example_analysis_view(row)


@router.put("/example-analyses/{analysis_id}", response_model=PremiumAIExampleAnalysis)
def update_example_analysis(
    analysis_id: int,
    payload: PremiumAIExampleAnalysisUpdate,
    supabase: Client = Depends(get_supabase_client)
):
    updates = payload.model_dump(exclude_unset=True)
    if "content_type" in updates and hasattr(updates["content_type"], 'value'):
         updates["content_type"] = updates["content_type"].value
    if "exam_ids" in updates:
         updates["exam_ids"] = _validate_exam_ids(updates["exam_ids"], supabase)
         
    row = _first(supabase.table("premium_ai_example_analyses").update(updates).eq("id", analysis_id).execute())
    if not row:
        raise HTTPException(status_code=404, detail="Analysis not found")
    return _example_analysis_view(row)


@router.delete("/example-analyses/{analysis_id}")
def delete_example_analysis(
    analysis_id: int,
    supabase: Client = Depends(get_supabase_client)
):
    supabase.table("premium_ai_example_analyses").delete().eq("id", analysis_id).execute()
    return {"ok": True}


@router.post("/save-draft/{quiz_kind}", response_model=PremiumAIDraftQuiz)
def save_premium_draft(
    quiz_kind: str,
    payload: SavePremiumDraftRequest,
    supabase: Client = Depends(get_supabase_client)
):
    # Determine content type from quiz_kind or payload... payload has category_ids etc.
    # We need to store content_type in draft table.
    # Infer from quiz_kind.
    q_kind = quiz_kind.lower()
    if "math" in q_kind: ct = AISystemInstructionContentType.PREMIUM_MATHS_QUIZ
    elif "passage" in q_kind: ct = AISystemInstructionContentType.PREMIUM_PASSAGE_QUIZ
    else: ct = AISystemInstructionContentType.PREMIUM_GK_QUIZ
    
    data = {
        "quiz_kind": q_kind,
        "content_type": ct.value,
        "parsed_quiz_data": payload.parsed_quiz_data,
        "category_ids": payload.category_ids,
        "exam_id": payload.exam_id,
        "ai_instruction_id": payload.ai_instruction_id,
        "source_url": payload.source_url,
        "source_pdf_id": payload.source_pdf_id,
        "notes": payload.notes,
    }
    
    row = _first(supabase.table("premium_ai_draft_quizzes").insert(data).execute())
    if not row:
         raise HTTPException(status_code=400, detail="Failed to save draft")
    return _draft_view(row)


@router.post("/convert-draft-to-premium-quiz", response_model=ConvertDraftToPremiumQuizResponse)
def convert_draft_to_premium_quiz(
    payload: ConvertDraftToPremiumQuizRequest,
    supabase: Client = Depends(get_supabase_client)
):
    # Fetch draft
    draft_row = _first(supabase.table("premium_ai_draft_quizzes").select("*").eq("id", payload.draft_quiz_id).execute())
    if not draft_row:
        raise HTTPException(status_code=404, detail="Draft not found")
    
    draft = _draft_view(draft_row)
    data = draft["parsed_quiz_data"]
    quiz_kind = draft["quiz_kind"] # Enum
    
    # Create content item
    # Check if passage or normal
    
    created_id = None
    final_type = ""
    
    if quiz_kind == QuizKind.PASSAGE:
        # data should have passage_title, passage_text, questions
        final_type = ContentType.QUIZ_PASSAGE.value
        item_data = {
            "passage_title": data.get("passage_title"),
            "passage_text": data.get("passage_text"),
            "source_reference": data.get("source_reference"),
            "source": data.get("source_reference"),
            "category_ids": draft["category_ids"],
            "premium_passage_category_ids": draft["category_ids"],
            "exam_id": draft["exam_id"],
            "questions": data.get("questions") or []
        }
        
        row = _first(supabase.table("content_items").insert({
            "title": data.get("passage_title") or "Premium Passage Quiz",
            "type": final_type,
            "data": item_data
        }).execute())
        if row: created_id = row["id"]
        
    else:
        # GK or Maths
        final_type = ContentType.QUIZ_GK.value if quiz_kind == QuizKind.GK else ContentType.QUIZ_MATHS.value
        
        # data is single question object
        question_text = data.get("question_statement") or data.get("question") or "Premium Quiz Question"
        
        options = data.get("options") or []
        normalized_options = []
        for idx, opt in enumerate(options):
             if isinstance(opt, dict):
                 normalized_options.append({"label": opt.get("label"), "text": opt.get("text"), "is_correct": opt.get("is_correct")})
             else:
                 pass # simplified
        
        item_data = {
            "question_statement": question_text,
            "supp_question_statement": data.get("supp_question_statement"),
            "supplementary_statement": data.get("supp_question_statement"),
            "question_prompt": data.get("question_prompt"),
            "statements_facts": data.get("statements_facts") or [],
            "statement_facts": data.get("statements_facts") or [],
            "options": normalized_options,
            "correct_answer": _normalize_label(data.get("correct_answer")),
            "explanation": data.get("explanation"),
            "explanation_text": data.get("explanation"),
            "source_reference": data.get("source_reference"),
            "source": data.get("source_reference"),
            "category_ids": draft["category_ids"],
            "exam_id": draft["exam_id"],
        }
        
        if quiz_kind == QuizKind.GK:
            item_data["premium_gk_category_ids"] = draft["category_ids"]
        else:
            item_data["premium_maths_category_ids"] = draft["category_ids"]

        row = _first(supabase.table("content_items").insert({
            "title": str(question_text)[:200],
            "type": final_type,
            "data": item_data
        }).execute())
        if row: created_id = row["id"]

    if not created_id:
        raise HTTPException(status_code=500, detail="Failed to create content item from draft")

    return ConvertDraftToPremiumQuizResponse(
        message="Successfully converted draft to premium quiz",
        new_quiz_id=int(created_id),
        quiz_type=final_type
    )
