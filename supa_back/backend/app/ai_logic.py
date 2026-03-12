import base64
import json
import os
import re
import logging
import html
from pathlib import Path
from typing import Any, Dict, List, Optional
import traceback

import google.generativeai as genai
from dotenv import load_dotenv
from openai import AsyncOpenAI

from .models import (
    AIInstructionType,
    AIProvider,
    AIQuizGenerateRequest,
    MainsAIGenerateRequest,
    MainsEvaluationRequest,
    OCRRequest,
    AISystemInstructionContentType
)
from .ai_legacy_prompts import (
    GK_DEFAULT_INSTR, MATHS_DEFAULT_INSTR, PASSAGE_DEFAULT_INSTR,
    EXPLANATION_GUIDANCE, MATHS_EXPLANATION_FORMAT,
    _style_profile_system_instructions,
    _style_profile_refine_system_instructions,
    _resolve_example_guidance,
    _extract_example_format_spec,
    _append_user_priority_instructions,
    _append_generation_balance_rules,
    _fix_latex_escaping
)

# Robust .env loading
env_path = Path(__file__).resolve().parent.parent / '.env'
load_dotenv(dotenv_path=env_path)

OPENAI_API_KEY = os.getenv("OPENAI_API_KEY")
GEMINI_API_KEY = os.getenv("GEMINI_API_KEY")

logger = logging.getLogger(__name__)

openai_client = AsyncOpenAI(api_key=OPENAI_API_KEY) if OPENAI_API_KEY else None
if GEMINI_API_KEY:
    genai.configure(api_key=GEMINI_API_KEY)


def _append_hardcoded_no_copy_rules(system_instructions: str) -> str:
    return (
        system_instructions
        + "\n\nHARDCODED RULES (MANDATORY):"
        + "\n- Examples are for format/style only. Do not copy their topic facts or answer-key pattern."
        + "\n- Do not repeat one fixed correct option label across the batch. Correct answers must vary across questions."
        + "\n- Recompute the correct answer from source content for every question independently."
    )


async def generate_quiz_content(
    request: AIQuizGenerateRequest,
    instruction_override: Optional[Dict[str, Any]] = None,
) -> List[Dict[str, Any]]:
    # Initialize prompts to empty strings in case of early failure
    system_prompt = ""
    user_prompt = ""
    raw_text = ""
    error_msg = None

    try:
        system_prompt = _build_system_prompt(request, instruction_override)
        user_prompt = _build_user_prompt(request, instruction_override)

        provider = (request.provider or "openai").strip().lower()

        # 1. Try requested Gemini
        if provider == "gemini":
             if not GEMINI_API_KEY:
                 raise RuntimeError("Gemini API Key missing in environment.")
             
             # Use requested model, but ensure it's a known good one if possible
             model_name = request.model
             
             # For this specific environment, we saw these models are available:
             # models/gemini-3-flash-preview, models/gemini-2.5-flash, etc.
             available_models = [
                 "models/gemini-3-flash-preview", 
                 "models/gemini-2.5-flash", 
                 "models/gemini-2.5-pro", 
                 "models/gemini-2.0-flash",
             ]
             
             # If requested model is not in available models, try to find it or fallback
             final_model = "models/gemini-3-flash-preview"
             if model_name:
                 if model_name in available_models:
                     final_model = model_name
                 elif f"models/{model_name}" in available_models:
                     final_model = f"models/{model_name}"
                 else:
                     # Check for substring match as last resort
                     for am in available_models:
                         if model_name in am:
                             final_model = am
                             break
             
             model_name = final_model
             print(f"DEBUG: Selected Gemini Model: {model_name}")
             model = genai.GenerativeModel(model_name)
             response = await model.generate_content_async(f"{system_prompt}\n\n{user_prompt}")
             raw_text = response.text or ""
        
        # 2. Try requested OpenAI
        elif provider == "openai":
             if not openai_client:
                 raise RuntimeError("OpenAI API Key missing in environment.")
                 
             completion = await openai_client.chat.completions.create(
                model=request.model or "gpt-4o",
                messages=[
                    {"role": "system", "content": system_prompt},
                    {"role": "user", "content": user_prompt},
                ],
                response_format={"type": "json_object"},
            )
             raw_text = completion.choices[0].message.content or ""

        # 3. Fallback logic if provider not matched but keys exist
        elif GEMINI_API_KEY:
            model = genai.GenerativeModel("gemini-3-flash-preview")
            response = await model.generate_content_async(f"{system_prompt}\n\n{user_prompt}")
            raw_text = response.text or ""

        elif openai_client:
            completion = await openai_client.chat.completions.create(
                model="gpt-4o",
                messages=[
                    {"role": "system", "content": system_prompt},
                    {"role": "user", "content": user_prompt},
                ],
                response_format={"type": "json_object"},
            )
            raw_text = completion.choices[0].message.content or ""
        
        else:
            raise RuntimeError("No AI provider configured (Keys missing).")

    except Exception as e:
        error_msg = f"AI Error: {str(e)}"
        print(f"CRITICAL AI FAILURE: {error_msg}")
        traceback.print_exc()
        # Return offline fallback on ANY error
        fallback_items = _offline_fallback_quiz_items(request, error_message=error_msg)
        return _normalize_items(fallback_items, request.instruction_type, request=request)

    # Apply LaTeX fixing on raw text
    raw_text = _fix_latex_escaping(raw_text) or ""
    print(f"DEBUG: RAW AI TEXT: {raw_text[:1000]}")

    parsed_items = _parse_json_items(raw_text)
    if not parsed_items:
        print("AI returned invalid JSON. Using fallback.")
        fallback_items = _offline_fallback_quiz_items(request)
        return _normalize_items(fallback_items, request.instruction_type, request=request)
    
    return _normalize_items(parsed_items, request.instruction_type, request=request)


