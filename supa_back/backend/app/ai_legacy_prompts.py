import re
import html
from collections import Counter
from typing import List, Optional, Dict, Any, Tuple
from bs4 import BeautifulSoup
from .models import AISystemInstructionContentType

# ---- Default instructions (used if none configured) ----
GK_DEFAULT_INSTR = (
    "You are a UPSC-style GK quiz parsing assistant.\n"
    "Task: Parse the provided content into multiple-choice question objects without paraphrasing.\n"
    "Requirements:\n"
    "- Preserve original phrasing (do not reword).\n"
    "- Identify question boundaries effectively (numbered lists, blank lines, or headings).\n"
    "- Recognize statement lists (I., II., 1., 2., -, -), prompts, and options in formats like A), A., (a), etc.\n"
    "- Options MUST be labeled A-D and correct_answer must be one of A/B/C/D.\n"
    "- Output an ARRAY of question objects. If only one question is present, return an array with one item.\n"
    "- If comparison or tabular data is needed (e.g., matching columns), use standard HTML <table> tags instead of Markdown tables.\n"
    "Distractor & Answer Logic (CRITICAL):\n"
    "- DO NOT default to 'All of the above' or 'All statements are correct' as an escape route. This is lazy and unacceptable.\n"
    "- Focus heavily on creating INCORRECT but PLAUSIBLE options (distractors). Options must be confusingly similar to the truth.\n"
    "- Ensure options do not contradict the premise of the question or each other (unless they are distinct independent choices).\n"
    "- Language: Use clear, unambiguous, and professional language throughout generation.\n"
    "Output: A JSON array where each item matches the output_schema."
)

MATHS_DEFAULT_INSTR = (
    "You are a Mathematics MCQ parsing assistant.\n"
    "Task: Parse the provided content into maths MCQ objects with expressions preserved verbatim.\n"
    "Requirements:\n"
    "- Preserve all mathematical expressions, numbers, units, and symbols exactly as given.\n"
    "- Use LaTeX notation for ALL mathematical expressions: $...$ for inline, $$...$$ for display.\n"
    "- Use proper LaTeX: \\frac{a}{b}, \\sqrt{x}, \\in, \\mathbf{R}, etc. (single backslash, not double).\n"
    "- Identify question boundaries effectively.\n"
    "- Options MUST be labeled A-D and correct_answer must be one of A/B/C/D.\n"
    "- If a solution/explanation is present, include it verbatim in 'explanation' with LaTeX formatting.\n"
    "- Output an ARRAY of question objects. If only one question is present, return an array with one item.\n"
    "- If tabular data is needed, use standard HTML <table> tags.\n"
    "Distractor & Answer Logic (CRITICAL):\n"
    "- DO NOT default to 'All of the above' or simplistic answers.\n"
    "- Generate distractors that reflect common calculation errors or misconceptions.\n"
    "- Clarity: Ensure all mathematical logic and problem statements are crystal clear and linguistically precise.\n"
    "Output: A JSON array where each item matches the output_schema."
)

PASSAGE_DEFAULT_INSTR = (
    "You are a passage-based quiz generation assistant.\n"
    "Task: produce a passage and passage-based MCQ questions in strict JSON.\n"
    "Requirements:\n"
    "- If the source already contains a clear passage, preserve that passage text faithfully.\n"
    "- If the source is only a topic, instruction, or brief prompt, generate a new self-contained passage first and then generate the MCQ questions from that passage.\n"
    "- passage_text must always be an actual readable passage, never a meta instruction like 'create 4 passage based questions'.\n"
    "- passage_text should be substantive and exam-usable, not just one short line.\n"
    "- For each question, preserve original wording and label options A-D.\n"
    "- Each question must have correct_answer in A/B/C/D.\n"
    "- Output a JSON object containing 'passage_text' and a 'questions' array. Use HTML <table> for any tabular content.\n"
    "- If multiple passages are requested, output a JSON array of passage objects.\n"
    "Distractor & Answer Logic (CRITICAL):\n"
    "- Avoid 'All of the above' unless it is a genuinely rigorous detailed question.\n"
    "- Ensure distractors are derived from the passage text but misinterpret relationships or facts plausibly.\n"
    "- Language: Maintain the tone and clarity of the original passage while ensuring questions are articulated with high-level linguistic precision.\n"
    "Output: A JSON object (or array of objects) matching the output_schema."
)

