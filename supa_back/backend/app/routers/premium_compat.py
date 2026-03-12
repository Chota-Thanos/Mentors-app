from typing import Any, Dict, List, Literal, Optional

from fastapi import APIRouter, Depends, HTTPException, Header
from pydantic import BaseModel
from supabase import Client

from ..supabase_client import get_supabase_client

router = APIRouter(prefix="/api/v1/premium-collections", tags=["Premium Collections Compatibility"])


class PremiumCollectionCreatePayload(BaseModel):
    name: str
    description: Optional[str] = None
    test_kind: Optional[Literal["prelims", "mains"]] = None
    price: Optional[float] = None
    is_public: Optional[bool] = False
    is_subscription: Optional[bool] = False
    is_private_source: Optional[bool] = False
    category_ids: Optional[List[int]] = None
    admin_subpage_id: Optional[int] = None
    image_url: Optional[str] = None


class PremiumCollectionUpdatePayload(BaseModel):
    name: Optional[str] = None
    description: Optional[str] = None
    test_kind: Optional[Literal["prelims", "mains"]] = None
    price: Optional[float] = None
    is_public: Optional[bool] = None
    is_finalized: Optional[bool] = None
    is_subscription: Optional[bool] = None
    is_private_source: Optional[bool] = None
    category_ids: Optional[List[int]] = None
    admin_subpage_id: Optional[int] = None
    image_url: Optional[str] = None


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


def _normalize_mode(value: Any) -> str:
    return str(value or "").strip().lower()


def _resolve_collection_test_kind(meta: Optional[Dict[str, Any]], explicit: Optional[str] = None) -> str:
    normalized_explicit = _normalize_mode(explicit)
    if normalized_explicit in {"prelims", "mains"}:
        return normalized_explicit

    payload = meta if isinstance(meta, dict) else {}
    normalized_kind = _normalize_mode(payload.get("test_kind"))
    if normalized_kind in {"prelims", "mains"}:
        return normalized_kind

    mode = _normalize_mode(payload.get("collection_mode"))
    if mode in {"mains", "mains_ai", "mains_ai_question", "mains_question", "mains_test"}:
        return "mains"
    return "prelims"


def _apply_collection_test_kind_meta(meta: Dict[str, Any], test_kind: str) -> Dict[str, Any]:
    normalized = dict(meta or {})
    if test_kind == "mains":
        normalized["collection_mode"] = "mains_ai"
        normalized["test_kind"] = "mains"
    else:
        normalized["collection_mode"] = "prelims_quiz"
        normalized["test_kind"] = "prelims"
    return normalized


def _view(row: Dict[str, Any]) -> Dict[str, Any]:
    meta_value = row.get("meta")
    meta = meta_value if isinstance(meta_value, dict) else {}
    test_kind = _resolve_collection_test_kind(meta)
    return {
        "id": row.get("id"),
        "name": row.get("title"),
        "description": row.get("description"),
        "test_kind": test_kind,
        "test_label": "Mains Test" if test_kind == "mains" else "Prelims Test",
        "collection_mode": _normalize_mode(meta.get("collection_mode")) or ("mains_ai" if test_kind == "mains" else "prelims_quiz"),
        "price": row.get("price"),
        "is_paid": row.get("is_premium"),
        "is_public": row.get("is_public"),
        "image_url": row.get("thumbnail_url"),
        "is_subscription": meta.get("is_subscription", False),
        "is_private_source": meta.get("is_private_source", False),
        "admin_subpage_id": meta.get("admin_subpage_id"),
        "category_ids": meta.get("category_ids") or [],
        "is_finalized": row.get("is_finalized"),
        "created_at": row.get("created_at"),
        "updated_at": row.get("updated_at"),
        "items": [],
    }


def get_user_id(
    authorization: Optional[str] = Header(None),
    supabase: Client = Depends(get_supabase_client),
) -> Optional[str]:
    if not authorization:
        return None
    try:
        token = authorization.split(" ")[1]
        response = supabase.auth.get_user(token)
        return response.user.id
    except Exception:
        return None


@router.get("/")
def list_all_collections(supabase: Client = Depends(get_supabase_client)):
    rows = _rows(supabase.table("collections").select("*").order("created_at", desc=True).execute())
    return [_view(row) for row in rows]


