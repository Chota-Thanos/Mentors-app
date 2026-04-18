"""
AI engine — ported and restructured from the old ai_logic.py.

Key changes from the old version:
  - Provider config comes from Settings (not os.getenv directly)
  - No legacy content_type strings ('premium_gk' etc) — domain is explicit
  - Quota checking is a separate function (check_and_increment_quota)
  - Mains evaluation is a first-class function
  - Article draft generation is a first-class function
"""

import base64
import json
import logging
import re
import traceback
from typing import Any

import google.generativeai as genai
from openai import AsyncOpenAI

from .config import get_settings
from .prompts import (
    GK_SYSTEM_PROMPT,
    MATHS_SYSTEM_PROMPT,
    PASSAGE_SYSTEM_PROMPT,
    MAINS_GENERATE_PROMPT,
    MAINS_EVAL_SYSTEM_PROMPT,
    ARTICLE_GENERATE_PROMPT,
    QUESTION_FIELD_GUARDRAILS,
    EXPLANATION_GUIDANCE,
    NO_COPY_RULES,
)

logger = logging.getLogger(__name__)
_settings = get_settings()

# ── Provider init ──────────────────────────────────────────────────────────────
if _settings.gemini_api_key:
    genai.configure(api_key=_settings.gemini_api_key)

_openai_client: AsyncOpenAI | None = (
    AsyncOpenAI(api_key=_settings.openai_api_key) if _settings.openai_api_key else None
)

GEMINI_MODELS = [
    "models/gemini-2.5-flash",
    "models/gemini-2.0-flash",
    "models/gemini-2.5-pro",
]


# ── Low-level AI call ──────────────────────────────────────────────────────────

async def _call_ai(
    system_prompt: str,
    user_prompt: str,
    provider: str | None = None,
    model: str | None = None,
) -> str:
    """Call an AI provider and return raw text response."""
    provider = (provider or _settings.ai_default_provider).lower()
    model = model or _settings.ai_default_model

    if provider == "gemini":
        if not _settings.gemini_api_key:
            raise RuntimeError("GEMINI_API_KEY not configured")
        # Resolve model name
        final_model = model if model in GEMINI_MODELS else GEMINI_MODELS[0]
        gm = genai.GenerativeModel(final_model)
        resp = await gm.generate_content_async(f"{system_prompt}\n\n{user_prompt}")
        return resp.text or ""

    elif provider == "openai":
        if not _openai_client:
            raise RuntimeError("OPENAI_API_KEY not configured")
        completion = await _openai_client.chat.completions.create(
            model=model or "gpt-4o",
            messages=[
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": user_prompt},
            ],
            response_format={"type": "json_object"},
        )
        return completion.choices[0].message.content or ""

    else:
        # Auto fallback order: Gemini → OpenAI
        if _settings.gemini_api_key:
            return await _call_ai(system_prompt, user_prompt, provider="gemini", model=model)
        elif _openai_client:
            return await _call_ai(system_prompt, user_prompt, provider="openai", model=model)
        raise RuntimeError("No AI provider available")


# ── JSON parsing (ported from old ai_logic._parse_json_items) ─────────────────

def _fix_latex(text: str) -> str:
    """Fix common LaTeX escaping issues from AI output."""
    return re.sub(r"\\(?![nrt\"\\])", r"\\\\", text)


def _strip_code_fence(text: str) -> str:
    text = re.sub(r"^\s*```(?:json)?\s*", "", text, flags=re.IGNORECASE)
    return re.sub(r"\s*```\s*$", "", text).strip()


def _strip_trailing_commas(blob: str) -> str:
    prev = None
    while blob != prev:
        prev = blob
        blob = re.sub(r",(\s*[}\]])", r"\1", blob)
    return blob


def _try_parse(blob: str) -> Any:
    blob = _strip_trailing_commas(blob.strip())
    if not blob:
        return None
    try:
        return json.loads(blob)
    except json.JSONDecodeError:
        try:
            import ast
            return ast.literal_eval(blob)
        except Exception:
            return None


