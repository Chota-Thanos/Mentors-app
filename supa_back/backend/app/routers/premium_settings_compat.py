from typing import Any, Dict, List, Optional

from fastapi import APIRouter, Depends, HTTPException
from supabase import Client

from ..models import (
    PremiumAIQuizInstruction,
    PremiumAIQuizInstructionCreate,
    PremiumAIQuizInstructionUpdate,
    AISystemInstructionContentType,
    AIProvider,
)
from ..supabase_client import get_supabase_client

router = APIRouter(prefix="/api/v1", tags=["Premium AI Settings"])

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

def _is_missing_table_error(exc: Exception, table_name: str) -> bool:
    error_text = str(exc).lower()
    return "could not find the table" in error_text and table_name.lower() in error_text

@router.get("/admin/premium-ai-settings/", response_model=List[PremiumAIQuizInstruction])
def list_premium_ai_settings(
    limit: int = 100,
    offset: int = 0,
    supabase: Client = Depends(get_supabase_client),
):
    try:
        query = supabase.table("premium_ai_quiz_instructions").select("*").range(offset, offset + limit - 1).order("created_at", desc=True)
        return _rows(query.execute())
    except Exception as e:
        if _is_missing_table_error(e, "premium_ai_quiz_instructions"):
            raise HTTPException(status_code=503, detail="Table 'premium_ai_quiz_instructions' is missing. Run migration.")
        raise HTTPException(status_code=500, detail=str(e))

@router.post("/admin/premium-ai-settings/", response_model=PremiumAIQuizInstruction)
def create_premium_ai_setting(
    payload: PremiumAIQuizInstructionCreate,
    supabase: Client = Depends(get_supabase_client),
):
    try:
        data = payload.model_dump()
        data["content_type"] = payload.content_type.value
        data["ai_provider"] = payload.ai_provider.value
        row = _first(supabase.table("premium_ai_quiz_instructions").insert(data).execute())
        if not row:
            raise HTTPException(status_code=400, detail="Failed to create instruction")
        return PremiumAIQuizInstruction(**row)
    except Exception as e:
        if _is_missing_table_error(e, "premium_ai_quiz_instructions"):
             raise HTTPException(status_code=503, detail="Table 'premium_ai_quiz_instructions' is missing. Run migration.")
        raise HTTPException(status_code=500, detail=str(e))

@router.put("/admin/premium-ai-settings/{instruction_id}", response_model=PremiumAIQuizInstruction)
def update_premium_ai_setting(
    instruction_id: int,
    payload: PremiumAIQuizInstructionUpdate,
    supabase: Client = Depends(get_supabase_client),
):
    try:
        updates = payload.model_dump(exclude_unset=True)
        # Check if style_analysis_system_prompt is in the updates
        if "style_analysis_system_prompt" in updates:
            print(f"DEBUG: Updating instruction {instruction_id} with style_analysis_system_prompt: {updates['style_analysis_system_prompt']}")
        else:
            print(f"DEBUG: style_analysis_system_prompt NOT present in updates for instruction {instruction_id}")

        if "content_type" in updates and updates["content_type"]:
             updates["content_type"] = updates["content_type"].value
        if "ai_provider" in updates and updates["ai_provider"]:
             updates["ai_provider"] = updates["ai_provider"].value
        
        print(f"DEBUG: Full updates payload: {updates}")
        row = _first(supabase.table("premium_ai_quiz_instructions").update(updates).eq("id", instruction_id).execute())
        if not row:
            raise HTTPException(status_code=404, detail="Instruction not found or update failed")
        return PremiumAIQuizInstruction(**row)
    except Exception as e:
        print(f"ERROR updating instruction: {e}")
        if _is_missing_table_error(e, "premium_ai_quiz_instructions"):
             raise HTTPException(status_code=503, detail="Table 'premium_ai_quiz_instructions' is missing. Run migration.")
        raise HTTPException(status_code=500, detail=str(e))

@router.delete("/admin/premium-ai-settings/{instruction_id}")
def delete_premium_ai_setting(
    instruction_id: int,
    supabase: Client = Depends(get_supabase_client),
):
    try:
        supabase.table("premium_ai_quiz_instructions").delete().eq("id", instruction_id).execute()
        return {"ok": True}
    except Exception as e:
        if _is_missing_table_error(e, "premium_ai_quiz_instructions"):
             raise HTTPException(status_code=503, detail="Table 'premium_ai_quiz_instructions' is missing. Run migration.")
        raise HTTPException(status_code=500, detail=str(e))