def _build_system_prompt(
    request: AIQuizGenerateRequest,
    instruction_override: Optional[Dict[str, Any]],
) -> str:
    override_system_prompt: Optional[str] = None
    if instruction_override:
        if instruction_override.get("system_prompt"):
            override_system_prompt = str(instruction_override["system_prompt"])
        elif instruction_override.get("system_instructions"):
            override_system_prompt = str(instruction_override["system_instructions"])

    # Determine if this is a premium request
    ct = (request.content_type or "").lower()
    is_premium_gk = ct == AISystemInstructionContentType.PREMIUM_GK_QUIZ.value or "premium_gk" in ct
    is_premium_maths = ct == AISystemInstructionContentType.PREMIUM_MATHS_QUIZ.value or "premium_maths" in ct
    is_premium_passage = ct == AISystemInstructionContentType.PREMIUM_PASSAGE_QUIZ.value or "premium_passage" in ct
    
    base = "You are an AI assistant that generates premium UPSC preparation content."

    recent_questions = [q.strip() for q in (request.recent_questions or []) if isinstance(q, str) and q.strip()]
    recent_questions = recent_questions[-10:]
    recent_block = ""
    if recent_questions:
        recent_block = "\nRecent questions:\n- " + "\n- ".join(recent_questions)
    
    if is_premium_gk:
        system = override_system_prompt or GK_DEFAULT_INSTR
        if recent_block:
            system += (
                "\n\nAvoid repeating, paraphrasing, or covering the exact same facts/scenarios from recent questions. "
                "Find new angles from the provided content."
                f"{recent_block}"
            )
        system += (
            "\n\nPreserve question wording and options exactly as given; do not paraphrase. "
            "Use the provided content as the source of truth. "
            "If explanations are missing or too short, expand them based strictly on the content (no unsupported facts). "
            "Output an ARRAY of question objects. "
            "Preserve literal markers such as 'Statement I:' and 'Statement II:' if present; "
            "include them verbatim in statements_facts or question text. Do not rename/remove them. "
            "If statements_facts or question_prompt are present, do NOT repeat them inside question_statement. "
            "For statement-based questions, ALWAYS include a clear 'question_prompt' field containing the final ask sentence. "
            "Strictly follow every instruction and schema field; do not skip or merge required fields. "
            "If examples are provided, apply the same format constraints to EVERY question in the batch; "
            "do not follow the format only for the first question."
        )
        system += EXPLANATION_GUIDANCE
        system = _append_generation_balance_rules(system)
        system = _append_hardcoded_no_copy_rules(system)
        return _append_user_priority_instructions(system, request.user_instructions)
        
    if is_premium_maths:
        system = override_system_prompt or MATHS_DEFAULT_INSTR
        if recent_block:
            system += (
                "\n\nAvoid repeating, paraphrasing, or covering the exact same problems/scenarios from recent questions. "
                "Find new problem variants from the provided content."
                f"{recent_block}"
            )
        system += (
            "\n\nPreserve question wording and options exactly as given; do not paraphrase. "
            "Use the provided content as the source of truth. "
            "If explanations are missing or too short, expand them based strictly on the content (no unsupported facts). "
            "Output an ARRAY of question objects. "
            "Preserve literal markers such as 'Statement I:' and 'Statement II:' if present; "
            "include them verbatim in statements_facts or question text. Do not rename/remove them. "
            "If statements_facts or question_prompt are present, do NOT repeat them inside question_statement. "
            "For statement-based questions, ALWAYS include a clear 'question_prompt' field containing the final ask sentence. "
            "Strictly follow every instruction and schema field; do not skip or merge required fields. "
            "If examples are provided, apply the same format constraints to EVERY question in the batch; "
            "do not follow the format only for the first question."
        )
        system += EXPLANATION_GUIDANCE
        system += MATHS_EXPLANATION_FORMAT
        system = _append_generation_balance_rules(system)
        system = _append_hardcoded_no_copy_rules(system)
        return _append_user_priority_instructions(system, request.user_instructions)
        
    if is_premium_passage:
        system = override_system_prompt or PASSAGE_DEFAULT_INSTR
        if recent_block:
            system += (
                "\n\nAvoid repeating or paraphrasing recent questions while preserving the same question format constraints. "
                "Use different sections/aspects of the source content."
                f"{recent_block}"
            )
        system += (
            "\n\nPreserve passage text, question wording, and options exactly as given; do not paraphrase. "
            "Use the provided content as the source of truth. "
            "If explanations are missing or too short, expand them based strictly on the passage (no unsupported facts). "
            "For any question text inside the passage, preserve markers like 'Statement I:' and 'Statement II:' verbatim; "
            "do not rename or remove them. "
            "If statements_facts or question_prompt are present, do NOT repeat them inside question_statement. "
            "For statement-based questions, ALWAYS include a clear 'question_prompt' field containing the final ask sentence. "
            "Strictly follow every instruction and schema field; do not skip or merge required fields. "
            "If examples are provided, apply the same format constraints to EVERY generated question."
        )
        system += EXPLANATION_GUIDANCE
        system += "\nIf the user requests multiple passages, return a JSON array of passage objects."
        system = _append_generation_balance_rules(system)
        system = _append_hardcoded_no_copy_rules(system)
        return _append_user_priority_instructions(system, request.user_instructions)

    if override_system_prompt:
        return override_system_prompt

    if request.instruction_type == AIInstructionType.QUIZ_GEN:
        return (
            base
            + f"\nIMPORTANT: You MUST generate EXACTLY {request.count} items. No more, no less."
            + "\nReturn strict JSON: {\"items\": [ ... ]}. Each item in the array MUST be a complete question object."
            + "\nREQUIRED: 'question_statement', 'options' (array of strings), 'correct_answer' (A/B/C/D), 'explanation_text'."
            + "\nIf using Assertion-Reasoning:"
            + "\n- Put the two statements in 'statements_facts': [\"Assertion: ...\", \"Reason: ...\"]"
            + "\n- You MAY omit 'options' to use the standard A/B/C/D format automatically, OR provide them explicitly."
        )
    if request.instruction_type == AIInstructionType.GRADING:
        return (
            base
            + "\nEvaluate answer quality and return strict JSON with keys: score, critique, suggestions."
        )
    if request.instruction_type == AIInstructionType.SUMMARY:
        return base + "\nReturn strict JSON with summary items."
    if request.instruction_type == AIInstructionType.EXPLANATION:
        return base + "\nReturn strict JSON with explanation items."
    return base


def _build_user_prompt(
    request: AIQuizGenerateRequest,
    instruction_override: Optional[Dict[str, Any]],
) -> str:
    template = ""
    if instruction_override and instruction_override.get("user_prompt_template"):
        template = str(instruction_override["user_prompt_template"])
    
    # Check premium context
    ct = (request.content_type or "").lower()
    is_premium = "premium" in ct
    
    # Resolve example guidance if present
    example_guidance, format_spec = None, None
    if is_premium and (request.example_questions or request.formatting_instruction_text):
        ex_list = request.example_questions or []
        # If formatting_instruction_text is passed, use it as guidance source along with examples
        example_guidance, format_spec = _resolve_example_guidance(ex_list, request.formatting_instruction_text)

    if template:
        prompt = template
        replacements = {
            "{{content}}": request.content,
            "{{count}}": str(request.count),
            "{{content_type}}": request.content_type,
            "{{user_instructions}}": request.user_instructions or "",
            "{{example_questions}}": "\n".join(request.example_questions or []),
            "{{recent_questions}}": "\n".join(request.recent_questions or []),
        }
        for token, value in replacements.items():
            prompt = prompt.replace(token, value)
        
        # --- PROMPT ENFORCEMENT ---
        if example_guidance:
             prompt += "\n\n" + example_guidance

        if request.example_questions and "{{example_questions}}" not in template and not example_guidance:
            prompt += "\n\n### EXAMPLE FORMAT ###\n" + "\n".join(request.example_questions)
        
        if request.user_instructions and "{{user_instructions}}" not in template and not is_premium:
            prompt += "\n\n### USER INSTRUCTIONS ###\n" + request.user_instructions

        if request.formatting_instruction_text and not example_guidance:
             prompt += "\n\n### FORMATTING & EVALUATION STYLE ###\n" + request.formatting_instruction_text + "\n(Apply this analysis to the generated questions)"

        prompt += f"\n\n(SYSTEM NOTE: You MUST generate EXACTLY {request.count} questions.)"
        
        return prompt

    extra_lines: List[str] = [
        f"Content Type: {request.content_type}",
        f"Desired Count: {request.count}",
        "Source Content:",
        request.content or "",
        "GENERATE VALID JSON ONLY.",
    ]
    # For premium, user_instructions are in system prompt. For non-premium, add here.
    if request.user_instructions and not is_premium:
        extra_lines.extend(["User Instructions:", request.user_instructions])
        
    if example_guidance:
        extra_lines.extend([example_guidance])
    else:
        if request.formatting_instruction_text:
            extra_lines.extend(["Formatting Instruction:", request.formatting_instruction_text])
        if request.example_questions:
            extra_lines.extend(["Example Questions:", "\n".join(request.example_questions)])
            
    if request.recent_questions:
        extra_lines.extend(["Recent Questions:", "\n".join(request.recent_questions)])

    return "\n".join(extra_lines)


def _parse_json_items(text: str) -> List[Dict[str, Any]]:
    if not text or not str(text).strip():
        return []

    raw = str(text).strip()
    raw = re.sub(r"^\s*```(?:json)?\s*", "", raw, flags=re.IGNORECASE)
    raw = re.sub(r"\s*```\s*$", "", raw, flags=re.IGNORECASE).strip()

    def _payload_to_items(payload: Any) -> List[Dict[str, Any]]:
        if isinstance(payload, list):
            return [item for item in payload if isinstance(item, dict)]
        if isinstance(payload, dict):
            items = payload.get("items") or payload.get("questions") or payload.get("quiz")
            if isinstance(items, list):
                return [item for item in items if isinstance(item, dict)]
            if isinstance(items, dict):
                return [items]
            return [payload]
        return []

    def _strip_trailing_commas(blob: str) -> str:
        previous = None
        cleaned_blob = blob
        while cleaned_blob != previous:
            previous = cleaned_blob
            cleaned_blob = re.sub(r",(\s*[}\]])", r"\1", cleaned_blob)
        return cleaned_blob

    def _try_load(blob: str) -> Any:
        candidate = _strip_trailing_commas(blob.strip())
        if not candidate:
            return None
        try:
            return json.loads(candidate)
        except json.JSONDecodeError:
            try:
                import ast
                return ast.literal_eval(candidate)
            except Exception:
                return None

    def _balanced_slices(source: str, open_char: str, close_char: str) -> List[str]:
        slices: List[str] = []
        depth = 0
        start_idx: Optional[int] = None
        in_string = False
        escaped = False
        for idx, ch in enumerate(source):
            if escaped:
                escaped = False
                continue
            if ch == "\\":
                escaped = True
                continue
            if ch == '"':
                in_string = not in_string
                continue
            if in_string:
                continue
            if ch == open_char:
                if depth == 0:
                    start_idx = idx
                depth += 1
            elif ch == close_char and depth > 0:
                depth -= 1
                if depth == 0 and start_idx is not None:
                    slices.append(source[start_idx: idx + 1])
                    start_idx = None
        return slices

    def _try_payload(blob: str) -> List[Dict[str, Any]]:
        parsed = _try_load(blob)
        if parsed is None:
            return []
        return _payload_to_items(parsed)

    direct_items = _try_payload(raw)
    if direct_items:
        return direct_items

    extracted = _extract_json_blob(raw)
    if extracted:
        extracted_items = _try_payload(extracted)
        if extracted_items:
            return extracted_items

    for array_blob in _balanced_slices(raw, "[", "]"):
        items = _try_payload(array_blob)
        if items:
            return items

    recovered_items: List[Dict[str, Any]] = []
    for object_blob in _balanced_slices(raw, "{", "}"):
        parsed = _try_load(object_blob)
        if parsed is None:
            continue
        recovered_items.extend(_payload_to_items(parsed))
    if recovered_items:
        return recovered_items

    return []