EXPLANATION_GUIDANCE = (
    "\n\nExplanation requirements:\n"
    "- Always include a high-clarity explanation (do not leave it null).\n"
    "- Ensure professional academic language and clear logical flow.\n"
)

QUESTION_FIELD_MAPPING_GUARDRAILS = (
    "\n\nQuestion field mapping rules (MANDATORY):\n"
    "- You are primarily segmenting source quiz text into fields, not rewriting it.\n"
    "- Preserve all original wording exactly. Do NOT paraphrase, shorten, simplify, translate, or normalize quiz text.\n"
    "- question_statement: keep only the source text that functions as the stem/lead-in. If the source does not clearly separate a final ask from the stem, keep the full original question in question_statement and leave question_prompt null.\n"
    "- supp_question_statement: keep only extra supporting context that belongs to the question but is neither the numbered/bulleted statements nor the final ask sentence.\n"
    "- statements_facts: include only the exact numbered/bulleted statements or facts, one item per array entry, preserving any literal markers already present in the source.\n"
    "- question_prompt: include only the exact final ask sentence when the source clearly separates it from the stem/statements. Do not invent or paraphrase a prompt.\n"
    "- Never move text from question_statement into question_prompt, or from question_prompt into question_statement, unless the source itself clearly separates those parts.\n"
    "- Never invent generic filler such as 'Consider the following statements:' unless that exact text exists in the source.\n"
    "- Do not repeat statements_facts inside question_statement, supp_question_statement, or question_prompt.\n"
    "- Do not repeat question_prompt inside question_statement.\n"
)

MATHS_EXPLANATION_FORMAT = (
    "\n\nMaths Explanation Guidelines:\n"
    "- The solution MUST be presented step-by-step.\n"
    "- Each step must be on a new line.\n"
    "- Simplify the explanation so that even a beginner can understand.\n"
    "- State the formula used clearly before applying it.\n"
    "- Show the substitution of values into the formula.\n"
    "- Show the intermediate calculation steps.\n"
    "- Conclude with the final answer."
)

QUIZ_OUTPUT_SCHEMA = {
    "type": "object",
    "properties": {
        "quiz_type": {"type": "string"},
        "question_statement": {"type": "string"},
        "supp_question_statement": {"type": ["string", "null"]},
        "statements_facts": {"type": ["array", "null"], "items": {"type": "string"}},
        "question_prompt": {"type": ["string", "null"]},
        "options": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "label": {"type": "string"},
                    "text": {"type": "string"},
                    "is_correct": {"type": "boolean"},
                },
                "required": ["label", "text", "is_correct"],
            },
        },
        "correct_answer": {"type": "string"},
        "explanation": {"type": ["string", "null"]},
        "source_reference": {"type": ["string", "null"]},
    },
    "required": ["quiz_type", "question_statement", "options", "correct_answer"],
}

# Support either a single question object or a list of question objects
QUIZ_LIST_OR_OBJECT_SCHEMA = {
    "oneOf": [
        QUIZ_OUTPUT_SCHEMA,
        {"type": "array", "items": QUIZ_OUTPUT_SCHEMA},
    ]
}

PASSAGE_OUTPUT_SCHEMA = {
    "type": "object",
    "properties": {
        "passage_title": {"type": ["string", "null"]},
        "passage_text": {"type": "string"},
        "source_reference": {"type": ["string", "null"]},
        "questions": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "question_statement": {"type": "string"},
                    "supp_question_statement": {"type": ["string", "null"]},
                    "statements_facts": {"type": ["array", "null"], "items": {"type": "string"}},
                    "question_prompt": {"type": ["string", "null"]},
                    "options": {
                        "type": "array",
                        "items": {
                            "type": "object",
                            "properties": {
                                "label": {"type": "string"},
                                "text": {"type": "string"},
                                "is_correct": {"type": "boolean"},
                            },
                            "required": ["label", "text", "is_correct"],
                        },
                    },
                    "correct_answer": {"type": "string"},
                    "explanation": {"type": ["string", "null"]},
                },
                "required": ["question_statement", "options", "correct_answer"],
            },
        },
    },
    "required": ["passage_text", "questions"],
}

