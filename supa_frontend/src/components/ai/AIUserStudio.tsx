"use client";

import { type ChangeEvent, useCallback, useEffect, useMemo, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import axios from "axios";
import { AlertTriangle, ArrowDown, ArrowUp, CheckCircle2, ChevronDown, ChevronUp, CircleDashed, Download, FileText, Loader2, RefreshCcw, Save, Settings2, Share2, Sparkles, Trash2, UploadCloud, Wand2, X } from "lucide-react";
import { toast } from "sonner";

import { legacyPremiumAiApi } from "@/lib/legacyPremiumAiApi";
import { premiumApi, premiumApiRoot } from "@/lib/premiumApi";
import {
  normalizeOutputLanguage,
  OUTPUT_LANGUAGE_OPTIONS,
  persistOutputLanguage,
  readOutputLanguage,
  type OutputLanguage,
} from "@/lib/outputLanguage";
import { createClient } from "@/lib/supabase/client";
import { useAuth } from "@/context/AuthContext";
import { hasGenerationSubscription, hasQuizMasterGenerationSubscription, isQuizMasterLike } from "@/lib/accessControl";
import MiniRichTextInput from "@/components/ui/MiniRichTextInput";
import ExamCategorySelector from "@/components/premium/ExamCategorySelector";
import type {
  AIProvider,
  PremiumPreviewMixJobCreateRequest,
  PremiumPreviewMixJobCreateResponse,
  PremiumPreviewMixJobStatusResponse,
  PremiumAIContentType,
  PremiumCategory,
  PremiumCollection,
  PremiumAIExampleAnalysis,
  PremiumAIExampleAnalysisListResponse,
  PremiumPreviewResponse,
  QuizKind,
  UploadedPDF,
} from "@/types/premium";

const CONTENT_TYPE_MAP: Record<QuizKind, PremiumAIContentType> = {
  gk: "premium_gk_quiz",
  maths: "premium_maths_quiz",
  passage: "premium_passage_quiz",
};

const USER_PROVIDER: AIProvider = "gemini";
const USER_MODEL = "gemini-3-flash-preview";
const GENERATED_QUIZ_TTL_MS = 24 * 60 * 60 * 1000;
const GENERATED_QUIZ_STORAGE_VERSION = 1;
const QUIZ_KINDS: QuizKind[] = ["gk", "maths", "passage"];
const QUIZ_KIND_LABEL: Record<QuizKind, string> = {
  gk: "GK",
  maths: "Maths",
  passage: "Passage",
};
const CONTENT_SOURCE_OPTIONS: Array<{
  value: "text" | "url" | "pdf" | "image";
  label: string;
  description: string;
}> = [
    {
      value: "text",
      label: "Raw Text",
      description: "Paste direct content for parsing and generation.",
    },
    {
      value: "url",
      label: "URL",
      description: "Use a webpage link as the content source.",
    },
    {
      value: "image",
      label: "Photo OCR",
      description: "Upload one or more photos and extract text.",
    },
    {
      value: "pdf",
      label: "Uploaded PDF",
      description: "Upload/select a PDF and use extracted text.",
    },
  ];
const QUIZ_KIND_META: Record<QuizKind, { description: string; tag: string; cta: string; tone: string }> = {
  gk: {
    description: "Current affairs, polity, geography, economy, and integrated GS practice sets.",
    tag: "Foundation",
    cta: "Switch",
    tone: "bg-amber-50 text-amber-700",
  },
  maths: {
    description: "Quant-heavy drills with cleaner numerical framing and calculation-focused prompts.",
    tag: "Quant Focus",
    cta: "Open",
    tone: "bg-emerald-50 text-emerald-700",
  },
  passage: {
    description: "Comprehension-first sets with passage context and linked multi-question flows.",
    tag: "Reading Focus",
    cta: "Open",
    tone: "bg-sky-50 text-sky-700",
  },
};
const QUICK_COUNT_PRESETS: Array<{ label: string; value: string; detail: string }> = [
  { label: "5", value: "5", detail: "Balanced Set" },
  { label: "10", value: "10", detail: "Revision Drill" },
  { label: "15", value: "15", detail: "Deep Practice" },
];
const INSTRUCTION_PRESETS: Array<{ id: string; label: string; text: string }> = [
  {
    id: "balanced",
    label: "Balanced",
    text: "Maintain UPSC difficulty balance and keep explanations concise with exam-relevant logic.",
  },
  {
    id: "strict",
    label: "Exam Strict",
    text: "Prefer high-discrimination questions, avoid trivial clues, and keep options tightly confusable.",
  },
  {
    id: "revision",
    label: "Fast Revision",
    text: "Focus on quick revision style: short prompts, clear distractors, and crisp explanations.",
  },
];
const EXPLANATION_HTML_ENFORCEMENT_INSTRUCTION = [
  "For every question, return explanation in valid HTML only.",
  "Use semantic tags like <p>, <ul>, <ol>, <li>, <strong>, <em>, and <code> where relevant.",
  "Do not return markdown in explanation fields.",
].join("\n");
const LARGE_MIX_ASYNC_THRESHOLD = 8;
const MIX_TASK_MAX_ATTEMPTS = 3;
const MIX_JOB_POLL_INTERVAL_MS = 1200;
const MIX_JOB_POLL_TIMEOUT_MS = 4 * 60 * 1000;

function toError(error: unknown): string {
  if (axios.isAxiosError(error)) {
    if (typeof error.response?.data?.detail === "string") return error.response.data.detail;
    return error.message;
  }
  if (error instanceof Error && error.message) return error.message;
  return "Unknown error";
}

function parseLines(value: string): string[] {
  return value
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
}

function parseExampleLines(value: string): string[] {
  if (!value || !value.trim()) return [];
  const hasOptions = /\(\d+\)|^\s*\(\d+\)|^\s*[A-D][\.)]/m.test(value);
  const hasQuestionMarker = /^(?:\*\*)?Q\d+\.|^\d+\.|^Question\s+\d+/im.test(value);
  if (hasOptions || (hasQuestionMarker && value.includes("\n"))) {
    return [value.trim()];
  }
  const byDoubleNewline = value.split(/\n\n+/).map((block) => block.trim()).filter(Boolean);
  if (byDoubleNewline.length > 1) return byDoubleNewline;
  return parseLines(value);
}

function normalizeCategoryIds(raw: unknown): number[] {
  if (!Array.isArray(raw)) return [];
  const output: number[] = [];
  for (const value of raw) {
    const parsed = Number(value);
    if (!Number.isFinite(parsed) || parsed <= 0) continue;
    if (!output.includes(parsed)) output.push(parsed);
  }
  return output;
}

function flattenCategoryNameMap(nodes: PremiumCategory[], output: Record<number, string>): void {
  for (const node of nodes || []) {
    const id = Number(node.id);
    if (Number.isFinite(id) && id > 0) {
      output[id] = String(node.name || `Category ${id}`);
    }
    if (Array.isArray(node.children) && node.children.length > 0) {
      flattenCategoryNameMap(node.children, output);
    }
  }
}

function inlineMarkdownToHtml(raw: string): string {
  const escaped = String(raw || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
  return escaped
    .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
    .replace(/__(.+?)__/g, "<strong>$1</strong>")
    .replace(/\*(.+?)\*/g, "<em>$1</em>")
    .replace(/_(.+?)_/g, "<em>$1</em>");
}

function formatPlainTextToHtml(raw: string): string {
  const lines = String(raw || "").replace(/\r\n/g, "\n").split("\n");
  const parts: string[] = [];
  let paragraphChunks: string[] = [];
  let inList = false;

  const flushParagraph = () => {
    if (paragraphChunks.length === 0) return;
    parts.push(`<p>${paragraphChunks.join(" ")}</p>`);
    paragraphChunks = [];
  };

  for (const sourceLine of lines) {
    const line = sourceLine.trim();
    if (!line) {
      flushParagraph();
      if (inList) {
        parts.push("</ul>");
        inList = false;
      }
      continue;
    }

    const bullet = line.match(/^[-*•]\s+(.+)$/);
    if (bullet) {
      flushParagraph();
      if (!inList) {
        parts.push("<ul>");
        inList = true;
      }
      parts.push(`<li>${inlineMarkdownToHtml(bullet[1])}</li>`);
      continue;
    }

    if (inList) {
      parts.push("</ul>");
      inList = false;
    }
    paragraphChunks.push(inlineMarkdownToHtml(line));
  }

  flushParagraph();
  if (inList) parts.push("</ul>");
  return parts.join("").trim();
}

function sanitizeRichHtml(raw: string): string {
  const htmlInput = String(raw || "").trim();
  if (!htmlInput) return "";
  if (typeof window === "undefined") {
    return htmlInput
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");
  }

  const allowedTags = new Set([
    "P", "BR", "UL", "OL", "LI", "STRONG", "B", "EM", "I", "U",
    "CODE", "PRE", "BLOCKQUOTE", "H1", "H2", "H3", "H4", "H5", "H6",
    "DIV", "SPAN", "A",
  ]);
  const styleAllowedProps = new Set([
    "font-weight",
    "font-style",
    "text-decoration",
    "color",
    "background-color",
    "font-size",
    "line-height",
    "text-align",
  ]);

  const sanitizeStyle = (value: string): string => {
    const chunks = String(value || "")
      .split(";")
      .map((chunk) => chunk.trim())
      .filter(Boolean);
    const safe: string[] = [];
    for (const chunk of chunks) {
      const separatorIndex = chunk.indexOf(":");
      if (separatorIndex <= 0) continue;
      const prop = chunk.slice(0, separatorIndex).trim().toLowerCase();
      const rawVal = chunk.slice(separatorIndex + 1).trim();
      if (!styleAllowedProps.has(prop)) continue;
      if (!rawVal) continue;
      if (/[{}<>]/.test(rawVal)) continue;
      if (/url\s*\(/i.test(rawVal)) continue;
      safe.push(`${prop}: ${rawVal}`);
      if (safe.length >= 12) break;
    }
    return safe.join("; ");
  };

  const sanitizeHref = (value: string): string => {
    const href = String(value || "").trim();
    if (!href) return "";
    if (/^(https?:|mailto:)/i.test(href)) return href;
    return "";
  };

  const parser = new window.DOMParser();
  const doc = parser.parseFromString(`<div>${htmlInput}</div>`, "text/html");
  const root = doc.body.firstElementChild as HTMLElement | null;
  if (!root) return "";

  const sanitizeNode = (node: Node): void => {
    if (node.nodeType === Node.TEXT_NODE) return;
    if (node.nodeType !== Node.ELEMENT_NODE) {
      node.parentNode?.removeChild(node);
      return;
    }

    const element = node as HTMLElement;
    const tagName = element.tagName.toUpperCase();
    if (!allowedTags.has(tagName)) {
      const textNode = doc.createTextNode(element.textContent || "");
      element.parentNode?.replaceChild(textNode, element);
      return;
    }

    Array.from(element.attributes).forEach((attr) => {
      const attrName = attr.name.toLowerCase();
      if (attrName === "style" && (tagName === "SPAN" || tagName === "P" || tagName === "DIV")) {
        const safeStyle = sanitizeStyle(attr.value);
        if (safeStyle) element.setAttribute("style", safeStyle);
        else element.removeAttribute(attr.name);
        return;
      }
      if (tagName === "A" && attrName === "href") {
        const safeHref = sanitizeHref(attr.value);
        if (safeHref) {
          element.setAttribute("href", safeHref);
          element.setAttribute("target", "_blank");
          element.setAttribute("rel", "noopener noreferrer nofollow");
        } else {
          element.removeAttribute(attr.name);
        }
        return;
      }
      element.removeAttribute(attr.name);
    });

    Array.from(element.childNodes).forEach((child) => sanitizeNode(child));
  };

  Array.from(root.childNodes).forEach((node) => sanitizeNode(node));
  return root.innerHTML.trim();
}

function formatExplanationHtml(raw: string): string {
  const text = String(raw || "").trim();
  if (!text) return "";
  const looksLikeHtml = /<\s*[a-z][^>]*>/i.test(text);
  const htmlCandidate = looksLikeHtml ? text : formatPlainTextToHtml(text);
  return sanitizeRichHtml(htmlCandidate);
}

function splitStatementStructure(text: string): { lead: string; statements: string[]; prompt: string | null } {
  if (!text.trim()) return { lead: "", statements: [], prompt: null };
  const compact = text.replace(/\s+/g, " ").trim();
  const markerPattern = "statement\\s*(?:\\d+|[ivxlcdm]+)\\s*[:\\).-]";
  const inlinePattern = new RegExp(
    `\\b(${markerPattern})\\s*(.+?)(?=(?:\\b${markerPattern}\\s*|\\bwhich one of the following\\b|\\bwhich of the following\\b|\\bhow many of the above\\b|\\bhow many\\b|\\bselect(?:\\s+the)?\\s+correct\\b|$))`,
    "gi",
  );
  const matches = Array.from(compact.matchAll(inlinePattern));
  if (matches.length >= 2) {
    const statements = matches
      .map((match) => `${String(match[1] || "").trim()} ${String(match[2] || "").trim().replace(/[.;]\s*$/, "")}`.trim())
      .filter(Boolean);
    const firstIdx = matches[0].index ?? 0;
    const last = matches[matches.length - 1];
    const lastIdx = typeof last.index === "number" ? last.index + String(last[0] || "").length : compact.length;
    const lead = compact.slice(0, firstIdx).replace(/\s*[:\-]\s*$/, "").trim();
    const tail = compact.slice(lastIdx).trim();
    const promptCandidate = tail || null;
    if (promptCandidate) return { lead, statements, prompt: promptCandidate };
    const promptMatch = compact.match(
      /(which one of the following[^?]*\?|which of the following[^?]*\?|how many of the above[^?]*\?|select(?:\s+the)?\s+correct[^?]*\?)/i,
    );
    return { lead, statements, prompt: promptMatch ? promptMatch[1].trim() : null };
  }
  return { lead: compact, statements: [], prompt: null };
}

function isStatementLine(text: string): boolean {
  return /^\s*(?:[-*]\s*)?(?:(?:statement|fact)\s*)?(?:\(?[ivxlcdm]+\)?|\(?\d+\)?|[a-z])[\).:\-]\s+\S+/i.test(String(text || "").trim());
}

function normalizeStatements(raw: unknown, depth = 0): string[] {
  if (depth > 4 || raw == null) return [];

  if (Array.isArray(raw)) {
    const out: string[] = [];
    raw.forEach((item) => {
      out.push(...normalizeStatements(item, depth + 1));
    });
    return out;
  }

  if (typeof raw === "object") {
    const record = raw as Record<string, unknown>;
    const prioritizedKeys = [
      "statements_facts",
      "statement_facts",
      "statementsFacts",
      "statementFacts",
      "statements",
      "statement",
      "facts",
      "fact_statements",
      "items",
      "text",
      "value",
      "content",
    ];
    for (const key of prioritizedKeys) {
      if (!(key in record)) continue;
      const nested = normalizeStatements(record[key], depth + 1);
      if (nested.length > 0) return nested;
    }

    const out: string[] = [];
    Object.entries(record).forEach(([key, value]) => {
      const nested = normalizeStatements(value, depth + 1);
      if (nested.length === 0) return;
      const keyText = String(key || "").trim();
      if (/^(?:statement\s*)?(?:\d+|[ivxlcdm]+|[a-z])$/i.test(keyText)) {
        nested.forEach((entry) => {
          if (isStatementLine(entry)) out.push(entry);
          else out.push(`${keyText}. ${entry}`);
        });
        return;
      }
      out.push(...nested);
    });
    return out;
  }

  const text = String(raw || "").trim();
  if (!text) return [];

  const lines = text.replace(/\r\n/g, "\n").split("\n").map((line) => line.trim()).filter(Boolean);
  if (lines.length > 0) {
    const statementLines = lines.filter((line) => isStatementLine(line));
    if (statementLines.length > 0) return statementLines;
  }

  const split = splitStatementStructure(text);
  if (split.statements.length > 0) {
    return split.statements.map((entry) => String(entry).trim()).filter(Boolean);
  }

  const compact = text.replace(/\s+/g, " ").trim();
  const inlineMatches = Array.from(
    compact.matchAll(/(?:^|\s)((?:\(?[ivxlcdm]+\)?|\(?\d+\)?|[a-z])[\).:\-])\s+(.+?)(?=(?:\s(?:\(?[ivxlcdm]+\)?|\(?\d+\)?|[a-z])[\).:\-]\s+)|$)/gi),
  );
  if (inlineMatches.length >= 2) {
    return inlineMatches
      .map((match) => `${String(match[1] || "").trim()} ${String(match[2] || "").trim().replace(/[.;]\s*$/, "")}`.trim())
      .filter(Boolean);
  }

  if (lines.length > 1) return lines;
  return [text];
}

function looksLikePromptText(text: string): boolean {
  const cleaned = String(text || "").trim();
  if (!cleaned) return false;
  const lowered = cleaned.toLowerCase();
  if (cleaned.includes("?")) return true;
  return /^(which|what|how many|how much|who|whom|where|when|select|choose|identify|find|determine|correct|true|false)\b/.test(lowered);
}

function normalizeTag(value?: string | null): string {
  return String(value ?? "").trim().toLowerCase();
}

function formatDateTimeDDMMYYYY(value: number): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const pad = (num: number) => String(num).padStart(2, "0");
  return `${pad(date.getDate())}/${pad(date.getMonth() + 1)}/${date.getFullYear()}, ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

function stripHtmlTags(raw: string): string {
  const input = String(raw || "");
  if (!input.trim()) return "";
  if (typeof window === "undefined") return input.replace(/<[^>]+>/g, " ");
  const parser = new window.DOMParser();
  const doc = parser.parseFromString(`<div>${input}</div>`, "text/html");
  return String(doc.body.textContent || "");
}

function toPlainText(raw: string): string {
  const input = String(raw || "").trim();
  if (!input) return "";
  if (/<\s*[a-z][^>]*>/i.test(input)) {
    return stripHtmlTags(input).replace(/\s+/g, " ").trim();
  }
  return input.replace(/\s+/g, " ").trim();
}

function normalizeQuestionStatements(question: JsonRecord): string[] {
  return normalizeStatements(
    question.statements_facts
    ?? question.statement_facts
    ?? question.statementsFacts
    ?? question.statementFacts
    ?? question.statements
    ?? question.statement
    ?? question.facts
    ?? null,
  );
}

type OptionShape = { label: string; text: string; is_correct?: boolean };
type JsonRecord = Record<string, unknown>;
type StyleProfileResponse = { style_profile?: Record<string, unknown> };
type AttemptableQuestion = {
  key: string;
  question: JsonRecord;
  sourceItem: JsonRecord;
  questionIndex?: number;
  passage_title?: string;
  passage_text?: string;
};
type EditableQuestionDraft = {
  question_statement: string;
  supp_question_statement: string;
  question_prompt: string;
  statements_facts_input: string;
  options: { label: string; text: string }[];
  correct_answer: string;
  explanation: string;
  passage_title: string;
  passage_text: string;
};
type SharePlatform = "native" | "copy" | "copy_rich" | "x" | "whatsapp" | "telegram" | "facebook";
type PostActionTab = "pdf" | "share" | "add_existing" | "create_new";
type SharePayload = {
  title: string;
  text: string;
  html?: string;
  url?: string;
};
type FormatMixEntry = {
  id: string;
  analysisId: string;
  count: string;
};
type MixJobTaskStatus = "pending" | "running" | "retrying" | "completed" | "failed";
type MixJobTask = {
  id: string;
  title: string;
  requestedCount: number;
  attempt: number;
  maxAttempts: number;
  status: MixJobTaskStatus;
  error?: string;
};
type OcrImageFile = {
  id: string;
  name: string;
  preview: string;
  base64: string;
};

function toMixJobTaskStatus(value: string): MixJobTaskStatus {
  if (value === "running" || value === "retrying" || value === "completed" || value === "failed") return value;
  return "pending";
}

type StoredGeneratedQuizEntry = {
  quiz_kind: QuizKind;
  parsed_quiz_data: unknown;
  recent_questions: string[];
  created_at: number;
  expires_at: number;
};

type StoredGeneratedQuizState = {
  version: number;
  entries: Partial<Record<QuizKind, StoredGeneratedQuizEntry>>;
};

type SharedGeneratorSettings = {
  content_source_type?: "text" | "url" | "pdf" | "image";
  content_text?: string;
  content_url?: string;
  ocr_extracted_text?: string;
  selected_uploaded_pdf_id?: string;
  ocr_on_upload?: boolean;
  additional_instructions?: string;
  example_question?: string;
  example_questions_input?: string;
  analyzed_example_style?: string;
  desired_question_count?: string;
  output_language?: OutputLanguage;
  analysis_tag_l1_filter?: string;
  analysis_tag_l2_filter?: string;
  selected_analysis_id?: string;
  mix_entries?: FormatMixEntry[];
  use_category_source?: boolean;
  selected_exam_id?: number | null;
  selected_category_ids?: number[];
};

function asRecord(value: unknown): JsonRecord | null {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as JsonRecord) : null;
}

function normalizeOptions(raw: unknown, correctAnswer?: string | null): OptionShape[] {
  const desired = (correctAnswer || "").toUpperCase();

  if (Array.isArray(raw)) {
    const normalized: OptionShape[] = raw.map((opt, idx) => {
      const fallbackLabel = String.fromCharCode(65 + idx);
      if (typeof opt === "string") {
        return {
          label: fallbackLabel,
          text: opt,
          is_correct: desired === fallbackLabel,
        };
      }
      if (opt && typeof opt === "object") {
        const map = opt as Record<string, unknown>;
        let label = String(map.label ?? map.option_label ?? map.option ?? fallbackLabel).toUpperCase().trim();
        if (label.startsWith("OPTION ")) label = label.replace("OPTION ", "").trim();
        if (["1", "2", "3", "4", "5"].includes(label)) {
          label = String.fromCharCode(64 + Number(label));
        }
        if (!["A", "B", "C", "D", "E"].includes(label)) {
          label = fallbackLabel;
        }
        const text = String(map.text ?? map.option_text ?? map.value ?? map.option_value ?? "");
        const isCorrect = Boolean(map.is_correct) || desired === label;
        return { label, text, is_correct: isCorrect };
      }
      return { label: fallbackLabel, text: "", is_correct: false };
    });
    return normalized.filter((opt) => opt.text.trim());
  }

  if (raw && typeof raw === "object") {
    const map = raw as Record<string, unknown>;
    const pairs = Object.entries(map)
      .map<OptionShape | null>(([key, value]) => {
        let label = String(key || "").trim().toUpperCase();
        if (label.startsWith("OPTION ")) label = label.replace("OPTION ", "").trim();
        if (["1", "2", "3", "4", "5"].includes(label)) {
          label = String.fromCharCode(64 + Number(label));
        }
        if (!["A", "B", "C", "D", "E"].includes(label)) return null;
        const text = typeof value === "string"
          ? value
          : (value && typeof value === "object")
            ? String(
              (value as Record<string, unknown>).text
              ?? (value as Record<string, unknown>).option_text
              ?? (value as Record<string, unknown>).value
              ?? (value as Record<string, unknown>).option_value
              ?? "",
            )
            : "";
        return { label, text, is_correct: desired === label };
      })
      .filter((item): item is OptionShape => item !== null);
    return pairs
      .sort((a, b) => a.label.localeCompare(b.label))
      .filter((opt) => opt.text.trim());
  }

  return [];
}

function resolveCorrectAnswer(raw: JsonRecord, fallback = "A"): string {
  const value = raw.correct_answer
    ?? raw.correct_option
    ?? raw.correctOption
    ?? raw.answer
    ?? raw.answer_key
    ?? raw.answerKey
    ?? "";
  const normalized = String(value || "").trim().toUpperCase();
  return normalized || fallback;
}

function generatedQuizStorageKey(userId: string): string {
  return `premium-ai-user-generated:${userId}`;
}

function sharedGeneratorSettingsStorageKey(userId: string): string {
  return `premium-ai-user-shared-settings:${userId}`;
}

function toPositiveInt(value: string, fallback = 1): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(1, Math.floor(parsed));
}

function createMixEntryId(): string {
  return `${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
}