def _extract_json_blob(text: str) -> str:
    if not text:
        return ""
    direct = text.strip().replace("```json", "").replace("```", "").strip()
    if direct.startswith("{") or direct.startswith("["):
        return direct
    match = re.search(r"(\{.*\}|\[.*\])", direct, flags=re.DOTALL)
    if match:
        return match.group(1).strip()
    return ""


def _is_generic_option_set(options: List[Dict[str, Any]]) -> bool:
    if not options:
        return True
    return all(bool(re.match(r"^\s*option\s+\d+\s*$", str(opt.get("text") or ""), flags=re.IGNORECASE)) for opt in options)


def _normalize_option_compare_text(value: str) -> str:
    text = str(value or "").strip().lower()
    text = re.sub(r"\s+", " ", text)
    return re.sub(r"[^a-z0-9 ]+", "", text)


def _inline_markdown_to_html(text: str) -> str:
    escaped = html.escape(str(text or "").strip(), quote=False)
    escaped = re.sub(r"\*\*(.+?)\*\*", r"<strong>\1</strong>", escaped)
    escaped = re.sub(r"__(.+?)__", r"<strong>\1</strong>", escaped)
    escaped = re.sub(r"\*(.+?)\*", r"<em>\1</em>", escaped)
    escaped = re.sub(r"_(.+?)_", r"<em>\1</em>", escaped)
    return escaped


def _text_to_simple_html(text: str) -> str:
    lines = [line.rstrip() for line in str(text or "").replace("\r\n", "\n").split("\n")]
    parts: List[str] = []
    paragraph_chunks: List[str] = []
    in_list = False

    def flush_paragraph() -> None:
        nonlocal paragraph_chunks
        if not paragraph_chunks:
            return
        parts.append(f"<p>{' '.join(paragraph_chunks)}</p>")
        paragraph_chunks = []

    for raw_line in lines:
        line = raw_line.strip()
        if not line:
            flush_paragraph()
            if in_list:
                parts.append("</ul>")
                in_list = False
            continue

        bullet_match = re.match(r"^[-*•]\s+(.+)$", line)
        if bullet_match:
            flush_paragraph()
            if not in_list:
                parts.append("<ul>")
                in_list = True
            parts.append(f"<li>{_inline_markdown_to_html(bullet_match.group(1))}</li>")
            continue

        if in_list:
            parts.append("</ul>")
            in_list = False
        paragraph_chunks.append(_inline_markdown_to_html(line))

    flush_paragraph()
    if in_list:
        parts.append("</ul>")

    return "".join(parts).strip()


def _normalize_explanation_html(value: Any) -> Optional[str]:
    if value is None:
        return None

    if isinstance(value, dict):
        bullet_lines = []
        for key, raw_val in value.items():
            key_label = str(key or "").replace("_", " ").strip().title()
            val_text = str(raw_val or "").strip()
            if not val_text:
                continue
            bullet_lines.append(f"- {key_label}: {val_text}")
        html_out = _text_to_simple_html("\n".join(bullet_lines))
        return html_out or None

    raw_text = str(value or "").strip()
    if not raw_text:
        return None

    if raw_text.startswith("{") and raw_text.endswith("}"):
        try:
            parsed = json.loads(raw_text)
            if isinstance(parsed, dict):
                return _normalize_explanation_html(parsed)
        except json.JSONDecodeError:
            pass

    if re.search(r"<\s*[a-z][^>]*>", raw_text, flags=re.IGNORECASE):
        return raw_text

    html_out = _text_to_simple_html(raw_text)
    return html_out or None


def _extract_example_prompt_template(example_questions: Optional[List[str]]) -> Optional[str]:
    if not example_questions:
        return None
    prompts: Dict[str, int] = {}
    for example in example_questions:
        if not isinstance(example, str) or not example.strip():
            continue
        lines = [line.strip() for line in example.splitlines() if line.strip()]
        for line in lines:
            lowered = line.lower()
            if "?" in line and re.search(r"\b(which|select|correct|following|above)\b", lowered):
                prompts[line] = prompts.get(line, 0) + 1
    if not prompts:
        return None
    return max(prompts.items(), key=lambda item: (item[1], len(item[0])))[0]


def _split_statement_structure(text: str) -> tuple[str, List[str], Optional[str]]:
    if not text:
        return "", [], None
    raw_text = str(text)
    lines = [line.strip() for line in raw_text.splitlines() if line and line.strip()]
    if not lines:
        compact = re.sub(r"\s+", " ", raw_text.strip())
        lines = [compact] if compact else []

    statement_indices: List[int] = []
    statements: List[str] = []
    prompt_idx: Optional[int] = None
    prompt_text: Optional[str] = None
    statement_line_re = re.compile(
        r"^\s*(?:statement\s*(?:\d+|[ivxlcdm]+)|\d+|[ivxlcdm]+)\s*[:\).-]\s+",
        flags=re.IGNORECASE,
    )

    for idx, line in enumerate(lines):
        if statement_line_re.match(line):
            statement_indices.append(idx)
            statements.append(line)

    for idx, line in enumerate(lines):
        lowered = line.lower()
        if idx in statement_indices:
            continue
        if ("?" in line and re.search(r"\b(which|select|correct|following|above)\b", lowered)) or re.search(
            r"\bwhich one of the following\b|\bselect the correct answer\b|\bcorrect in respect of the above\b",
            lowered,
        ):
            prompt_idx = idx
            prompt_text = line
            break

    lead_lines = [line for idx, line in enumerate(lines) if idx not in statement_indices and idx != prompt_idx]
    lead_in = " ".join(lead_lines).strip()
    if statements:
        return lead_in, statements, prompt_text

    compact = re.sub(r"\s+", " ", raw_text.strip())
    if not compact:
        return "", [], None

    marker_pattern = r"statement\s*(?:\d+|[ivxlcdm]+)\s*[:\).-]"
    inline_re = re.compile(
        rf"(?is)\b({marker_pattern})\s*(.+?)(?=(?:\b{marker_pattern}\s*|\bwhich one of the following\b|\bwhich of the following\b|\bhow many of the above\b|\bhow many\b|\bselect(?:\s+the)?\s+correct\b|$))"
    )
    inline_matches = list(inline_re.finditer(compact))
    if len(inline_matches) >= 2:
        inline_statements: List[str] = []
        for match in inline_matches:
            prefix = re.sub(r"\s+", " ", str(match.group(1) or "").strip())
            body = re.sub(r"\s+", " ", str(match.group(2) or "").strip(" .;"))
            statement_line = f"{prefix} {body}".strip()
            if statement_line:
                inline_statements.append(statement_line)
        if inline_statements:
            first_idx = inline_matches[0].start()
            lead = compact[:first_idx].strip(" :-")
            tail = compact[inline_matches[-1].end():].strip()
            inline_prompt = None
            if tail:
                inline_prompt = tail
            if not inline_prompt:
                prompt_match = re.search(
                    r"(which one of the following[^?]*\?|which of the following[^?]*\?|how many of the above[^?]*\?|select(?:\s+the)?\s+correct[^?]*\?)",
                    compact,
                    flags=re.IGNORECASE,
                )
                if prompt_match:
                    inline_prompt = prompt_match.group(1).strip()
            return lead, inline_statements, inline_prompt

    return lead_in, statements, prompt_text


def _looks_like_statement_line(text: str) -> bool:
    return bool(
        re.match(
            r"^\s*(?:[-*•]\s*)?(?:(?:statement|fact)\s*)?(?:\(?[ivxlcdm]+\)?|\(?\d+\)?|[a-z])[\)\.:\-]\s+",
            str(text or "").strip(),
            flags=re.IGNORECASE,
        )
    )