@router.get("/by-subpage/{slug}")
def get_by_subpage(slug: str, supabase: Client = Depends(get_supabase_client)):
    rows = _rows(supabase.table("collections").select("*").order("created_at", desc=True).execute())
    filtered = []
    for row in rows:
        meta = row.get("meta") or {}
        if str(meta.get("admin_subpage_slug") or "") == slug or str(meta.get("admin_subpage_id") or "") == slug:
            filtered.append(row)
    if not filtered:
        filtered = rows
    return [_view(row) for row in filtered]


@router.get("/{collection_id}")
def get_collection(collection_id: int, supabase: Client = Depends(get_supabase_client)):
    row = _first(supabase.table("collections").select("*").eq("id", collection_id).limit(1).execute())
    if not row:
        raise HTTPException(status_code=404, detail="Collection not found")
    payload = _view(row)
    items = _rows(
        supabase.table("collection_items")
        .select("id, order, section_title, content_item_id, content_items(*)")
        .eq("collection_id", collection_id)
        .order("order")
        .execute()
    )
    payload["items"] = [
        {
            "id": it.get("id"),
            "order": it.get("order"),
            "section_title": it.get("section_title"),
            "content_item_id": it.get("content_item_id"),
            "content": it.get("content_items"),
        }
        for it in items
    ]
    return payload


@router.post("/")
def create_collection(
    payload: PremiumCollectionCreatePayload,
    user_id: Optional[str] = Depends(get_user_id),
    supabase: Client = Depends(get_supabase_client),
):
    meta = {
        "is_subscription": payload.is_subscription,
        "is_private_source": payload.is_private_source,
        "admin_subpage_id": payload.admin_subpage_id,
        "category_ids": payload.category_ids or [],
    }
    if user_id:
        meta["author_id"] = user_id
    test_kind = _resolve_collection_test_kind(meta, payload.test_kind)
    meta = _apply_collection_test_kind_meta(meta, test_kind)
    row = _first(
        supabase.table("collections")
        .insert(
            {
                "title": payload.name,
                "description": payload.description,
                "price": payload.price or 0,
                "is_public": payload.is_public or False,
                "is_premium": True if (payload.price and payload.price > 0) else False,
                "type": "test_series",
                "thumbnail_url": payload.image_url,
                "meta": meta,
            }
        )
        .execute()
    )
    if not row:
        raise HTTPException(status_code=400, detail="Failed to create collection")
    return _view(row)


@router.put("/{collection_id}")
def update_collection(
    collection_id: int,
    payload: PremiumCollectionUpdatePayload,
    supabase: Client = Depends(get_supabase_client),
):
    current = _first(supabase.table("collections").select("*").eq("id", collection_id).limit(1).execute())
    if not current:
        raise HTTPException(status_code=404, detail="Collection not found")

    updates: Dict[str, Any] = {}
    if payload.name is not None:
        updates["title"] = payload.name
    if payload.description is not None:
        updates["description"] = payload.description
    if payload.price is not None:
        updates["price"] = payload.price
        updates["is_premium"] = payload.price > 0
    if payload.is_public is not None:
        updates["is_public"] = payload.is_public
    if payload.is_finalized is not None:
        updates["is_finalized"] = payload.is_finalized
    if payload.image_url is not None:
        updates["thumbnail_url"] = payload.image_url

    if (
        payload.admin_subpage_id is not None
        or payload.category_ids is not None
        or payload.is_subscription is not None
        or payload.is_private_source is not None
        or payload.test_kind is not None
    ):
        meta = dict(current.get("meta") or {})
        if payload.admin_subpage_id is not None:
            meta["admin_subpage_id"] = payload.admin_subpage_id
        if payload.category_ids is not None:
            meta["category_ids"] = payload.category_ids
        if payload.is_subscription is not None:
            meta["is_subscription"] = payload.is_subscription
        if payload.is_private_source is not None:
            meta["is_private_source"] = payload.is_private_source
        test_kind = _resolve_collection_test_kind(meta, payload.test_kind)
        meta = _apply_collection_test_kind_meta(meta, test_kind)
        updates["meta"] = meta

    row = _first(supabase.table("collections").update(updates).eq("id", collection_id).execute())
    if not row:
        raise HTTPException(status_code=404, detail="Collection not found")
    return _view(row)