STYLE_PROFILE_SCHEMA = {
    "type": "object",
    "properties": {
        "example_count": {"type": "integer"},
        "summary": {"type": "string"},
        "style_instructions": {"type": "string"},
        "question_style_instructions": {"type": "string"},
        "answer_style_instructions": {"type": "string"},
        "format_rules": {"type": "array", "items": {"type": "string"}},
        "difficulty": {"type": "string"},
        "option_style": {"type": "string"},
        "explanation_style": {"type": "string"},
        "topic_emphasis": {"type": "array", "items": {"type": "string"}},
        "dos": {"type": "array", "items": {"type": "string"}},
        "donts": {"type": "array", "items": {"type": "string"}},
        "example_analyses": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "index": {"type": "integer"},
                    "example": {"type": "string"},
                    "nature": {"type": "string"},
                    "format": {"type": "string"},
                    "depth": {"type": "string"},
                    "topic_focus": {"type": "array", "items": {"type": "string"}},
                    "difficulty": {"type": "string"},
                    "reasoning_pattern": {"type": "string"},
                    "option_pattern": {"type": "string"},
                    "explanation_expectations": {"type": "string"},
                    "constraints": {"type": "array", "items": {"type": "string"}},
                },
                "required": ["index", "example", "nature", "format", "depth"],
            },
        },
    },
    "required": ["example_count", "summary", "style_instructions", "format_rules", "dos", "donts", "example_analyses"],
}