def _coerce_statement_list(value: Any, *, _depth: int = 0) -> List[str]:
    if _depth > 4 or value is None:
        return []

    if isinstance(value, list):
        output: List[str] = []
        for item in value:
            output.extend(_coerce_statement_list(item, _depth=_depth + 1))
        return [text for text in output if text]

    if isinstance(value, dict):
        prioritized_keys = (
            "statements_facts",
            "statement_facts",
            "statements",
            "facts",
            "items",
            "statement",
            "fact",
            "text",
            "value",
            "content",
        )
        for key in prioritized_keys:
            if key in value:
                nested = _coerce_statement_list(value.get(key), _depth=_depth + 1)
                if nested:
                    return nested

        output: List[str] = []
        for raw_key, raw_val in value.items():
            nested = _coerce_statement_list(raw_val, _depth=_depth + 1)
            if not nested:
                continue
            key_text = str(raw_key or "").strip()
            if key_text and re.match(r"^(?:statement\s*)?(?:\d+|[ivxlcdm]+|[a-z])$", key_text, flags=re.IGNORECASE):
                for text in nested:
                    if _looks_like_statement_line(text):
                        output.append(text)
                    else:
                        output.append(f"{key_text}: {text}")
                continue
            output.extend(nested)
        return [text for text in output if text]

    text = str(value or "").strip()
    if not text:
        return []

    _, extracted, _ = _split_statement_structure(text)
    if extracted:
        return [str(item).strip() for item in extracted if str(item).strip()]

    lines = [line.strip() for line in text.splitlines() if line and line.strip()]
    if lines:
        statement_lines = [line for line in lines if _looks_like_statement_line(line)]
        if statement_lines:
            return statement_lines
        if len(lines) > 1:
            return lines

    return [text]


def _extract_question_statements(question: Dict[str, Any]) -> List[str]:
    if not isinstance(question, dict):
        return []

    statement_keys = (
        "statements_facts",
        "statement_facts",
        "statementsFacts",
        "statementFacts",
        "statements",
        "statement",
        "facts",
        "fact_statements",
    )
    for key in statement_keys:
        statements = _coerce_statement_list(question.get(key))
        if statements:
            return statements

    supplementary_text = str(
        question.get("supp_question_statement")
        or question.get("supplementary_statement")
        or question.get("supplementary")
        or ""
    ).strip()
    if supplementary_text:
        _, extracted, _ = _split_statement_structure(supplementary_text)
        if extracted:
            return [str(item).strip() for item in extracted if str(item).strip()]

    question_text = str(
        question.get("question_statement")
        or question.get("question_text")
        or question.get("question")
        or ""
    ).strip()
    if question_text:
        _, extracted, _ = _split_statement_structure(question_text)
        if extracted:
            return [str(item).strip() for item in extracted if str(item).strip()]

    return []


def _question_contains_statement_markers(text: str) -> bool:
    if not text:
        return False
    return bool(
        re.search(
            r"\bstatement\s*(?:\d+|[ivxlcdm]+)\b",
            str(text),
            flags=re.IGNORECASE,
        )
    )


def _looks_like_prompt_text(text: str) -> bool:
    cleaned = str(text or "").strip()
    if not cleaned:
        return False
    lowered = cleaned.lower()
    if "?" in cleaned:
        return True
    return bool(
        re.search(
            r"^(which|what|how many|how much|who|whom|where|when|select|choose|identify|find|determine|correct|true|false)\b",
            lowered,
        )
    )


def _build_options_from_template(
    template: List[str],
    answer_value: Any,
) -> List[Dict[str, Any]]:
    opts: List[Dict[str, Any]] = []
    for idx, text in enumerate(template[:5]):
        cleaned = str(text or "").strip()
        if not cleaned:
            continue
        opts.append({"label": chr(ord("A") + idx), "text": cleaned, "is_correct": False})
    if len(opts) < 2:
        return []
    answer_label = _normalize_answer_label(answer_value, [str(o.get("text") or "") for o in opts])
    return [{**opt, "is_correct": opt.get("label") == answer_label} for opt in opts[:5]]


def _options_overlap_with_template(options: List[Dict[str, Any]], template: Optional[List[str]]) -> int:
    if not template:
        return 0
    current = {_normalize_option_compare_text(str(opt.get("text") or "")) for opt in options if str(opt.get("text") or "").strip()}
    expected = {_normalize_option_compare_text(str(text or "")) for text in template if str(text or "").strip()}
    current.discard("")
    expected.discard("")
    if not current or not expected:
        return 0
    return len(current.intersection(expected))


def _enforce_example_format_on_batch(
    questions: List[Dict[str, Any]],
    example_format_spec: Optional[Dict[str, Any]],
    example_option_template: Optional[List[str]],
    example_prompt_template: Optional[str],
) -> None:
    if not questions:
        return
    spec = example_format_spec or {}

    expects_statements = bool(spec.get("expects_statements"))
    requires_prompt = bool(spec.get("requires_prompt"))
    requires_lead_in = bool(spec.get("requires_lead_in"))
    expected_item_count = spec.get("expected_item_count")
    template_is_statement_style = bool(
        example_option_template
        and any("statement i" in str(text).lower() for text in example_option_template)
    )

    for question in questions:
        question_text = str(question.get("question_statement") or "").strip()
        supplementary = str(question.get("supp_question_statement") or question.get("supplementary_statement") or "").strip()
        prompt = str(question.get("question_prompt") or "").strip() or None
        statements = _extract_question_statements(question)

        lead, extracted_statements, extracted_prompt = _split_statement_structure(question_text)
        if extracted_statements:
            if not statements:
                statements = extracted_statements
            if lead:
                question_text = lead
            elif requires_lead_in:
                question_text = "Consider the following statements:"
            if not prompt and extracted_prompt:
                prompt = extracted_prompt

        if expects_statements:
            if not statements:
                lead, extracted_statements, extracted_prompt = _split_statement_structure(question_text)
                if extracted_statements:
                    statements = extracted_statements
                    if lead:
                        question_text = lead
                    elif requires_lead_in:
                        question_text = "Consider the following statements:"
                if not prompt and extracted_prompt:
                    prompt = extracted_prompt

            if not statements and supplementary:
                _, extracted_statements, extracted_prompt = _split_statement_structure(supplementary)
                if extracted_statements:
                    statements = extracted_statements
                if not prompt and extracted_prompt:
                    prompt = extracted_prompt

            if requires_prompt and not prompt:
                # Do not overwrite a valid question prompt already present in question_text.
                if question_text and _looks_like_prompt_text(question_text):
                    prompt = question_text
                elif example_prompt_template:
                    prompt = example_prompt_template
                elif not question_text:
                    prompt = "Which one of the following is correct in respect of the above statements?"

            if requires_lead_in and not question_text:
                question_text = "Consider the following statements:"

            # Keep statement count flexible; do not hard-truncate to example count.
            # UPSC list-based questions can validly contain varying numbers of statements.

            options = question.get("options")
            if not isinstance(options, list):
                options = []
            if template_is_statement_style and example_option_template and len(example_option_template) >= 4:
                overlap = _options_overlap_with_template(options, example_option_template)
                if _is_generic_option_set(options) or overlap < 2:
                    templated_options = _build_options_from_template(
                        example_option_template,
                        question.get("correct_answer") or question.get("answer"),
                    )
                    if len(templated_options) >= 4:
                        options = templated_options

            question["options"] = options

        if statements:
            if question_text and prompt and _looks_like_prompt_text(question_text) and not _looks_like_prompt_text(prompt):
                question_text, prompt = prompt, question_text
            if question_text and _looks_like_prompt_text(question_text):
                if not prompt:
                    prompt = question_text
                question_text = "Consider the following statements:"
            elif not question_text:
                if prompt and not _looks_like_prompt_text(prompt):
                    question_text = prompt
                    prompt = None
                else:
                    question_text = "Consider the following statements:"
            if prompt and not _looks_like_prompt_text(prompt) and _looks_like_prompt_text(question_text):
                question_text, prompt = prompt, question_text

        if statements and _question_contains_statement_markers(question_text):
            lead_only, _, lead_prompt = _split_statement_structure(question_text)
            if lead_only:
                question_text = lead_only
            elif requires_lead_in:
                question_text = "Consider the following statements:"
            if not prompt and lead_prompt:
                prompt = lead_prompt
        question_text = question_text.strip()

        question["question_statement"] = question_text
        question["question_prompt"] = prompt
        question["statements_facts"] = statements
        question["statement_facts"] = statements


def _label_to_index(label: str) -> int:
    cleaned = str(label or "").strip().upper()
    if cleaned in {"A", "B", "C", "D", "E"}:
        return ord(cleaned) - ord("A")
    try:
        numeric = int(cleaned)
        if 1 <= numeric <= 5:
            return numeric - 1
    except ValueError:
        pass
    return 99