async function sleep(ms: number): Promise<void> {
  await new Promise((resolve) => window.setTimeout(resolve, ms));
}

function readGeneratedQuizState(storageKey: string): StoredGeneratedQuizState {
  if (typeof window === "undefined") {
    return { version: GENERATED_QUIZ_STORAGE_VERSION, entries: {} };
  }
  try {
    const raw = window.localStorage.getItem(storageKey);
    if (!raw) return { version: GENERATED_QUIZ_STORAGE_VERSION, entries: {} };

    const parsed = JSON.parse(raw) as { entries?: Record<string, unknown> } | null;
    const sourceEntries = parsed?.entries && typeof parsed.entries === "object"
      ? (parsed.entries as Record<string, unknown>)
      : {};

    const now = Date.now();
    let changed = false;
    const entries: Partial<Record<QuizKind, StoredGeneratedQuizEntry>> = {};

    for (const kind of QUIZ_KINDS) {
      const candidate = sourceEntries[kind];
      if (!candidate || typeof candidate !== "object") continue;
      const row = candidate as Record<string, unknown>;
      const createdAt = Number(row.created_at);
      const expiresAt = Number(row.expires_at);
      if (!Number.isFinite(createdAt) || !Number.isFinite(expiresAt) || expiresAt <= now) {
        changed = true;
        continue;
      }
      entries[kind] = {
        quiz_kind: kind,
        parsed_quiz_data: row.parsed_quiz_data,
        recent_questions: Array.isArray(row.recent_questions)
          ? row.recent_questions.map((item) => String(item)).filter(Boolean).slice(-30)
          : [],
        created_at: createdAt,
        expires_at: expiresAt,
      };
    }

    if (changed) {
      const hasEntries = QUIZ_KINDS.some((kind) => Boolean(entries[kind]));
      if (hasEntries) {
        window.localStorage.setItem(storageKey, JSON.stringify({ version: GENERATED_QUIZ_STORAGE_VERSION, entries }));
      } else {
        window.localStorage.removeItem(storageKey);
      }
    }

    return { version: GENERATED_QUIZ_STORAGE_VERSION, entries };
  } catch {
    window.localStorage.removeItem(storageKey);
    return { version: GENERATED_QUIZ_STORAGE_VERSION, entries: {} };
  }
}

function writeGeneratedQuizState(storageKey: string, state: StoredGeneratedQuizState): void {
  if (typeof window === "undefined") return;
  const hasEntries = QUIZ_KINDS.some((kind) => Boolean(state.entries[kind]));
  if (!hasEntries) {
    window.localStorage.removeItem(storageKey);
    return;
  }
  window.localStorage.setItem(
    storageKey,
    JSON.stringify({
      version: GENERATED_QUIZ_STORAGE_VERSION,
      entries: state.entries,
    }),
  );
}

function readSharedGeneratorSettings(storageKey: string): SharedGeneratorSettings {
  if (typeof window === "undefined") return {};
  try {
    const raw = window.localStorage.getItem(storageKey);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as SharedGeneratorSettings | null;
    if (!parsed || typeof parsed !== "object") return {};
    return parsed;
  } catch {
    window.localStorage.removeItem(storageKey);
    return {};
  }
}

function writeSharedGeneratorSettings(storageKey: string, settings: SharedGeneratorSettings): void {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(storageKey, JSON.stringify(settings));
}

type AIUserStudioProps = {
  quizKind: QuizKind;
  mode?: "default" | "quiz_master";
  enforceTargetCollection?: boolean;
};