def _style_profile_system_instructions(
    content_type: AISystemInstructionContentType,
    user_instructions: str | None = None,
) -> str:
    if content_type == AISystemInstructionContentType.MAINS_QUESTION_GENERATION:
        base = (
            "You are a UPSC Mains question style analyst. Your job is to infer the question design and answer-approach expectations "
            "from example UPSC Mains subjective questions. Output a JSON object that strictly follows the provided schema. "
            "Keep instructions concise and directly usable for generation. "
            "Keep the analysis neutral and topic-agnostic. "
            "Do NOT re-create or paraphrase the original topics; use placeholders like [Topic A]. "
            "In example_analyses[].example, provide a short neutral label (not the full example text). "
            "Analysis must be moderately detailed and visualize the question type clearly.\n"
            "PRESENTATION FORMAT (MANDATORY): Provide analysis in TWO PARTS for each example.\n"
            "PART 1 - FULL QUESTION ANALYSIS (overall):\n"
            "1. Question type/directive: identify directive keyword (examine/evaluate/critically examine/etc.) and expected answer type.\n"
            "2. Depth level: overview vs in-depth; factual vs analytical vs applied.\n"
            "3. Area of asking: which domain/dimension is emphasized (policy, institutional, ethical, historical, socio-economic, etc.).\n"
            "4. Interrelation of keywords/segments: how sub-parts/keywords connect; single-part vs multi-part; dependencies.\n"
            "5. Scope: single-topic vs multi-topic; breadth of dimensions.\n"
            "6. Expected answer structure: intro/body/conclusion, balance of dimensions, use of examples/data.\n"
            "PART 2 - COMPONENT-WISE ANALYSIS:\n"
            "1. Break the question into parts/keywords and explain what each part demands.\n"
            "2. State the expected answer type and how the directive shapes the structure.\n"
            "3. Note required linkages between parts and the preferred order of treatment.\n"
            "4. Indicate expected depth, evidence, and balance for each component.\n"
            "You MUST: (1) mention the total number of examples, (2) provide a separate analysis for each example, "
            "and (3) produce a combined instruction set that enforces ALL example formats found. "
            "If the examples show different question types, your instructions must explicitly allow ALL of them, not just average them. "
            "Ensure style_instructions include a reusable template for answer_approach: start with 'Expected Answer Type:', "
            "break the question into parts, then provide an 'Answer Approach' structure based on the directive keyword. "
            "For this content type, also provide BOTH 'question_style_instructions' and 'answer_style_instructions': "
            "question_style_instructions should focus on question framing/directive-demand decomposition, "
            "and answer_style_instructions should focus on answer writing nuance, structure, balance, evidence, and conclusion quality."
        )
        if user_instructions:
            base += f"\n\nAdditional constraints from the user: {user_instructions}"
        return base
    if content_type == AISystemInstructionContentType.MAINS_EVALUATION:
        base = (
            "You are an evaluation style analyst. Your job is to infer the evaluation style, depth, and parameters "
            "from example UPSC Mains evaluation feedback. Output a JSON object that strictly follows the provided schema. "
            "Keep instructions concise and directly usable for evaluation. "
            "Do NOT repeat any topic-specific content; use placeholders like [Topic A]. "
            "In example_analyses[].example, provide a short neutral label (not the full example text). "
            "Analysis must be moderately detailed and clearly visualize the evaluator's approach.\n"
            "PRESENTATION FORMAT (MANDATORY): Provide analysis in TWO PARTS for each example.\n"
            "PART 1 - FULL EVALUATION ANALYSIS (overall):\n"
            "1. Depth and strictness: lenient vs strict, surface vs detailed.\n"
            "2. Evaluation parameters emphasized: length, factual accuracy, coverage, diversity, examples/data, structure, directives.\n"
            "3. Feedback structure: ordering of verdict, intro/body/conclusion checks, and actionability.\n"
            "4. Missing-points logic: how gaps are identified and how model answers are used.\n"
            "PART 2 - COMPONENT-WISE ANALYSIS:\n"
            "1. How introductions, body points, and conclusions are judged.\n"
            "2. How strengths/weaknesses are framed and justified.\n"
            "3. How improved answers are constructed (if applicable).\n"
            "You MUST: (1) mention the total number of examples, (2) provide a separate analysis for each example, "
            "and (3) produce a combined instruction set that enforces ALL evaluation patterns found. "
            "Ensure style_instructions explicitly list evaluation parameters and the missing-points rule: "
            "missing points must be tied to the model answer or explicit question demand."
        )
        if user_instructions:
            base += f"\n\nAdditional constraints from the user: {user_instructions}"
        return base

    if content_type == AISystemInstructionContentType.PREMIUM_GK_QUIZ:
        label = "UPSC-style GK multiple-choice questions"
    elif content_type == AISystemInstructionContentType.PREMIUM_MATHS_QUIZ:
        label = "Mathematics multiple-choice questions"
    elif content_type == AISystemInstructionContentType.PREMIUM_PASSAGE_QUIZ:
        label = "Passage-based multiple-choice questions"
    elif content_type == AISystemInstructionContentType.MAINS_QUESTION_GENERATION:
        label = "UPSC Mains subjective questions"
    elif content_type == AISystemInstructionContentType.MAINS_EVALUATION:
        label = "Mains Answer Evaluation Feedback"
    else:
        label = "multiple-choice questions"
    base = (
        "You are a quiz style analyst. Your job is to infer the format, depth, and stylistic patterns "
        f"from example {label}. Output a JSON object that strictly follows the provided schema. "
        "Keep instructions concise and directly usable for generation. "
        "Keep the analysis neutral and topic-agnostic. "
        "Describe patterns in a reusable way so they can transfer to other topics (focus on roles of statements, "
        "ordering, and intent rather than the specific subject). "
        "Do NOT generate new questions and do NOT paraphrase or re-create the example topics; "
        "avoid repeating named entities or specific facts from the examples. "
        "When you need to reference an example, use neutral placeholders like [Topic A] instead of the original topic. "
        "In example_analyses[].example, provide a short neutral label (not the full example text). "
        "For each example, analyze nature of the question, format, depth, topic focus, difficulty level, reasoning pattern, option style, and explanation expectations. "
        "PRESENTATION FORMAT (MANDATORY): Provide analysis in TWO PARTS for each example. "
        "Analysis should be moderately detailed, and each part should visualize the question type clearly.\n"
        "PART 1 - FULL QUESTION ANALYSIS (overall):\n"
        "1. Overall structure: e.g., prompt + N statements (independent vs related), or direct question + options; include the typical prompt phrasing.\n"
        "2. Focus of the question: application vs features vs impacts vs causes vs factual aspects.\n"
        "3. Topic scope: single-topic vs multi-topic (statements/options drawn from one topic vs combined topics around a single feature).\n"
        "4. Difficulty level: solvable from overview (easy) vs in-depth single-topic vs comparative multi-topic knowledge.\n"
        "5. Relations between components: how question_statement connects to statements_facts or options; "
        "is question_statement answerable on its own or a placeholder (e.g., 'Consider the following')?\n"
        "6. Structural & semantic relation: identify if it asks to define a term from features, verify statements, "
        "or combine independent facts into one concept.\n"
        "7. Topic cohesion (gap): same paragraph/section vs different topics/chapters; single-note vs wide-span vs comparative vs sequential; "
        "state whether statements/options are related or independent.\n"
        "8. Option & topic analysis (overall): topic cohesion, aspect focus, plausibility, contradictions.\n"
        "9. Incorrect statements/options: identify where wrong options typically come from (common confusions, near-true facts, "
        "misapplied definitions, reversed causality, wrong pairings) and the expected wrong-option patterns.\n"
        "PART 2 - COMPONENT-WISE ANALYSIS:\n"
        "1. question_statement: purpose, tone, and how it sets up the analytical task; identify the specific aspect it asks about (even if phrased generally).\n"
        "2. statements_facts: nature and construction of statements in the example (to-the-point vs verbose, factual vs analytical, continuity with the question_statement). "
        "Statements must stay within the SAME aspect asked by the question_statement. Incorrect but plausible statements must also stay within that same aspect. "
        "Include density/length, gap between statements (same paragraph/section vs different topics/chapters), and whether statements are related or independent.\n"
        "3. question_prompt: exact phrasing style, placement relative to statements, and whether it references statement numbers.\n"
        "4. options: structure (statement-number combos vs standalone), option style, internal consistency, "
        "gap between options (same section vs different topics/chapters), relation to question_statement, "
        "and the expected wrong-option patterns (sources and types of incorrect options).\n"
        "IMPORTANT: Some examples are direct questions where statements_facts or question_prompt are missing. You MUST handle this explicitly.\n"
        "Be specific and non-trivial. "
        "You MUST: (1) mention the total number of examples, (2) provide a separate analysis for each example, "
        "and (3) produce a combined instruction set that enforces ALL example formats found. "
        "If the examples show DIFFERENT types (e.g., one direct, one statement-based), your instructions must explicitly allow ALL of them, not just average them. "
        "Ensure the style_instructions include a reusable template that explains how to adapt the format to any subject matter. "
        "GLOBAL INSTRUCTIONS: Answers should vary; minimize 'all correct' patterns. "
        "GLOBAL INCORRECT-OPTION RULE (unchanging): Incorrect options must be plausible and correct-looking, "
        "aligned to the nature of the statements/options in the examples, but absolutely incorrect. "
        "Explanations must be logical, justified, and add brief extra knowledge about the topic. "
        "For maths questions, explanations must be step-by-step and simple enough for weaker students."
    )
    if user_instructions:
        base += f"\n\nAdditional constraints from the user: {user_instructions}"
    return base