def _normalize_options_input(options_in: Any) -> List[Dict[str, Any]]:
    options: List[Dict[str, Any]] = []
    if isinstance(options_in, list):
        for opt_idx, opt in enumerate(options_in):
            default_label = chr(ord("A") + opt_idx)
            if isinstance(opt, str):
                options.append({"label": default_label, "text": opt.strip(), "is_correct": False})
            elif isinstance(opt, dict):
                label = str(
                    opt.get("label")
                    or opt.get("option_label")
                    or opt.get("option")
                    or default_label
                ).upper()
                if label.startswith("OPTION "):
                    label = label.replace("OPTION ", "").strip()
                if label in {"1", "2", "3", "4", "5"}:
                    label = chr(ord("A") + int(label) - 1)
                if label not in {"A", "B", "C", "D", "E"}:
                    label = default_label
                options.append(
                    {
                        "label": label,
                        "text": str(
                            opt.get("text")
                            or opt.get("option_text")
                            or opt.get("value")
                            or opt.get("option_value")
                            or ""
                        ).strip(),
                        "is_correct": bool(opt.get("is_correct")),
                    }
                )
    elif isinstance(options_in, dict):
        normalized_pairs: List[tuple[int, str, str]] = []
        for raw_label, raw_value in options_in.items():
            label_guess = str(raw_label or "").strip()
            label_norm = label_guess.upper() if label_guess else ""
            text_value = ""
            if isinstance(raw_value, str):
                text_value = raw_value.strip()
            elif isinstance(raw_value, dict):
                text_value = str(
                    raw_value.get("text")
                    or raw_value.get("option_text")
                    or raw_value.get("value")
                    or raw_value.get("option_value")
                    or ""
                ).strip()
                label_norm = str(
                    raw_value.get("label")
                    or raw_value.get("option_label")
                    or label_norm
                ).strip().upper()
            if label_norm.startswith("OPTION "):
                label_norm = label_norm.replace("OPTION ", "").strip()
            if label_norm in {"1", "2", "3", "4", "5"}:
                label_norm = chr(ord("A") + int(label_norm) - 1)
            if label_norm not in {"A", "B", "C", "D", "E"}:
                label_norm = chr(ord("A") + len(normalized_pairs))
            normalized_pairs.append((_label_to_index(label_norm), label_norm, text_value))
        normalized_pairs.sort(key=lambda item: item[0])
        for _, label_norm, text_value in normalized_pairs:
            options.append({"label": label_norm, "text": text_value, "is_correct": False})
    return [opt for opt in options if str(opt.get("text") or "").strip()]


def _extract_example_option_template(example_questions: Optional[List[str]]) -> Optional[List[str]]:
    if not example_questions:
        return None

    templates: Dict[tuple[str, ...], int] = {}
    option_letter_line_re = re.compile(r"^\s*[\(\[]?([A-Ea-e])[\)\]]?[\.\):-]?\s+(.+?)\s*$")
    option_numeric_line_re = re.compile(r"^\s*[\(\[]?([1-5])[\)\]]?[\.\):-]\s+(.+?)\s*$")
    answer_line_re = re.compile(r"^\s*ans(?:wer)?\b", flags=re.IGNORECASE)
    option_letter_marker_re = re.compile(r"[\(\[]?([A-Ea-e])[\)\]]?[\.\):-]?\s+")

    for example in example_questions:
        if not isinstance(example, str) or not example.strip():
            continue
        lines = [line.strip() for line in example.splitlines() if line and line.strip()]
        parsed_options: List[str] = []

        # Prefer A/B/C... style line options first.
        for line in lines:
            if answer_line_re.match(line):
                continue
            match = option_letter_line_re.match(line)
            if match:
                option_text = (match.group(2) or "").strip()
                if option_text:
                    parsed_options.append(option_text)

        # Fallback to numeric options only when we can identify a trailing option block.
        if len(parsed_options) < 2:
            numeric_rows: List[tuple[int, str]] = []
            for idx, line in enumerate(lines):
                if answer_line_re.match(line):
                    continue
                match = option_numeric_line_re.match(line)
                if match:
                    option_text = (match.group(2) or "").strip()
                    if option_text:
                        numeric_rows.append((idx, option_text))
            if len(numeric_rows) >= 2:
                answer_idx = next((idx for idx, line in enumerate(lines) if answer_line_re.match(line)), len(lines))
                candidates = [row for row in numeric_rows if row[0] < answer_idx]
                if candidates:
                    block_rev: List[tuple[int, str]] = []
                    prev_idx: Optional[int] = None
                    for row_idx, text in reversed(candidates):
                        if prev_idx is None or prev_idx - row_idx <= 1:
                            block_rev.append((row_idx, text))
                            prev_idx = row_idx
                        else:
                            break
                    numeric_block = [text for _, text in reversed(block_rev)]
                    if len(numeric_block) >= 2:
                        parsed_options = numeric_block

        if len(parsed_options) < 2:
            compact = re.sub(r"\s+", " ", example.strip())
            matches = list(option_letter_marker_re.finditer(compact))
            inline_options: List[str] = []
            if len(matches) >= 2:
                for idx, marker in enumerate(matches):
                    start = marker.end()
                    end = matches[idx + 1].start() if idx + 1 < len(matches) else len(compact)
                    candidate = compact[start:end].strip(" ;|,")
                    if candidate and not answer_line_re.match(candidate):
                        inline_options.append(candidate)
            if len(inline_options) >= 2:
                parsed_options = inline_options
        if len(parsed_options) >= 2:
            key = tuple(parsed_options[:5])
            templates[key] = templates.get(key, 0) + 1

    if not templates:
        return None
    best_template = max(templates.items(), key=lambda item: (item[1], len(item[0])))[0]
    return list(best_template)


def _should_apply_example_option_template(
    options: List[Dict[str, Any]],
    example_option_template: Optional[List[str]],
    statements_facts: Optional[List[Any]] = None,
) -> bool:
    if not example_option_template:
        return False
    # Never overwrite concrete model-generated options.
    # Apply template only when options are generic placeholders.
    return _is_generic_option_set(options)


def _apply_example_option_template_if_needed(
    options: List[Dict[str, Any]],
    example_option_template: Optional[List[str]],
    statements_facts: Optional[List[Any]] = None,
) -> List[Dict[str, Any]]:
    if not _should_apply_example_option_template(options, example_option_template, statements_facts):
        return options
    templated: List[Dict[str, Any]] = []
    for idx, text in enumerate(example_option_template[:5]):
        cleaned = str(text or "").strip()
        if not cleaned:
            continue
        templated.append(
            {
                "label": chr(ord("A") + idx),
                "text": cleaned,
                "is_correct": False,
            }
        )
    # Apply template only when it can provide a full MCQ option set.
    if len(templated) < 4:
        return options
    return templated


