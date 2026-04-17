"""
PDF & Storage Router
POST /pdfs/upload    — upload a PDF, extract text, store metadata
GET  /pdfs/{id}      — get PDF metadata (for source selection)
DELETE /pdfs/{id}    — soft-delete a user's PDF
POST /pdfs/extract-url — fetch URL and extract readable text
"""

import io
import logging
import uuid
from datetime import datetime, timezone, timedelta

import httpx
from bs4 import BeautifulSoup
from fastapi import APIRouter, Depends, File, HTTPException, UploadFile, status
from pydantic import BaseModel

from ..auth import ProfileRow, require_auth
from ..db import get_admin_client

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/pdfs", tags=["PDFs & Sources"])

MAX_PDF_BYTES = 20 * 1024 * 1024  # 20 MB
PDF_EXPIRY_DAYS = 30


# ── PDF extraction ─────────────────────────────────────────────────────────────

def _extract_text_fitz(data: bytes) -> tuple[str, int, bool]:
    """Extract text using PyMuPDF. Returns (text, page_count, used_ocr)."""
    try:
        import fitz  # PyMuPDF
        doc = fitz.open(stream=data, filetype="pdf")
        pages = len(doc)
        texts = [doc.load_page(i).get_text() for i in range(pages)]
        full_text = "\n\n".join(t for t in texts if t.strip())
        if len(full_text.strip()) < 100:
            # Possibly scanned — attempt OCR via text blocks only
            logger.warning("PDF text too short, content may be scanned")
        return full_text, pages, False
    except Exception as exc:
        logger.error("PyMuPDF extraction failed: %s", exc)
        return "", 0, False


def _extract_text_pypdf(data: bytes) -> tuple[str, int, bool]:
    """Fallback extraction using pypdf."""
    try:
        from pypdf import PdfReader
        reader = PdfReader(io.BytesIO(data))
        pages = len(reader.pages)
        texts = [p.extract_text() or "" for p in reader.pages]
        return "\n\n".join(t for t in texts if t.strip()), pages, False
    except Exception as exc:
        logger.error("pypdf extraction failed: %s", exc)
        return "", 0, False


def extract_text_from_pdf(data: bytes) -> tuple[str, int, bool]:
    """Best-effort text extraction, tries PyMuPDF then pypdf."""
    text, pages, ocr = _extract_text_fitz(data)
    if not text.strip():
        text, pages, ocr = _extract_text_pypdf(data)
    return text, pages, ocr


# ── URL extraction ─────────────────────────────────────────────────────────────

async def extract_text_from_url(url: str) -> str:
    """Fetch a URL and extract visible text using BeautifulSoup."""
    headers = {
        "User-Agent": (
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
            "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
        )
    }
    try:
        async with httpx.AsyncClient(timeout=15, follow_redirects=True) as client:
            resp = await client.get(url, headers=headers)
            resp.raise_for_status()
            html = resp.text
    except Exception as exc:
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail=f"Failed to fetch URL: {exc}",
        )

    soup = BeautifulSoup(html, "html.parser")

    # Remove noisy elements
    for tag in soup(["script", "style", "nav", "header", "footer", "aside", "ads"]):
        tag.decompose()

    # Try to find article body
    article = soup.find("article") or soup.find("main") or soup.find("body")
    text = (article or soup).get_text(separator="\n", strip=True)

    # Clean excessive blank lines
    import re
    text = re.sub(r"\n{3,}", "\n\n", text).strip()
    return text[:50_000]  # Cap at 50k chars to avoid token overflow


# ── Routes ─────────────────────────────────────────────────────────────────────

@router.post("/upload")
async def upload_pdf(
    file: UploadFile = File(...),
    profile: ProfileRow = Depends(require_auth),
):
    """Upload a PDF, extract text, store in Supabase Storage, save metadata."""
    if not file.filename or not file.filename.lower().endswith(".pdf"):
        raise HTTPException(status.HTTP_415_UNSUPPORTED_MEDIA_TYPE, "Only PDF files are accepted")

    data = await file.read()
    if len(data) > MAX_PDF_BYTES:
        raise HTTPException(status.HTTP_413_REQUEST_ENTITY_TOO_LARGE, "PDF exceeds 20 MB limit")

    # Extract text
    extracted_text, page_count, used_ocr = extract_text_from_pdf(data)

    # Upload to Supabase Storage
    admin = get_admin_client()
    storage_path = f"pdfs/{profile.id}/{uuid.uuid4()}/{file.filename}"
    try:
        admin.storage.from_("uploads").upload(
            path=storage_path,
            file=data,
            file_options={"content-type": "application/pdf"},
        )
    except Exception as exc:
        logger.warning("Storage upload failed (non-critical): %s", exc)
        storage_path = None

    # Save metadata
    expires_at = (datetime.now(timezone.utc) + timedelta(days=PDF_EXPIRY_DAYS)).isoformat()
    saved = admin.table("uploaded_pdfs").insert({
        "user_id": profile.id,
        "filename": file.filename,
        "content_type": "application/pdf",
        "storage_object_path": storage_path,
        "extracted_text": extracted_text,
        "page_count": page_count,
        "used_ocr": used_ocr,
        "status": "active",
        "expires_at": expires_at,
    }).execute()

    row = saved.data[0]
    return {
        "id": row["id"],
        "filename": file.filename,
        "page_count": page_count,
        "used_ocr": used_ocr,
        "has_text": bool(extracted_text.strip()),
        "text_preview": extracted_text[:300],
        "expires_at": expires_at,
    }


@router.get("/")
async def list_pdfs(profile: ProfileRow = Depends(require_auth)):
    """List the authenticated user's active uploaded PDFs."""
    admin = get_admin_client()
    resp = (
        admin.table("uploaded_pdfs")
        .select("id,filename,extracted_text,page_count,used_ocr,created_at,expires_at,status,user_id")
        .eq("user_id", profile.id)
        .eq("status", "active")
        .order("created_at", desc=True)
        .execute()
    )
    return resp.data or []


@router.get("/{pdf_id}")
async def get_pdf_meta(pdf_id: int, profile: ProfileRow = Depends(require_auth)):
    """Get PDF metadata (without the full text)."""
    admin = get_admin_client()
    resp = (
        admin.table("uploaded_pdfs")
        .select("id,filename,page_count,used_ocr,status,expires_at,created_at")
        .eq("id", pdf_id)
        .eq("user_id", profile.id)
        .eq("status", "active")
        .single()
        .execute()
    )
    if not resp.data:
        raise HTTPException(404, "PDF not found")
    return resp.data


@router.delete("/{pdf_id}")
async def delete_pdf(pdf_id: int, profile: ProfileRow = Depends(require_auth)):
    """Soft-delete a user's PDF."""
    admin = get_admin_client()
    admin.table("uploaded_pdfs").update({
        "status": "deleted",
        "deleted_at": datetime.now(timezone.utc).isoformat(),
    }).eq("id", pdf_id).eq("user_id", profile.id).execute()
    return {"message": "PDF deleted"}


class ExtractUrlRequest(BaseModel):
    url: str


@router.post("/extract-url")
async def extract_url(
    body: ExtractUrlRequest,
    profile: ProfileRow = Depends(require_auth),
):
    """Fetch a URL and extract its readable text for AI generation."""
    text = await extract_text_from_url(body.url)
    if not text.strip():
        raise HTTPException(422, "Could not extract readable content from URL")
    return {
        "url": body.url,
        "text": text,
        "length": len(text),
    }