def _style_profile_refine_system_instructions(
    content_type: AISystemInstructionContentType,
    user_instructions: str | None = None,
) -> str:
    base = _style_profile_system_instructions(content_type, user_instructions)
    return base + "\n\nRevise the existing style profile using the feedback. Keep it concise and actionable."

def _normalize_whitespace(text: str) -> str:
    return re.sub(r"\s+", " ", (text or "").strip())

def _normalize_option_text(text: str) -> str:
    cleaned = re.sub(r"[^a-z0-9\s]+", "", (text or "").lower())
    return _normalize_whitespace(cleaned)

def _options_match(expected: str, actual: str) -> bool:
    if not expected or not actual:
        return False
    if expected == actual or expected in actual or actual in expected:
        return True
    expected_tokens = set(expected.split())
    actual_tokens = set(actual.split())
    if not expected_tokens or not actual_tokens:
        return False
    return expected_tokens.issubset(actual_tokens) or actual_tokens.issubset(expected_tokens)

def _extract_numbered_statements_from_text(text: str) -> list[str]:
    if not text:
        return []
    statements: list[str] = []
    for line in (line.strip() for line in text.splitlines()):
        if not line:
            continue
        match = re.match(r"^(\d+|[ivx]+)\s*[).:-]\s*(.+)$", line, re.IGNORECASE)
        if match:
            statements.append(match.group(2).strip())
            continue
        match = re.match(r"^(statement\s*(?:\d+|i{1,3}|iv|v|vi{0,3}|ix|x))\s*[:\-]\s*(.+)$", line, re.IGNORECASE)
        if match:
            statements.append(f"{match.group(1).strip()}: {match.group(2).strip()}")
    return statements