export default function AIUserStudio({
  quizKind,
  mode = "default",
  enforceTargetCollection = false,
}: AIUserStudioProps) {
  const { user, isAuthenticated } = useAuth();
  const searchParams = useSearchParams();
  const quizMasterMode = mode === "quiz_master";

  const [analyses, setAnalyses] = useState<PremiumAIExampleAnalysis[]>([]);
  const [selectedAnalysisId, setSelectedAnalysisId] = useState("");
  const [analysisTagL1Filter, setAnalysisTagL1Filter] = useState("");
  const [analysisTagL2Filter, setAnalysisTagL2Filter] = useState("");

  const [contentSourceType, setContentSourceType] = useState<"text" | "url" | "pdf" | "image">("pdf");
  const [contentText, setContentText] = useState("");
  const [contentUrl, setContentUrl] = useState("");
  const [ocrImages, setOcrImages] = useState<OcrImageFile[]>([]);
  const [ocrExtractedText, setOcrExtractedText] = useState("");
  const [extractingImageText, setExtractingImageText] = useState(false);
  const [uploadedPdfs, setUploadedPdfs] = useState<UploadedPDF[]>([]);
  const [selectedUploadedPdfId, setSelectedUploadedPdfId] = useState<string>("");
  const [uploadingPdf, setUploadingPdf] = useState(false);
  const [loadingUploadedPdfs, setLoadingUploadedPdfs] = useState(false);
  const [deletingPdfId, setDeletingPdfId] = useState<number | null>(null);
  const [ocrOnUpload, setOcrOnUpload] = useState(true);
  const [additionalInstructions, setAdditionalInstructions] = useState("");
  const [exampleQuestion, setExampleQuestion] = useState("");
  const [exampleQuestionsInput, setExampleQuestionsInput] = useState("");
  const [analyzedExampleStyle, setAnalyzedExampleStyle] = useState("");
  const [analyzingExampleStyle, setAnalyzingExampleStyle] = useState(false);
  const [exampleQuestionsModalItem, setExampleQuestionsModalItem] = useState<PremiumAIExampleAnalysis | null>(null);
  const [mixEntries, setMixEntries] = useState<FormatMixEntry[]>([]);
  const [desiredQuestionCount, setDesiredQuestionCount] = useState("5");
  const [outputLanguage, setOutputLanguage] = useState<OutputLanguage>("en");
  const [currentStep, setCurrentStep] = useState<number>(3);
  const useUnifiedMainsLikeLayout = true;
  const [showChatSettings, setShowChatSettings] = useState(false);
  const [showAdvancedFormatControls, setShowAdvancedFormatControls] = useState(false);
  const [questionStyleTab, setQuestionStyleTab] = useState<"existing" | "own">("existing");
  const [useCategorySource, setUseCategorySource] = useState(false);
  const [selectedExamId, setSelectedExamId] = useState<number | null>(null);
  const [selectedCategoryIds, setSelectedCategoryIds] = useState<number[]>([]);
  const [categoryNameById, setCategoryNameById] = useState<Record<number, string>>({});
  const [mixJobTasks, setMixJobTasks] = useState<MixJobTask[]>([]);
  const [lastMixJobFailedCount, setLastMixJobFailedCount] = useState(0);

  const [loading, setLoading] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [result, setResult] = useState<unknown | null>(null);
  const [recentQuestions, setRecentQuestions] = useState<string[]>([]);
  const [collections, setCollections] = useState<PremiumCollection[]>([]);
  const [selectedCollectionId, setSelectedCollectionId] = useState("");
  const [newCollectionName, setNewCollectionName] = useState("");
  const [isAddingToCollection, setIsAddingToCollection] = useState(false);
  const [isGeneratingPdf, setIsGeneratingPdf] = useState(false);
  const [activePostActionTab, setActivePostActionTab] = useState<PostActionTab>("pdf");
  const [attemptSelections, setAttemptSelections] = useState<Record<string, string>>({});
  const [attemptSubmitted, setAttemptSubmitted] = useState<Record<string, boolean>>({});
  const [selectedAttemptKeys, setSelectedAttemptKeys] = useState<string[]>([]);
  const [editingQuestionKey, setEditingQuestionKey] = useState<string | null>(null);
  const [editingQuestionDraft, setEditingQuestionDraft] = useState<EditableQuestionDraft | null>(null);
  const [editingExplanationKey, setEditingExplanationKey] = useState<string | null>(null);
  const [storageUserId, setStorageUserId] = useState("anonymous");
  const [generatedExpiresAt, setGeneratedExpiresAt] = useState<number | null>(null);
  const [sharedSettingsHydrated, setSharedSettingsHydrated] = useState(false);
  const queryRequiresTargetBinding = useMemo(() => {
    const raw = String(searchParams.get("bind_test") || "").trim().toLowerCase();
    return raw === "1" || raw === "true" || raw === "yes";
  }, [searchParams]);
  const requestedCollectionId = useMemo(() => {
    const raw = searchParams.get("collection_id") || searchParams.get("test_id") || "";
    const parsed = Number(raw);
    if (!Number.isFinite(parsed) || parsed <= 0) return null;
    return Math.floor(parsed);
  }, [searchParams]);
  const requireSpecificTargetCollection = enforceTargetCollection || queryRequiresTargetBinding;

  useEffect(() => {
    setOutputLanguage(readOutputLanguage());
  }, []);

  const selectedContentType = CONTENT_TYPE_MAP[quizKind];
  const quizMasterAccount = isQuizMasterLike(user);
  const hasGenerationAccess = quizMasterMode
    ? hasQuizMasterGenerationSubscription(user)
    : hasGenerationSubscription(user);
  const subscriptionRequiredMessage = quizMasterMode
    ? (quizMasterAccount
      ? "Active Quiz Master AI subscription required."
      : "Quiz Master role is required for this workspace.")
    : "Active subscription required for AI generation.";
  const ocrSubscriptionRequiredMessage = quizMasterMode
    ? (quizMasterAccount
      ? "Active Quiz Master AI subscription required for OCR."
      : "Quiz Master role is required for this workspace.")
    : "Active subscription required for OCR.";
  const kindRouteMap = useMemo(() => {
    const basePath = quizMasterMode ? "/quiz-master/ai-quiz" : "/ai-quiz-generator";
    const query = new URLSearchParams();
    if (requestedCollectionId) query.set("collection_id", String(requestedCollectionId));
    if (requireSpecificTargetCollection) query.set("bind_test", "1");
    const suffix = query.toString();
    const trailing = suffix ? `?${suffix}` : "";
    return {
      gk: `${basePath}/gk${trailing}`,
      maths: `${basePath}/maths${trailing}`,
      passage: `${basePath}/passage${trailing}`,
    } satisfies Record<QuizKind, string>;
  }, [quizMasterMode, requestedCollectionId, requireSpecificTargetCollection]);
  const canEditGeneratedQuestions = hasGenerationAccess;
  const generatedStorageKey = useMemo(() => generatedQuizStorageKey(storageUserId), [storageUserId]);
  const sharedSettingsKey = useMemo(() => sharedGeneratorSettingsStorageKey(storageUserId), [storageUserId]);

  useEffect(() => {
    let active = true;
    const hydrateUser = async () => {
      try {
        const supabase = createClient();
        const { data: { user } } = await supabase.auth.getUser();
        if (!active) return;
        setStorageUserId(user?.id || "anonymous");
      } catch {
        if (!active) return;
        setStorageUserId("anonymous");
      }
    };
    hydrateUser();
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    setSharedSettingsHydrated(false);
    const saved = readSharedGeneratorSettings(sharedSettingsKey);
    setContentSourceType(saved.content_source_type || "text");
    setContentText(saved.content_text || "");
    setContentUrl(saved.content_url || "");
    setOcrExtractedText(saved.ocr_extracted_text || "");
    setSelectedUploadedPdfId(saved.selected_uploaded_pdf_id || "");
    setOcrOnUpload(saved.ocr_on_upload ?? true);
    setAdditionalInstructions(saved.additional_instructions || "");
    setExampleQuestion(saved.example_question || "");
    setExampleQuestionsInput(saved.example_questions_input || "");
    setAnalyzedExampleStyle(saved.analyzed_example_style || "");
    setDesiredQuestionCount(saved.desired_question_count || "5");
    if (saved.output_language) {
      const normalizedLanguage = normalizeOutputLanguage(saved.output_language);
      setOutputLanguage(normalizedLanguage);
      persistOutputLanguage(normalizedLanguage);
    }
    setUseCategorySource(Boolean(saved.use_category_source));
    setSelectedExamId(
      typeof saved.selected_exam_id === "number" && Number.isFinite(saved.selected_exam_id)
        ? saved.selected_exam_id
        : null,
    );
    setSelectedCategoryIds(normalizeCategoryIds(saved.selected_category_ids));
    setAnalysisTagL1Filter(saved.analysis_tag_l1_filter || "");
    setAnalysisTagL2Filter(saved.analysis_tag_l2_filter || "");
    setSelectedAnalysisId(saved.selected_analysis_id || "");
    if (Array.isArray(saved.mix_entries)) {
      const validRows = saved.mix_entries
        .filter((row): row is FormatMixEntry => (
          Boolean(row)
          && typeof row.id === "string"
          && typeof row.analysisId === "string"
          && typeof row.count === "string"
        ))
        .map((row) => ({ id: row.id, analysisId: row.analysisId, count: row.count }));
      setMixEntries(validRows);
    } else {
      setMixEntries([]);
    }
    setSharedSettingsHydrated(true);
  }, [sharedSettingsKey]);

  useEffect(() => {
    let active = true;
    const loadCategoryNames = async () => {
      if (!selectedExamId) {
        if (active) setCategoryNameById({});
        return;
      }
      try {
        const quizType = `premium_${quizKind}`;
        const response = await axios.get<PremiumCategory[]>(
          `${premiumApiRoot}/api/v1/premium-categories/${quizType}/`,
          {
            params: {
              hierarchical: true,
              exam_id: selectedExamId,
            },
          },
        );
        if (!active) return;
        const map: Record<number, string> = {};
        flattenCategoryNameMap(response.data || [], map);
        setCategoryNameById(map);
      } catch {
        if (!active) return;
        setCategoryNameById({});
      }
    };
    void loadCategoryNames();
    return () => {
      active = false;
    };
  }, [quizKind, selectedExamId]);

  useEffect(() => {
    if (!sharedSettingsHydrated) return;
    writeSharedGeneratorSettings(sharedSettingsKey, {
      content_source_type: contentSourceType,
      content_text: contentText,
      content_url: contentUrl,
      ocr_extracted_text: ocrExtractedText,
      selected_uploaded_pdf_id: selectedUploadedPdfId,
      ocr_on_upload: ocrOnUpload,
      additional_instructions: additionalInstructions,
      example_question: exampleQuestion,
      example_questions_input: exampleQuestionsInput,
      analyzed_example_style: analyzedExampleStyle,
      desired_question_count: desiredQuestionCount,
      output_language: outputLanguage,
      use_category_source: useCategorySource,
      selected_exam_id: selectedExamId,
      selected_category_ids: selectedCategoryIds,
      analysis_tag_l1_filter: analysisTagL1Filter,
      analysis_tag_l2_filter: analysisTagL2Filter,
      selected_analysis_id: selectedAnalysisId,
      mix_entries: mixEntries,
    });
  }, [
    additionalInstructions,
    analysisTagL1Filter,
    analysisTagL2Filter,
    analyzedExampleStyle,
    contentSourceType,
    contentText,
    contentUrl,
    desiredQuestionCount,
    outputLanguage,
    selectedCategoryIds,
    selectedExamId,
    exampleQuestion,
    exampleQuestionsInput,
    mixEntries,
    ocrExtractedText,
    ocrOnUpload,
    useCategorySource,
    selectedAnalysisId,
    selectedUploadedPdfId,
    sharedSettingsHydrated,
    sharedSettingsKey,
  ]);

  const selectedAnalysis = useMemo(
    () => analyses.find((item) => String(item.id) === selectedAnalysisId) || null,
    [analyses, selectedAnalysisId],
  );

  const activeMixPlan = useMemo(() => {
    return mixEntries
      .map((entry) => {
        const analysis = analyses.find((item) => String(item.id) === entry.analysisId);
        const count = Math.min(100, toPositiveInt(entry.count, 1));
        if (!analysis) return null;
        return { ...entry, analysis, count };
      })
      .filter((item): item is { id: string; analysisId: string; count: number; analysis: PremiumAIExampleAnalysis } => Boolean(item));
  }, [mixEntries, analyses]);

  const totalMixedRequested = useMemo(
    () => activeMixPlan.reduce((sum, item) => sum + item.count, 0),
    [activeMixPlan],
  );

  const mixCountByAnalysisId = useMemo(() => {
    const map = new Map<string, string>();
    for (const entry of mixEntries) {
      const analysisId = String(entry.analysisId || "").trim();
      if (!analysisId) continue;
      const normalized = String(toPositiveInt(entry.count, 0));
      map.set(analysisId, normalized);
    }
    return map;
  }, [mixEntries]);

  const sourceReady = useMemo(() => {
    if (useCategorySource) return selectedCategoryIds.length > 0;
    if (contentSourceType === "text") return Boolean(contentText.trim());
    if (contentSourceType === "url") return Boolean(contentUrl.trim());
    if (contentSourceType === "image") return Boolean(ocrExtractedText.trim());
    return Boolean(selectedUploadedPdfId);
  }, [contentSourceType, contentText, contentUrl, ocrExtractedText, selectedUploadedPdfId, selectedCategoryIds, useCategorySource]);

  const formatPlanReady = useMemo(() => {
    if (activeMixPlan.length > 0) return totalMixedRequested > 0;
    return Boolean(selectedAnalysisId || analyzedExampleStyle.trim() || parseExampleLines(exampleQuestionsInput).length > 0);
  }, [activeMixPlan.length, analyzedExampleStyle, exampleQuestionsInput, selectedAnalysisId, totalMixedRequested]);

  const shouldUseAsyncJobMode = useMemo(
    () => activeMixPlan.length > 1 && totalMixedRequested >= LARGE_MIX_ASYNC_THRESHOLD,
    [activeMixPlan.length, totalMixedRequested],
  );

  const analysisTagHierarchy = useMemo(() => {
    const map = new Map<string, Set<string>>();
    for (const item of analyses) {
      const l1 = normalizeTag(item.tag_level1);
      const l2 = normalizeTag(item.tag_level2);
      if (!l1) continue;
      if (!map.has(l1)) map.set(l1, new Set());
      if (l2) map.get(l1)?.add(l2);
    }
    return {
      level1: Array.from(map.keys()).sort((a, b) => a.localeCompare(b)),
      level2ByLevel1: map,
    };
  }, [analyses]);

  const filteredAnalyses = useMemo(() => {
    return analyses.filter((item) => {
      const l1Match = !analysisTagL1Filter || normalizeTag(item.tag_level1) === normalizeTag(analysisTagL1Filter);
      const l2Match = !analysisTagL2Filter || normalizeTag(item.tag_level2) === normalizeTag(analysisTagL2Filter);
      return l1Match && l2Match;
    });
  }, [analyses, analysisTagL1Filter, analysisTagL2Filter]);

  useEffect(() => {
    if (filteredAnalyses.length === 0) {
      setSelectedAnalysisId("");
      return;
    }
    if (!filteredAnalyses.some((item) => String(item.id) === selectedAnalysisId)) {
      setSelectedAnalysisId(String(filteredAnalyses[0].id));
    }
  }, [filteredAnalyses, selectedAnalysisId]);

  useEffect(() => {
    if (analyses.length === 0) {
      setMixEntries([]);
      return;
    }
    setMixEntries((prev) =>
      prev
        .filter((entry) => analyses.some((item) => String(item.id) === entry.analysisId))
        .map((entry) => ({ ...entry, count: String(toPositiveInt(entry.count, 1)) })),
    );
  }, [analyses]);

  const loadAnalyses = useCallback(async () => {
    const params = new URLSearchParams();
    params.set("content_type", selectedContentType);
    params.set("include_admin", "false");
    const response = await legacyPremiumAiApi.get<PremiumAIExampleAnalysisListResponse>(
      `/premium-ai-quizzes/example-analyses?${params.toString()}`,
    );
    const nextAnalyses = response.data?.items || [];
    setAnalyses(nextAnalyses);
    setSelectedAnalysisId((current) => {
      if (current && nextAnalyses.some((item) => String(item.id) === current)) return current;
      if (nextAnalyses.length > 0) return String(nextAnalyses[0].id);
      return "";
    });
  }, [selectedContentType]);

  const loadUploadedPdfs = useCallback(async () => {
    setLoadingUploadedPdfs(true);
    try {
      const supabase = createClient();
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.access_token) {
        setUploadedPdfs([]);
        setSelectedUploadedPdfId("");
        return;
      }
      const response = await legacyPremiumAiApi.get<UploadedPDF[]>("/premium-ai-quizzes/uploaded-pdfs");
      const items = Array.isArray(response.data) ? response.data : [];
      setUploadedPdfs(items);
      setSelectedUploadedPdfId((prev) => {
        if (prev && items.some((item) => String(item.id) === prev)) return prev;
        return items[0] ? String(items[0].id) : "";
      });
    } catch (error: unknown) {
      setUploadedPdfs([]);
      setSelectedUploadedPdfId("");
      if (axios.isAxiosError(error) && error.response?.status === 401) {
        return;
      }
      toast.error("Failed to load uploaded PDFs.", { description: toError(error) });
    } finally {
      setLoadingUploadedPdfs(false);
    }
  }, []);

  const loadAll = useCallback(async () => {
    setLoading(true);
    try {
      await loadAnalyses();
    } catch (error: unknown) {
      toast.error("Failed to load AI quiz settings", { description: toError(error) });
    } finally {
      setLoading(false);
    }
  }, [loadAnalyses]);

  useEffect(() => {
    loadAll();
  }, [loadAll]);

  useEffect(() => {
    if (!isAuthenticated) {
      setUploadedPdfs([]);
      setSelectedUploadedPdfId("");
      return;
    }
    if (contentSourceType !== "pdf") {
      return;
    }
    loadUploadedPdfs();
  }, [contentSourceType, isAuthenticated, loadUploadedPdfs]);

  const loadCollections = useCallback(async () => {
    try {
      const response = await premiumApi.get<PremiumCollection[]>("/collections", {
        params: { mine_only: true, test_kind: "prelims" },
      });
      setCollections(Array.isArray(response.data) ? response.data : []);
    } catch (error: unknown) {
      toast.error("Failed to load Prelims Tests", { description: toError(error) });
    }
  }, []);

  useEffect(() => {
    loadCollections();
  }, [loadCollections]);

  useEffect(() => {
    if (!requestedCollectionId) return;
    if (requireSpecificTargetCollection) {
      setSelectedCollectionId(String(requestedCollectionId));
      return;
    }
    if (collections.some((row) => Number(row.id) === requestedCollectionId)) {
      setSelectedCollectionId(String(requestedCollectionId));
    }
  }, [collections, requestedCollectionId, requireSpecificTargetCollection]);

  const availableCollections = useMemo(() => {
    if (!requireSpecificTargetCollection || !requestedCollectionId) return collections;
    const bound = collections.find((row) => Number(row.id) === requestedCollectionId);
    if (bound) return [bound];
    return [
      {
        id: requestedCollectionId,
        title: `Prelims Test ${requestedCollectionId}`,
        test_kind: "prelims",
      } as PremiumCollection,
    ];
  }, [collections, requireSpecificTargetCollection, requestedCollectionId]);

  const targetCollectionMissing = useMemo(() => {
    return requireSpecificTargetCollection && !requestedCollectionId;
  }, [requireSpecificTargetCollection, requestedCollectionId]);

  const postActionTabs = useMemo<Array<{ id: PostActionTab; label: string }>>(() => {
    const tabs: Array<{ id: PostActionTab; label: string }> = [
      { id: "pdf", label: "Create PDF" },
      { id: "share", label: "Share" },
      { id: "add_existing", label: requireSpecificTargetCollection ? "Add to Bound Test" : "Add to Existing Test" },
    ];
    if (!requireSpecificTargetCollection) {
      tabs.push({ id: "create_new", label: "Create New Test" });
    }
    return tabs;
  }, [requireSpecificTargetCollection]);

  useEffect(() => {
    if (requireSpecificTargetCollection && activePostActionTab === "create_new") {
      setActivePostActionTab("add_existing");
    }
  }, [requireSpecificTargetCollection, activePostActionTab]);

  useEffect(() => {
    const state = readGeneratedQuizState(generatedStorageKey);
    const entry = state.entries[quizKind];
    if (!entry) {
      setResult(null);
      setGeneratedExpiresAt(null);
      return;
    }
    setResult(entry.parsed_quiz_data);
    setGeneratedExpiresAt(entry.expires_at);
    if (entry.recent_questions.length > 0) {
      setRecentQuestions((prev) => (prev.length > 0 ? prev : entry.recent_questions));
    }
  }, [generatedStorageKey, quizKind]);

  const persistGeneratedPreview = useCallback((
    kind: QuizKind,
    parsedQuizData: unknown,
    recentQuestionHistory: string[],
  ) => {
    const now = Date.now();
    const expiresAt = now + GENERATED_QUIZ_TTL_MS;
    const state = readGeneratedQuizState(generatedStorageKey);
    state.entries[kind] = {
      quiz_kind: kind,
      parsed_quiz_data: parsedQuizData,
      recent_questions: recentQuestionHistory.slice(-30),
      created_at: now,
      expires_at: expiresAt,
    };
    writeGeneratedQuizState(generatedStorageKey, state);
    if (kind === quizKind) {
      setGeneratedExpiresAt(expiresAt);
    }
  }, [generatedStorageKey, quizKind]);

  const clearGeneratedPreview = useCallback((kind: QuizKind) => {
    const state = readGeneratedQuizState(generatedStorageKey);
    if (state.entries[kind]) {
      delete state.entries[kind];
      writeGeneratedQuizState(generatedStorageKey, state);
    }
    if (kind === quizKind) {
      setResult(null);
      setGeneratedExpiresAt(null);
      setAttemptSelections({});
      setAttemptSubmitted({});
      setSelectedAttemptKeys([]);
      setEditingQuestionKey(null);
      setEditingQuestionDraft(null);
      setEditingExplanationKey(null);
    }
  }, [generatedStorageKey, quizKind]);

  useEffect(() => {
    if (!generatedExpiresAt) return;
    const clearExpired = () => {
      if (Date.now() < generatedExpiresAt) return;
      clearGeneratedPreview(quizKind);
    };
    clearExpired();
    const timer = window.setInterval(clearExpired, 60_000);
    return () => window.clearInterval(timer);
  }, [clearGeneratedPreview, generatedExpiresAt, quizKind]);

  useEffect(() => {
    if (!result) return;
    persistGeneratedPreview(quizKind, result, recentQuestions);
  }, [persistGeneratedPreview, quizKind, recentQuestions, result]);

  const applySelectedAnalysisToForm = () => {
    if (!selectedAnalysis) return;
    if ((selectedAnalysis.example_questions || []).length > 0) {
      setExampleQuestionsInput(selectedAnalysis.example_questions.join("\n"));
    }
    toast.success("Example format applied to guidance.");
  };

  const addSelectedAnalysisToMix = () => {
    if (!selectedAnalysisId) {
      toast.error("Select an example format first.");
      return;
    }
    setMixEntries((prev) => [
      ...prev,
      { id: createMixEntryId(), analysisId: selectedAnalysisId, count: "1" },
    ]);
  };

  const addEmptyMixRow = () => {
    const fallbackAnalysisId = selectedAnalysisId || (filteredAnalyses[0] ? String(filteredAnalyses[0].id) : "");
    if (!fallbackAnalysisId) {
      toast.error("No example format available to add.");
      return;
    }
    setMixEntries((prev) => [
      ...prev,
      { id: createMixEntryId(), analysisId: fallbackAnalysisId, count: "1" },
    ]);
  };

  const updateMixRow = (id: string, updates: Partial<FormatMixEntry>) => {
    setMixEntries((prev) => prev.map((entry) => (entry.id === id ? { ...entry, ...updates } : entry)));
  };

  const removeMixRow = (id: string) => {
    setMixEntries((prev) => prev.filter((entry) => entry.id !== id));
  };

  const setMixCountForAnalysis = useCallback((analysisId: string, rawValue: string) => {
    const normalizedAnalysisId = String(analysisId || "").trim();
    if (!normalizedAnalysisId) return;

    const digits = String(rawValue || "").replace(/[^\d]/g, "");
    const parsed = Number(digits || "0");
    const normalizedCount = Number.isFinite(parsed) ? Math.max(0, Math.min(100, Math.floor(parsed))) : 0;

    setMixEntries((prev) => {
      const remaining = prev.filter((entry) => String(entry.analysisId) !== normalizedAnalysisId);
      if (normalizedCount <= 0) return remaining;
      return [
        ...remaining,
        {
          id: createMixEntryId(),
          analysisId: normalizedAnalysisId,
          count: String(normalizedCount),
        },
      ];
    });

    if (normalizedCount > 0) {
      setSelectedAnalysisId(normalizedAnalysisId);
    }
  }, []);

  const extractGeneratedItems = useCallback((value: unknown): JsonRecord[] => {
    if (!value) return [];
    if (quizKind === "passage") {
      if (Array.isArray(value)) {
        return value.filter((item): item is JsonRecord => Boolean(asRecord(item)));
      }
      const root = asRecord(value);
      if (!root) return [];
      const passages = root.passages;
      if (Array.isArray(passages)) {
        return passages.filter((item): item is JsonRecord => Boolean(asRecord(item)));
      }
      return [root];
    }
    if (Array.isArray(value)) {
      return value.filter((item): item is JsonRecord => Boolean(asRecord(item)));
    }
    const single = asRecord(value);
    if (!single) return [];
    const questions = single.questions;
    if (Array.isArray(questions)) {
      const parsed = questions
        .map((item) => asRecord(item))
        .filter((item): item is JsonRecord => Boolean(item));
      if (parsed.length > 0) return parsed;
    }
    return [single];
  }, [quizKind]);

  const collectQuestionTextsFromItems = useCallback((items: JsonRecord[]): string[] => {
    if (quizKind === "passage") {
      return items
        .flatMap((item) => {
          const questions = item.questions;
          return Array.isArray(questions) ? questions : [];
        })
        .map((q) => asRecord(q))
        .filter((q): q is JsonRecord => Boolean(q))
        .map((q) => String(q.question_statement || q.question || "").trim())
        .filter(Boolean);
    }
    return items
      .map((item) => String(item.question_statement || item.question || "").trim())
      .filter(Boolean);
  }, [quizKind]);

  const trimPassageItemsByQuestionCount = useCallback((items: JsonRecord[], desiredCount: number): JsonRecord[] => {
    if (desiredCount <= 0) return [];
    let remaining = desiredCount;
    const trimmed: JsonRecord[] = [];

    for (const item of items) {
      if (remaining <= 0) break;
      const questions = Array.isArray(item.questions) ? item.questions : [];
      if (questions.length === 0) continue;
      const nextQuestions = questions.slice(0, remaining);
      if (nextQuestions.length === 0) continue;
      trimmed.push({ ...item, questions: nextQuestions });
      remaining -= nextQuestions.length;
    }

    return trimmed;
  }, []);

  const handlePdfUpload = useCallback(async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    if (!isAuthenticated) {
      toast.error("Login required to upload PDF.");
      return;
    }
    if (file.type !== "application/pdf" && !file.name.toLowerCase().endsWith(".pdf")) {
      toast.error("Only PDF files are allowed.");
      return;
    }
    setUploadingPdf(true);
    try {
      const formData = new FormData();
      formData.append("file", file);
      const response = await legacyPremiumAiApi.post<UploadedPDF>(
        "/premium-ai-quizzes/upload-pdf",
        formData,
        { params: { use_ocr: ocrOnUpload } },
      );
      const uploaded = response.data;
      await loadUploadedPdfs();
      setSelectedUploadedPdfId(String(uploaded.id));
      setContentSourceType("pdf");
      toast.success(`PDF uploaded: ${uploaded.filename}`, {
        description: uploaded.used_ocr
          ? "OCR was used to improve extraction."
          : "Text extraction is ready.",
      });
    } catch (error: unknown) {
      toast.error("PDF upload failed", { description: toError(error) });
    } finally {
      setUploadingPdf(false);
    }
  }, [isAuthenticated, loadUploadedPdfs, ocrOnUpload]);

  const handleDeleteUploadedPdf = useCallback(async (pdf: UploadedPDF) => {
    if (deletingPdfId || uploadingPdf) return;
    if (!window.confirm(`Delete "${pdf.filename}"?`)) return;
    setDeletingPdfId(pdf.id);
    try {
      await legacyPremiumAiApi.delete(`/premium-ai-quizzes/uploaded-pdfs/${pdf.id}`);
      setUploadedPdfs((prev) => prev.filter((item) => item.id !== pdf.id));
      setSelectedUploadedPdfId((prev) => (prev === String(pdf.id) ? "" : prev));
      toast.success("Uploaded PDF deleted.");
    } catch (error: unknown) {
      toast.error("Failed to delete PDF", { description: toError(error) });
    } finally {
      setDeletingPdfId(null);
    }
  }, [deletingPdfId, uploadingPdf]);

  const handleImageFilesChange = useCallback(async (event: ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files || []);
    event.target.value = "";
    if (files.length === 0) return;

    const nextFiles: OcrImageFile[] = [];
    for (const file of files) {
      if (!file.type.startsWith("image/")) {
        toast.error(`"${file.name}" is not an image file.`);
        continue;
      }
      const fileData = await new Promise<OcrImageFile>((resolve) => {
        const reader = new FileReader();
        reader.onloadend = () => {
          const result = String(reader.result || "");
          resolve({
            id: `${Date.now()}-${Math.random().toString(16).slice(2, 8)}`,
            name: file.name,
            preview: result,
            base64: result,
          });
        };
        reader.readAsDataURL(file);
      });
      nextFiles.push(fileData);
    }
    if (nextFiles.length === 0) return;
    setOcrImages((prev) => [...prev, ...nextFiles]);
  }, []);

  const removeOcrImage = useCallback((id: string) => {
    setOcrImages((prev) => prev.filter((file) => file.id !== id));
  }, []);

  const moveOcrImage = useCallback((index: number, direction: "up" | "down") => {
    setOcrImages((prev) => {
      const next = [...prev];
      const target = direction === "up" ? index - 1 : index + 1;
      if (target < 0 || target >= next.length) return prev;
      [next[index], next[target]] = [next[target], next[index]];
      return next;
    });
  }, []);

  const extractTextFromImages = useCallback(async () => {
    if (!isAuthenticated) {
      toast.error("Login required to extract text from images.");
      return;
    }
    if (!hasGenerationAccess) {
      toast.error(ocrSubscriptionRequiredMessage);
      return;
    }
    if (ocrImages.length === 0) {
      toast.error("Add photo(s) first.");
      return;
    }

    setExtractingImageText(true);
    try {
      const response = await premiumApi.post<{ extracted_text: string }>("/ai-evaluation/ocr", {
        images_base64: ocrImages.map((file) => file.base64),
        ai_provider: USER_PROVIDER,
        ai_model_name: USER_MODEL,
      });
      const extracted = String(response.data?.extracted_text || "").trim();
      if (!extracted) {
        toast.error("No text was extracted from uploaded photos.");
        return;
      }
      setOcrExtractedText(extracted);
      toast.success(`Text extracted from ${ocrImages.length} image(s).`);
    } catch (error: unknown) {
      toast.error("Image OCR failed", { description: toError(error) });
    } finally {
      setExtractingImageText(false);
    }
  }, [hasGenerationAccess, isAuthenticated, ocrImages, ocrSubscriptionRequiredMessage]);

  const analyzeExampleStyle = useCallback(async () => {
    if (!isAuthenticated) {
      toast.error("Login required to analyze examples.");
      return;
    }
    if (!hasGenerationAccess) {
      toast.error(subscriptionRequiredMessage);
      return;
    }

    const parsedExamples = parseExampleLines(exampleQuestionsInput);
    if (parsedExamples.length === 0) {
      toast.error("Add example question text first.");
      return;
    }

    setAnalyzingExampleStyle(true);
    try {
      const response = await premiumApi.post<StyleProfileResponse>("/ai/style-profile", {
        content_type: selectedContentType,
        example_questions: parsedExamples,
        ai_provider: USER_PROVIDER,
        ai_model_name: USER_MODEL,
      });
      const styleInstructions = String(response.data?.style_profile?.style_instructions || "").trim();
      if (!styleInstructions) {
        toast.error("No style instructions were returned from analysis.");
        return;
      }
      setAnalyzedExampleStyle(styleInstructions);
      toast.success("Example analysis applied to this generation session.");
    } catch (error: unknown) {
      toast.error("Example analysis failed", { description: toError(error) });
    } finally {
      setAnalyzingExampleStyle(false);
    }
  }, [exampleQuestionsInput, hasGenerationAccess, isAuthenticated, selectedContentType, subscriptionRequiredMessage]);

  const generatePreview = async () => {
    if (!isAuthenticated) {
      toast.error("Login required to generate quizzes.");
      return;
    }
    if (!hasGenerationAccess) {
      toast.error(subscriptionRequiredMessage);
      return;
    }

    const requestedCategoryIds = selectedCategoryIds;
    const content = useCategorySource
      ? ""
      : contentSourceType === "text"
        ? contentText.trim()
        : contentSourceType === "image"
          ? ocrExtractedText.trim()
          : "";
    const url = useCategorySource ? "" : (contentSourceType === "url" ? contentUrl.trim() : "");
    const uploadedPdfId = useCategorySource ? NaN : (contentSourceType === "pdf" ? Number(selectedUploadedPdfId) : NaN);
    const normalizedUploadedPdfId = Number.isFinite(uploadedPdfId) && uploadedPdfId > 0 ? uploadedPdfId : undefined;
    if (useCategorySource && requestedCategoryIds.length === 0) {
      toast.error("Select at least one category when category source mode is enabled.");
      return;
    }
    if (!useCategorySource && !content && !url && !normalizedUploadedPdfId) {
      toast.error("Provide source content (text, URL, photo OCR, or uploaded PDF).");
      return;
    }

    setGenerating(true);
    setLastMixJobFailedCount(0);
    try {
      const desiredCount = Math.max(1, Math.min(100, Number(desiredQuestionCount || "5") || 5));
      const parsedExampleQuestions = parseExampleLines(exampleQuestionsInput);
      const customAnalyzedStyle = analyzedExampleStyle.trim();
      let nextRecentQuestions = [...recentQuestions];
      let parsedData: unknown = null;
      let failedTaskCount = 0;
      const buildUserInstructions = (...segments: Array<string | null | undefined>): string => {
        const base = segments.map((segment) => String(segment || "").trim()).filter(Boolean);
        return [...base, EXPLANATION_HTML_ENFORCEMENT_INSTRUCTION].join("\n\n");
      };

      const runPlanGeneration = async (
        plan: { analysisId: string; analysis: PremiumAIExampleAnalysis; count: number },
      ): Promise<JsonRecord[]> => {
        const analysisStyle = String(plan.analysis.style_profile?.style_instructions || "").trim();
        const planStyle = [analysisStyle, customAnalyzedStyle].filter(Boolean).join("\n\n");
        const planInstructions = buildUserInstructions(
          additionalInstructions.trim(),
          `Generate exactly ${plan.count} question(s) in the style of "${plan.analysis.title}".`,
        );

        const response = await legacyPremiumAiApi.post<PremiumPreviewResponse>(`/premium-ai-quizzes/preview/${quizKind}`, {
          content: content || undefined,
          uploaded_pdf_id: normalizedUploadedPdfId,
          url: url || undefined,
          content_type: selectedContentType,
          category_ids: requestedCategoryIds.length > 0 ? requestedCategoryIds : undefined,
          use_category_source: useCategorySource,
          example_analysis_id: Number(plan.analysisId),
          ai_provider: USER_PROVIDER,
          ai_model_name: USER_MODEL,
          user_instructions: planInstructions,
          formatting_instruction_text: planStyle || undefined,
          example_question: exampleQuestion.trim() || undefined,
          example_questions: parsedExampleQuestions,
          recent_questions: nextRecentQuestions.slice(-10),
          desired_question_count: plan.count,
          output_language: outputLanguage,
        });

        const items = extractGeneratedItems(response.data.parsed_quiz_data || null);
        const trimmedItems = quizKind === "passage"
          ? trimPassageItemsByQuestionCount(items, plan.count)
          : items.slice(0, plan.count);

        return trimmedItems;
      };

      if (activeMixPlan.length > 0) {
        const aggregateItems: JsonRecord[] = [];
        const mixPlanPayload = activeMixPlan.map((plan) => {
          const analysisStyle = String(plan.analysis.style_profile?.style_instructions || "").trim();
          const planStyle = [analysisStyle, customAnalyzedStyle].filter(Boolean).join("\n\n");
          const planInstructions = buildUserInstructions(
            additionalInstructions.trim(),
            `Generate exactly ${plan.count} question(s) in the style of "${plan.analysis.title}".`,
          );
          return {
            id: plan.id,
            title: plan.analysis.title,
            count: plan.count,
            analysisId: Number(plan.analysisId),
            userInstructions: planInstructions,
            formattingInstructionText: planStyle || undefined,
          };
        });

        if (shouldUseAsyncJobMode) {
          const initialTasks: MixJobTask[] = mixPlanPayload.map((plan) => ({
            id: plan.id,
            title: plan.title,
            requestedCount: plan.count,
            attempt: 0,
            maxAttempts: MIX_TASK_MAX_ATTEMPTS,
            status: "pending",
          }));
          setMixJobTasks(initialTasks);

          const createPayload: PremiumPreviewMixJobCreateRequest = {
            content: content || undefined,
            uploaded_pdf_id: normalizedUploadedPdfId,
            url: url || undefined,
            content_type: selectedContentType,
            category_ids: requestedCategoryIds.length > 0 ? requestedCategoryIds : undefined,
            use_category_source: useCategorySource,
            ai_provider: USER_PROVIDER,
            ai_model_name: USER_MODEL,
            example_question: exampleQuestion.trim() || undefined,
            example_questions: parsedExampleQuestions,
            recent_questions: nextRecentQuestions.slice(-10),
            max_attempts: MIX_TASK_MAX_ATTEMPTS,
            output_language: outputLanguage,
            plans: mixPlanPayload.map((plan) => ({
              plan_id: plan.id,
              title: plan.title,
              example_analysis_id: plan.analysisId,
              desired_question_count: plan.count,
              user_instructions: plan.userInstructions,
              formatting_instruction_text: plan.formattingInstructionText,
            })),
          };
          const createResponse = await legacyPremiumAiApi.post<PremiumPreviewMixJobCreateResponse>(
            `/premium-ai-quizzes/preview-jobs/${quizKind}`,
            createPayload,
          );

          const jobId = String(createResponse.data.job_id || "");
          if (!jobId) {
            throw new Error("Async mix job could not be created.");
          }

          const terminalStatuses = new Set(["completed", "partial", "failed"]);
          const startedAt = Date.now();
          let terminalSnapshot: PremiumPreviewMixJobStatusResponse | null = null;

          while (Date.now() - startedAt < MIX_JOB_POLL_TIMEOUT_MS) {
            await sleep(MIX_JOB_POLL_INTERVAL_MS);
            const statusResponse = await legacyPremiumAiApi.get<PremiumPreviewMixJobStatusResponse>(
              `/premium-ai-quizzes/preview-jobs/${jobId}`,
            );
            const snapshot = statusResponse.data;
            setMixJobTasks(
              (snapshot.tasks || []).map((task) => ({
                id: String(task.plan_id),
                title: String(task.title || "Format"),
                requestedCount: Number(task.requested_count || 0),
                attempt: Number(task.attempt || 0),
                maxAttempts: Number(task.max_attempts || MIX_TASK_MAX_ATTEMPTS),
                status: toMixJobTaskStatus(String(task.status || "")),
                error: task.error ? String(task.error) : undefined,
              })),
            );
            setLastMixJobFailedCount(Number(snapshot.failed_tasks || 0));
            if (terminalStatuses.has(String(snapshot.status || ""))) {
              terminalSnapshot = snapshot;
              break;
            }
          }

          if (!terminalSnapshot) {
            throw new Error("Async generation is taking longer than expected. Please retry.");
          }
          failedTaskCount = Number(terminalSnapshot.failed_tasks || 0);
          if (!terminalSnapshot.parsed_quiz_data) {
            throw new Error(terminalSnapshot.error || "AI could not generate valid questions for the selected format mix.");
          }
          if (String(terminalSnapshot.status) === "failed") {
            throw new Error(terminalSnapshot.error || "All format tasks failed after retries.");
          }
          parsedData = terminalSnapshot.parsed_quiz_data;
          const freshTexts = collectQuestionTextsFromItems(extractGeneratedItems(parsedData));
          if (freshTexts.length > 0) {
            nextRecentQuestions = [...nextRecentQuestions, ...freshTexts].slice(-30);
          }
        } else {
          setMixJobTasks([]);
          for (const plan of activeMixPlan) {
            const trimmedItems = await runPlanGeneration(plan);
            if (trimmedItems.length === 0) {
              throw new Error(`No valid questions returned for "${plan.analysis.title}".`);
            }
            aggregateItems.push(...trimmedItems);
            const freshTexts = collectQuestionTextsFromItems(trimmedItems);
            if (freshTexts.length > 0) {
              nextRecentQuestions = [...nextRecentQuestions, ...freshTexts].slice(-30);
            }
          }
        }

        if (!shouldUseAsyncJobMode) {
          if (aggregateItems.length === 0) {
            throw new Error("AI could not generate valid questions for the selected format mix.");
          }

          if (quizKind === "passage") {
            parsedData = aggregateItems.length === 1
              ? aggregateItems[0]
              : { passages: aggregateItems };
          } else {
            parsedData = {
              ...(aggregateItems[0] || {}),
              questions: aggregateItems,
            };
          }
        }
      } else {
        setMixJobTasks([]);
        const styleInstruction = String(selectedAnalysis?.style_profile?.style_instructions || "").trim();
        const mergedStyleInstruction = [styleInstruction, customAnalyzedStyle].filter(Boolean).join("\n\n");
        const mergedInstructions = buildUserInstructions(additionalInstructions.trim());
        const payload = {
          content: content || undefined,
          uploaded_pdf_id: normalizedUploadedPdfId,
          url: url || undefined,
          content_type: selectedContentType,
          category_ids: requestedCategoryIds.length > 0 ? requestedCategoryIds : undefined,
          use_category_source: useCategorySource,
          example_analysis_id: selectedAnalysisId ? Number(selectedAnalysisId) : undefined,
          ai_provider: USER_PROVIDER,
          ai_model_name: USER_MODEL,
          user_instructions: mergedInstructions,
          formatting_instruction_text: mergedStyleInstruction || undefined,
          example_question: exampleQuestion.trim() || undefined,
          example_questions: parsedExampleQuestions,
          recent_questions: nextRecentQuestions.slice(-10),
          desired_question_count: desiredCount,
          output_language: outputLanguage,
        };

        const response = await legacyPremiumAiApi.post<PremiumPreviewResponse>(`/premium-ai-quizzes/preview/${quizKind}`, payload);
        parsedData = response.data.parsed_quiz_data || null;

        const generatedItems = extractGeneratedItems(parsedData);
        const freshTexts = collectQuestionTextsFromItems(generatedItems);
        if (freshTexts.length > 0) {
          nextRecentQuestions = [...nextRecentQuestions, ...freshTexts].slice(-30);
        }
      }

      const previousItems = extractGeneratedItems(result);
      const latestItems = extractGeneratedItems(parsedData);
      const mergedItems = [...latestItems, ...previousItems];
      const mergedParsedData = quizKind === "passage"
        ? (mergedItems.length === 1 ? mergedItems[0] : { passages: mergedItems })
        : { questions: mergedItems };

      setResult(mergedParsedData);
      setRecentQuestions(nextRecentQuestions);
      persistGeneratedPreview(quizKind, mergedParsedData, nextRecentQuestions);
      setLastMixJobFailedCount(failedTaskCount);

      const producedCount = collectQuestionTextsFromItems(extractGeneratedItems(parsedData)).length;
      toast.success("Preview generated", {
        description: activeMixPlan.length > 0
          ? `Generated ${producedCount || "mixed-format"} items using your format mix.`
          : "Your generated questions will stay for 24 hours unless you move them into a test.",
      });
      if (failedTaskCount > 0) {
        toast.warning(`${failedTaskCount} format task(s) failed after retries.`, {
          description: "Successful tasks were still included in this preview.",
        });
      }
    } catch (error: unknown) {
      if (activeMixPlan.length === 0) setMixJobTasks([]);
      toast.error("Generation failed", { description: toError(error) });
    } finally {
      setGenerating(false);
    }
  };

  const generatedItems = useMemo(() => extractGeneratedItems(result), [extractGeneratedItems, result]);
  const attemptableQuestions = useMemo<AttemptableQuestion[]>(() => {
    if (quizKind === "passage") {
      return generatedItems.flatMap((passage, passageIndex) => {
        const questions = Array.isArray(passage.questions) ? passage.questions : [];
        const attemptable: AttemptableQuestion[] = [];
        questions.forEach((question, questionIndex) => {
          const record = asRecord(question);
          if (!record) return;
          attemptable.push({
            key: `p${passageIndex}-q${questionIndex}`,
            question: record,
            sourceItem: passage,
            questionIndex,
            passage_title: passage.passage_title ? String(passage.passage_title) : undefined,
            passage_text: passage.passage_text ? String(passage.passage_text) : undefined,
          });
        });
        return attemptable;
      });
    }
    return generatedItems.map((question, index) => ({
      key: `q${index}`,
      question,
      sourceItem: question,
    }));
  }, [generatedItems, quizKind]);

  const generatedReady = attemptableQuestions.length > 0;
  const selectedAttemptKeySet = useMemo(() => new Set(selectedAttemptKeys), [selectedAttemptKeys]);
  const selectedAttemptableQuestions = useMemo(
    () => attemptableQuestions.filter((entry) => selectedAttemptKeySet.has(entry.key)),
    [attemptableQuestions, selectedAttemptKeySet],
  );
  const allAttemptablesSelected = attemptableQuestions.length > 0 && selectedAttemptableQuestions.length === attemptableQuestions.length;
  const selectedGeneratedItems = useMemo<JsonRecord[]>(() => {
    if (selectedAttemptableQuestions.length === 0) return [];
    if (quizKind !== "passage") {
      return selectedAttemptableQuestions.map((entry) => entry.question);
    }
    return selectedAttemptableQuestions.map((entry) => ({
      category_ids: normalizeCategoryIds(
        entry.question.category_ids
        || entry.question.premium_passage_category_ids
        || entry.sourceItem.category_ids
        || entry.sourceItem.premium_passage_category_ids
        || [],
      ),
      passage_title: entry.passage_title || (entry.sourceItem.passage_title ? String(entry.sourceItem.passage_title) : "AI Passage Quiz"),
      passage_text: entry.passage_text || (entry.sourceItem.passage_text ? String(entry.sourceItem.passage_text) : ""),
      source_reference: entry.sourceItem.source_reference ? String(entry.sourceItem.source_reference) : null,
      source: entry.sourceItem.source_reference ? String(entry.sourceItem.source_reference) : null,
      questions: [entry.question],
    }));
  }, [quizKind, selectedAttemptableQuestions]);

  useEffect(() => {
    setAttemptSelections({});
    setAttemptSubmitted({});
    setEditingQuestionKey(null);
    setEditingQuestionDraft(null);
    setEditingExplanationKey(null);
  }, [quizKind, result]);

  useEffect(() => {
    setSelectedAttemptKeys(attemptableQuestions.map((entry) => entry.key));
  }, [attemptableQuestions]);

  useEffect(() => {
    setMixJobTasks([]);
    setLastMixJobFailedCount(0);
  }, [quizKind]);

  const buildQuestionContentData = useCallback((item: JsonRecord) => {
    const correctAnswer = resolveCorrectAnswer(item, "A");
    const categoryIds = normalizeCategoryIds(
      item.category_ids
      || item.premium_gk_category_ids
      || item.premium_maths_category_ids
      || [],
    );
    const options = normalizeOptions(item.options, correctAnswer).map((option, idx) => ({
      label: option.label || String.fromCharCode(65 + idx),
      text: option.text,
      is_correct: Boolean(option.is_correct),
    }));
    return {
      question_statement: String(item.question_statement || item.question || "").trim(),
      supp_question_statement: item.supp_question_statement
        ? String(item.supp_question_statement)
        : item.supplementary_statement
          ? String(item.supplementary_statement)
          : null,
      supplementary_statement: item.supp_question_statement
        ? String(item.supp_question_statement)
        : item.supplementary_statement
          ? String(item.supplementary_statement)
          : null,
      statements_facts: normalizeQuestionStatements(item),
      statement_facts: normalizeQuestionStatements(item),
      question_prompt: item.question_prompt ? String(item.question_prompt) : (item.prompt ? String(item.prompt) : null),
      options,
      correct_answer: correctAnswer || "A",
      explanation: item.explanation ? String(item.explanation) : (item.explanation_text ? String(item.explanation_text) : null),
      explanation_text: item.explanation ? String(item.explanation) : (item.explanation_text ? String(item.explanation_text) : null),
      source_reference: item.source_reference ? String(item.source_reference) : null,
      source: item.source_reference ? String(item.source_reference) : null,
      category_ids: categoryIds,
    };
  }, []);

  const buildPassageContentData = useCallback((item: JsonRecord) => {
    const questions = Array.isArray(item.questions) ? item.questions : [];
    const normalizedQuestions = questions
      .map((q) => asRecord(q))
      .filter((q): q is JsonRecord => Boolean(q))
      .map((q) => {
        const correctAnswer = resolveCorrectAnswer(q, "A");
        const questionCategoryIds = normalizeCategoryIds(
          q.category_ids || q.premium_passage_category_ids || [],
        );
        const options = normalizeOptions(q.options, correctAnswer).map((option, idx) => ({
          label: option.label || String.fromCharCode(65 + idx),
          text: option.text,
          is_correct: Boolean(option.is_correct),
        }));
        return {
          question_statement: String(q.question_statement || q.question || "").trim(),
          supp_question_statement: q.supp_question_statement
            ? String(q.supp_question_statement)
            : q.supplementary_statement
              ? String(q.supplementary_statement)
              : null,
          supplementary_statement: q.supp_question_statement
            ? String(q.supp_question_statement)
            : q.supplementary_statement
              ? String(q.supplementary_statement)
              : null,
          statements_facts: normalizeQuestionStatements(q),
          statement_facts: normalizeQuestionStatements(q),
          question_prompt: q.question_prompt ? String(q.question_prompt) : (q.prompt ? String(q.prompt) : null),
          options,
          correct_answer: correctAnswer || "A",
          explanation: q.explanation ? String(q.explanation) : (q.explanation_text ? String(q.explanation_text) : null),
          explanation_text: q.explanation ? String(q.explanation) : (q.explanation_text ? String(q.explanation_text) : null),
          category_ids: questionCategoryIds,
          premium_passage_category_ids: questionCategoryIds,
        };
      });
    const passageCategoryIds = normalizeCategoryIds(
      item.category_ids
      || item.premium_passage_category_ids
      || normalizedQuestions[0]?.category_ids
      || [],
    );

    return {
      passage_title: item.passage_title ? String(item.passage_title) : "AI Passage Quiz",
      passage_text: item.passage_text ? String(item.passage_text) : "",
      source_reference: item.source_reference ? String(item.source_reference) : null,
      source: item.source_reference ? String(item.source_reference) : null,
      questions: normalizedQuestions,
      category_ids: passageCategoryIds,
      premium_passage_category_ids: passageCategoryIds,
    };
  }, []);

  const addItemsToCollection = useCallback(async (collectionId: number) => {
    if (!selectedGeneratedItems.length) {
      toast.error("Select quiz item(s) first.");
      return;
    }
    setIsAddingToCollection(true);
    try {
      let addedCount = 0;
      for (const item of selectedGeneratedItems) {
        if (quizKind === "passage") {
          const contentData = buildPassageContentData(item);
          await premiumApi.post("/content", {
            title: contentData.passage_title || "AI Passage Quiz",
            type: "quiz_passage",
            data: contentData,
            collection_id: collectionId,
          });
          addedCount += 1;
        } else {
          const contentData = buildQuestionContentData(item);
          await premiumApi.post("/content", {
            title: contentData.question_statement || `AI ${QUIZ_KIND_LABEL[quizKind]} Quiz`,
            type: quizKind === "gk" ? "quiz_gk" : "quiz_maths",
            data: contentData,
            collection_id: collectionId,
          });
          addedCount += 1;
        }
      }
      toast.success(`Added ${addedCount} selected item(s) to Prelims Test.`);
      await loadCollections();
    } catch (error: unknown) {
      toast.error("Failed to add generated items to Prelims Test", { description: toError(error) });
    } finally {
      setIsAddingToCollection(false);
    }
  }, [buildPassageContentData, buildQuestionContentData, loadCollections, quizKind, selectedGeneratedItems]);

  const handleCreatePdf = useCallback(async () => {
    if (!selectedGeneratedItems.length) {
      toast.error("Select quiz item(s) first.");
      return;
    }
    setIsGeneratingPdf(true);
    try {
      const title = `AI ${QUIZ_KIND_LABEL[quizKind]} Quiz`;
      const response = await premiumApi.post("/generate-pdf", {
        title,
        items: selectedGeneratedItems,
      }, {
        responseType: "blob",
      });

      const blob = new Blob([response.data], { type: "application/pdf" });
      const url = window.URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.setAttribute("download", `${title.replace(/\s+/g, "_").toLowerCase()}.pdf`);
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.URL.revokeObjectURL(url);
      toast.success("PDF created");
    } catch (error: unknown) {
      toast.error("Failed to create PDF", { description: toError(error) });
    } finally {
      setIsGeneratingPdf(false);
    }
  }, [quizKind, selectedGeneratedItems]);

  const handleCreateAndAddCollection = useCallback(async () => {
    const name = newCollectionName.trim();
    if (!name) {
      toast.error("Prelims Test name is required.");
      return;
    }
    setIsAddingToCollection(true);
    try {
      const createResponse = await premiumApi.post<PremiumCollection>("/collections", {
        title: name,
        description: "Generated from AI User Studio",
        type: "test_series",
        test_kind: "prelims",
        is_premium: true,
        is_public: false,
        is_finalized: false,
        meta: {
          collection_mode: "prelims_quiz",
          test_kind: "prelims",
        },
      });
      const collectionId = Number(createResponse.data?.id);
      if (!Number.isFinite(collectionId) || collectionId <= 0) {
        throw new Error("Prelims Test creation returned invalid ID.");
      }
      setSelectedCollectionId(String(collectionId));
      setNewCollectionName("");
      await addItemsToCollection(collectionId);
    } catch (error: unknown) {
      toast.error("Failed to create Prelims Test", { description: toError(error) });
      setIsAddingToCollection(false);
    }
  }, [addItemsToCollection, newCollectionName]);

  const handleAddToSelectedCollection = useCallback(() => {
    const collectionId = requireSpecificTargetCollection
      ? Number(requestedCollectionId || 0)
      : Number(selectedCollectionId);
    if (!Number.isFinite(collectionId) || collectionId <= 0) {
      toast.error(
        requireSpecificTargetCollection
          ? "Target Prelims Test is missing or inaccessible."
          : "Select a valid Prelims Test first.",
      );
      return;
    }
    void addItemsToCollection(collectionId);
  }, [addItemsToCollection, requireSpecificTargetCollection, requestedCollectionId, selectedCollectionId]);

  const updateAttemptExplanation = useCallback((attemptKey: string, htmlValue: string) => {
    setResult((prev: unknown | null) => {
      const root = asRecord(prev);
      if (!root) return prev;

      if (quizKind === "passage") {
        const match = attemptKey.match(/^p(\d+)-q(\d+)$/);
        if (!match) return prev;
        const passageIndex = Number(match[1]);
        const questionIndex = Number(match[2]);

        if (Array.isArray(root.passages)) {
          const passages = root.passages;
          const passageRow = asRecord(passages[passageIndex]);
          if (!passageRow || !Array.isArray(passageRow.questions)) return prev;
          const questionRow = asRecord(passageRow.questions[questionIndex]);
          if (!questionRow) return prev;

          const nextQuestion = {
            ...questionRow,
            explanation: htmlValue,
            explanation_text: htmlValue,
          };
          const nextPassageQuestions = [...passageRow.questions];
          nextPassageQuestions[questionIndex] = nextQuestion;
          const nextPassage = {
            ...passageRow,
            questions: nextPassageQuestions,
          };
          const nextPassages = [...passages];
          nextPassages[passageIndex] = nextPassage;
          return {
            ...root,
            passages: nextPassages,
          };
        }

        if (passageIndex === 0 && Array.isArray(root.questions)) {
          const questionRow = asRecord(root.questions[questionIndex]);
          if (!questionRow) return prev;
          const nextQuestion = {
            ...questionRow,
            explanation: htmlValue,
            explanation_text: htmlValue,
          };
          const nextQuestions = [...root.questions];
          nextQuestions[questionIndex] = nextQuestion;
          return {
            ...root,
            questions: nextQuestions,
          };
        }

        return prev;
      }

      const match = attemptKey.match(/^q(\d+)$/);
      if (!match) return prev;
      const questionIndex = Number(match[1]);
      if (!Array.isArray(root.questions)) return prev;
      const questionRow = asRecord(root.questions[questionIndex]);
      if (!questionRow) return prev;

      const nextQuestion = {
        ...questionRow,
        explanation: htmlValue,
        explanation_text: htmlValue,
      };
      const nextQuestions = [...root.questions];
      nextQuestions[questionIndex] = nextQuestion;
      return {
        ...root,
        questions: nextQuestions,
      };
    });
  }, [quizKind]);

  const startEditingAttempt = useCallback((attempt: AttemptableQuestion) => {
    if (!canEditGeneratedQuestions) {
      toast.error("Active subscription required to edit generated quizzes.");
      return;
    }
    const question = attempt.question;
    const correctAnswer = resolveCorrectAnswer(question, "A");
    const normalizedOptions = normalizeOptions(question.options, correctAnswer);
    const existingStatements = normalizeQuestionStatements(question);
    const optionsForDraft = normalizedOptions.length > 0
      ? normalizedOptions.map((option) => ({ label: option.label, text: String(option.text || "") }))
      : ["A", "B", "C", "D"].map((label) => ({ label, text: "" }));

    setEditingQuestionKey(attempt.key);
    setEditingQuestionDraft({
      question_statement: String(question.question_statement || question.question || "").trim(),
      supp_question_statement: String(question.supp_question_statement || question.supplementary_statement || "").trim(),
      question_prompt: String(question.question_prompt || question.prompt || "").trim(),
      statements_facts_input: existingStatements.map((fact) => String(fact).trim()).filter(Boolean).join("\n"),
      options: optionsForDraft,
      correct_answer: correctAnswer,
      explanation: String(question.explanation || question.explanation_text || "").trim(),
      passage_title: String(attempt.passage_title || "").trim(),
      passage_text: String(attempt.passage_text || "").trim(),
    });
    setEditingExplanationKey(null);
  }, [canEditGeneratedQuestions]);

  const cancelEditingAttempt = useCallback(() => {
    setEditingQuestionKey(null);
    setEditingQuestionDraft(null);
  }, []);

  const saveEditedAttempt = useCallback((attemptKey: string) => {
    if (!editingQuestionDraft || editingQuestionKey !== attemptKey) return;
    const cleanedQuestion = editingQuestionDraft.question_statement.trim();
    if (!cleanedQuestion) {
      toast.error("Question statement cannot be empty.");
      return;
    }

    const cleanedOptions = editingQuestionDraft.options
      .map((option) => ({
        label: String(option.label || "").trim().toUpperCase(),
        text: String(option.text || "").trim(),
      }))
      .filter((option) => option.label && option.text);

    if (cleanedOptions.length < 2) {
      toast.error("At least 2 options are required.");
      return;
    }

    const optionLabels = new Set(cleanedOptions.map((option) => option.label));
    const fallbackCorrect = cleanedOptions[0]?.label || "A";
    const nextCorrect = optionLabels.has(editingQuestionDraft.correct_answer.trim().toUpperCase())
      ? editingQuestionDraft.correct_answer.trim().toUpperCase()
      : fallbackCorrect;
    const nextStatementsFacts = parseLines(editingQuestionDraft.statements_facts_input);
    const explanationHtml = formatExplanationHtml(editingQuestionDraft.explanation);

    setResult((prev: unknown | null) => {
      const root = asRecord(prev);
      if (!root) return prev;

      const nextQuestionData = {
        question_statement: cleanedQuestion,
        question: cleanedQuestion,
        supp_question_statement: editingQuestionDraft.supp_question_statement.trim() || null,
        supplementary_statement: editingQuestionDraft.supp_question_statement.trim() || null,
        question_prompt: editingQuestionDraft.question_prompt.trim() || null,
        prompt: editingQuestionDraft.question_prompt.trim() || null,
        statements_facts: nextStatementsFacts,
        statement_facts: nextStatementsFacts,
        options: cleanedOptions.map((option) => ({
          label: option.label,
          text: option.text,
          is_correct: option.label === nextCorrect,
        })),
        correct_answer: nextCorrect,
        explanation: explanationHtml,
        explanation_text: explanationHtml,
      };

      if (quizKind === "passage") {
        const match = attemptKey.match(/^p(\d+)-q(\d+)$/);
        if (!match) return prev;
        const passageIndex = Number(match[1]);
        const questionIndex = Number(match[2]);
        const nextPassageTitle = editingQuestionDraft.passage_title.trim() || "AI Passage Quiz";
        const nextPassageText = editingQuestionDraft.passage_text.trim();

        if (Array.isArray(root.passages)) {
          const passages = root.passages;
          const passageRow = asRecord(passages[passageIndex]);
          if (!passageRow || !Array.isArray(passageRow.questions)) return prev;
          const questionRow = asRecord(passageRow.questions[questionIndex]);
          if (!questionRow) return prev;

          const nextQuestion = {
            ...questionRow,
            ...nextQuestionData,
          };
          const nextPassageQuestions = [...passageRow.questions];
          nextPassageQuestions[questionIndex] = nextQuestion;
          const nextPassage = {
            ...passageRow,
            passage_title: nextPassageTitle,
            passage_text: nextPassageText,
            questions: nextPassageQuestions,
          };
          const nextPassages = [...passages];
          nextPassages[passageIndex] = nextPassage;
          return {
            ...root,
            passages: nextPassages,
          };
        }

        if (passageIndex === 0 && Array.isArray(root.questions)) {
          const questionRow = asRecord(root.questions[questionIndex]);
          if (!questionRow) return prev;
          const nextQuestion = {
            ...questionRow,
            ...nextQuestionData,
          };
          const nextQuestions = [...root.questions];
          nextQuestions[questionIndex] = nextQuestion;
          return {
            ...root,
            passage_title: nextPassageTitle,
            passage_text: nextPassageText,
            questions: nextQuestions,
          };
        }

        return prev;
      }

      const match = attemptKey.match(/^q(\d+)$/);
      if (!match) return prev;
      const questionIndex = Number(match[1]);
      if (!Array.isArray(root.questions)) return prev;
      const questionRow = asRecord(root.questions[questionIndex]);
      if (!questionRow) return prev;

      const nextQuestion = {
        ...questionRow,
        ...nextQuestionData,
      };
      const nextQuestions = [...root.questions];
      nextQuestions[questionIndex] = nextQuestion;
      return {
        ...root,
        questions: nextQuestions,
      };
    });

    setEditingQuestionKey(null);
    setEditingQuestionDraft(null);
    toast.success("Quiz item updated.");
  }, [editingQuestionDraft, editingQuestionKey, quizKind]);

  const removeAttemptQuestion = useCallback((attemptKey: string) => {
    setResult((prev: unknown | null) => {
      const root = asRecord(prev);
      if (!root) return prev;

      if (quizKind === "passage") {
        const match = attemptKey.match(/^p(\d+)-q(\d+)$/);
        if (!match) return prev;
        const passageIndex = Number(match[1]);
        const questionIndex = Number(match[2]);

        if (Array.isArray(root.passages)) {
          const passages = [...root.passages];
          const passageRow = asRecord(passages[passageIndex]);
          if (!passageRow || !Array.isArray(passageRow.questions)) return prev;
          const nextQuestions = passageRow.questions.filter((_, idx) => idx !== questionIndex);
          if (nextQuestions.length === 0) {
            passages.splice(passageIndex, 1);
          } else {
            passages[passageIndex] = {
              ...passageRow,
              questions: nextQuestions,
            };
          }
          if (passages.length === 0) return null;
          return {
            ...root,
            passages,
          };
        }

        if (Array.isArray(root.questions)) {
          const nextQuestions = root.questions.filter((_, idx) => idx !== questionIndex);
          if (nextQuestions.length === 0) return null;
          return {
            ...root,
            questions: nextQuestions,
          };
        }

        return prev;
      }

      const match = attemptKey.match(/^q(\d+)$/);
      if (!match || !Array.isArray(root.questions)) return prev;
      const questionIndex = Number(match[1]);
      const nextQuestions = root.questions.filter((_, idx) => idx !== questionIndex);
      if (nextQuestions.length === 0) return null;
      return {
        ...root,
        questions: nextQuestions,
      };
    });

    setAttemptSelections({});
    setAttemptSubmitted({});
    setSelectedAttemptKeys([]);
    setEditingQuestionKey(null);
    setEditingQuestionDraft(null);
    setEditingExplanationKey(null);
    toast.success("Quiz item removed.");
  }, [quizKind]);

  const buildShareText = useCallback((): string => {
    if (selectedAttemptableQuestions.length === 0) return "";
    const previewItems = selectedAttemptableQuestions.slice(0, 5);
    const lines: string[] = [
      `AI ${QUIZ_KIND_LABEL[quizKind]} Quiz (${selectedAttemptableQuestions.length} selected question${selectedAttemptableQuestions.length > 1 ? "s" : ""})`,
      "",
    ];
    previewItems.forEach((entry, index) => {
      const question = entry.question;
      const questionText = String(question.question_statement || question.question || "").trim();
      if (quizKind === "passage" && entry.passage_title) {
        lines.push(`Passage: ${entry.passage_title}`);
      }
      lines.push(`${index + 1}. ${questionText}`);
      const options = normalizeOptions(question.options, resolveCorrectAnswer(question, "A"));
      options.forEach((option) => {
        lines.push(`${option.label}. ${option.text}`);
      });
      lines.push("");
    });
    if (selectedAttemptableQuestions.length > previewItems.length) {
      lines.push(`...and ${selectedAttemptableQuestions.length - previewItems.length} more.`);
      lines.push("");
    }
    lines.push("Generated via UPSC App AI Quiz Generator");
    return lines.join("\n");
  }, [quizKind, selectedAttemptableQuestions]);

  const sharePayloadToPlatform = useCallback(async (
    platform: SharePlatform,
    payload: SharePayload,
  ) => {
    const pageUrl = payload.url || (typeof window !== "undefined" ? window.location.href : "");
    const payloadText = pageUrl ? `${payload.text}\n\n${pageUrl}`.trim() : payload.text;

    if (platform === "copy") {
      try {
        await navigator.clipboard.writeText(payloadText);
        toast.success("Share text copied.");
      } catch {
        toast.error("Could not copy share text.");
      }
      return;
    }

    if (platform === "copy_rich") {
      try {
        const clipboardAny = navigator.clipboard as Clipboard & { write?: (items: unknown[]) => Promise<void> };
        const clipboardItemCtor = (window as Window & { ClipboardItem?: new (items: Record<string, Blob>) => unknown }).ClipboardItem;
        if (payload.html && clipboardAny.write && clipboardItemCtor) {
          const item = new clipboardItemCtor({
            "text/html": new Blob([payload.html], { type: "text/html" }),
            "text/plain": new Blob([payloadText], { type: "text/plain" }),
          });
          await clipboardAny.write([item]);
          toast.success("Formatted question copied.");
          return;
        }
        await navigator.clipboard.writeText(payloadText);
        toast.success("Share text copied.");
      } catch {
        toast.error("Could not copy question.");
      }
      return;
    }

    if (platform === "native") {
      if (navigator.share) {
        try {
          await navigator.share({
            title: payload.title,
            text: payload.text,
            url: pageUrl || undefined,
          });
          return;
        } catch {
          return;
        }
      }
      toast.error("Native sharing is not supported on this device.");
      return;
    }

    const encodedUrl = encodeURIComponent(pageUrl);
    const encodedText = encodeURIComponent(payload.text);
    const targetUrl = platform === "x"
      ? `https://twitter.com/intent/tweet?text=${encodedText}&url=${encodedUrl}`
      : platform === "whatsapp"
        ? `https://wa.me/?text=${encodeURIComponent(payloadText)}`
        : platform === "telegram"
          ? `https://t.me/share/url?url=${encodedUrl}&text=${encodedText}`
          : `https://www.facebook.com/sharer/sharer.php?u=${encodedUrl}&quote=${encodedText}`;
    window.open(targetUrl, "_blank", "noopener,noreferrer,width=640,height=720");
  }, []);

  const buildSingleAttemptSharePayload = useCallback((attempt: AttemptableQuestion): SharePayload => {
    const question = attempt.question;
    const supplementary = String(question.supp_question_statement || question.supplementary_statement || "").trim();
    const statements = normalizeQuestionStatements(question);
    let promptText = String(question.question_prompt || question.prompt || "").trim();
    let questionText = String(question.question_statement || question.question || "").trim();
    let normalizedStatements = statements.map((fact) => String(fact).trim()).filter(Boolean);
    if (/\bstatement\s*(?:\d+|[ivxlcdm]+)\b/i.test(questionText)) {
      const split = splitStatementStructure(questionText);
      if (normalizedStatements.length === 0 && split.statements.length > 0) {
        normalizedStatements = split.statements;
      }
      if (split.lead) {
        questionText = split.lead;
      } else if (normalizedStatements.length > 0) {
        questionText = "Consider the following statements:";
      }
      if (!promptText && split.prompt) {
        promptText = split.prompt;
      }
    }
    if (normalizedStatements.length > 0 && !questionText) {
      questionText = "Consider the following statements:";
    }
    if (normalizedStatements.length > 0 && looksLikePromptText(questionText) && !promptText) {
      promptText = questionText;
      questionText = "Consider the following statements:";
    }
    const correctAnswer = resolveCorrectAnswer(question, "A");
    const options = normalizeOptions(question.options, correctAnswer);
    const explanationHtml = formatExplanationHtml(String(question.explanation || question.explanation_text || ""));
    const explanationPlain = toPlainText(explanationHtml || String(question.explanation || question.explanation_text || ""));

    const textLines: string[] = [];
    if (quizKind === "passage" && attempt.passage_title) {
      textLines.push(`Passage: ${toPlainText(attempt.passage_title)}`);
    }
    if (quizKind === "passage" && attempt.passage_text) {
      textLines.push(toPlainText(attempt.passage_text));
      textLines.push("");
    }
    textLines.push(`Question: ${toPlainText(questionText)}`);
    if (supplementary) textLines.push(`Supplementary: ${toPlainText(supplementary)}`);
    if (normalizedStatements.length > 0) {
      textLines.push("Statements/Facts:");
      normalizedStatements.forEach((fact, idx) => textLines.push(`${idx + 1}. ${toPlainText(fact)}`));
    }
    if (promptText) textLines.push(`Prompt: ${toPlainText(promptText)}`);
    textLines.push("Options:");
    options.forEach((option) => textLines.push(`${option.label}. ${toPlainText(String(option.text || ""))}`));
    textLines.push(`Correct Answer: ${correctAnswer}`);
    if (explanationPlain) textLines.push(`Explanation: ${explanationPlain}`);
    textLines.push("");
    textLines.push("Generated via UPSC App AI Quiz Generator");

    const toRichFragment = (raw: string): string => {
      const value = String(raw || "").trim();
      if (!value) return "";
      if (/<\s*[a-z][^>]*>/i.test(value)) return sanitizeRichHtml(value);
      return inlineMarkdownToHtml(value);
    };

    const htmlParts: string[] = [];
    if (quizKind === "passage" && attempt.passage_title) {
      htmlParts.push(`<h3>Passage: ${toRichFragment(String(attempt.passage_title || ""))}</h3>`);
    }
    if (quizKind === "passage" && attempt.passage_text) {
      htmlParts.push(`<div>${toRichFragment(String(attempt.passage_text || ""))}</div>`);
    }
    htmlParts.push(`<h3>Question</h3><div>${toRichFragment(questionText)}</div>`);
    if (supplementary) htmlParts.push(`<div><strong>Supplementary:</strong> ${toRichFragment(supplementary)}</div>`);
    if (normalizedStatements.length > 0) {
      htmlParts.push(`<div><strong>Statements/Facts:</strong><ol>${normalizedStatements.map((fact) => `<li>${toRichFragment(fact)}</li>`).join("")}</ol></div>`);
    }
    if (promptText) htmlParts.push(`<div><strong>Prompt:</strong> ${toRichFragment(promptText)}</div>`);
    htmlParts.push(`<div><strong>Options:</strong><ol type="A">${options.map((option) => `<li>${toRichFragment(String(option.text || ""))}</li>`).join("")}</ol></div>`);
    htmlParts.push(`<div><strong>Correct Answer:</strong> ${correctAnswer}</div>`);
    if (explanationHtml) htmlParts.push(`<div><strong>Explanation:</strong><div>${explanationHtml}</div></div>`);
    const questionUrl = typeof window !== "undefined"
      ? `${window.location.origin}${window.location.pathname}${window.location.search}#generated-question-${attempt.key}`
      : "";

    return {
      title: `AI ${QUIZ_KIND_LABEL[quizKind]} Quiz Question`,
      text: textLines.join("\n"),
      html: `<div>${htmlParts.join("")}</div>`,
      url: questionUrl,
    };
  }, [quizKind]);

  const shareSingleQuestion = useCallback(async (
    attempt: AttemptableQuestion,
    platform: SharePlatform,
  ) => {
    const payload = buildSingleAttemptSharePayload(attempt);
    await sharePayloadToPlatform(platform, payload);
  }, [buildSingleAttemptSharePayload, sharePayloadToPlatform]);

  const shareSelectedQuizzes = useCallback(async (platform: SharePlatform) => {
    if (selectedAttemptableQuestions.length === 0) {
      toast.error("Select quiz item(s) first.");
      return;
    }
    const payload: SharePayload = {
      title: `AI ${QUIZ_KIND_LABEL[quizKind]} Quiz`,
      text: buildShareText(),
    };
    await sharePayloadToPlatform(platform, payload);
  }, [buildShareText, quizKind, selectedAttemptableQuestions.length, sharePayloadToPlatform]);

  const resultView = (() => {
    if (attemptableQuestions.length === 0) return <p className="text-sm text-gray-500">No generated output yet.</p>;
    return (
      <div className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-slate-200 bg-slate-50 p-3 text-xs">
          <span className="font-semibold text-slate-700">
            Quiz list: {attemptableQuestions.length} item(s)
          </span>
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-slate-600">Selected: {selectedAttemptableQuestions.length}</span>
            <button
              type="button"
              className="rounded-md border border-slate-300 bg-white px-2.5 py-1 font-semibold text-slate-700 hover:bg-slate-100"
              onClick={() => setSelectedAttemptKeys(attemptableQuestions.map((entry) => entry.key))}
              disabled={allAttemptablesSelected}
            >
              Select All
            </button>
            <button
              type="button"
              className="rounded-md border border-slate-300 bg-white px-2.5 py-1 font-semibold text-slate-700 hover:bg-slate-100"
              onClick={() => setSelectedAttemptKeys([])}
              disabled={selectedAttemptableQuestions.length === 0}
            >
              Clear Selection
            </button>
          </div>
        </div>

        {attemptableQuestions.map((currentAttempt, index) => {
          const currentQuestion = currentAttempt.question;
          const currentKey = currentAttempt.key;
          const isMarkedSelected = selectedAttemptKeySet.has(currentKey);
          const correctAnswer = resolveCorrectAnswer(currentQuestion, "A");
          const options = normalizeOptions(currentQuestion.options, correctAnswer);
          const questionCategoryIds = normalizeCategoryIds(
            currentQuestion.category_ids
            || currentQuestion.premium_gk_category_ids
            || currentQuestion.premium_maths_category_ids
            || currentQuestion.premium_passage_category_ids
            || currentAttempt.sourceItem.category_ids
            || currentAttempt.sourceItem.premium_gk_category_ids
            || currentAttempt.sourceItem.premium_maths_category_ids
            || currentAttempt.sourceItem.premium_passage_category_ids
            || [],
          );
          const selectedLabel = attemptSelections[currentKey] || "";
          const isSubmitted = Boolean(attemptSubmitted[currentKey]);
          const isCorrect = isSubmitted && selectedLabel === correctAnswer;
          const explanation = String(currentQuestion.explanation || currentQuestion.explanation_text || "").trim();
          const explanationHtml = formatExplanationHtml(explanation);
          const supplementary = String(currentQuestion.supp_question_statement || currentQuestion.supplementary_statement || "").trim();
          const statements = normalizeQuestionStatements(currentQuestion);
          let promptText = String(currentQuestion.question_prompt || currentQuestion.prompt || "").trim();
          let questionText = String(currentQuestion.question_statement || currentQuestion.question || "").trim();
          let normalizedStatements = statements.map((fact) => String(fact).trim()).filter(Boolean);
          if (/\bstatement\s*(?:\d+|[ivxlcdm]+)\b/i.test(questionText)) {
            const split = splitStatementStructure(questionText);
            if (normalizedStatements.length === 0 && split.statements.length > 0) {
              normalizedStatements = split.statements;
            }
            if (split.lead) {
              questionText = split.lead;
            } else if (normalizedStatements.length > 0) {
              questionText = "Consider the following statements:";
            }
            if (!promptText && split.prompt) {
              promptText = split.prompt;
            }
          }
          if (normalizedStatements.length > 0 && !questionText) {
            questionText = "Consider the following statements:";
          }
          if (normalizedStatements.length > 0 && looksLikePromptText(questionText) && !promptText) {
            promptText = questionText;
            questionText = "Consider the following statements:";
          }
          const isEditingQuestion = editingQuestionKey === currentKey && Boolean(editingQuestionDraft);

          return (
            <div id={`generated-question-${currentKey}`} key={currentKey} className="space-y-3 rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-xs font-semibold uppercase tracking-wide text-slate-600">
                  Quiz {index + 1}
                </p>
                <div className="flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    className={`rounded-md border px-3 py-1.5 text-xs font-semibold ${isMarkedSelected
                      ? "border-indigo-500 bg-indigo-50 text-indigo-700"
                      : "border-slate-300 bg-white text-slate-700 hover:bg-slate-50"
                      }`}
                    onClick={() => {
                      setSelectedAttemptKeys((prev) => (
                        prev.includes(currentKey)
                          ? prev.filter((key) => key !== currentKey)
                          : [currentKey, ...prev]
                      ));
                    }}
                  >
                    {isMarkedSelected ? "Selected" : "Select"}
                  </button>
                  <button
                    type="button"
                    className="inline-flex items-center rounded-md border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50"
                    onClick={() => void shareSingleQuestion(currentAttempt, "native")}
                  >
                    <Share2 className="mr-1.5 h-3.5 w-3.5" />
                    Share
                  </button>
                  <button
                    type="button"
                    className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50"
                    onClick={() => void shareSingleQuestion(currentAttempt, "copy_rich")}
                  >
                    Copy Rich
                  </button>
                  <button
                    type="button"
                    className="rounded-md border border-slate-300 bg-white px-2.5 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50"
                    onClick={() => void shareSingleQuestion(currentAttempt, "whatsapp")}
                  >
                    WhatsApp
                  </button>
                  <button
                    type="button"
                    className="rounded-md border border-slate-300 bg-white px-2.5 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50"
                    onClick={() => void shareSingleQuestion(currentAttempt, "x")}
                  >
                    X
                  </button>
                  {canEditGeneratedQuestions ? (
                    <button
                      type="button"
                      className="rounded-md border border-emerald-300 bg-emerald-50 px-3 py-1.5 text-xs font-semibold text-emerald-700 hover:bg-emerald-100"
                      onClick={() => (isEditingQuestion ? cancelEditingAttempt() : startEditingAttempt(currentAttempt))}
                    >
                      {isEditingQuestion ? "Cancel Edit" : "Edit"}
                    </button>
                  ) : (
                    <span className="rounded-md border border-slate-200 bg-slate-50 px-2.5 py-1 text-[11px] font-semibold text-slate-500">
                      Edit: subscriber only
                    </span>
                  )}
                  <button
                    type="button"
                    className="inline-flex items-center rounded-md border border-red-300 bg-red-50 px-3 py-1.5 text-xs font-semibold text-red-700 hover:bg-red-100"
                    onClick={() => removeAttemptQuestion(currentKey)}
                  >
                    <Trash2 className="mr-1 h-3.5 w-3.5" />
                    Remove
                  </button>
                </div>
              </div>

              {isEditingQuestion && editingQuestionDraft ? (
                <div className="space-y-3 rounded-md border border-emerald-200 bg-emerald-50/60 p-3">
                  <p className="text-xs font-semibold uppercase tracking-wide text-emerald-700">Edit Quiz Item</p>
                  {quizKind === "passage" ? (
                    <>
                      <input
                        className="w-full rounded-md border border-emerald-200 bg-white px-3 py-2 text-sm"
                        value={editingQuestionDraft.passage_title}
                        onChange={(event) => setEditingQuestionDraft((prev) => (prev ? { ...prev, passage_title: event.target.value } : prev))}
                        placeholder="Passage title"
                      />
                      <textarea
                        className="min-h-[90px] w-full rounded-md border border-emerald-200 bg-white px-3 py-2 text-sm"
                        value={editingQuestionDraft.passage_text}
                        onChange={(event) => setEditingQuestionDraft((prev) => (prev ? { ...prev, passage_text: event.target.value } : prev))}
                        placeholder="Passage text"
                      />
                    </>
                  ) : null}
                  <textarea
                    className="min-h-[80px] w-full rounded-md border border-emerald-200 bg-white px-3 py-2 text-sm"
                    value={editingQuestionDraft.question_statement}
                    onChange={(event) => setEditingQuestionDraft((prev) => (prev ? { ...prev, question_statement: event.target.value } : prev))}
                    placeholder="Question statement"
                  />
                  <input
                    className="w-full rounded-md border border-emerald-200 bg-white px-3 py-2 text-sm"
                    value={editingQuestionDraft.supp_question_statement}
                    onChange={(event) => setEditingQuestionDraft((prev) => (prev ? { ...prev, supp_question_statement: event.target.value } : prev))}
                    placeholder="Supplementary statement (optional)"
                  />
                  <input
                    className="w-full rounded-md border border-emerald-200 bg-white px-3 py-2 text-sm"
                    value={editingQuestionDraft.question_prompt}
                    onChange={(event) => setEditingQuestionDraft((prev) => (prev ? { ...prev, question_prompt: event.target.value } : prev))}
                    placeholder="Prompt (optional)"
                  />
                  <div className="space-y-1">
                    <p className="text-xs font-semibold uppercase tracking-wide text-emerald-700">Statements / Facts</p>
                    <textarea
                      className="min-h-[100px] w-full rounded-md border border-emerald-200 bg-white px-3 py-2 text-sm"
                      value={editingQuestionDraft.statements_facts_input}
                      onChange={(event) => setEditingQuestionDraft((prev) => (prev ? { ...prev, statements_facts_input: event.target.value } : prev))}
                      placeholder="One statement or fact per line"
                    />
                  </div>
                  <div className="space-y-2">
                    {editingQuestionDraft.options.map((option, optionIndex) => (
                      <div key={`${currentKey}-edit-option-${option.label}`} className="grid gap-2 md:grid-cols-[48px_1fr]">
                        <div className="inline-flex items-center justify-center rounded-md border border-emerald-200 bg-white text-xs font-semibold text-emerald-700">
                          {option.label}
                        </div>
                        <input
                          className="w-full rounded-md border border-emerald-200 bg-white px-3 py-2 text-sm"
                          value={option.text}
                          onChange={(event) => {
                            const value = event.target.value;
                            setEditingQuestionDraft((prev) => {
                              if (!prev) return prev;
                              const nextOptions = [...prev.options];
                              nextOptions[optionIndex] = { ...nextOptions[optionIndex], text: value };
                              return { ...prev, options: nextOptions };
                            });
                          }}
                          placeholder={`Option ${option.label}`}
                        />
                      </div>
                    ))}
                  </div>
                  <select
                    className="w-full rounded-md border border-emerald-200 bg-white px-3 py-2 text-sm"
                    value={editingQuestionDraft.correct_answer}
                    onChange={(event) => setEditingQuestionDraft((prev) => (prev ? { ...prev, correct_answer: event.target.value } : prev))}
                  >
                    {editingQuestionDraft.options.map((option) => (
                      <option key={`${currentKey}-correct-${option.label}`} value={option.label}>
                        Correct: {option.label}
                      </option>
                    ))}
                  </select>
                  <MiniRichTextInput
                    value={editingQuestionDraft.explanation}
                    onChange={(value) => setEditingQuestionDraft((prev) => (prev ? { ...prev, explanation: value } : prev))}
                    placeholder="Explanation (HTML supported)"
                  />
                  <div className="flex flex-wrap gap-2">
                    <button
                      type="button"
                      className="inline-flex items-center rounded-md bg-emerald-600 px-3 py-2 text-xs font-semibold text-white hover:bg-emerald-700"
                      onClick={() => saveEditedAttempt(currentKey)}
                    >
                      <Save className="mr-1.5 h-3.5 w-3.5" />
                      Save Edits
                    </button>
                    <button
                      type="button"
                      className="inline-flex items-center rounded-md border border-slate-300 bg-white px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50"
                      onClick={cancelEditingAttempt}
                    >
                      <X className="mr-1.5 h-3.5 w-3.5" />
                      Cancel
                    </button>
                  </div>
                </div>
              ) : null}

              {currentAttempt.passage_text && !isEditingQuestion ? (
                <div className="rounded-md border border-amber-200 bg-amber-50 p-3">
                  <p className="text-xs font-semibold uppercase tracking-wide text-amber-700">
                    {currentAttempt.passage_title || "Passage"}
                  </p>
                  <p className="mt-2 whitespace-pre-wrap text-sm text-amber-900">{currentAttempt.passage_text}</p>
                </div>
              ) : null}

              {!isEditingQuestion ? (
                <div className="rounded-md border border-gray-200 bg-white p-4">
                  <p className="text-sm font-semibold text-gray-900">{questionText}</p>
                  {supplementary ? <p className="mt-1 text-sm text-gray-600">{supplementary}</p> : null}
                  {normalizedStatements.length > 0 ? (
                    <ul className="mt-2 list-disc pl-5 text-sm text-gray-700">
                      {normalizedStatements.map((fact, factIndex) => <li key={factIndex}>{fact}</li>)}
                    </ul>
                  ) : null}
                  {promptText ? <p className="mt-2 text-sm italic text-gray-700">{promptText}</p> : null}
                  {questionCategoryIds.length > 0 ? (
                    <div className="mt-2 flex flex-wrap items-center gap-1">
                      <span className="text-[11px] font-semibold uppercase tracking-wide text-gray-500">Categories:</span>
                      {questionCategoryIds.map((categoryId) => (
                        <span
                          key={`${currentKey}-cat-${categoryId}`}
                          className="rounded-full border border-slate-300 bg-slate-50 px-2 py-0.5 text-[11px] text-slate-700"
                        >
                          {categoryNameById[categoryId] ? `${categoryNameById[categoryId]} (#${categoryId})` : `#${categoryId}`}
                        </span>
                      ))}
                    </div>
                  ) : null}

                  <div className="mt-3 space-y-2">
                    {options.map((option) => {
                      const isSelected = selectedLabel === option.label;
                      const isCorrectOption = option.label === correctAnswer;
                      const optionClass = isSubmitted
                        ? isCorrectOption
                          ? "border-green-400 bg-green-50 text-green-900"
                          : isSelected
                            ? "border-red-400 bg-red-50 text-red-900"
                            : "border-gray-200 bg-white text-gray-700"
                        : isSelected
                          ? "border-indigo-400 bg-indigo-50 text-indigo-900"
                          : "border-gray-200 bg-white text-gray-700";
                      return (
                        <button
                          key={option.label}
                          type="button"
                          disabled={isSubmitted}
                          onClick={() => setAttemptSelections((prev) => ({ ...prev, [currentKey]: option.label }))}
                          className={`block w-full rounded-md border px-3 py-2 text-left text-sm disabled:cursor-not-allowed ${optionClass}`}
                        >
                          {option.label}. {option.text}
                        </button>
                      );
                    })}
                  </div>

                  <div className="mt-3 flex flex-wrap items-center gap-2">
                    <button
                      type="button"
                      disabled={!selectedLabel || isSubmitted}
                      onClick={() => {
                        if (!selectedLabel) {
                          toast.error("Select an option first.");
                          return;
                        }
                        setAttemptSubmitted((prev) => ({ ...prev, [currentKey]: true }));
                      }}
                      className="rounded-md bg-gray-900 px-3 py-2 text-xs font-semibold text-white disabled:opacity-60"
                    >
                      Submit Answer
                    </button>
                    {isSubmitted ? (
                      <span className={`text-xs font-semibold ${isCorrect ? "text-green-700" : "text-red-700"}`}>
                        {isCorrect ? "Correct" : `Incorrect (Correct: ${correctAnswer})`}
                      </span>
                    ) : (
                      <span className="text-xs text-gray-500">Answer and explanation will appear after first attempt.</span>
                    )}
                    {isSubmitted && canEditGeneratedQuestions ? (
                      <button
                        type="button"
                        className="rounded-md border border-slate-300 bg-white px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50"
                        onClick={() => setEditingExplanationKey((prev) => (prev === currentKey ? null : currentKey))}
                      >
                        {editingExplanationKey === currentKey ? "Hide Editor" : "Edit Explanation"}
                      </button>
                    ) : null}
                  </div>

                  {isSubmitted ? (
                    <div className="mt-3 rounded-md border border-slate-200 bg-slate-50 p-3 text-sm text-slate-700">
                      <p>
                        <span className="font-semibold">Correct Answer:</span> {correctAnswer}
                      </p>
                      {explanationHtml ? (
                        <div className="mt-2">
                          <p className="text-xs font-semibold uppercase tracking-wide text-slate-600">Explanation</p>
                          <div
                            className="prose prose-sm mt-2 max-w-none rounded-md border border-slate-200 bg-white p-3 text-slate-800 [&_a]:text-blue-700 [&_a]:underline [&_b]:font-semibold [&_code]:rounded [&_code]:bg-slate-100 [&_code]:px-1 [&_code]:py-0.5 [&_em]:italic [&_li]:my-0.5 [&_ol]:pl-5 [&_p]:my-2 [&_strong]:font-semibold [&_u]:underline [&_ul]:pl-5"
                            dangerouslySetInnerHTML={{ __html: explanationHtml }}
                          />
                        </div>
                      ) : null}
                      {editingExplanationKey === currentKey ? (
                        <div className="mt-3">
                          <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-600">Explanation Editor</p>
                          <MiniRichTextInput
                            value={String(currentQuestion.explanation || currentQuestion.explanation_text || "")}
                            onChange={(value) => updateAttemptExplanation(currentKey, value)}
                            placeholder="Write or refine explanation..."
                          />
                        </div>
                      ) : null}
                    </div>
                  ) : null}
                </div>
              ) : null}
            </div>
          );
        })}
      </div>
    );
  })();

  const resetComposerSession = useCallback(() => {
    clearGeneratedPreview(quizKind);
    setResult(null);
    setCurrentStep(3);
    setAdditionalInstructions("");
    setExampleQuestion("");
    setExampleQuestionsInput("");
    setAnalyzedExampleStyle("");
    setOcrImages([]);
    setOcrExtractedText("");
    setMixEntries([]);
    setMixJobTasks([]);
    setLastMixJobFailedCount(0);
  }, [clearGeneratedPreview, quizKind]);

  return (
    <div className="space-y-7">
      <section className="relative overflow-hidden rounded-3xl border border-slate-200 bg-gradient-to-br from-amber-50 via-white to-sky-50 p-6 shadow-sm">
        <div className="pointer-events-none absolute -right-14 -top-14 h-48 w-48 rounded-full bg-amber-200/30 blur-3xl" />
        <div className="pointer-events-none absolute -bottom-16 left-1/2 h-40 w-40 -translate-x-1/2 rounded-full bg-sky-200/30 blur-3xl" />
        <div className="relative space-y-5">
          <div className={useUnifiedMainsLikeLayout ? "mx-auto max-w-4xl text-center" : "flex flex-wrap items-start justify-between gap-3"}>
            <div>
              <div className={useUnifiedMainsLikeLayout ? "flex justify-center items-center gap-2" : "flex items-center gap-2"}>
                {!useUnifiedMainsLikeLayout ? <Sparkles className="h-5 w-5 text-amber-500" /> : null}
                <h1 className="text-2xl sm:text-5xl font-bold text-slate-900">
                  {useUnifiedMainsLikeLayout ? "Free AI Quiz Generator" : "AI Quiz Generator"}
                </h1>
              </div>
              <p className="mt-3 text-sm sm:text-xl text-slate-600">
                {useUnifiedMainsLikeLayout
                  ? "Create custom quizzes effortlessly with AI. Transform any text into multiple-choice questions."
                  : "Build GK, Maths, and Passage quizzes from text, URL, photo OCR, or uploaded PDFs with cleaner step-by-step flow."}
              </p>
              {!useUnifiedMainsLikeLayout ? (
                <p className="mt-2 text-xs text-slate-600">
                  Current generator: <span className="font-semibold text-slate-800">{QUIZ_KIND_LABEL[quizKind]}</span>. Shared settings are applied across all generators.
                </p>
              ) : null}
              {!useUnifiedMainsLikeLayout && quizMasterMode ? (
                <p className="mt-2 text-xs text-slate-600">
                  Quiz Master workspace: use AI parse/generate and push selected questions into your prelims tests.
                </p>
              ) : null}
            </div>
            {!useUnifiedMainsLikeLayout ? (
              <div className="flex items-center gap-2">
                <div className="rounded-xl border border-slate-200 bg-white/90 px-3 py-2">
                  <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Default model</p>
                  <p className="mt-1 text-sm font-semibold text-slate-800">{USER_PROVIDER} / {USER_MODEL}</p>
                </div>
                <button
                  type="button"
                  onClick={() => setShowChatSettings((prev) => !prev)}
                  className="inline-flex items-center gap-1.5 rounded-xl border border-slate-300 bg-white px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50"
                >
                  <Settings2 className="h-3.5 w-3.5" />
                  {showChatSettings ? "Hide Settings" : "AI Settings"}
                </button>
              </div>
            ) : null}
          </div>

          {!useUnifiedMainsLikeLayout && showChatSettings ? (
            <div className="rounded-2xl border border-slate-200 bg-white/95 p-4 shadow-sm">
              <div className="grid gap-4 md:grid-cols-3">
                <div className="space-y-2">
                  <p className="text-xs font-semibold uppercase tracking-wide text-slate-600">Output Language</p>
                  <div className="flex flex-wrap gap-2">
                    {OUTPUT_LANGUAGE_OPTIONS.map((option) => {
                      const active = outputLanguage === option.value;
                      return (
                        <button
                          key={`hero-lang-${option.value}`}
                          type="button"
                          onClick={() => {
                            const next = persistOutputLanguage(option.value);
                            setOutputLanguage(next);
                          }}
                          className={`rounded-full border px-3 py-1 text-xs font-semibold ${active
                            ? "border-indigo-400 bg-indigo-100 text-indigo-800"
                            : "border-slate-300 bg-white text-slate-700 hover:bg-slate-50"
                            }`}
                        >
                          {option.label}
                        </button>
                      );
                    })}
                  </div>
                </div>
                <div className="space-y-2">
                  <p className="text-xs font-semibold uppercase tracking-wide text-slate-600">Default Count</p>
                  <div className="flex flex-wrap gap-2">
                    {QUICK_COUNT_PRESETS.map((preset) => {
                      const active = desiredQuestionCount === preset.value;
                      return (
                        <button
                          key={`hero-count-${preset.value}`}
                          type="button"
                          onClick={() => setDesiredQuestionCount(preset.value)}
                          className={`rounded-full border px-3 py-1 text-xs font-semibold ${active
                            ? "border-indigo-400 bg-indigo-100 text-indigo-800"
                            : "border-slate-300 bg-white text-slate-700 hover:bg-slate-50"
                            }`}
                        >
                          {preset.label}
                        </button>
                      );
                    })}
                  </div>
                </div>
                <div className="space-y-2">
                  <p className="text-xs font-semibold uppercase tracking-wide text-slate-600">Session Control</p>
                  <button
                    type="button"
                    onClick={resetComposerSession}
                    className="inline-flex items-center rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50"
                  >
                    <RefreshCcw className="mr-1.5 h-3.5 w-3.5" />
                    Reset Chat Session
                  </button>
                </div>
              </div>
            </div>
          ) : null}

          {!useUnifiedMainsLikeLayout ? (
            <div className="grid gap-3 md:grid-cols-3">
              {QUIZ_KINDS.map((kind) => {
                const isActive = quizKind === kind;
                const meta = QUIZ_KIND_META[kind];
                return (
                  <Link
                    key={kind}
                    href={kindRouteMap[kind]}
                    className={`group rounded-2xl border p-4 transition ${isActive
                      ? "border-slate-900 bg-slate-900 text-white shadow-lg"
                      : "border-slate-200 bg-white/90 hover:-translate-y-0.5 hover:border-slate-400 hover:shadow-md"
                      }`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className={`inline-flex rounded-full px-2 py-1 text-[10px] font-semibold uppercase tracking-wide ${isActive ? "bg-white/20 text-white" : meta.tone}`}>
                        {meta.tag}
                      </span>
                      <span className={`text-[11px] font-semibold ${isActive ? "text-white/90" : "text-slate-600 group-hover:text-slate-900"}`}>
                        {isActive ? "Active" : meta.cta}
                      </span>
                    </div>
                    <p className={`mt-3 text-base font-semibold ${isActive ? "text-white" : "text-slate-900"}`}>
                      {QUIZ_KIND_LABEL[kind]} Generator
                    </p>
                    <p className={`mt-1 text-xs leading-relaxed ${isActive ? "text-white/85" : "text-slate-600"}`}>
                      {meta.description}
                    </p>
                  </Link>
                );
              })}
            </div>
          ) : null}

          {!useUnifiedMainsLikeLayout ? (
            <div className="flex flex-wrap gap-2">
              <Link
                href={kindRouteMap.maths}
                className="inline-flex items-center rounded-lg border border-emerald-300 bg-emerald-50 px-3 py-2 text-xs font-semibold text-emerald-800 hover:bg-emerald-100"
              >
                Open Maths Generator
              </Link>
              <Link
                href={kindRouteMap.passage}
                className="inline-flex items-center rounded-lg border border-sky-300 bg-sky-50 px-3 py-2 text-xs font-semibold text-sky-800 hover:bg-sky-100"
              >
                Open Passage Generator
              </Link>
            </div>
          ) : null}

          {!useUnifiedMainsLikeLayout ? (
            <div className="rounded-xl border border-amber-200/70 bg-white/85 p-3">
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-600">Progress</p>
              <div className="mt-2 grid gap-2 md:grid-cols-3">
                {[
                  { label: "Example Ready", done: formatPlanReady },
                  { label: "Source Ready", done: sourceReady },
                  { label: "Generated", done: generatedReady },
                ].map((step) => (
                  <div key={step.label} className="flex items-center gap-2 rounded-md border border-amber-100 bg-amber-50/70 px-3 py-2 text-xs">
                    {step.done ? (
                      <CheckCircle2 className="h-4 w-4 text-emerald-600" />
                    ) : generating ? (
                      <CircleDashed className="h-4 w-4 animate-spin text-amber-700" />
                    ) : (
                      <CircleDashed className="h-4 w-4 text-slate-500" />
                    )}
                    <span className={step.done ? "font-semibold text-emerald-800" : "text-slate-700"}>{step.label}</span>
                  </div>
                ))}
              </div>
            </div>
          ) : null}
        </div>
      </section>

      <div className="mx-auto grid w-full max-w-5xl grid-cols-1 items-start gap-6">
        <section className="flex w-full flex-col gap-6 rounded-3xl border border-slate-200 bg-white p-4 sm:p-6 shadow-sm">
          {loading ? (
            <p className="flex items-center gap-2 text-sm text-gray-500">
              <Loader2 className="h-4 w-4 animate-spin" />
              Loading...
            </p>
          ) : null}

          {!useUnifiedMainsLikeLayout ? (
            <div className="bg-white border-b border-indigo-50 p-4 shrink-0 flex items-center justify-between sticky top-0 z-10 shadow-sm rounded-xl mb-6">
              <div className="flex items-center gap-3">
                <div className="h-10 w-10 rounded-full bg-gradient-to-br from-indigo-500 to-violet-600 flex items-center justify-center shadow-md">
                  <Wand2 className="h-5 w-5 text-white" />
                </div>
                <div>
                  <h3 className="font-bold text-slate-800 flex items-center gap-2">
                    AI Generator
                    <span className="flex h-2 w-2 rounded-full bg-emerald-500"></span>
                  </h3>
                  <p className="text-[10px] sm:text-xs text-slate-500 font-medium">Ready to create questions</p>
                </div>
              </div>
              <div className="flex gap-2">
                <span className="inline-flex rounded-full border border-indigo-200 bg-indigo-50 px-2.5 py-1 text-[11px] font-semibold text-indigo-700">
                  {QUIZ_KIND_LABEL[quizKind]} Mode
                </span>
              </div>
            </div>
          ) : null}

          {!useUnifiedMainsLikeLayout && currentStep >= 1 && (
            <div className="order-3 flex w-full justify-start animate-in fade-in slide-in-from-bottom-2 mb-6">
              <div className="flex gap-3 max-w-[90%] md:max-w-[85%]">
                <div className="h-8 w-8 rounded-full bg-gradient-to-r from-indigo-500 to-violet-500 flex items-center justify-center shrink-0 shadow-sm mt-1 hidden sm:flex">
                  <Wand2 className="h-4 w-4 text-white" />
                </div>
                <div className="rounded-2xl rounded-tl-sm bg-white border border-slate-200 shadow-sm p-4 md:p-5 text-sm md:text-[15px] text-slate-700 space-y-3 leading-relaxed">
                  <p className="font-semibold text-slate-900">Hello! I&apos;m your AI Quiz Assistant.</p>
                  <p>Let&apos;s set up the <strong className="text-indigo-700">quiz format and language</strong>. What type of questions should I generate?</p>
                </div>
              </div>
            </div>
          )}

          {!useUnifiedMainsLikeLayout && currentStep >= 1 && (
            <div className="order-2 w-full animate-in fade-in slide-in-from-bottom-2 mb-4">
              <div className="w-full space-y-4 rounded-2xl border border-amber-200 bg-amber-50/50 p-4 text-left">
                <div className="space-y-2 rounded-xl border border-indigo-200 bg-indigo-50/60 p-4">
                  <p className="text-sm font-semibold text-indigo-900">Primary Language Selection</p>
                  <p className="text-xs text-indigo-700">
                    Choose output language first. Generation and parsing instructions use this as the primary parameter.
                  </p>
                  <select
                    className="w-full rounded-md border border-indigo-300 bg-white px-3 py-2 text-sm"
                    value={outputLanguage}
                    onChange={(event) => {
                      const next = persistOutputLanguage(event.target.value);
                      setOutputLanguage(next);
                    }}
                  >
                    {OUTPUT_LANGUAGE_OPTIONS.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="space-y-2 rounded-xl border border-amber-200 bg-amber-50/70 p-4">
                  <p className="text-sm font-semibold text-slate-900">Quick Defaults</p>
                  <p className="text-xs text-slate-600">
                    Pick defaults first, then continue step-by-step like a chat workflow.
                  </p>
                  <div className="space-y-2">
                    <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Question count</p>
                    <div className="flex flex-wrap gap-2">
                      {QUICK_COUNT_PRESETS.map((preset) => {
                        const active = desiredQuestionCount === preset.value;
                        return (
                          <button
                            key={`quick-count-${preset.value}`}
                            type="button"
                            onClick={() => setDesiredQuestionCount(preset.value)}
                            className={`rounded-full border px-3 py-1 text-xs font-semibold ${active
                              ? "border-indigo-400 bg-indigo-100 text-indigo-800"
                              : "border-slate-300 bg-white text-slate-700 hover:bg-slate-50"
                              }`}
                          >
                            {preset.label} <span className="text-[10px] opacity-80">({preset.detail})</span>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                </div>

                <div className="space-y-3 rounded-xl border border-sky-200 bg-sky-50/70 p-4">
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-sm font-semibold text-gray-900">2. Quiz Format</p>
                    <button
                      type="button"
                      onClick={() => setShowAdvancedFormatControls((prev) => !prev)}
                      className="inline-flex items-center gap-1 rounded-md border border-slate-300 bg-white px-2.5 py-1 text-[11px] font-semibold text-slate-700 hover:bg-slate-100"
                    >
                      {showAdvancedFormatControls ? (
                        <>
                          Hide <ChevronUp className="h-3.5 w-3.5" />
                        </>
                      ) : (
                        <>
                          Advanced <ChevronDown className="h-3.5 w-3.5" />
                        </>
                      )}
                    </button>
                  </div>
                  <p className="text-xs text-gray-600">
                    Start with defaults. Open advanced controls only when you need custom format behavior.
                  </p>
                  {!showAdvancedFormatControls ? (
                    <div className="rounded-md border border-indigo-200 bg-indigo-50 px-3 py-2 text-xs text-indigo-800">
                      Active format: <span className="font-semibold">{selectedAnalysis?.title || "Standard UPSC style"}</span>.
                      Open advanced controls to use style tags, custom examples, or mix planner.
                    </div>
                  ) : null}

                  {showAdvancedFormatControls ? (
                    <>

                      <div className="flex flex-col gap-3">
                        <div className="flex flex-wrap md:flex-nowrap items-center gap-3 rounded-md border border-gray-200 bg-white p-3">
                          <p className="text-[10px] font-bold uppercase tracking-wide text-gray-500 min-w-[60px] shrink-0">STYLE 1</p>
                          <div className="flex flex-wrap gap-2">
                            <button
                              type="button"
                              className={`rounded-full border px-3 py-1 text-xs font-semibold ${!analysisTagL1Filter
                                ? "border-indigo-400 bg-indigo-100 text-indigo-800"
                                : "border-gray-300 bg-white text-gray-700 hover:bg-gray-100"
                                }`}
                              onClick={() => {
                                setAnalysisTagL1Filter("");
                                setAnalysisTagL2Filter("");
                              }}
                            >
                              All
                            </button>
                            {analysisTagHierarchy.level1.map((tag) => {
                              const active = normalizeTag(analysisTagL1Filter) === normalizeTag(tag);
                              return (
                                <button
                                  key={tag}
                                  type="button"
                                  className={`rounded-full border px-3 py-1 text-xs font-semibold ${active
                                    ? "border-indigo-400 bg-indigo-100 text-indigo-800"
                                    : "border-gray-300 bg-white text-gray-700 hover:bg-gray-100"
                                    }`}
                                  onClick={() => {
                                    setAnalysisTagL1Filter(tag);
                                    setAnalysisTagL2Filter("");
                                  }}
                                >
                                  {tag}
                                </button>
                              );
                            })}
                          </div>
                        </div>

                        {analysisTagL1Filter ? (
                          <div className="flex flex-wrap md:flex-nowrap items-center gap-3 rounded-md border border-gray-200 bg-white p-3">
                            <p className="text-[10px] font-bold uppercase tracking-wide text-gray-500 min-w-[60px] shrink-0">STYLE 2</p>
                            <div className="flex flex-wrap gap-2">
                              <button
                                type="button"
                                className={`rounded-full border px-3 py-1 text-xs font-semibold ${!analysisTagL2Filter
                                  ? "border-indigo-400 bg-indigo-100 text-indigo-800"
                                  : "border-gray-300 bg-white text-gray-700 hover:bg-gray-100"
                                  }`}
                                onClick={() => setAnalysisTagL2Filter("")}
                              >
                                All
                              </button>
                              {Array.from(analysisTagHierarchy.level2ByLevel1.get(normalizeTag(analysisTagL1Filter)) || []).map((tag) => {
                                const active = normalizeTag(analysisTagL2Filter) === normalizeTag(tag);
                                return (
                                  <button
                                    key={tag}
                                    type="button"
                                    className={`rounded-full border px-3 py-1 text-xs font-semibold ${active
                                      ? "border-indigo-400 bg-indigo-100 text-indigo-800"
                                      : "border-gray-300 bg-white text-gray-700 hover:bg-gray-100"
                                      }`}
                                    onClick={() => setAnalysisTagL2Filter(tag)}
                                  >
                                    {tag}
                                  </button>
                                );
                              })}
                            </div>
                          </div>
                        ) : null}
                      </div>

                      <div className="space-y-2 rounded-md border border-gray-200 bg-white p-3">
                        <div className="flex items-center justify-between gap-2">
                          <p className="text-xs font-semibold uppercase tracking-wide text-gray-600">Example Names</p>
                          <button
                            type="button"
                            className="rounded-md border border-gray-300 bg-white px-3 py-1.5 text-xs font-semibold text-gray-700 hover:bg-gray-100 disabled:opacity-60"
                            onClick={applySelectedAnalysisToForm}
                            disabled={!selectedAnalysisId}
                          >
                            Apply Selected Example
                          </button>
                        </div>
                        {filteredAnalyses.length === 0 ? (
                          <p className="text-xs text-gray-500">No examples found for current tags.</p>
                        ) : (
                          <div className="flex flex-wrap gap-2">
                            {filteredAnalyses.map((item) => {
                              const active = selectedAnalysisId === String(item.id);
                              return (
                                <button
                                  key={item.id}
                                  type="button"
                                  className={`rounded-md border px-3 py-1.5 text-xs font-semibold ${active
                                    ? "border-indigo-400 bg-indigo-100 text-indigo-800"
                                    : "border-gray-300 bg-white text-gray-700 hover:bg-gray-100"
                                    }`}
                                  onClick={() => setSelectedAnalysisId(String(item.id))}
                                >
                                  {item.title}
                                </button>
                              );
                            })}
                          </div>
                        )}
                      </div>

                      <div className="space-y-2 rounded-md border border-gray-200 bg-white p-3">
                        <p className="text-xs font-semibold uppercase tracking-wide text-gray-600">Or Provide Your Own Example</p>
                        <input
                          className="w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm"
                          value={exampleQuestion}
                          onChange={(event) => setExampleQuestion(event.target.value)}
                          placeholder="Single example question (optional)"
                        />
                        <textarea
                          className="min-h-[90px] w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm"
                          value={exampleQuestionsInput}
                          onChange={(event) => setExampleQuestionsInput(event.target.value)}
                          placeholder="Example questions (one per line)"
                        />
                        <div className="flex flex-wrap items-center gap-2">
                          <button
                            type="button"
                            className="rounded-md border border-gray-300 bg-white px-3 py-2 text-xs font-semibold text-gray-700 hover:bg-gray-100 disabled:opacity-60"
                            onClick={analyzeExampleStyle}
                            disabled={analyzingExampleStyle || !exampleQuestionsInput.trim()}
                          >
                            {analyzingExampleStyle ? "Analyzing..." : "Analyze Example"}
                          </button>
                          {analyzedExampleStyle ? (
                            <button
                              type="button"
                              className="rounded-md border border-gray-300 bg-white px-3 py-2 text-xs font-semibold text-gray-700 hover:bg-gray-100"
                              onClick={() => setAnalyzedExampleStyle("")}
                            >
                              Clear Analysis
                            </button>
                          ) : null}
                        </div>
                        {analyzedExampleStyle ? (
                          <p className="rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-800">
                            Custom example analysis is active and will be applied during generation.
                          </p>
                        ) : null}
                      </div>

                      <div className="rounded-md border border-gray-200 bg-white p-3 space-y-2">
                        <div className="flex items-center justify-between">
                          <p className="text-xs font-semibold uppercase tracking-wide text-gray-600">Format Mix Planner (Optional)</p>
                          <span className="text-[11px] text-gray-500">Total target: {totalMixedRequested}</span>
                        </div>
                        {shouldUseAsyncJobMode ? (
                          <p className="rounded-md border border-indigo-200 bg-indigo-50 px-2 py-1 text-[11px] text-indigo-700">
                            Large mix detected. Async job mode with retry queue will be used automatically.
                          </p>
                        ) : null}
                        <p className="text-xs text-gray-500">
                          Plan one generation with multiple example types. Add rows and set question count per style.
                        </p>
                        {mixEntries.length === 0 ? (
                          <p className="text-xs text-gray-500">No mix rows added. Single-format generation will be used.</p>
                        ) : (
                          <div className="space-y-2">
                            {mixEntries.map((entry) => (
                              <div key={entry.id} className="grid gap-2 md:grid-cols-[1fr_120px_auto]">
                                <select
                                  className="rounded-md border border-gray-300 bg-white px-3 py-2 text-sm"
                                  value={entry.analysisId}
                                  onChange={(event) => updateMixRow(entry.id, { analysisId: event.target.value })}
                                >
                                  {analyses.map((item) => (
                                    <option key={item.id} value={String(item.id)}>{item.title}</option>
                                  ))}
                                </select>
                                <input
                                  className="rounded-md border border-gray-300 bg-white px-3 py-2 text-sm"
                                  value={entry.count}
                                  onChange={(event) => updateMixRow(entry.id, { count: event.target.value.replace(/[^\d]/g, "") || "1" })}
                                  placeholder="Count"
                                />
                                <button
                                  type="button"
                                  className="rounded-md border border-red-300 bg-white px-3 py-2 text-xs font-semibold text-red-700 hover:bg-red-50"
                                  onClick={() => removeMixRow(entry.id)}
                                >
                                  Remove
                                </button>
                              </div>
                            ))}
                          </div>
                        )}
                        <div className="flex flex-wrap gap-2">
                          <button
                            type="button"
                            className="rounded-md border border-gray-300 bg-white px-3 py-2 text-xs font-semibold text-gray-700 hover:bg-gray-100 disabled:opacity-60"
                            onClick={addSelectedAnalysisToMix}
                            disabled={!selectedAnalysisId}
                          >
                            Add Selected
                          </button>
                          <button
                            type="button"
                            className="rounded-md border border-gray-300 bg-white px-3 py-2 text-xs font-semibold text-gray-700 hover:bg-gray-100 disabled:opacity-60"
                            onClick={addEmptyMixRow}
                            disabled={filteredAnalyses.length === 0}
                          >
                            Add Row
                          </button>
                          {mixEntries.length > 0 ? (
                            <button
                              type="button"
                              className="rounded-md border border-gray-300 bg-white px-3 py-2 text-xs font-semibold text-gray-700 hover:bg-gray-100"
                              onClick={() => setMixEntries([])}
                            >
                              Clear Mix
                            </button>
                          ) : null}
                        </div>
                      </div>
                    </>
                  ) : null}
                </div>

                {currentStep === 1 && (
                  <div className="flex justify-end pt-4">
                    <button
                      onClick={() => setCurrentStep(2)}
                      className="inline-flex items-center justify-center rounded-xl bg-indigo-600 px-6 py-2.5 text-sm font-bold text-white hover:bg-indigo-700 shadow-md transition-all active:scale-95"
                    >
                      Continue to Source Content
                      <ArrowDown className="ml-2 h-4 w-4 -rotate-90" />
                    </button>
                  </div>
                )}
              </div>
            </div>
          )}

          {!useUnifiedMainsLikeLayout && currentStep >= 2 && (
            <div className="order-1 flex w-full justify-start animate-in fade-in slide-in-from-bottom-2 mb-6">
              <div className="flex gap-3 max-w-[90%] md:max-w-[85%]">
                <div className="h-8 w-8 rounded-full bg-gradient-to-r from-indigo-500 to-violet-500 flex items-center justify-center shrink-0 shadow-sm mt-1 hidden sm:flex">
                  <Wand2 className="h-4 w-4 text-white" />
                </div>
                <div className="rounded-2xl rounded-tl-sm border border-sky-200 bg-sky-50/70 shadow-sm p-4 md:p-5 text-sm md:text-[15px] text-slate-700 space-y-3 leading-relaxed">
                  <p>Great! Now, please provide the <strong className="text-indigo-700">source content</strong> for the quiz.</p>
                </div>
              </div>
            </div>
          )}

          {currentStep >= 2 && (
            <div className="order-1 w-full animate-in fade-in slide-in-from-bottom-2 mb-4">
              <div className="w-full space-y-4 rounded-2xl border border-sky-200 bg-sky-50/50 p-3 sm:p-4 text-left">
                <div className="space-y-3 rounded-xl border border-sky-200 bg-sky-100/60 p-3 sm:p-4">
                  <p className="text-sm font-semibold text-gray-900">1. Source Content</p>
                  <div className="rounded-xl bg-slate-100 p-1">
                    <div className="grid grid-cols-2 gap-1 sm:grid-cols-3 lg:grid-cols-5">
                      {CONTENT_SOURCE_OPTIONS.map((option) => {
                        const active = !useCategorySource && contentSourceType === option.value;
                        const sourceLabel = option.value === "pdf"
                          ? "File"
                          : option.value === "text"
                            ? "Text"
                            : option.value === "url"
                              ? "Article Link"
                              : "Photo OCR";
                        return (
                          <button
                            key={option.value}
                            type="button"
                            onClick={() => {
                              setUseCategorySource(false);
                              setContentSourceType(option.value);
                            }}
                            className={`inline-flex items-center justify-center rounded-lg px-2 py-2 text-[11px] sm:text-xs font-semibold transition ${active
                              ? "bg-white text-sky-700 shadow-sm"
                              : "text-slate-500 hover:text-slate-700"
                              }`}
                          >
                            {sourceLabel}
                          </button>
                        );
                      })}
                      <button
                        type="button"
                        onClick={() => setUseCategorySource(true)}
                        className={`inline-flex items-center justify-center rounded-lg px-2 py-2 text-[11px] sm:text-xs font-semibold transition ${useCategorySource
                          ? "bg-white text-sky-700 shadow-sm"
                          : "text-slate-500 hover:text-slate-700"
                          }`}
                      >
                        Category Source
                      </button>
                    </div>
                  </div>
                  <p className="text-xs text-gray-600">
                    {useCategorySource
                      ? "Category linked source mode is active. Select categories below."
                      : "Choose one source tab and provide input below."}
                  </p>
                  {useCategorySource ? (
                    <div className="rounded-md border border-sky-200 bg-white p-3">
                      <ExamCategorySelector
                        quizKind={quizKind}
                        selectedExamId={selectedExamId}
                        selectedCategoryIds={selectedCategoryIds}
                        onExamChange={setSelectedExamId}
                        onCategoryIdsChange={setSelectedCategoryIds}
                      />
                    </div>
                  ) : null}
                  {!useCategorySource && contentSourceType === "text" ? (
                    <textarea
                      className="min-h-[160px] w-full rounded-md border border-sky-300 bg-white px-3 py-2 text-sm"
                      value={contentText}
                      onChange={(event) => setContentText(event.target.value)}
                      placeholder="Paste source text for quiz generation"
                    />
                  ) : null}
                  {!useCategorySource && contentSourceType === "url" ? (
                    <input
                      className="w-full rounded-md border border-sky-300 bg-white px-3 py-2 text-sm"
                      value={contentUrl}
                      onChange={(event) => setContentUrl(event.target.value)}
                      placeholder="https://example.com/content"
                    />
                  ) : null}
                  {!useCategorySource && contentSourceType === "image" ? (
                    <div className="space-y-3 rounded-md border border-emerald-200 bg-emerald-50/60 p-3">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <p className="text-xs text-gray-600">Upload photo pages and extract text in the same sequence.</p>
                        <label className="inline-flex cursor-pointer items-center gap-2 rounded-md border border-gray-300 bg-white px-3 py-1.5 text-xs font-semibold text-gray-700 hover:bg-gray-100">
                          <UploadCloud className="h-3.5 w-3.5" />
                          Add Photos
                          <input
                            type="file"
                            accept="image/*"
                            multiple
                            className="hidden"
                            onChange={handleImageFilesChange}
                            disabled={extractingImageText}
                          />
                        </label>
                      </div>

                      {ocrImages.length > 0 ? (
                        <div className="max-h-44 space-y-2 overflow-auto pr-1">
                          {ocrImages.map((file, index) => (
                            <div key={file.id} className="flex items-center gap-3 rounded-md border border-gray-200 bg-white px-3 py-2">
                              <Image
                                src={file.preview}
                                alt={file.name}
                                width={36}
                                height={48}
                                unoptimized
                                className="h-12 w-9 rounded border border-gray-200 object-cover"
                              />
                              <div className="min-w-0 flex-1">
                                <p className="truncate text-xs font-semibold text-gray-800">Page {index + 1}</p>
                                <p className="truncate text-[11px] text-gray-500">{file.name}</p>
                              </div>
                              <div className="flex items-center gap-1">
                                <button
                                  type="button"
                                  className="rounded-md border border-gray-300 bg-white px-1.5 py-1 text-gray-600 hover:bg-gray-100 disabled:opacity-40"
                                  onClick={() => moveOcrImage(index, "up")}
                                  disabled={index === 0}
                                >
                                  <ArrowUp className="h-3.5 w-3.5" />
                                </button>
                                <button
                                  type="button"
                                  className="rounded-md border border-gray-300 bg-white px-1.5 py-1 text-gray-600 hover:bg-gray-100 disabled:opacity-40"
                                  onClick={() => moveOcrImage(index, "down")}
                                  disabled={index >= ocrImages.length - 1}
                                >
                                  <ArrowDown className="h-3.5 w-3.5" />
                                </button>
                                <button
                                  type="button"
                                  className="rounded-md border border-red-300 bg-white px-1.5 py-1 text-red-700 hover:bg-red-50"
                                  onClick={() => removeOcrImage(file.id)}
                                >
                                  <Trash2 className="h-3.5 w-3.5" />
                                </button>
                              </div>
                            </div>
                          ))}
                        </div>
                      ) : (
                        <p className="text-xs text-gray-500">No photos added yet.</p>
                      )}

                      <div className="flex flex-wrap items-center gap-2">
                        <button
                          type="button"
                          className="rounded-md border border-emerald-300 bg-white px-3 py-1.5 text-xs font-semibold text-emerald-700 hover:bg-emerald-50 disabled:opacity-60"
                          onClick={extractTextFromImages}
                          disabled={extractingImageText || ocrImages.length === 0}
                        >
                          {extractingImageText ? (
                            <>
                              <Loader2 className="mr-1 inline-block h-3.5 w-3.5 animate-spin" />
                              Extracting...
                            </>
                          ) : (
                            "Extract Text"
                          )}
                        </button>
                        {ocrExtractedText.trim() ? <span className="text-xs text-emerald-700">OCR text ready for generation.</span> : null}
                      </div>

                      <textarea
                        className="min-h-[120px] w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm"
                        value={ocrExtractedText}
                        onChange={(event) => setOcrExtractedText(event.target.value)}
                        placeholder="Extracted text will appear here. You can edit before generation."
                      />
                    </div>
                  ) : null}
                  {!useCategorySource && contentSourceType === "pdf" ? (
                    <div className="space-y-3 rounded-md border border-amber-200 bg-amber-50/60 p-3">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <label className="inline-flex items-center gap-2 text-xs text-gray-700">
                          <input
                            type="checkbox"
                            checked={ocrOnUpload}
                            onChange={(event) => setOcrOnUpload(event.target.checked)}
                            className="h-4 w-4 rounded border-gray-300"
                          />
                          Enable OCR for low-text/scanned PDFs
                        </label>
                        <button
                          type="button"
                          className="rounded-md border border-gray-300 bg-white px-3 py-1.5 text-xs font-semibold text-gray-700 hover:bg-gray-100 disabled:opacity-60"
                          onClick={() => loadUploadedPdfs()}
                          disabled={loadingUploadedPdfs}
                        >
                          {loadingUploadedPdfs ? "Refreshing..." : "Refresh list"}
                        </button>
                      </div>

                      <label className="inline-flex cursor-pointer items-center gap-2 rounded-md border border-gray-300 bg-white px-3 py-2 text-xs font-semibold text-gray-700 hover:bg-gray-100">
                        {uploadingPdf ? <Loader2 className="h-4 w-4 animate-spin" /> : <UploadCloud className="h-4 w-4" />}
                        {uploadingPdf ? "Uploading PDF..." : "Upload PDF"}
                        <input
                          type="file"
                          accept="application/pdf,.pdf"
                          className="hidden"
                          onChange={handlePdfUpload}
                          disabled={uploadingPdf}
                        />
                      </label>

                      <div className="space-y-2">
                        <select
                          className="w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm"
                          value={selectedUploadedPdfId}
                          onChange={(event) => setSelectedUploadedPdfId(event.target.value)}
                          disabled={loadingUploadedPdfs || uploadedPdfs.length === 0}
                        >
                          <option value="">Select uploaded PDF</option>
                          {uploadedPdfs.map((pdf) => (
                            <option key={pdf.id} value={String(pdf.id)}>
                              {pdf.filename}
                            </option>
                          ))}
                        </select>

                        {uploadedPdfs.length > 0 ? (
                          <div className="max-h-44 space-y-2 overflow-auto pr-1">
                            {uploadedPdfs.map((pdf) => {
                              const isSelected = selectedUploadedPdfId === String(pdf.id);
                              return (
                                <div key={pdf.id} className={`flex items-center justify-between rounded-md border px-3 py-2 ${isSelected ? "border-indigo-300 bg-indigo-50" : "border-gray-200 bg-white"}`}>
                                  <div className="min-w-0">
                                    <p className="truncate text-xs font-semibold text-gray-800">{pdf.filename}</p>
                                    <p className="text-[11px] text-gray-500">
                                      <FileText className="mr-1 inline-block h-3 w-3" />
                                      {pdf.page_count ? `${pdf.page_count} page(s)` : "Pages: n/a"}
                                      {pdf.used_ocr ? " - OCR used" : ""}
                                    </p>
                                    <p className="text-[11px] text-amber-700">
                                      Expires: {pdf.expires_at ? new Date(pdf.expires_at).toLocaleString() : "n/a"}
                                    </p>
                                  </div>
                                  <div className="flex items-center gap-2">
                                    <button
                                      type="button"
                                      className="rounded-md border border-gray-300 bg-white px-2 py-1 text-[11px] font-semibold text-gray-700 hover:bg-gray-100"
                                      onClick={() => setSelectedUploadedPdfId(String(pdf.id))}
                                    >
                                      Use
                                    </button>
                                    <button
                                      type="button"
                                      className="rounded-md border border-red-300 bg-white px-2 py-1 text-[11px] font-semibold text-red-700 hover:bg-red-50 disabled:opacity-60"
                                      onClick={() => handleDeleteUploadedPdf(pdf)}
                                      disabled={deletingPdfId === pdf.id}
                                    >
                                      {deletingPdfId === pdf.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}
                                    </button>
                                  </div>
                                </div>
                              );
                            })}
                          </div>
                        ) : (
                          <p className="text-xs text-gray-500">No uploaded PDFs found. Upload one to use it as content source.</p>
                        )}
                      </div>
                    </div>
                  ) : null}

                  {useUnifiedMainsLikeLayout ? (
                    <>
                      <div className="overflow-hidden rounded-xl border border-slate-200 bg-slate-50">
                        <div className="grid gap-0 sm:grid-cols-2 lg:grid-cols-3">
                          <div className="space-y-1 border-b border-slate-200 px-3 py-3 sm:border-r lg:border-b-0">
                            <label className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">Question</label>
                            <select
                              value={desiredQuestionCount}
                              onChange={(event) => setDesiredQuestionCount(event.target.value)}
                              className="w-full rounded-md border border-slate-200 bg-white px-2 py-1.5 text-sm outline-none focus:ring-2 focus:ring-sky-500"
                            >
                              {["5", "10", "15", "20"].map((value) => (
                                <option key={`desired-count-${value}`} value={value}>
                                  {value}
                                </option>
                              ))}
                            </select>
                          </div>
                          <div className="space-y-1 border-b border-slate-200 px-3 py-3 lg:border-r lg:border-b-0">
                            <label className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">Output Language</label>
                            <select
                              value={outputLanguage}
                              onChange={(event) => {
                                const next = persistOutputLanguage(event.target.value);
                                setOutputLanguage(next);
                              }}
                              className="w-full rounded-md border border-slate-200 bg-white px-2 py-1.5 text-sm outline-none focus:ring-2 focus:ring-sky-500"
                            >
                              {OUTPUT_LANGUAGE_OPTIONS.map((option) => (
                                <option key={option.value} value={option.value}>
                                  {option.label}
                                </option>
                              ))}
                            </select>
                          </div>
                          <div className="flex items-end px-3 py-3">
                            <button
                              type="button"
                              onClick={() => setShowAdvancedFormatControls((prev) => !prev)}
                              className="inline-flex w-full items-center justify-center rounded-md border border-slate-300 bg-white px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-100"
                            >
                              Prompt Settings
                              {showAdvancedFormatControls ? <ChevronUp className="ml-1 h-3.5 w-3.5" /> : <ChevronDown className="ml-1 h-3.5 w-3.5" />}
                            </button>
                          </div>
                        </div>
                      </div>

                      <div className="space-y-3 rounded-xl border border-violet-200 bg-violet-50/60 p-3 sm:p-4">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <p className="text-sm font-semibold text-slate-900">2. Question Style</p>
                          <span className="rounded-full border border-violet-200 bg-white px-2.5 py-1 text-[11px] font-semibold text-violet-700">
                            Total target: {totalMixedRequested}
                          </span>
                        </div>
                        <p className="text-xs text-slate-600">
                          Pick from existing examples or provide your own example pattern.
                        </p>

                        <div className="rounded-xl border border-violet-200 bg-white p-1">
                          <div className="grid grid-cols-2 gap-1">
                            <button
                              type="button"
                              onClick={() => setQuestionStyleTab("existing")}
                              className={`rounded-lg px-3 py-2 text-xs font-semibold transition ${questionStyleTab === "existing"
                                ? "bg-violet-100 text-violet-800"
                                : "text-slate-600 hover:bg-slate-100"
                                }`}
                            >
                              Existing Examples
                            </button>
                            <button
                              type="button"
                              onClick={() => setQuestionStyleTab("own")}
                              className={`rounded-lg px-3 py-2 text-xs font-semibold transition ${questionStyleTab === "own"
                                ? "bg-violet-100 text-violet-800"
                                : "text-slate-600 hover:bg-slate-100"
                                }`}
                            >
                              Own Example
                            </button>
                          </div>
                        </div>

                        {questionStyleTab === "existing" ? (
                          <div className="space-y-3 rounded-xl border border-violet-200 bg-white p-3 sm:p-4">
                            <div className="flex flex-col gap-3">
                              <div className="flex flex-wrap md:flex-nowrap items-center gap-3 rounded-lg border border-slate-200 bg-slate-50 p-2.5">
                                <p className="text-[10px] font-bold uppercase tracking-wide text-slate-500 min-w-[60px] shrink-0">STYLE 1</p>
                                <div className="-mx-1 flex flex-wrap gap-2 px-1">
                                  <button
                                    type="button"
                                    className={`shrink-0 rounded-full border px-3 py-1 text-xs font-semibold ${!analysisTagL1Filter
                                      ? "border-violet-400 bg-violet-100 text-violet-800"
                                      : "border-slate-300 bg-white text-slate-700 hover:bg-slate-100"
                                      }`}
                                    onClick={() => {
                                      setAnalysisTagL1Filter("");
                                      setAnalysisTagL2Filter("");
                                    }}
                                  >
                                    All
                                  </button>
                                  {analysisTagHierarchy.level1.map((tag) => {
                                    const active = normalizeTag(analysisTagL1Filter) === normalizeTag(tag);
                                    return (
                                      <button
                                        key={tag}
                                        type="button"
                                        className={`shrink-0 rounded-full border px-3 py-1 text-xs font-semibold ${active
                                          ? "border-violet-400 bg-violet-100 text-violet-800"
                                          : "border-slate-300 bg-white text-slate-700 hover:bg-slate-100"
                                          }`}
                                        onClick={() => {
                                          setAnalysisTagL1Filter(tag);
                                          setAnalysisTagL2Filter("");
                                        }}
                                      >
                                        {tag}
                                      </button>
                                    );
                                  })}
                                </div>
                              </div>

                              {analysisTagL1Filter ? (
                                <div className="flex flex-wrap md:flex-nowrap items-center gap-3 rounded-lg border border-slate-200 bg-slate-50 p-2.5">
                                  <p className="text-[10px] font-bold uppercase tracking-wide text-slate-500 min-w-[60px] shrink-0">STYLE 2</p>
                                  <div className="-mx-1 flex flex-wrap gap-2 px-1">
                                    <button
                                      type="button"
                                      className={`shrink-0 rounded-full border px-3 py-1 text-xs font-semibold ${!analysisTagL2Filter
                                        ? "border-violet-400 bg-violet-100 text-violet-800"
                                        : "border-slate-300 bg-white text-slate-700 hover:bg-slate-100"
                                        }`}
                                      onClick={() => setAnalysisTagL2Filter("")}
                                    >
                                      All
                                    </button>
                                    {Array.from(analysisTagHierarchy.level2ByLevel1.get(normalizeTag(analysisTagL1Filter)) || []).map((tag) => {
                                      const active = normalizeTag(analysisTagL2Filter) === normalizeTag(tag);
                                      return (
                                        <button
                                          key={tag}
                                          type="button"
                                          className={`shrink-0 rounded-full border px-3 py-1 text-xs font-semibold ${active
                                            ? "border-violet-400 bg-violet-100 text-violet-800"
                                            : "border-slate-300 bg-white text-slate-700 hover:bg-slate-100"
                                            }`}
                                          onClick={() => setAnalysisTagL2Filter(tag)}
                                        >
                                          {tag}
                                        </button>
                                      );
                                    })}
                                  </div>
                                </div>
                              ) : null}
                            </div>

                            <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-violet-200 bg-violet-50/60 px-3 py-2">
                              <div className="flex items-center gap-2">
                                {shouldUseAsyncJobMode ? (
                                  <span className="rounded-full border border-indigo-200 bg-indigo-50 px-2 py-0.5 text-[10px] font-semibold text-indigo-700">
                                    Async Mode
                                  </span>
                                ) : null}
                                {mixEntries.length > 0 ? (
                                  <button
                                    type="button"
                                    onClick={() => setMixEntries([])}
                                    className="rounded-full border border-slate-300 bg-white px-2.5 py-1 text-[10px] font-semibold text-slate-700 hover:bg-slate-100"
                                  >
                                    Clear counts
                                  </button>
                                ) : null}
                              </div>
                            </div>

                            {filteredAnalyses.length === 0 ? (
                              <p className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-500">
                                No examples found for current filters.
                              </p>
                            ) : (
                              <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                                {filteredAnalyses.map((item) => {
                                  const analysisId = String(item.id);
                                  const active = selectedAnalysisId === analysisId;
                                  const selectedCount = mixCountByAnalysisId.get(analysisId) || "0";
                                  return (
                                    <div
                                      key={item.id}
                                      className={`rounded-xl border p-3 shadow-sm transition ${active
                                        ? "border-violet-300 bg-violet-50/70"
                                        : "border-slate-200 bg-white hover:border-violet-200"
                                        }`}
                                    >
                                      <button
                                        type="button"
                                        onClick={() => setSelectedAnalysisId(analysisId)}
                                        className="w-full text-left"
                                      >
                                        <p className={`text-sm font-semibold ${active ? "text-violet-900" : "text-slate-900"}`}>
                                          {item.title}
                                        </p>
                                        {item.description ? (
                                          <p className="mt-1.5 line-clamp-2 text-[11px] text-slate-500">{item.description}</p>
                                        ) : null}
                                        {item.example_questions && item.example_questions.length > 0 ? (
                                          <button
                                            type="button"
                                            onClick={(e) => {
                                              e.stopPropagation();
                                              setExampleQuestionsModalItem(item);
                                            }}
                                            className="mt-2 text-[10px] font-semibold text-violet-600 hover:text-violet-800 flex items-center gap-1 group"
                                          >
                                            View Examples <ArrowDown className="h-3 w-3 -rotate-90 group-hover:translate-x-0.5 transition-transform" />
                                          </button>
                                        ) : null}
                                      </button>

                                      <div className="mt-3 border-t border-slate-200 pt-2">
                                        <label className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">
                                          Questions
                                        </label>
                                        <select
                                          value={selectedCount}
                                          onChange={(event) => setMixCountForAnalysis(analysisId, event.target.value)}
                                          className="mt-1 w-full rounded-md border border-slate-300 bg-white px-2 py-1.5 text-xs"
                                        >
                                          {["0", "1", "2", "3", "5", "8", "10", "15", "20"].map((value) => (
                                            <option key={`style-count-${analysisId}-${value}`} value={value}>
                                              {value}
                                            </option>
                                          ))}
                                        </select>
                                      </div>
                                    </div>
                                  );
                                })}
                              </div>
                            )}

                            <p className="text-[11px] text-slate-500">
                              Set `0` if you do not want that style in the generated mix.
                            </p>
                          </div>
                        ) : (
                          <div className="space-y-2 rounded-xl border border-violet-200 bg-white p-3 sm:p-4">
                            <p className="text-xs font-semibold uppercase tracking-wide text-gray-600">Own Example Input</p>
                            <input
                              className="w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm"
                              value={exampleQuestion}
                              onChange={(event) => setExampleQuestion(event.target.value)}
                              placeholder="Single example question (optional)"
                            />
                            <textarea
                              className="min-h-[90px] w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm"
                              value={exampleQuestionsInput}
                              onChange={(event) => setExampleQuestionsInput(event.target.value)}
                              placeholder="Example questions (one per line)"
                            />
                            <div className="flex flex-wrap items-center gap-2">
                              <button
                                type="button"
                                className="rounded-md border border-gray-300 bg-white px-3 py-2 text-xs font-semibold text-gray-700 hover:bg-gray-100 disabled:opacity-60"
                                onClick={analyzeExampleStyle}
                                disabled={analyzingExampleStyle || !exampleQuestionsInput.trim()}
                              >
                                {analyzingExampleStyle ? "Analyzing..." : "Analyze Example"}
                              </button>
                              {analyzedExampleStyle ? (
                                <button
                                  type="button"
                                  className="rounded-md border border-gray-300 bg-white px-3 py-2 text-xs font-semibold text-gray-700 hover:bg-gray-100"
                                  onClick={() => setAnalyzedExampleStyle("")}
                                >
                                  Clear Analysis
                                </button>
                              ) : null}
                            </div>
                            {analyzedExampleStyle ? (
                              <p className="rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-800">
                                Custom example analysis is active and will be applied during generation.
                              </p>
                            ) : null}
                          </div>
                        )}
                      </div>

                      {showAdvancedFormatControls ? (
                        <div className="space-y-3 rounded-xl border border-emerald-200 bg-emerald-50/70 p-3">
                          <p className="text-sm font-semibold text-gray-900">Prompt Settings</p>
                          <p className="text-xs text-gray-600">
                            Add user instructions to guide question generation.
                          </p>
                          <div className="space-y-2">
                            <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Instruction presets</p>
                            <div className="flex flex-wrap gap-2">
                              {INSTRUCTION_PRESETS.map((preset) => (
                                <button
                                  key={preset.id}
                                  type="button"
                                  onClick={() => setAdditionalInstructions(preset.text)}
                                  className="rounded-full border border-slate-300 bg-white px-3 py-1 text-xs font-semibold text-slate-700 hover:bg-slate-100"
                                >
                                  {preset.label}
                                </button>
                              ))}
                            </div>
                          </div>
                          <textarea
                            className="min-h-[90px] w-full rounded-md border border-emerald-300 bg-white px-3 py-2 text-sm"
                            value={additionalInstructions}
                            onChange={(event) => setAdditionalInstructions(event.target.value)}
                            placeholder="User instructions (optional)"
                          />
                        </div>
                      ) : null}

                      <div className="rounded-md border border-indigo-200 bg-indigo-50 px-3 py-2 text-xs text-indigo-800">
                        {activeMixPlan.length > 0 ? (
                          <>
                            <p className="font-semibold">Applied Format Mix</p>
                            <p className="mt-1">
                              {activeMixPlan.map((plan) => `${plan.analysis.title} (${plan.count})`).join(", ")}
                            </p>
                          </>
                        ) : (
                          <>
                            <p>
                              Applied Format:{" "}
                              <span className="font-semibold">{selectedAnalysis?.title || "Default"}</span>
                            </p>
                            {(selectedAnalysis?.tag_level1 || selectedAnalysis?.tag_level2) ? (
                              <p className="mt-1">
                                Question Styles: {[selectedAnalysis.tag_level1, selectedAnalysis.tag_level2].filter(Boolean).join(" / ")}
                              </p>
                            ) : null}
                          </>
                        )}
                      </div>
                    </>
                  ) : null}
                </div>

                {useUnifiedMainsLikeLayout ? (
                  <>
                    <button
                      type="button"
                      className="inline-flex w-full items-center justify-center rounded-xl bg-sky-600 px-6 py-3 text-sm font-bold text-white shadow-md transition-all hover:bg-sky-700 disabled:cursor-not-allowed disabled:opacity-60"
                      onClick={() => {
                        generatePreview();
                        setCurrentStep(4);
                      }}
                      disabled={generating || !sourceReady}
                    >
                      {generating ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Sparkles className="mr-2 h-4 w-4" />}
                      {activeMixPlan.length > 0
                        ? `Generate Mixed ${QUIZ_KIND_LABEL[quizKind]} (${totalMixedRequested})`
                        : `Generate ${QUIZ_KIND_LABEL[quizKind]}`}
                    </button>

                  </>
                ) : null}

                {!useUnifiedMainsLikeLayout && currentStep === 2 && (
                  <div className="flex justify-between pt-4">
                    <button
                      onClick={() => setCurrentStep(3)}
                      className="inline-flex items-center text-slate-500 hover:text-indigo-600 hover:bg-indigo-50 text-sm font-bold bg-white px-6 py-2.5 rounded-xl border border-slate-200 shadow-sm transition-all"
                    >
                      Back
                    </button>
                    <button
                      onClick={() => setCurrentStep(3)}
                      disabled={!sourceReady}
                      className="inline-flex items-center justify-center rounded-xl bg-indigo-600 px-6 py-2.5 text-sm font-bold text-white hover:bg-indigo-700 shadow-md transition-all active:scale-95 disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      Continue to Instructions
                      <ArrowDown className="ml-2 h-4 w-4 -rotate-90" />
                    </button>
                  </div>
                )}
              </div>
            </div>
          )}

          {!useUnifiedMainsLikeLayout && currentStep >= 3 && (
            <div className="order-5 flex w-full justify-start animate-in fade-in slide-in-from-bottom-2 mb-6">
              <div className="flex gap-3 max-w-[90%] md:max-w-[85%]">
                <div className="h-8 w-8 rounded-full bg-gradient-to-r from-indigo-500 to-violet-500 flex items-center justify-center shrink-0 shadow-sm mt-1 hidden sm:flex">
                  <Wand2 className="h-4 w-4 text-white" />
                </div>
                <div className="rounded-2xl rounded-tl-sm border border-emerald-200 bg-emerald-50/70 shadow-sm p-4 md:p-5 text-sm md:text-[15px] text-slate-700 space-y-3 leading-relaxed">
                  <p>Almost there. Any final <strong className="text-indigo-700">instructions</strong> before we generate the quiz?</p>
                </div>
              </div>
            </div>
          )}

          {!useUnifiedMainsLikeLayout && currentStep >= 3 && (
            <div className="order-3 w-full animate-in fade-in slide-in-from-bottom-2 mb-4">
              <div className="w-full space-y-4 rounded-2xl border border-emerald-200 bg-emerald-50/50 p-4 text-left">
                <div className="space-y-3 rounded-xl border border-emerald-200 bg-emerald-50/70 p-4">
                  <p className="text-sm font-semibold text-gray-900">
                    {useUnifiedMainsLikeLayout ? "Prompt Settings" : "3. Instructions"}
                  </p>
                  <p className="rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-800">
                    Explanation formatting is hardcoded: generated explanations are always requested in HTML format.
                  </p>
                  <p className="text-xs text-gray-600">
                    Add any extra generation constraints here.
                  </p>
                  <p className="rounded-md border border-indigo-200 bg-indigo-50 px-3 py-2 text-xs text-indigo-800">
                    Language and question style are controlled from the settings row above.
                  </p>
                  <div className="space-y-2">
                    <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Instruction presets</p>
                    <div className="flex flex-wrap gap-2">
                      {INSTRUCTION_PRESETS.map((preset) => (
                        <button
                          key={preset.id}
                          type="button"
                          onClick={() => setAdditionalInstructions(preset.text)}
                          className="rounded-full border border-slate-300 bg-white px-3 py-1 text-xs font-semibold text-slate-700 hover:bg-slate-100"
                        >
                          {preset.label}
                        </button>
                      ))}
                    </div>
                  </div>
                  <textarea
                    className="min-h-[90px] w-full rounded-md border border-emerald-300 bg-white px-3 py-2 text-sm"
                    value={additionalInstructions}
                    onChange={(event) => setAdditionalInstructions(event.target.value)}
                    placeholder="Additional instructions"
                  />
                </div>

                <div className="flex justify-end pt-4">
                  {useUnifiedMainsLikeLayout ? (
                    <button
                      type="button"
                      className="rounded-xl border border-slate-300 bg-white px-6 py-2.5 text-sm font-bold text-slate-700 hover:bg-slate-50 transition-all"
                      onClick={resetComposerSession}
                    >
                      Clear
                    </button>
                  ) : (
                    <div className="flex gap-2">
                      <button
                        type="button"
                        className="rounded-xl border border-slate-300 bg-white px-6 py-2.5 text-sm font-bold text-slate-700 hover:bg-slate-50 transition-all"
                        onClick={resetComposerSession}
                      >
                        Clear
                      </button>
                      <button
                        type="button"
                        className="inline-flex items-center rounded-xl bg-indigo-600 px-6 py-2.5 text-sm font-bold text-white shadow-md hover:bg-indigo-700 disabled:opacity-60 active:scale-95 transition-all"
                        onClick={() => {
                          generatePreview();
                          setCurrentStep(4);
                        }}
                        disabled={generating}
                      >
                        {generating ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Sparkles className="mr-2 h-4 w-4" />}
                        {activeMixPlan.length > 0
                          ? `Generate Mixed ${QUIZ_KIND_LABEL[quizKind]} (${totalMixedRequested})`
                          : `Generate ${QUIZ_KIND_LABEL[quizKind]}`}
                      </button>
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}

          {(generating && mixJobTasks.length > 0) || lastMixJobFailedCount > 0 ? (
            <div className="rounded-md border border-gray-200 bg-gray-50 p-3">
              <div className="flex items-center justify-between">
                <p className="text-xs font-semibold uppercase tracking-wide text-gray-600">Async Mix Job Queue</p>
                {lastMixJobFailedCount > 0 ? (
                  <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-amber-700">
                    <AlertTriangle className="h-3.5 w-3.5" />
                    Failed: {lastMixJobFailedCount}
                  </span>
                ) : null}
              </div>
              <div className="mt-2 space-y-2">
                {mixJobTasks.map((task) => {
                  const tone = task.status === "completed"
                    ? "text-emerald-700"
                    : task.status === "failed"
                      ? "text-red-700"
                      : "text-indigo-700";
                  const statusLabel = task.status === "retrying"
                    ? `Retry ${task.attempt}/${task.maxAttempts}`
                    : task.status.toUpperCase();
                  return (
                    <div key={task.id} className="rounded-md border border-gray-200 bg-white px-3 py-2 text-xs">
                      <div className="flex items-center justify-between gap-2">
                        <p className="font-semibold text-gray-800">{task.title}</p>
                        <span className={`font-semibold ${tone}`}>{statusLabel}</span>
                      </div>
                      <p className="mt-1 text-gray-500">Requested: {task.requestedCount} question(s)</p>
                      {task.error ? <p className="mt-1 text-red-600">{task.error}</p> : null}
                    </div>
                  );
                })}
              </div>
            </div>
          ) : null}
        </section>

        {(currentStep >= 4 || resultView || attemptableQuestions.length > 0) && (
          <section className="space-y-4 rounded-3xl border border-indigo-200 bg-white p-6 shadow-xl w-full mt-8 animate-in fade-in slide-in-from-bottom-4 col-span-1">
            <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
              <div>
                <h2 className="text-xl font-bold text-slate-900">Generated Output</h2>
                <p className="mt-1 text-xs text-slate-600">Review generated questions, attempt them, then export or add to Prelims Tests.</p>
              </div>
              <button
                onClick={() => {
                  setResult(null);
                  setCurrentStep(3);
                }}
                className="inline-flex items-center text-slate-500 hover:text-indigo-600 hover:bg-indigo-50 text-sm font-bold bg-white px-6 py-2.5 rounded-full border border-slate-200 shadow-sm transition-all shrink-0"
              >
                <RefreshCcw className="mr-2 h-4 w-4" />
                Start Over
              </button>
            </div>

            <div className="space-y-4 rounded-xl border border-indigo-200 bg-gradient-to-br from-white via-slate-50 to-indigo-50 p-4 shadow-sm">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-sm font-semibold text-slate-900">Post-Generation Actions</p>
                  <p className="mt-1 text-xs text-slate-600">Export your output or move it directly into Prelims Tests.</p>
                </div>
                <span className="inline-flex rounded-full border border-indigo-200 bg-white px-2.5 py-1 text-[11px] font-semibold text-indigo-700">
                  {attemptableQuestions.length} Ready
                </span>
              </div>
              <p className="text-xs text-slate-600">
                Generated questions: <span className="font-semibold text-slate-900">{attemptableQuestions.length}</span>
              </p>
              <p className="text-xs text-slate-600">
                Selected for actions: <span className="font-semibold text-slate-900">{selectedGeneratedItems.length}</span>
              </p>

              <div className="space-y-3">
                <div className="overflow-x-auto rounded-xl bg-slate-100 p-1">
                  <div className="inline-flex min-w-full gap-1">
                    {postActionTabs.map((tab) => {
                      const active = activePostActionTab === tab.id;
                      return (
                        <button
                          key={`post-action-tab-${tab.id}`}
                          type="button"
                          onClick={() => setActivePostActionTab(tab.id)}
                          className={`inline-flex shrink-0 items-center justify-center rounded-lg px-3 py-2 text-xs font-semibold transition sm:flex-1 ${active
                            ? "bg-white text-indigo-700 shadow-sm"
                            : "text-slate-600 hover:text-slate-800"
                            }`}
                        >
                          {tab.label}
                        </button>
                      );
                    })}
                  </div>
                </div>

                <div className="space-y-3 rounded-lg border border-slate-200 bg-white/90 p-3 sm:p-4">
                  {activePostActionTab === "pdf" ? (
                    <>
                      <p className="text-xs text-slate-600">Create a PDF from selected generated questions.</p>
                      <button
                        type="button"
                        className="inline-flex w-full items-center justify-center rounded-md border border-indigo-300 bg-white px-3 py-2 text-xs font-semibold text-indigo-700 shadow-sm hover:bg-indigo-50 disabled:opacity-60 sm:w-auto"
                        onClick={handleCreatePdf}
                        disabled={isGeneratingPdf || selectedGeneratedItems.length === 0}
                      >
                        {isGeneratingPdf ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Download className="mr-2 h-4 w-4" />}
                        {isGeneratingPdf ? "Creating PDF..." : "Create PDF"}
                      </button>
                    </>
                  ) : null}

                  {activePostActionTab === "share" ? (
                    <>
                      <label className="text-xs font-semibold uppercase tracking-wide text-slate-500">Share Selected Quizzes</label>
                      <div className="grid grid-cols-2 gap-2 sm:flex sm:flex-wrap">
                        <button
                          type="button"
                          className="inline-flex items-center justify-center rounded-md border border-slate-300 bg-white px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-100 disabled:opacity-60"
                          onClick={() => void shareSelectedQuizzes("native")}
                          disabled={selectedGeneratedItems.length === 0}
                        >
                          <Share2 className="mr-1.5 h-3.5 w-3.5" />
                          Share
                        </button>
                        <button
                          type="button"
                          className="rounded-md border border-slate-300 bg-white px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-100 disabled:opacity-60"
                          onClick={() => void shareSelectedQuizzes("whatsapp")}
                          disabled={selectedGeneratedItems.length === 0}
                        >
                          WhatsApp
                        </button>
                        <button
                          type="button"
                          className="rounded-md border border-slate-300 bg-white px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-100 disabled:opacity-60"
                          onClick={() => void shareSelectedQuizzes("x")}
                          disabled={selectedGeneratedItems.length === 0}
                        >
                          X
                        </button>
                        <button
                          type="button"
                          className="rounded-md border border-slate-300 bg-white px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-100 disabled:opacity-60"
                          onClick={() => void shareSelectedQuizzes("telegram")}
                          disabled={selectedGeneratedItems.length === 0}
                        >
                          Telegram
                        </button>
                        <button
                          type="button"
                          className="rounded-md border border-slate-300 bg-white px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-100 disabled:opacity-60"
                          onClick={() => void shareSelectedQuizzes("facebook")}
                          disabled={selectedGeneratedItems.length === 0}
                        >
                          Facebook
                        </button>
                        <button
                          type="button"
                          className="rounded-md border border-slate-300 bg-white px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-100 disabled:opacity-60"
                          onClick={() => void shareSelectedQuizzes("copy")}
                          disabled={selectedGeneratedItems.length === 0}
                        >
                          Copy Text
                        </button>
                      </div>
                    </>
                  ) : null}

                  {activePostActionTab === "add_existing" ? (
                    <>
                      {requireSpecificTargetCollection ? (
                        <p className={`rounded-md border px-3 py-2 text-xs ${targetCollectionMissing
                          ? "border-rose-200 bg-rose-50 text-rose-700"
                          : "border-emerald-200 bg-emerald-50 text-emerald-700"
                          }`}>
                          {targetCollectionMissing
                            ? "Target Prelims Test ID is missing in URL. Open this workspace from Test Series -> Add Quiz."
                            : `Bound to Prelims Test #${requestedCollectionId}. Selected quizzes will be added only to this test.`}
                        </p>
                      ) : null}
                      <label className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                        {requireSpecificTargetCollection ? "Add to Bound Prelims Test" : "Add to Existing Prelims Test"}
                      </label>
                      <div className="flex flex-col gap-2 sm:flex-row">
                        <select
                          className="flex-1 rounded-md border border-slate-300 bg-white px-3 py-2 text-sm"
                          value={selectedCollectionId}
                          onChange={(event) => setSelectedCollectionId(event.target.value)}
                          disabled={requireSpecificTargetCollection}
                        >
                          <option value="">{requireSpecificTargetCollection ? "Bound Prelims Test" : "Select Prelims Test"}</option>
                          {availableCollections.map((collection) => (
                            <option key={collection.id} value={String(collection.id)}>
                              {collection.title || collection.name || `Prelims Test ${collection.id}`}
                            </option>
                          ))}
                        </select>
                        <button
                          type="button"
                          className="w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-100 disabled:opacity-60 sm:w-auto"
                          onClick={handleAddToSelectedCollection}
                          disabled={
                            isAddingToCollection
                            || selectedGeneratedItems.length === 0
                            || (!selectedCollectionId && !requireSpecificTargetCollection)
                            || targetCollectionMissing
                          }
                        >
                          {isAddingToCollection ? "Adding..." : "Add"}
                        </button>
                      </div>
                    </>
                  ) : null}

                  {activePostActionTab === "create_new" && !requireSpecificTargetCollection ? (
                    <>
                      <label className="text-xs font-semibold uppercase tracking-wide text-slate-500">Create New Prelims Test</label>
                      <div className="flex flex-col gap-2 sm:flex-row">
                        <input
                          className="flex-1 rounded-md border border-slate-300 bg-white px-3 py-2 text-sm"
                          value={newCollectionName}
                          onChange={(event) => setNewCollectionName(event.target.value)}
                          placeholder="e.g. AI Prelims Practice Set"
                        />
                        <button
                          type="button"
                          className="w-full rounded-md bg-slate-900 px-3 py-2 text-xs font-semibold text-white shadow-sm disabled:opacity-60 sm:w-auto"
                          onClick={handleCreateAndAddCollection}
                          disabled={isAddingToCollection || selectedGeneratedItems.length === 0 || !newCollectionName.trim()}
                        >
                          {isAddingToCollection ? "Working..." : "Create + Add"}
                        </button>
                      </div>
                    </>
                  ) : null}
                </div>
              </div>
            </div>

            {attemptableQuestions.length > 0 ? (
              <p className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
                Your generated questions will stay for 24 hours unless you move them into a test.
                {generatedExpiresAt ? ` Auto-removal: ${formatDateTimeDDMMYYYY(generatedExpiresAt)}.` : ""}
              </p>
            ) : null}

            {resultView}
          </section>
        )}
      </div>

      {/* Example Questions Modal */}
      {exampleQuestionsModalItem ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4 backdrop-blur-sm">
          <div className="max-h-[85vh] w-full max-w-2xl overflow-hidden rounded-2xl bg-white shadow-2xl flex flex-col transition-all">
            <div className="flex items-center justify-between border-b border-slate-100 p-5 bg-slate-50">
              <div>
                <h3 className="text-lg font-bold text-slate-800">{exampleQuestionsModalItem.title}</h3>
                <p className="text-xs text-slate-500 mt-0.5">Reference Patterns for AI Generator</p>
              </div>
              <button
                type="button"
                className="rounded-full p-2 text-slate-400 hover:bg-slate-200 hover:text-slate-600 transition-colors"
                onClick={() => setExampleQuestionsModalItem(null)}
              >
                <X className="h-5 w-5" />
              </button>
            </div>
            <div className="flex-1 overflow-y-auto p-6 bg-slate-50 space-y-4">
              {exampleQuestionsModalItem.example_questions.map((question, index) => (
                <div key={index} className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm relative group overflow-hidden">
                  <div className="absolute top-0 left-0 w-1 h-full bg-violet-400 opacity-0 group-hover:opacity-100 transition-opacity" />
                  <p className="text-[10px] font-bold text-slate-400 mb-2 uppercase tracking-widest">Example {index + 1}</p>
                  <pre className="whitespace-pre-wrap text-sm text-slate-700 font-sans leading-relaxed">{question}</pre>
                </div>
              ))}
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