def _normalize_items(
    items: List[Dict[str, Any]],
    instruction_type: AIInstructionType,
    request: Optional[AIQuizGenerateRequest] = None,
) -> List[Dict[str, Any]]:
    if instruction_type != AIInstructionType.QUIZ_GEN:
        return items

    content_type = (request.content_type if request else "").lower()
    quiz_kind = (request.quiz_kind.value if request and request.quiz_kind else "").lower()
    is_passage_mode = ("passage" in content_type) or (quiz_kind == "passage")
    example_option_template = _extract_example_option_template(request.example_questions if request else None)
    example_format_spec = _extract_example_format_spec(request.example_questions if request and request.example_questions else [])
    example_prompt_template = _extract_example_prompt_template(request.example_questions if request else None)
    
    if is_passage_mode:
        normalized_passages: List[Dict[str, Any]] = []
        for raw in items:
            if not isinstance(raw, dict):
                continue
            questions_in = raw.get("questions")
            if not isinstance(questions_in, list):
                questions_in = [raw]
            passage_questions = []
            for q in questions_in:
                if not isinstance(q, dict):
                    continue
                options_in = q.get("options") or []
                options = _normalize_options_input(options_in)
                if len(options) == 0:
                    while len(options) < 4:
                        options.append(
                            {
                                "label": chr(ord("A") + len(options)),
                                "text": f"Option {len(options) + 1}",
                                "is_correct": False,
                            }
                        )
                statements = _extract_question_statements(q)
                options = _apply_example_option_template_if_needed(options, example_option_template, statements)
                answer_raw = (
                    q.get("correct_answer")
                    or q.get("correct_option")
                    or q.get("correctOption")
                    or q.get("answer")
                    or q.get("answer_key")
                    or q.get("answerKey")
                )
                answer = _normalize_answer_label(answer_raw, [o["text"] for o in options])
                options_with_correct = [{**opt, "is_correct": opt.get("label") == answer} for opt in options[:5]]
                supplementary = str(
                    q.get("supp_question_statement") or q.get("supplementary_statement") or q.get("supplementary") or ""
                ).strip() or None
                explanation = _normalize_explanation_html(q.get("explanation") or q.get("explanation_text"))
                passage_questions.append(
                    {
                        "question_statement": str(q.get("question_statement") or q.get("question_text") or q.get("question") or "").strip(),
                        "supp_question_statement": supplementary,
                        "supplementary_statement": supplementary,
                        "statements_facts": statements,
                        "statement_facts": statements,
                        "question_prompt": str(q.get("question_prompt") or q.get("prompt") or "").strip() or None,
                        "options": options_with_correct,
                        "correct_answer": answer,
                        "explanation": explanation,
                        "explanation_text": explanation,
                    }
                )
            _enforce_example_format_on_batch(
                passage_questions,
                example_format_spec,
                example_option_template,
                example_prompt_template,
            )

            passage_text = str(raw.get("passage_text") or raw.get("passage") or request.content if request else "").strip()
            if not passage_text and request and request.content:
                passage_text = request.content.strip()[:2000]
            source_reference = str(raw.get("source_reference") or raw.get("source") or "").strip() or None
            normalized_passages.append(
                {
                    "passage_title": str(raw.get("passage_title") or "").strip() or None,
                    "passage_text": passage_text,
                    "source_reference": source_reference,
                    "source": source_reference,
                    "questions": passage_questions,
                }
            )
        flattened_questions = []
        for passage in normalized_passages:
            passage_questions = passage.get("questions") or []
            if isinstance(passage_questions, list):
                flattened_questions.extend([q for q in passage_questions if isinstance(q, dict)])
        should_rebalance = not bool(request and request.example_questions)
        if should_rebalance:
            _rebalance_correct_answer_distribution(flattened_questions)
        return normalized_passages

    normalized: List[Dict[str, Any]] = []
    for raw in items:
        question_text = (
            raw.get("question_statement")
            or raw.get("question_text")
            or raw.get("question")
            or raw.get("title")
            or ""
        )
        options_in = raw.get("options") or []
        options = _normalize_options_input(options_in)
        if len(options) == 0:
            while len(options) < 4:
                options.append(
                    {
                        "label": chr(ord("A") + len(options)),
                        "text": f"Option {len(options) + 1}",
                        "is_correct": False,
                    }
                )
        statements = _extract_question_statements(raw)
        options = _apply_example_option_template_if_needed(options, example_option_template, statements)
        
        # Keep format neutral: do not force a single statement-style option template.
        # If the model did not provide options, generic placeholders stay as fallback.

        answer_raw = (
            raw.get("correct_answer")
            or raw.get("correct_option")
            or raw.get("correctOption")
            or raw.get("answer")
            or raw.get("answer_key")
            or raw.get("answerKey")
        )
        answer_label = _normalize_answer_label(answer_raw, [str(o.get("text") or "") for o in options])
        options_with_correct = [{**opt, "is_correct": opt.get("label") == answer_label} for opt in options[:5]]
        supplementary = str(
            raw.get("supplementary_statement") or raw.get("supp_question_statement") or raw.get("supplementary") or ""
        ).strip() or None

        explanation = _normalize_explanation_html(raw.get("explanation_text") or raw.get("explanation"))
        source_reference = str(raw.get("source_reference") or raw.get("source") or "").strip() or None

        normalized.append(
            {
                "question_statement": str(question_text).strip(),
                "options": options_with_correct,
                "correct_answer": answer_label,
                "explanation": explanation,
                "explanation_text": explanation,
                "question_prompt": str(raw.get("question_prompt") or raw.get("prompt") or "").strip() or None,
                "supp_question_statement": supplementary,
                "supplementary_statement": supplementary,
                "statements_facts": statements,
                "statement_facts": statements,
                "source_reference": source_reference,
                "source": source_reference,
            }
        )

    _enforce_example_format_on_batch(
        normalized,
        example_format_spec,
        example_option_template,
        example_prompt_template,
    )
    should_rebalance = not bool(request and request.example_questions)
    if should_rebalance:
        _rebalance_correct_answer_distribution(normalized)
    return normalized


def _normalize_answer_label(answer_value: Any, options: List[str]) -> str:
    if answer_value is None:
        return "A"
    answer_str = str(answer_value).strip()
    if not answer_str:
        return "A"
    upper = answer_str.upper()
    if upper in {"A", "B", "C", "D", "E"}:
        return upper
    if upper.startswith("OPTION "):
        maybe = upper.replace("OPTION ", "").strip()
        if maybe in {"A", "B", "C", "D", "E"}:
            return maybe
    try:
        numeric = int(answer_str)
        if 1 <= numeric <= len(options):
            return chr(ord("A") + numeric - 1)
        if 0 <= numeric < len(options):
            return chr(ord("A") + numeric)
    except ValueError:
        pass
    for idx, option in enumerate(options):
        if option.strip().lower() == answer_str.lower():
            return chr(ord("A") + idx)
    return "A"


def _explanation_mentions_option_label(explanation: Any) -> bool:
    if not isinstance(explanation, str):
        return False
    upper = explanation.upper()
    return bool(
        re.search(
            r"\bOPTION\s+[A-E]\b|\bCORRECT\s+ANSWER\s*[:\-]?\s*[A-E]\b|\b[A-E]\s*[\)\.]?\s+IS\s+CORRECT\b",
            upper,
        )
    )


def _rebalance_question_correct_label(question: Dict[str, Any], target_label: str) -> None:
    options = question.get("options")
    if not isinstance(options, list) or len(options) < 2:
        return

    option_dicts = [opt for opt in options if isinstance(opt, dict)]
    if len(option_dicts) < 2:
        return

    label_to_index: Dict[str, int] = {}
    option_texts: List[str] = []
    for idx, option in enumerate(option_dicts):
        label = str(option.get("label") or chr(ord("A") + idx)).upper().strip()
        if label and label not in label_to_index:
            label_to_index[label] = idx
        option_texts.append(str(option.get("text") or option.get("value") or ""))

    if target_label not in label_to_index:
        return

    current_label = _normalize_answer_label(question.get("correct_answer") or question.get("answer"), option_texts)
    if current_label not in label_to_index:
        return

    explanation = question.get("explanation_text") or question.get("explanation")
    if current_label != target_label and _explanation_mentions_option_label(explanation):
        return

    if current_label != target_label:
        current_idx = label_to_index[current_label]
        target_idx = label_to_index[target_label]
        current_text = option_dicts[current_idx].get("text")
        target_text = option_dicts[target_idx].get("text")
        option_dicts[current_idx]["text"] = "" if target_text is None else str(target_text)
        option_dicts[target_idx]["text"] = "" if current_text is None else str(current_text)

    question["correct_answer"] = target_label
    question["answer"] = target_label
    for option in option_dicts:
        label = str(option.get("label") or "").upper().strip()
        option["is_correct"] = label == target_label


def _rebalance_correct_answer_distribution(questions: List[Dict[str, Any]]) -> None:
    if len(questions) < 2:
        return
    labels = ["A", "B", "C", "D"]
    seed_source = str(questions[0].get("question_statement") or "")
    seed_offset = sum(ord(ch) for ch in seed_source[:30]) % len(labels) if seed_source else 0
    targets = [labels[(seed_offset + idx) % len(labels)] for idx in range(len(questions))]
    for question, target_label in zip(questions, targets):
        _rebalance_question_correct_label(question, target_label)


def _offline_fallback_quiz_items(request: AIQuizGenerateRequest, error_message: Optional[str] = None) -> List[Dict[str, Any]]:
    source = (request.content or "").strip()
    sentences = _extract_candidate_sentences(source)
    count = max(1, min(int(request.count or 5), 20))
    content_type = (request.content_type or "").lower()
    quiz_kind = (request.quiz_kind.value if request.quiz_kind else "").lower()
    is_passage = ("passage" in content_type) or (quiz_kind == "passage")
    is_maths = ("math" in content_type) or (quiz_kind == "maths")

    if is_passage:
        questions: List[Dict[str, Any]] = []
        for idx in range(count):
            snippet = sentences[idx % len(sentences)]
            questions.append(_build_offline_question(snippet, idx + 1, is_maths=False, error_message=error_message))
        passage_text = " ".join(sentences[: min(8, len(sentences))]).strip()
        return [
            {
                "passage_title": "Offline Fallback Passage",
                "passage_text": passage_text,
                "source_reference": "offline-fallback",
                "questions": questions,
            }
        ]

    items: List[Dict[str, Any]] = []
    for idx in range(count):
        snippet = sentences[idx % len(sentences)]
        item = _build_offline_question(snippet, idx + 1, is_maths=is_maths, error_message=error_message)
        item["source_reference"] = "offline-fallback"
        item["source"] = "offline-fallback"
        items.append(item)
    return items


def _extract_candidate_sentences(content: str) -> List[str]:
    cleaned = re.sub(r"\s+", " ", content).strip()
    if not cleaned:
        return ["No source content was provided."]
    candidates = re.split(r"[.!?\n]+", cleaned)
    sentences = [c.strip() for c in candidates if c and len(c.strip()) >= 20]
    if not sentences:
        sentences = [cleaned[:240]]
    return sentences[:30]