def _payload_to_items(payload: Any) -> list[dict]:
    if isinstance(payload, list):
        return [x for x in payload if isinstance(x, dict)]
    if isinstance(payload, dict):
        # Nested array keys
        for key in ("items", "questions", "quiz", "passages"):
            val = payload.get(key)
            if isinstance(val, list):
                return [x for x in val if isinstance(x, dict)]
        # Single passage object
        if payload.get("passage_text") or payload.get("passage_title"):
            return [payload]
        return [payload]
    return []


def parse_ai_json(raw: str) -> list[dict]:
    """Robustly extract a list of dicts from AI text."""
    raw = _fix_latex(raw)
    raw = _strip_code_fence(raw)

    parsed = _try_parse(raw)
    if parsed is not None:
        items = _payload_to_items(parsed)
        if items:
            return items

    # Try extracting balanced JSON blocks
    for open_c, close_c in [("[", "]"), ("{", "}")]:
        depth = 0
        start = None
        in_str = escaped = False
        for i, ch in enumerate(raw):
            if escaped:
                escaped = False
                continue
            if ch == "\\" and in_str:
                escaped = True
                continue
            if ch == '"':
                in_str = not in_str
                continue
            if in_str:
                continue
            if ch == open_c:
                if depth == 0:
                    start = i
                depth += 1
            elif ch == close_c and depth > 0:
                depth -= 1
                if depth == 0 and start is not None:
                    candidate = _try_parse(raw[start:i + 1])
                    if candidate is not None:
                        items = _payload_to_items(candidate)
                        if items:
                            return items
                    start = None

    return []


# ── Quiz generation ────────────────────────────────────────────────────────────

async def generate_quiz(
    *,
    domain: str,                     # 'gk' | 'maths' | 'passage'
    source_text: str,
    count: int = 10,
    language: str = "en",
    user_instructions: str | None = None,
    recent_questions: list[str] | None = None,
    system_prompt_override: str | None = None,
    example_questions: list[str] | None = None,
    provider: str | None = None,
    model: str | None = None,
) -> list[dict]:
    """Generate quiz questions for a given domain."""

    domain = domain.lower()
    base_prompts = {
        "gk": GK_SYSTEM_PROMPT,
        "maths": MATHS_SYSTEM_PROMPT,
        "passage": PASSAGE_SYSTEM_PROMPT,
    }
    base = system_prompt_override or base_prompts.get(domain, GK_SYSTEM_PROMPT)

    # Build system prompt
    system = base
    if recent_questions:
        recent_block = "\n- ".join(recent_questions[-10:])
        system += f"\n\nAvoid repeating these recent questions:\n- {recent_block}"
    system += QUESTION_FIELD_GUARDRAILS
    system += EXPLANATION_GUIDANCE
    system += NO_COPY_RULES
    if user_instructions:
        system += f"\n\nADDITIONAL USER INSTRUCTIONS:\n{user_instructions}"

    # Build user prompt
    lines = [
        f"Language: {'Hindi' if language == 'hi' else 'English'}",
        f"Generate EXACTLY {count} questions.",
        "Source content:",
        source_text,
    ]
    if example_questions:
        lines.append("\nExample format questions:")
        lines.extend(example_questions[:3])
    lines.append("\nGenerate VALID JSON ONLY. Return an array of question objects.")
    user = "\n".join(lines)

    try:
        raw = await _call_ai(system, user, provider=provider, model=model)
        items = parse_ai_json(raw)
        if items:
            return items
        logger.warning("AI returned no parseable items for domain=%s", domain)
        return _fallback_items(domain, count)
    except Exception as exc:
        logger.error("AI generation failed: %s", exc, exc_info=True)
        return _fallback_items(domain, count)


# ── Mains question generation ──────────────────────────────────────────────────

async def generate_mains_question(
    *,
    source_text: str,
    category_label: str | None = None,
    word_limit: int = 250,
    language: str = "en",
    system_prompt_override: str | None = None,
    provider: str | None = None,
    model: str | None = None,
) -> dict:
    """Generate a single UPSC Mains practice question."""
    system = system_prompt_override or MAINS_GENERATE_PROMPT
    user = (
        f"Topic/Source: {source_text}\n"
        f"Category: {category_label or 'General Studies'}\n"
        f"Word limit for answer: {word_limit}\n"
        f"Language: {'Hindi' if language == 'hi' else 'English'}\n\n"
        "Return JSON with keys: question_text, answer_approach, model_answer, word_limit"
    )
    try:
        raw = await _call_ai(system, user, provider=provider, model=model)
        items = parse_ai_json(raw)
        return items[0] if items else {}
    except Exception as exc:
        logger.error("Mains generation failed: %s", exc, exc_info=True)
        return {}