def _build_example_format_guidance(example_list: list[str]) -> str:
    cleaned = [ex.strip() for ex in (example_list or []) if ex and ex.strip()]
    if not cleaned:
        return ""

    item_counts: list[int] = []
    statement_lengths: list[int] = []  # avg words per statement
    lead_ins: list[str] = []
    prompt_tails: list[str] = []
    full_prompts: list[str] = []
    option_sets: list[tuple[str, ...]] = []

    for example in cleaned:
        lines = [line.strip() for line in example.splitlines() if line.strip()]
        for line in lines:
            line_lower = line.lower()
            if re.match(r"^consider the following", line_lower):
                lead_ins.append(line)
            if re.match(r"^(select the correct answer|which of the statements|which one of the following|which one is correct|choose the correct option)", line_lower):
                 full_prompts.append(line)
            if re.search(r"\bhow many of the above\b", line_lower):
                tail = re.split(r"\bhow many of the above\b", line, flags=re.IGNORECASE)[1].strip()
                if tail:
                    prompt_tails.append(tail)
            if line_lower.endswith("?") and re.search(r"\b(which|select|correct|following|above)\b", line_lower):
                full_prompts.append(line)

        numbered_lines = [
            line for line in lines
            if re.match(r"^\d+\s*[).:-]", line)
            or re.match(r"^(I|II|III|IV|V|VI|VII|VIII|IX|X)\s*[).:-]", line, re.IGNORECASE)
            or re.match(r"^statement\s*(?:\d+|i{1,3}|iv|v|vi{0,3}|ix|x)\s*[:\-]", line, re.IGNORECASE)
        ]
        if numbered_lines:
            item_counts.append(len(numbered_lines))
            # Calculate avg word count for this example
            words = sum(len(nl.split()) for nl in numbered_lines)
            statement_lengths.append(words / len(numbered_lines))

        options: list[str] = []
        for line in lines:
            if re.match(r"^ans\b", line, re.IGNORECASE):
                continue
            match = re.match(r"^\s*[\(\[]?([a-eA-E]|[1-5])[\)\]]?[\.\):-]?\s+(.+)$", line)
            if match:
                option_text = match.group(2).strip()
                if option_text:
                    options.append(option_text)
        if len(options) >= 2: # Capture even if fewer than 4, but usually 4
            option_sets.append(tuple(options[:4]))

    min_support = 1 if len(cleaned) == 1 else 2
    lead_in = Counter(lead_ins).most_common(1)[0][0] if lead_ins else None
    prompt_tail = Counter(prompt_tails).most_common(1)[0][0] if prompt_tails else None
    full_prompt = Counter(full_prompts).most_common(1)[0][0] if full_prompts else None
    
    item_count = None
    if item_counts:
        candidate, count = Counter(item_counts).most_common(1)[0]
        if count >= min_support:
            item_count = candidate
            
    avg_statement_words = sum(statement_lengths) / len(statement_lengths) if statement_lengths else 100
    is_short_statements = avg_statement_words < 6

    option_set = None
    if option_sets:
        candidate, count = Counter(option_sets).most_common(1)[0]
        if count >= min_support:
            option_set = candidate

    guidance_lines = [
        "Example format constraints (high priority after user instructions):",
        "- You MUST follow the structure and phrasing style of the examples; only replace the factual content.",
        "- Do NOT reuse the topics, named entities, or facts from the examples; use examples only as templates.",
        "- CRITICAL: The content/aspects of the questions MUST BE DIFFERENT from the examples. Do not ask about the same specific details or sub-topics found in the examples.",
        "- All factual content must come from the provided source content, not from the examples.",
        "- Do NOT mix in any other question formats; every question must follow this format.",
         "- Ignore any other example formats not provided in this request.",
    ]
    if lead_in:
        guidance_lines.append(f"- Lead-in template: \"{lead_in}\" (replace only the topic nouns).")
    if item_count:
        guidance_lines.append(f"- Use exactly {item_count} listed items/statements.")
    if is_short_statements:
        guidance_lines.append("- Note: Statements in examples are notably short. Keep generated statements concise and dense, but ensure they are grammatically sufficient for the context.")
    
    if prompt_tail:
        guidance_lines.append(f"- Prompt template: \"How many of the above {prompt_tail}\" (keep the phrasing style).")
    elif full_prompt:
        guidance_lines.append(f"- Prompt template: \"{full_prompt}\" (use this EXACT framing).")

    if option_set:
        guidance_lines.append("- Option texts must be: " + " | ".join(option_set) + " (map to A-D in order).")
        
    # Heuristic: if we have numbered items AND a separate question prompt or lead-in
    if item_count and (prompt_tail or full_prompt or lead_in):
        guidance_lines.append(
             "- Format structure key mapping:\n"
             "  * question_statement: the intro text (e.g. 'Consider...');\n"
             "  * statements_facts: the list items (e.g. '1. Addition');\n"
             "  * question_prompt: the specific question asking to select (e.g. 'Select the correct answer...')."
        )
    else:
         guidance_lines.append(
            "- If the example combines the question and list in one block without a separate prompt, map the main text to question_statement and list items to statements_facts."
        )

    bullet = "\n- "
    guidance_lines.append("Examples:" + bullet + bullet.join(cleaned))
    return "\n\n" + "\n".join(guidance_lines)