def _build_offline_question(snippet: str, idx: int, is_maths: bool = False, error_message: Optional[str] = None) -> Dict[str, Any]:
    short_snippet = snippet[:220].strip()
    if is_maths:
        question = f"Q{idx}. Based on the source, which interpretation is most logically consistent with: \"{short_snippet}\" pip?"
    else:
        question = f"Q{idx}. Which statement best aligns with the source excerpt: \"{short_snippet}\"?"

    options = [
        {"label": "A", "text": "It directly reflects the key idea in the excerpt.", "is_correct": True},
        {"label": "B", "text": "It contradicts the main claim presented in the excerpt.", "is_correct": False},
        {"label": "C", "text": "It discusses an unrelated issue not present in the excerpt.", "is_correct": False},
        {"label": "D", "text": "It cannot be inferred from the information in the excerpt.", "is_correct": False},
    ]
    
    prompt = None
    if error_message:
         prompt = f"Fallback generation triggered: {error_message}"
         
    return {
        "question_statement": question,
        "supp_question_statement": None,
        "supplementary_statement": None,
        "statements_facts": [short_snippet],
        "statement_facts": [short_snippet],
        "question_prompt": prompt,
        "options": options,
        "correct_answer": "A",
        "explanation": f"Fallback mode selected option A. {error_message if error_message else ''}",
        "explanation_text": f"Fallback mode selected option A. {error_message if error_message else ''}",
    }


async def evaluate_mains_answer(
    request: MainsEvaluationRequest,
    instructions: str,
) -> Dict[str, Any]:
    provider = (request.ai_provider or "gemini").strip().lower()
    model_name = request.ai_model_name or "gemini-3-flash-preview"
    user_prompt = f"Question: {request.question_text}\n\n"
    if request.model_answer:
        user_prompt += f"Model Answer: {request.model_answer}\n\n"
    user_prompt += f"Student Answer: {request.answer_text}\n\n"
    if request.answer_formatting_guidance:
        answer_style_guidance = str(request.answer_formatting_guidance or "").strip()
        if answer_style_guidance:
            user_prompt += (
                "Use this answer-writing style guidance as an evaluation rubric (structure/tone/depth checks):\n"
                f"{answer_style_guidance}\n\n"
            )
    user_prompt += (
        "Policy: Do NOT generate a new model/improved answer. "
        "Use the provided model answer as the reference and return it unchanged in improved_answer (or null if not provided).\n\n"
    )
    user_prompt += "Evaluate this answer strictly according to the provided instructions."

    raw_text = ""
    if provider == "gemini" and GEMINI_API_KEY:
        model = genai.GenerativeModel(model_name)
        response = await model.generate_content_async(f"{instructions}\n\n{user_prompt}")
        raw_text = response.text or ""
    elif provider == "openai" and openai_client:
        completion = await openai_client.chat.completions.create(
            model=model_name if "gpt" in model_name else "gpt-4o",
            messages=[
                {"role": "system", "content": instructions},
                {"role": "user", "content": user_prompt},
            ],
            response_format={"type": "json_object"},
        )
        raw_text = completion.choices[0].message.content or ""
    else:
        if GEMINI_API_KEY:
            model = genai.GenerativeModel("gemini-3-flash-preview")
            response = await model.generate_content_async(f"{instructions}\n\n{user_prompt}")
            raw_text = response.text or ""
        else:
            raise RuntimeError("No AI provider available for evaluation.")

    cleaned = _extract_json_blob(raw_text)
    try:
        parsed = json.loads(cleaned)
        if not isinstance(parsed, dict):
            parsed = {}
        parsed["improved_answer"] = request.model_answer or None
        return parsed
    except json.JSONDecodeError:
        return {
            "score": 0,
            "feedback": raw_text,
            "strengths": [],
            "weaknesses": [],
            "improved_answer": request.model_answer or None,
        }


async def extract_text_from_images(request: OCRRequest) -> str:
    model_name = request.ai_model_name or "gemini-3-flash-preview"
    if not GEMINI_API_KEY:
        raise RuntimeError("Gemini API key is required for OCR/Vision tasks.")
    model = genai.GenerativeModel(model_name)
    all_texts = []
    images_to_process = []
    if request.images_base64:
        images_to_process.extend(request.images_base64)
    elif request.image_base64:
        images_to_process.append(request.image_base64)

    for img_b64 in images_to_process:
        mime_type = "image/jpeg"
        data_str = img_b64
        if "," in img_b64:
            header, extracted_data = img_b64.split(",", 1)
            data_str = extracted_data
            if header.startswith("data:") and ";base64" in header:
                mime_type = header.split(";")[0].replace("data:", "")
        image_data = base64.b64decode(data_str)
        response = await model.generate_content_async(
            [
                "Transcribe all text from this image exactly as written. If it's a handwritten UPSC answer, preserve the structure (headings, bullet points). Do not add any preamble or commentary.",
                {"mime_type": mime_type, "data": image_data},
            ]
        )
        all_texts.append(response.text or "")
    return "\n\n".join(all_texts)


async def analyze_style_profile(
    content_type: str,
    examples: List[str],
    provider: str = "gemini",
    model_name: str = "gemini-3-flash-preview",
    system_prompt_override: Optional[str] = None,
) -> Dict[str, Any]:
    system_prompt = system_prompt_override or _style_profile_system_instructions(content_type)
    
    user_prompt = (
        f"Analyze these examples for Content Type: {content_type}\n\n"
        "EXAMPLES:\n" + "\n---\n".join(examples) + "\n\n"
        "Extract the formatting and evaluation instructions that would allow an AI to replicate this exact style."
    )

    raw_text = ""
    json_instruction = "Return the result as a raw JSON object. Do not include markdown code fences (like ```json ... ```)."

    if provider == "gemini" and GEMINI_API_KEY:
        model = genai.GenerativeModel(model_name)
        response = await model.generate_content_async(f"{system_prompt}\n\n{user_prompt}\n\n{json_instruction}")
        raw_text = response.text or ""
    elif provider == "openai" and openai_client:
        completion = await openai_client.chat.completions.create(
            model="gpt-4o",
            messages=[
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": f"{user_prompt}\n\n{json_instruction}"},
            ],
            response_format={"type": "json_object"},
        )
        raw_text = completion.choices[0].message.content or ""

    cleaned = _extract_json_blob(raw_text)
    try:
        profile = json.loads(cleaned)
        return {"style_profile": profile}
    except json.JSONDecodeError:
        return {"style_profile": {"style_instructions": raw_text, "parse_error": True}}


async def refine_style_profile(
    current_profile: Dict[str, Any],
    feedback: str,
    provider: str = "gemini",
    model_name: str = "gemini-3-flash-preview",
) -> Dict[str, Any]:
    system_prompt = (
        "You are an AI that refines system instructions. "
        "Update the provided style profile based on the user's feedback. "
        "Return strict JSON matching the input structure."
    )
    user_prompt = (
        f"Current Profile: {json.dumps(current_profile)}\n\n"
        f"User Feedback: {feedback}\n\n"
        "Produce an updated version of the style profile."
    )
    
    json_instruction = "Return the result as a raw JSON object. Do not include markdown code fences."

    raw_text = ""
    if provider == "gemini" and GEMINI_API_KEY:
        model = genai.GenerativeModel(model_name)
        response = await model.generate_content_async(f"{system_prompt}\n\n{user_prompt}\n\n{json_instruction}")
        raw_text = response.text or ""
    elif provider == "openai" and openai_client:
        completion = await openai_client.chat.completions.create(
            model="gpt-4o",
            messages=[
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": f"{user_prompt}\n\n{json_instruction}"},
            ],
            response_format={"type": "json_object"},
        )
        raw_text = completion.choices[0].message.content or ""

    cleaned = _extract_json_blob(raw_text)
    try:
        profile = json.loads(cleaned)
        return {"style_profile": profile}
    except json.JSONDecodeError:
        return {"style_profile": current_profile}