# ── Mains answer evaluation ────────────────────────────────────────────────────

async def evaluate_mains_answer(
    *,
    question_text: str,
    answer_text: str,
    word_limit: int = 250,
    model_answer: str | None = None,
    system_prompt_override: str | None = None,
    provider: str | None = None,
    model: str | None = None,
) -> dict:
    """
    AI evaluates a student's mains answer.
    Returns: score, max_score, feedback, strengths, weaknesses,
             structure_score, content_score, improved_answer
    """
    system = system_prompt_override or MAINS_EVAL_SYSTEM_PROMPT
    user_parts = [
        f"QUESTION:\n{question_text}",
        f"WORD LIMIT: {word_limit}",
    ]
    if model_answer:
        user_parts.append(f"MODEL ANSWER (for reference):\n{model_answer}")
    user_parts.append(f"STUDENT ANSWER:\n{answer_text}")
    user_parts.append(
        "\nReturn JSON with exactly these keys: "
        "score (float), max_score (float, default 10), feedback (string), "
        "strengths (list of strings), weaknesses (list of strings), "
        "structure_score (float), content_score (float), improved_answer (string)"
    )
    user = "\n\n".join(user_parts)

    try:
        raw = await _call_ai(system, user, provider=provider, model=model)
        items = parse_ai_json(raw)
        result = items[0] if items else {}
        # Ensure required keys have defaults
        return {
            "ai_score": float(result.get("score", 0)),
            "ai_max_score": float(result.get("max_score", 10)),
            "ai_feedback": result.get("feedback", ""),
            "ai_strengths": result.get("strengths", []),
            "ai_weaknesses": result.get("weaknesses", []),
            "ai_structure_score": float(result.get("structure_score", 0)),
            "ai_content_score": float(result.get("content_score", 0)),
            "improved_answer": result.get("improved_answer", ""),
        }
    except Exception as exc:
        logger.error("Mains evaluation failed: %s", exc, exc_info=True)
        return {
            "ai_score": 0,
            "ai_max_score": 10,
            "ai_feedback": "Evaluation failed. Please try again.",
            "ai_strengths": [],
            "ai_weaknesses": [],
            "ai_structure_score": 0,
            "ai_content_score": 0,
            "improved_answer": "",
        }


# ── Article generation ─────────────────────────────────────────────────────────

async def extract_text_from_images(
    *,
    images_base64: list[str],
    provider: str | None = None,
    model: str | None = None,
) -> str:
    """Extract text from uploaded page images using a multimodal provider."""
    provider = (provider or _settings.ai_default_provider).lower()
    if provider != "gemini":
        provider = "gemini"
    if not _settings.gemini_api_key:
        raise RuntimeError("GEMINI_API_KEY not configured")

    final_model = model if model in GEMINI_MODELS else GEMINI_MODELS[0]
    gm = genai.GenerativeModel(final_model)
    parts: list[Any] = [
        (
            "Extract all readable text from these UPSC answer/question images. "
            "Preserve page order, headings, numbering, and paragraph breaks. "
            "Return plain text only."
        )
    ]
    for image in images_base64:
        raw = str(image or "")
        if not raw.strip():
            continue
        mime_type = "image/jpeg"
        payload = raw
        if raw.startswith("data:") and "," in raw:
            header, payload = raw.split(",", 1)
            mime_type = header.split(";")[0].replace("data:", "") or mime_type
        try:
            parts.append({"mime_type": mime_type, "data": base64.b64decode(payload)})
        except Exception:
            logger.warning("Skipping invalid OCR image payload")

    if len(parts) == 1:
        return ""
    resp = await gm.generate_content_async(parts)
    return (resp.text or "").strip()