def _extract_example_format_spec(example_list: list[str]) -> dict | None:
    cleaned = [ex.strip() for ex in (example_list or []) if ex and ex.strip()]
    if not cleaned:
        return None

    item_counts: list[int] = []
    lead_in_hits = 0
    prompt_hits = 0
    option_sets: list[tuple[str, ...]] = []
    statement_lines_seen = 0

    for example in cleaned:
        lines = [line.strip() for line in example.splitlines() if line.strip()]
        for line in lines:
            if re.match(r"^consider the following", line, re.IGNORECASE):
                lead_in_hits += 1
            if re.search(r"\bhow many of the above\b", line, re.IGNORECASE):
                prompt_hits += 1
            if re.search(r"\b(which|select|correct|following|above)\b", line, re.IGNORECASE) and line.endswith("?"):
                prompt_hits += 1

        numbered_lines = [
            line for line in lines
            if re.match(r"^\d+\s*[).:-]", line)
            or re.match(r"^(I|II|III|IV|V|VI|VII|VIII|IX|X)\s*[).:-]", line, re.IGNORECASE)
            or re.match(r"^statement\s*(?:\d+|i{1,3}|iv|v|vi{0,3}|ix|x)\s*[:\-]", line, re.IGNORECASE)
        ]
        if numbered_lines:
            item_counts.append(len(numbered_lines))
            statement_lines_seen += len(numbered_lines)

        options: list[str] = []
        for line in lines:
            if re.match(r"^ans\b", line, re.IGNORECASE):
                continue
            match = re.match(r"^\s*[\(\[]?([a-eA-E]|[1-5])[\)\]]?[\.\):-]?\s+(.+)$", line)
            if match:
                option_text = match.group(2).strip()
                if option_text:
                    options.append(_normalize_option_text(option_text))
        if len(options) >= 4:
            option_sets.append(tuple(options[:4]))

    min_support = 1 if len(cleaned) == 1 else 2
    expected_item_count = None
    if item_counts:
        candidate, count = Counter(item_counts).most_common(1)[0]
        if count >= min_support:
            expected_item_count = candidate
    expected_options = None
    if option_sets:
        candidate, count = Counter(option_sets).most_common(1)[0]
        if count >= min_support:
            expected_options = list(candidate)

    return {
        "requires_lead_in": lead_in_hits >= min_support,
        "requires_prompt": prompt_hits >= min_support,
        "expected_item_count": expected_item_count,
        "expected_options": expected_options,
        "expects_statements": statement_lines_seen > 0,
    }

def _resolve_example_guidance(
    example_list: list[str],
    formatting_instruction_text: Optional[str]
) -> Tuple[Optional[str], Optional[dict]]:
    cleaned_guidance = (formatting_instruction_text or "").strip()
    format_spec = _extract_example_format_spec(example_list) if example_list else None
    if cleaned_guidance:
        if example_list:
            bullet = "\n- "
            cleaned_guidance += "\n\nExamples for reference:" + bullet + bullet.join(example_list)
        return cleaned_guidance, format_spec
    if example_list:
        return _build_example_format_guidance(example_list), format_spec
    return None, None