async def generate_mains_questions(
    request: MainsAIGenerateRequest,
    system_instructions: str,
    evaluation_sync_guidance: Optional[str] = None,
) -> List[Dict[str, Any]]:
    provider = (request.ai_provider or AIProvider.GEMINI).value.strip().lower()
    model_name = request.ai_model_name or "gemini-3-flash-preview"

    prompt = (
        f"Source Content: {request.content or request.url}\n\n"
        f"Task: Generate {request.number_of_questions} Mains questions based on the source content. "
        f"Each question must have a 'word_limit' of approximately {request.word_limit} words for the model answer.\n\n"
        "MANDATORY Answer Approach format:\n"
        "1) Use HTML with exactly two sections: <h3>Understand the Question</h3> and <h3>Answer Approach</h3>.\n"
        "2) In 'Understand the Question', start with 'Expected Answer Type:' and break the question into clear parts.\n"
        "3) Interpret directive keywords (e.g., 'critically examine' = balanced pros + cons + judgement; "
        "'evaluate' = criteria-based appraisal; 'analyze' = causes/effects/links). Do NOT list raw keywords; explain what each demands.\n"
        "4) Explain how to cover each part/aspect of the question.\n"
        "5) In 'Answer Approach', outline the structure based on the directive and the parts, with ordered sub-sections.\n"
        "6) Use <ul><li> for bullets; do NOT output empty <li> or empty <ul>/<ol>. If no bullets are needed, use <p> text.\n\n"
        "MODEL ANSWER QUALITY (MANDATORY):\n"
        "1) Avoid monolithic paragraphs. Use headings/sub-headings and compact bullet points for each dimension.\n"
        "2) Ensure diversity of points: cover multiple dimensions in smaller, crisp points (not one long narrative).\n"
        "3) Maintain balance where the directive requires it (e.g., 'critically examine' needs both positives and negatives plus a judgement).\n\n"
        "IMPORTANT: Format the 'model_answer' using semantic HTML tags (<h3>, <p>, <ul>, <li>, <strong>) to structure the Introduction, Body points, and Conclusion clearly. "
        "Do NOT use Markdown. Ensure the answer looks professional and is easy to read."
    )
    if request.example_formatting_guidance:
        prompt += f"\n\nQUESTION STYLE GUIDANCE (MANDATORY): {request.example_formatting_guidance}"
    if request.answer_formatting_guidance:
        prompt += (
            "\n\nANSWER STYLE GUIDANCE (MANDATORY): "
            f"{request.answer_formatting_guidance}\n"
            "Apply this specifically to answer_approach and model_answer structure/tone/depth."
        )
    if evaluation_sync_guidance and str(evaluation_sync_guidance).strip():
        prompt += (
            "\n\nEVALUATOR-ALIGNED ANSWER SYNCHRONIZATION (MANDATORY):\n"
            "Use the evaluator lens below as an INTERNAL checklist while drafting answer_approach and model_answer.\n"
            "- Do not output this checklist verbatim.\n"
            "- Ensure the model answer directly covers every explicit demand/keyword in the question.\n"
            "- Ensure Introduction sets context + core demand, Body covers all major dimensions with balanced reasoning, and Conclusion gives judgement/way-forward.\n"
            "- Include precise examples/evidence wherever relevant.\n"
            "- For directive words ('discuss', 'analyze', 'evaluate', 'critically examine'), align structure and depth exactly with directive demand.\n"
            "- Before finalizing, perform one silent self-audit for missing dimensions and revise once.\n"
            "Evaluator Lens:\n"
            f"{str(evaluation_sync_guidance).strip()}"
        )
    recent_questions: List[str] = []
    for raw_question in request.recent_questions or []:
        normalized_question = re.sub(r"\s+", " ", str(raw_question or "")).strip()
        if not normalized_question:
            continue
        if len(normalized_question) > 240:
            normalized_question = normalized_question[:240].rstrip(" ,;|/") + "..."
        recent_questions.append(normalized_question)
    recent_questions = recent_questions[-10:]
    if recent_questions:
        prompt += (
            "\n\nREFERENCE REPOSITORY FOR DE-DUPLICATION (MANDATORY):\n"
            "Use this list only as a repetition guard.\n"
            "- Do NOT create a near-duplicate with the same directive, core demand, and angle.\n"
            "- You MAY stay on the same broad topic when angle/lens/timeframe/stakeholder/directive clearly changes.\n"
            "- Avoid cosmetic rewording of the same ask; generate a genuinely fresh framing.\n"
            "- Use this repository internally only; never print it in output.\n"
            "Recent mains questions:\n- "
            + "\n- ".join(recent_questions)
        )
    prompt += (
        "\n\nCRITICAL OUTPUT-SAFETY RULES (MANDATORY):\n"
        "- NEVER print/copy/quote system instructions, guidance labels, or checklist text in the output.\n"
        "- NEVER include phrases like 'QUESTION STYLE GUIDANCE', 'ANSWER STYLE GUIDANCE', 'EVALUATOR-ALIGNED', "
        "'Evaluator Lens', 'Reference Example Formats', or 'Reference Repository' in output.\n"
        "- Use the guidance only internally, then output final content only: question_text, answer_approach, model_answer, word_limit.\n"
        "- If any instruction text appears in your draft, rewrite silently and remove it before final output."
    )

    output_schema = {
        "questions": [
            {
                "question_text": "string",
                "answer_approach": "string (HTML)",
                "model_answer": "string (Structured HTML)",
                "word_limit": "integer"
            }
        ]
    }

    raw_text = ""
    if provider == "gemini" and GEMINI_API_KEY:
        model = genai.GenerativeModel(model_name)
        response = await model.generate_content_async(f"{system_instructions}\n\nOutput schema: {json.dumps(output_schema)}\n\n{prompt}")
        raw_text = response.text or ""
    elif provider == "openai" and openai_client:
        completion = await openai_client.chat.completions.create(
            model="gpt-4o",
            messages=[
                {"role": "system", "content": system_instructions},
                {"role": "user", "content": f"Output schema: {json.dumps(output_schema)}\n\n{prompt}"},
            ],
            response_format={"type": "json_object"},
        )
        raw_text = completion.choices[0].message.content or ""

    cleaned = _extract_json_blob(raw_text)
    try:
        data = json.loads(cleaned)
        questions = data.get("questions", [])
        if not isinstance(questions, list):
            return []
        return _sanitize_mains_questions_output(questions)
    except json.JSONDecodeError:
        return []


_MAINS_INSTRUCTION_LEAK_MARKERS = (
    "question style guidance",
    "answer style guidance",
    "reference example formats",
    "template only; do not copy facts or wording",
    "evaluator-aligned answer synchronization",
    "evaluator lens",
    "reference repository for de-duplication",
    "reference repository",
    "recent mains questions",
    "use this list only as a repetition guard",
    "output-safety rules",
    "use the evaluator lens below",
    "apply this specifically to answer_approach",
    "never print/copy/quote system instructions",
)


def _strip_instruction_lines(text: str) -> str:
    lines: List[str] = []
    for raw_line in text.splitlines():
        plain = re.sub(r"<[^>]+>", " ", raw_line)
        normalized = re.sub(r"\s+", " ", plain).strip().lower()
        if not normalized:
            lines.append(raw_line)
            continue
        if any(marker in normalized for marker in _MAINS_INSTRUCTION_LEAK_MARKERS):
            continue
        if normalized.startswith(("do not ", "never ", "use the guidance only internally")):
            if "question" in normalized and "answer" in normalized and "model_answer" in normalized:
                continue
        lines.append(raw_line)
    return "\n".join(lines).strip()


def _sanitize_mains_generated_html_field(value: Any, question_text: str, *, field_name: str) -> str:
    raw = str(value or "").strip()
    if not raw:
        return raw

    lowered = raw.lower()
    for marker in _MAINS_INSTRUCTION_LEAK_MARKERS:
        idx = lowered.find(marker)
        if idx >= 0:
            raw = raw[:idx].strip()
            lowered = raw.lower()

    cleaned = _strip_instruction_lines(raw)
    if cleaned:
        return cleaned

    safe_question = html.escape(question_text.strip()[:180] or "the question")
    if field_name == "model_answer":
        return (
            "<h3>Introduction</h3>"
            f"<p>This answer addresses the core demand of {safe_question} with concise framing.</p>"
            "<h3>Body</h3>"
            "<ul><li>Cover all major dimensions required by the directive.</li>"
            "<li>Use balanced reasoning with evidence/examples where relevant.</li>"
            "<li>Show linkages between causes, impacts, and policy/way-forward.</li></ul>"
            "<h3>Conclusion</h3>"
            "<p>Provide a reasoned judgement and a practical, forward-looking close.</p>"
        )
    return (
        "<h3>Understand the Question</h3>"
        f"<p>Expected Answer Type: Address the full demand of {safe_question} with directive-specific structure.</p>"
        "<h3>Answer Approach</h3>"
        "<ul><li>Introduction with context and demand framing.</li>"
        "<li>Body covering all required dimensions with balanced reasoning and evidence.</li>"
        "<li>Conclusion with judgement and practical way forward.</li></ul>"
    )


def _sanitize_mains_questions_output(questions: List[Any]) -> List[Dict[str, Any]]:
    sanitized: List[Dict[str, Any]] = []
    for item in questions:
        if not isinstance(item, dict):
            continue
        question_text = str(item.get("question_text") or "").strip()
        next_item = dict(item)
        next_item["question_text"] = question_text
        next_item["answer_approach"] = _sanitize_mains_generated_html_field(
            item.get("answer_approach"),
            question_text,
            field_name="answer_approach",
        )
        next_item["model_answer"] = _sanitize_mains_generated_html_field(
            item.get("model_answer"),
            question_text,
            field_name="model_answer",
        )
        sanitized.append(next_item)
    return sanitized