async def generate_style_profile(
    *,
    content_type: str,
    example_questions: list[str],
    system_prompt_override: str | None = None,
    provider: str | None = None,
    model: str | None = None,
) -> dict:
    """Analyze examples and return a reusable style profile."""
    examples = "\n\n---\n\n".join(example_questions[:10])
    system = system_prompt_override or (
        "You analyze UPSC content examples and produce reusable generation or evaluation style guidance. "
        "Return JSON only."
    )
    user = (
        f"Content type: {content_type}\n\n"
        f"Examples:\n{examples}\n\n"
        "Return JSON with keys: style_instructions (string), structure_rules (list of strings), "
        "tone_rules (list of strings), avoid_rules (list of strings)."
    )
    try:
        raw = await _call_ai(system, user, provider=provider, model=model)
        items = parse_ai_json(raw)
        result = items[0] if items else {}
    except Exception as exc:
        logger.error("Style profile generation failed: %s", exc, exc_info=True)
        result = {}

    instructions = str(result.get("style_instructions") or "").strip()
    if not instructions:
        instructions = (
            "Follow the supplied example style closely. Preserve the same level of difficulty, "
            "answer structure, terminology, and explanation depth."
        )
    return {
        "style_instructions": instructions,
        "structure_rules": result.get("structure_rules") if isinstance(result.get("structure_rules"), list) else [],
        "tone_rules": result.get("tone_rules") if isinstance(result.get("tone_rules"), list) else [],
        "avoid_rules": result.get("avoid_rules") if isinstance(result.get("avoid_rules"), list) else [],
    }


async def refine_style_profile(
    *,
    style_profile: dict[str, Any],
    feedback: str,
    provider: str | None = None,
    model: str | None = None,
) -> dict:
    """Refine an existing style profile using user feedback."""
    system = "Refine a UPSC AI style profile. Return JSON only."
    user = (
        f"Existing style profile:\n{json.dumps(style_profile, ensure_ascii=False)}\n\n"
        f"Requested refinement:\n{feedback}\n\n"
        "Return the full updated JSON object with at least style_instructions."
    )
    try:
        raw = await _call_ai(system, user, provider=provider, model=model)
        items = parse_ai_json(raw)
        result = items[0] if items else {}
    except Exception as exc:
        logger.error("Style profile refinement failed: %s", exc, exc_info=True)
        result = {}

    merged = {**style_profile, **result}
    if not str(merged.get("style_instructions") or "").strip():
        merged["style_instructions"] = str(style_profile.get("style_instructions") or "").strip()
    if feedback.strip():
        merged["style_instructions"] = (
            f"{str(merged.get('style_instructions') or '').strip()}\n\nRefinement: {feedback.strip()}"
        ).strip()
    return merged


async def generate_article_draft(
    *,
    source_text: str | None = None,
    source_url: str | None = None,
    style_guide: str | None = None,
    provider: str | None = None,
    model: str | None = None,
) -> dict:
    """Generate an article draft from source content or URL."""
    system = ARTICLE_GENERATE_PROMPT
    if style_guide:
        system += f"\n\nEDITORIAL STYLE GUIDE:\n{style_guide}"

    content_part = (
        f"Source URL: {source_url}\n\n" if source_url else ""
    ) + (source_text or "")

    user = (
        f"{content_part}\n\n"
        "Return JSON with keys: title, excerpt, content (HTML), "
        "suggested_tags (list), seo_title, seo_description"
    )

    try:
        raw = await _call_ai(system, user, provider=provider, model=model)
        items = parse_ai_json(raw)
        return items[0] if items else {}
    except Exception as exc:
        logger.error("Article generation failed: %s", exc, exc_info=True)
        return {}


# ── Fallback items ─────────────────────────────────────────────────────────────

def _fallback_items(domain: str, count: int) -> list[dict]:
    """Return placeholder items when AI generation fails."""
    placeholder = {
        "question_statement": "[AI generation failed — please retry]",
        "options": [
            {"label": "A", "text": "Option A"},
            {"label": "B", "text": "Option B"},
            {"label": "C", "text": "Option C"},
            {"label": "D", "text": "Option D"},
        ],
        "correct_answer": "A",
        "explanation_text": "Generation failed. Please regenerate.",
        "_fallback": True,
    }
    return [placeholder] * count