def _matches_example_format(item: dict, spec: dict) -> bool:
    question_statement = str(item.get("question_statement") or "")
    question_prompt = str(item.get("question_prompt") or "")
    supp_question_statement = str(item.get("supp_question_statement") or "")

    if spec.get("requires_lead_in"):
        combined = f"{question_statement}\n{question_prompt}".lower()
        if "consider the following" not in combined:
            return False
    if spec.get("requires_prompt"):
        prompt_text = question_prompt or question_statement
        prompt_lower = prompt_text.lower()
        if "how many" not in prompt_lower:
            return False
        if not re.search(r"\b(above|following|these)\b", prompt_lower):
            return False

    statements = item.get("statements_facts") or []
    if not isinstance(statements, list) or len(statements) == 0:
        statements = _extract_numbered_statements_from_text(question_statement)
    if not statements:
        statements = _extract_numbered_statements_from_text(supp_question_statement)
    if not statements:
        statements = _extract_numbered_statements_from_text(question_prompt)
    if spec.get("expected_item_count") is not None:
        if not isinstance(statements, list) or len(statements) != spec["expected_item_count"]:
            return False
    elif spec.get("expects_statements"):
        if not isinstance(statements, list) or len(statements) == 0:
            return False

    expected_options = spec.get("expected_options")
    if expected_options:
        options = item.get("options") or []
        if not isinstance(options, list) or len(options) < len(expected_options):
            return False
        normalized = [_normalize_option_text(opt.get("text")) for opt in options[:len(expected_options)] if isinstance(opt, dict)]
        if len(normalized) < len(expected_options):
            return False
        for expected, actual in zip(expected_options, normalized):
            if not _options_match(expected, actual):
                return False

    return True

def _fix_latex_escaping(text: Optional[str]) -> Optional[str]:
    r"""
    Fix over-escaped LaTeX in AI responses.
    AI sometimes returns \\frac instead of \frac, \\in instead of \in, etc.
    This function normalizes to single backslashes within $ delimiters.
    """
    if not text or not isinstance(text, str):
        return text
    
    # Pattern to find content within $ delimiters (both inline and display)
    
    def fix_latex_block(match):
        content = match.group(1)
        # Replace double backslashes with single backslashes
        # But preserve actual newlines (\\n should stay as is in explanations)
        fixed = content.replace('\\\\', '\\')
        return f'${fixed}$'
    
    # Fix inline math $...$
    text = re.sub(r'\$([^\$]+)\$', fix_latex_block, text)
    
    # Fix display math $$...$$
    def fix_display_latex(match):
        content = match.group(1)
        fixed = content.replace('\\\\', '\\')
        return f'$${fixed}$$'
    
    text = re.sub(r'\$\$([^\$]+)\$\$', fix_display_latex, text)
    
    return text

def _append_user_priority_instructions(system_instructions: str, user_instructions: str | None) -> str:
    if not user_instructions or not user_instructions.strip():
        return system_instructions
    return (
        system_instructions
        + "\n\nPriority order for conflicts:\n"
          "1) User instructions & Provided Examples (ABSOLUTE HIGHEST PRIORITY). If the user provided ANY examples, you must STRICTLY follow that format and IGNORE any other system defaults or saved styles. Do not revert to generic formats.\n"
          "2) Example format constraints (when provided; must be followed unless they violate output_schema)\n"
          "3) System instructions\n"
          "If the user restricts the generation to specific topics or areas (e.g. 'only ask about X'), you MUST strictly follow this constraint and prioritize those topics."
        + f"\nUser instructions (highest priority): {user_instructions.strip()}"
    )

def _append_generation_balance_rules(system_instructions: str) -> str:
    return (
        system_instructions
        + "\n\nGLOBAL GENERATION RULES (HIGH PRIORITY):"
        + "\n- For multi-question batches, balance correct answers across A/B/C/D; avoid repeating the same correct label too often."
        + "\n- Vary option combinations; do NOT reuse the exact same combo with only the correct label moved (e.g., repeating '1 and 3 only')."
        + "\n- For statement-based questions, wrong statements must be plausible and close to true, drawn from the same or closely related area. "
          "Across a batch, balance these patterns: some questions with all statements incorrect (but plausible), some with all correct, and some mixed "
          "(multiple correct and multiple incorrect). Use the single-incorrect pattern and the all-correct pattern in about half of the statement-based questions, "
          "and use the mixed-patterns in the remaining half."
        + "\n- Maintain the statement/option gap shown in the examples: same paragraph/section vs cross-topic/chapters; keep statements/options "
          "related vs independent accordingly."
        + "\n- For direct questions (no statements_facts/question_prompt), apply the same gap/relatedness rules to options."
    )
