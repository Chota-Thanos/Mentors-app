"use client";

import axios from "axios";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Edit3, Loader2, Plus, Sparkles, Trash2 } from "lucide-react";
import { toast } from "sonner";

import CategorySelector from "@/components/premium/ExamCategorySelector";
import { useAuth } from "@/context/AuthContext";
import { hasQuizMasterGenerationSubscription } from "@/lib/accessControl";
import { legacyPremiumAiApi } from "@/lib/legacyPremiumAiApi";
import { OUTPUT_LANGUAGE_OPTIONS, persistOutputLanguage, readOutputLanguage, type OutputLanguage } from "@/lib/outputLanguage";
import { premiumApi } from "@/lib/premiumApi";
import type {
  PremiumAIContentType,
  PremiumAIExampleAnalysis,
  PremiumAIExampleAnalysisListResponse,
  PremiumContentItem,
  PremiumPreviewResponse,
  QuizKind,
  UploadedPDF,
} from "@/types/premium";

interface QuestionCreationMethodsViewProps {
  collectionId: number;
  collectionTitle: string;
}

type TabKey = "manual" | "parse" | "ai_generate" | "ai_parse";
type SourceKey = "manual" | "parse" | "ai_generate" | "ai_parse";
type AiSourceType = "text" | "url" | "pdf" | "image";
type OcrImageFile = {
  id: string;
  name: string;
  base64: string;
};

type DraftForm = {
  question_statement: string;
  supp_question_statement: string;
  statements_facts: string;
  question_prompt: string;
  option_a: string;
  option_b: string;
  option_c: string;
  option_d: string;
  option_e: string;
  correct_answer: string;
  explanation: string;
  source_reference: string;
  alpha_cat_ids_csv: string;
  passage_title: string;
  passage_text: string;
  category_ids?: number[];
};

type DraftQuestion = DraftForm & {
  local_id: string;
  source_method: SourceKey;
  selected: boolean;
  quiz_kind: QuizKind;
  exam_id: number | null;
  category_ids: number[];
};

const EMPTY_FORM: DraftForm = {
  question_statement: "",
  supp_question_statement: "",
  statements_facts: "",
  question_prompt: "",
  option_a: "",
  option_b: "",
  option_c: "",
  option_d: "",
  option_e: "",
  correct_answer: "A",
  explanation: "",
  source_reference: "",
  alpha_cat_ids_csv: "",
  passage_title: "",
  passage_text: "",
};

const CONTENT_TYPE_MAP: Record<QuizKind, PremiumAIContentType> = {
  gk: "premium_gk_quiz",
  maths: "premium_maths_quiz",
  passage: "premium_passage_quiz",
};

const SOURCE_LABEL: Record<SourceKey, string> = {
  manual: "Manual",
  parse: "Parsed",
  ai_generate: "AI Generated",
  ai_parse: "AI Parsed",
};

interface StandardDraftFieldsProps {
  title: string;
  hint: string;
  quizKind: QuizKind;
  form: DraftForm;
  onChange: (patch: Partial<DraftForm>) => void;
}

function StandardDraftFields({ title, hint, quizKind, form, onChange }: StandardDraftFieldsProps) {
  return (
    <div className="space-y-3 rounded border border-slate-200 bg-white p-3">
      <div>
        <p className="text-sm font-semibold text-slate-900">{title}</p>
        <p className="text-xs text-slate-600">{hint}</p>
      </div>

      {quizKind === "passage" ? (
        <div className="space-y-2">
          <div className="space-y-1">
            <label className="text-xs font-semibold uppercase tracking-wide text-slate-500">Passage title</label>
            <input
              value={form.passage_title}
              onChange={(event) => onChange({ passage_title: event.target.value })}
              className="w-full rounded border border-slate-300 bg-white px-3 py-2 text-sm"
              placeholder="Passage title"
            />
          </div>
          <div className="space-y-1">
            <label className="text-xs font-semibold uppercase tracking-wide text-slate-500">Passage text</label>
            <textarea
              rows={4}
              value={form.passage_text}
              onChange={(event) => onChange({ passage_text: event.target.value })}
              className="w-full rounded border border-slate-300 bg-white px-3 py-2 text-sm"
              placeholder="Passage text"
            />
          </div>
        </div>
      ) : null}

      <div className="space-y-1">
        <label className="text-xs font-semibold uppercase tracking-wide text-slate-500">Question statement</label>
        <textarea
          rows={3}
          value={form.question_statement}
          onChange={(event) => onChange({ question_statement: event.target.value })}
          className="w-full rounded border border-slate-300 bg-white px-3 py-2 text-sm"
          placeholder="Question statement"
        />
      </div>

      <div className="space-y-1">
        <label className="text-xs font-semibold uppercase tracking-wide text-slate-500">Supplementary statement</label>
        <textarea
          rows={2}
          value={form.supp_question_statement}
          onChange={(event) => onChange({ supp_question_statement: event.target.value })}
          className="w-full rounded border border-slate-300 bg-white px-3 py-2 text-sm"
          placeholder="Supplementary statement"
        />
      </div>

      <div className="space-y-1">
        <label className="text-xs font-semibold uppercase tracking-wide text-slate-500">Statements / Facts</label>
        <textarea
          rows={3}
          value={form.statements_facts}
          onChange={(event) => onChange({ statements_facts: event.target.value })}
          className="w-full rounded border border-slate-300 bg-white px-3 py-2 text-sm"
          placeholder="One fact per line"
        />
      </div>

      <div className="space-y-1">
        <label className="text-xs font-semibold uppercase tracking-wide text-slate-500">Question prompt</label>
        <textarea
          rows={2}
          value={form.question_prompt}
          onChange={(event) => onChange({ question_prompt: event.target.value })}
          className="w-full rounded border border-slate-300 bg-white px-3 py-2 text-sm"
          placeholder="Question prompt"
        />
      </div>

      <fieldset className="rounded border border-slate-200 p-3">
        <legend className="px-1 text-xs font-semibold uppercase tracking-wide text-slate-500">Options</legend>
        <div className="mt-2 grid gap-2 md:grid-cols-2">
          {([
            ["option_a", "Option A"],
            ["option_b", "Option B"],
            ["option_c", "Option C"],
            ["option_d", "Option D"],
            ["option_e", "Option E (optional)"],
          ] as const).map(([key, label]) => (
            <div key={key} className="space-y-1">
              <label className="text-xs text-slate-600">{label}</label>
              <input
                value={form[key]}
                onChange={(event) => onChange({ [key]: event.target.value })}
                className="w-full rounded border border-slate-300 bg-white px-3 py-2 text-sm"
                placeholder={label}
              />
            </div>
          ))}
        </div>
      </fieldset>

      <div className="grid gap-2 md:grid-cols-3">
        <div className="space-y-1">
          <label className="text-xs font-semibold uppercase tracking-wide text-slate-500">Correct answer</label>
          <select
            value={form.correct_answer}
            onChange={(event) => onChange({ correct_answer: event.target.value })}
            className="w-full rounded border border-slate-300 bg-white px-3 py-2 text-sm"
          >
            <option value="A">A</option>
            <option value="B">B</option>
            <option value="C">C</option>
            <option value="D">D</option>
            <option value="E">E</option>
          </select>
        </div>
        <div className="space-y-1 md:col-span-2">
          <label className="text-xs font-semibold uppercase tracking-wide text-slate-500">Source reference</label>
          <input
            value={form.source_reference}
            onChange={(event) => onChange({ source_reference: event.target.value })}
            className="w-full rounded border border-slate-300 bg-white px-3 py-2 text-sm"
            placeholder="Source reference"
          />
        </div>
      </div>

      <div className="space-y-1">
        <label className="text-xs font-semibold uppercase tracking-wide text-slate-500">Alpha category IDs</label>
        <input
          value={form.alpha_cat_ids_csv}
          onChange={(event) => onChange({ alpha_cat_ids_csv: event.target.value })}
          className="w-full rounded border border-slate-300 bg-white px-3 py-2 text-sm"
          placeholder="Comma-separated IDs (optional)"
        />
      </div>

      <div className="space-y-1">
        <label className="text-xs font-semibold uppercase tracking-wide text-slate-500">Explanation</label>
        <textarea
          rows={3}
          value={form.explanation}
          onChange={(event) => onChange({ explanation: event.target.value })}
          className="w-full rounded border border-slate-300 bg-white px-3 py-2 text-sm"
          placeholder="Explanation"
        />
      </div>
    </div>
  );
}

const parseFacts = (value: string): string[] =>
  value
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);

const parseIdsCsv = (value: string): number[] =>
  value
    .split(",")
    .map((part) => Number(part.trim()))
    .filter((item) => Number.isFinite(item) && item > 0);

const normalizeCategoryIds = (value: unknown): number[] => (
  Array.isArray(value)
    ? value
        .map((item) => Number(item))
        .filter((id, index, values) => Number.isFinite(id) && id > 0 && values.indexOf(id) === index)
    : []
);

const toError = (error: unknown): string => {
  if (axios.isAxiosError(error)) {
    const detail = error.response?.data?.detail;
    if (typeof detail === "string" && detail.trim()) return detail;
    return error.message;
  }
  if (error instanceof Error) return error.message;
  return "Unknown error";
};

const safeRecord = (value: unknown): Record<string, unknown> =>
  value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};

const newDraftId = (): string => `draft-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;

const parseDesiredCount = (value: string, fallback = 5): number => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return Math.max(1, Math.min(100, Math.floor(parsed)));
};

const estimateAiParseDesiredCount = (content: string, quizKind: QuizKind): number => {
  const normalized = content.replace(/\r/g, "").trim();
  if (!normalized) return 5;

  if (quizKind !== "passage") {
    const localParsedCount = parseTextBlocksToDraftForms(normalized).length;
    if (localParsedCount > 0) return Math.min(100, localParsedCount);
  }

  const questionMarkerCount = (normalized.match(/^(?:Q(?:uestion)?\s*\d+|\d+)\s*[\).\:\-]/gim) || []).length;
  const answerMarkerCount = (normalized.match(/^(?:ans(?:wer)?|correct(?:\s*answer)?)\s*[:\-]/gim) || []).length;
  const optionStartCount = (normalized.match(/^(?:\(?A\)?|Option\s*A|1[\).\:\-])\s+/gim) || []).length;
  const candidateCounts = [questionMarkerCount, answerMarkerCount, optionStartCount].filter((count) => count > 0);
  if (candidateCounts.length > 0) return Math.min(100, Math.max(...candidateCounts));

  const paragraphBlocks = normalized
    .split(/\n\s*\n+/)
    .map((block) => block.trim())
    .filter(Boolean).length;
  return Math.max(1, Math.min(100, paragraphBlocks || 5));
};

const parseCorrectAnswer = (raw: unknown): string => {
  const val = String(raw || "").trim().toUpperCase().replace("OPTION ", "");
  if (["A", "B", "C", "D", "E"].includes(val)) return val;
  const num = Number(val);
  if (Number.isFinite(num) && num >= 1 && num <= 5) return String.fromCharCode(64 + num);
  return "A";
};

const parseExampleLines = (value: string): string[] => {
  if (!value || !value.trim()) return [];
  const hasOptions = /\(\d+\)|^\s*\(\d+\)|^\s*[A-D][\.)]/m.test(value);
  const hasQuestionMarker = /^(?:\*\*)?Q\d+\.|^\d+\.|^Question\s+\d+/im.test(value);
  if (hasOptions || (hasQuestionMarker && value.includes("\n"))) {
    return [value.trim()];
  }
  const blocks = value
    .split(/\n\s*\n+/)
    .map((block) => block.trim())
    .filter(Boolean);
  if (blocks.length > 1) return blocks;
  return value
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
};

const mapRecordToDraftForm = (input: Record<string, unknown>, quizKind: QuizKind): DraftForm | null => {
  const statement = String(input.question_statement || input.question || "").trim();
  if (!statement) return null;

  const optionsRaw = Array.isArray(input.options) ? input.options : [];
  const optionsMap: Record<"A" | "B" | "C" | "D" | "E", string> = { A: "", B: "", C: "", D: "", E: "" };
  for (let i = 0; i < optionsRaw.length; i += 1) {
    const row = optionsRaw[i];
    const fallbackLabel = String.fromCharCode(65 + i);
    const optionRec = safeRecord(row);
    const label = String(optionRec.label || fallbackLabel).trim().toUpperCase();
    const text = typeof row === "string" ? row : String(optionRec.text || optionRec.value || "").trim();
    if (["A", "B", "C", "D", "E"].includes(label) && text) {
      optionsMap[label as keyof typeof optionsMap] = text;
    }
  }
  if (!optionsMap.A) optionsMap.A = String(input.option_a || "").trim();
  if (!optionsMap.B) optionsMap.B = String(input.option_b || "").trim();
  if (!optionsMap.C) optionsMap.C = String(input.option_c || "").trim();
  if (!optionsMap.D) optionsMap.D = String(input.option_d || "").trim();
  if (!optionsMap.E) optionsMap.E = String(input.option_e || "").trim();

  const maybeFacts = input.statements_facts ?? input.statement_facts;
  const facts = Array.isArray(maybeFacts)
    ? maybeFacts.map((row) => String(row || "").trim()).filter(Boolean)
    : parseFacts(String(maybeFacts || ""));

  return {
    ...EMPTY_FORM,
    question_statement: statement,
    supp_question_statement: String(input.supp_question_statement || input.supplementary_statement || "").trim(),
    statements_facts: facts.join("\n"),
    question_prompt: String(input.question_prompt || input.prompt || "").trim(),
    option_a: optionsMap.A || "Option 1",
    option_b: optionsMap.B || "Option 2",
    option_c: optionsMap.C || "Option 3",
    option_d: optionsMap.D || "Option 4",
    option_e: optionsMap.E,
    correct_answer: parseCorrectAnswer(input.correct_answer || input.answer),
    explanation: String(input.explanation || input.explanation_text || "").trim(),
    source_reference: String(input.source_reference || input.source || "").trim(),
    passage_title: quizKind === "passage" ? String(input.passage_title || "").trim() : "",
    passage_text: quizKind === "passage" ? String(input.passage_text || input.passage || "").trim() : "",
    category_ids: normalizeCategoryIds(
      input.category_ids
      || input.premium_gk_category_ids
      || input.premium_maths_category_ids
      || input.premium_passage_category_ids
      || [],
    ),
  };
};

const extractDraftFormsFromAiPayload = (payload: unknown, quizKind: QuizKind, fallbackText: string): DraftForm[] => {
  const root = safeRecord(payload);
  if (quizKind !== "passage") {
    const rows = Array.isArray(root.questions) ? root.questions : Array.isArray(payload) ? payload : [payload];
    return rows
      .map((row) => mapRecordToDraftForm(safeRecord(row), quizKind))
      .filter((row): row is DraftForm => Boolean(row));
  }

  const passageRows = Array.isArray(root.passages) ? root.passages : Array.isArray(payload) ? payload : [payload];
  const collected: DraftForm[] = [];
  for (const passageRow of passageRows) {
    const passage = safeRecord(passageRow);
    const title = String(passage.passage_title || "").trim();
    const text = String(passage.passage_text || passage.passage || fallbackText || "").trim();
    const source = String(passage.source_reference || passage.source || "").trim();
    const qRows = Array.isArray(passage.questions) ? passage.questions : [passage];
    for (const qRow of qRows) {
      const mapped = mapRecordToDraftForm(safeRecord(qRow), "passage");
      if (!mapped) continue;
      collected.push({
        ...mapped,
        passage_title: mapped.passage_title || title,
        passage_text: mapped.passage_text || text,
        source_reference: mapped.source_reference || source,
      });
    }
  }
  return collected;
};

const parseTextBlocksToDraftForms = (input: string): DraftForm[] => {
  const blocks = input
    .replace(/\r/g, "")
    .split(/\n\s*\n+/)
    .map((block) => block.trim())
    .filter(Boolean);

  const output: DraftForm[] = [];
  for (const block of blocks) {
    const lines = block
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean);
    if (lines.length === 0) continue;

    const options: Record<"A" | "B" | "C" | "D" | "E", string> = { A: "", B: "", C: "", D: "", E: "" };
    const statementLines: string[] = [];
    let answer = "A";
    let explanation = "";
    let prompt = "";
    let source = "";

    for (const line of lines) {
      const optionMatch = line.match(/^(?:\(?([A-E])\)?[\).\:\-]?|option\s*([A-E]))\s*(.+)$/i);
      if (optionMatch) {
        const label = String(optionMatch[1] || optionMatch[2] || "").toUpperCase() as "A" | "B" | "C" | "D" | "E";
        options[label] = optionMatch[3].trim();
        continue;
      }
      const ansMatch = line.match(/^(?:ans(?:wer)?|correct(?:\s*answer)?)\s*[:\-]\s*([A-E1-5])/i);
      if (ansMatch) {
        answer = parseCorrectAnswer(ansMatch[1]);
        continue;
      }
      const expMatch = line.match(/^(?:exp(?:lanation)?|reason)\s*[:\-]\s*(.+)$/i);
      if (expMatch) {
        explanation = expMatch[1].trim();
        continue;
      }
      const promptMatch = line.match(/^(?:prompt|question\s*prompt)\s*[:\-]\s*(.+)$/i);
      if (promptMatch) {
        prompt = promptMatch[1].trim();
        continue;
      }
      const sourceMatch = line.match(/^source\s*[:\-]\s*(.+)$/i);
      if (sourceMatch) {
        source = sourceMatch[1].trim();
        continue;
      }
      statementLines.push(line);
    }

    const statement = statementLines.join(" ").replace(/^\s*q(?:uestion)?\s*\d*\s*[\).\:\-]?\s*/i, "").trim();
    if (!statement || !options.A || !options.B || !options.C || !options.D) continue;

    output.push({
      ...EMPTY_FORM,
      question_statement: statement,
      option_a: options.A,
      option_b: options.B,
      option_c: options.C,
      option_d: options.D,
      option_e: options.E,
      correct_answer: answer,
      explanation,
      question_prompt: prompt,
      source_reference: source,
    });
  }
  return output;
};

export default function QuestionCreationMethodsView({ collectionId, collectionTitle }: QuestionCreationMethodsViewProps) {
  const { user, loading: authLoading } = useAuth();
  const hasAiAccess = useMemo(() => hasQuizMasterGenerationSubscription(user), [user]);

  const [tab, setTab] = useState<TabKey>("manual");
  const [quizKind, setQuizKind] = useState<QuizKind>("gk");
  const [selectedCategoryIds, setSelectedCategoryIds] = useState<number[]>([]);

  const [manualForm, setManualForm] = useState<DraftForm>(EMPTY_FORM);
  const [editingDraftId, setEditingDraftId] = useState<string | null>(null);

  const [parseInput, setParseInput] = useState("");
  const [parseCount, setParseCount] = useState("5");
  const [parsePassageTitle, setParsePassageTitle] = useState("");
  const [parsePassageText, setParsePassageText] = useState("");
  const [parsePassageSource, setParsePassageSource] = useState("");

  const [aiGenerateContent, setAiGenerateContent] = useState("");
  const [aiGenerateSourceType, setAiGenerateSourceType] = useState<AiSourceType>("text");
  const [aiGenerateUrl, setAiGenerateUrl] = useState("");
  const [aiGenerateUploadedPdfId, setAiGenerateUploadedPdfId] = useState("");
  const [aiGenerateImages, setAiGenerateImages] = useState<OcrImageFile[]>([]);
  const [aiGenerateOcrText, setAiGenerateOcrText] = useState("");
  const [aiGenerateExtracting, setAiGenerateExtracting] = useState(false);
  const [aiGenerateExampleAnalysisId, setAiGenerateExampleAnalysisId] = useState("");
  const [aiGenerateExampleQuestion, setAiGenerateExampleQuestion] = useState("");
  const [aiGenerateExampleQuestions, setAiGenerateExampleQuestions] = useState("");
  const [aiGenerateInstructions, setAiGenerateInstructions] = useState("");
  const [aiGenerateCount, setAiGenerateCount] = useState("5");
  const [aiGenerateUseCategorySource, setAiGenerateUseCategorySource] = useState(false);

  const [aiParseContent, setAiParseContent] = useState("");

  const [uploadedPdfs, setUploadedPdfs] = useState<UploadedPDF[]>([]);
  const [loadingUploadedPdfs, setLoadingUploadedPdfs] = useState(false);
  const [uploadingPdf, setUploadingPdf] = useState(false);
  const [deletingPdfId, setDeletingPdfId] = useState<number | null>(null);
  const [exampleAnalyses, setExampleAnalyses] = useState<PremiumAIExampleAnalysis[]>([]);
  const [loadingExampleAnalyses, setLoadingExampleAnalyses] = useState(false);

  const [outputLanguage, setOutputLanguage] = useState<OutputLanguage>("en");
  const [drafts, setDrafts] = useState<DraftQuestion[]>([]);
  const [working, setWorking] = useState(false);
  const [finalCount, setFinalCount] = useState<number | null>(null);

  const selectedDraftCount = useMemo(() => drafts.filter((row) => row.selected).length, [drafts]);
  const aiLocked = !authLoading && !hasAiAccess;

  useEffect(() => {
    setOutputLanguage(readOutputLanguage());
  }, []);

  const loadUploadedPdfs = useCallback(async () => {
    setLoadingUploadedPdfs(true);
    try {
      const response = await legacyPremiumAiApi.get<UploadedPDF[]>("/premium-ai-quizzes/uploaded-pdfs");
      const rows = Array.isArray(response.data) ? response.data : [];
      setUploadedPdfs(rows);
    } catch {
      setUploadedPdfs([]);
    } finally {
      setLoadingUploadedPdfs(false);
    }
  }, []);

  const loadExampleAnalyses = useCallback(async () => {
    setLoadingExampleAnalyses(true);
    try {
      const params = new URLSearchParams();
      params.set("content_type", CONTENT_TYPE_MAP[quizKind]);
      params.set("include_admin", "false");
      const response = await legacyPremiumAiApi.get<PremiumAIExampleAnalysisListResponse>(
        `/premium-ai-quizzes/example-analyses?${params.toString()}`,
      );
      const rows = Array.isArray(response.data?.items) ? response.data.items : [];
      setExampleAnalyses(rows);
      setAiGenerateExampleAnalysisId((current) => {
        if (current && rows.some((item) => String(item.id) === current)) return current;
        return rows[0] ? String(rows[0].id) : "";
      });
    } catch {
      setExampleAnalyses([]);
      setAiGenerateExampleAnalysisId("");
    } finally {
      setLoadingExampleAnalyses(false);
    }
  }, [quizKind]);

  useEffect(() => {
    if (tab !== "ai_generate") return;
    void loadUploadedPdfs();
    void loadExampleAnalyses();
  }, [tab, loadUploadedPdfs, loadExampleAnalyses]);

  const aiGenerateSelectedAnalysis = useMemo(
    () => exampleAnalyses.find((item) => String(item.id) === aiGenerateExampleAnalysisId) || null,
    [aiGenerateExampleAnalysisId, exampleAnalyses],
  );

  const applySelectedExampleAnalysis = () => {
    if (!aiGenerateSelectedAnalysis) {
      toast.error("Select a saved example format first.");
      return;
    }
    const exampleText = (aiGenerateSelectedAnalysis.example_questions || []).join("\n\n");
    setAiGenerateExampleQuestions(exampleText);
    toast.success("Saved example format applied.");
  };

  const extractAnalysisStyleInstructions = (analysis: PremiumAIExampleAnalysis | null): string | undefined => {
    const styleProfile = safeRecord(analysis?.style_profile);
    const instructions = String(styleProfile.style_instructions || "").trim();
    return instructions || undefined;
  };

  const readImageFile = async (file: File): Promise<OcrImageFile> =>
    new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onerror = () => reject(new Error(`Failed to read image: ${file.name}`));
      reader.onloadend = () =>
        resolve({
          id: `${Date.now()}-${Math.random().toString(16).slice(2, 8)}`,
          name: file.name,
          base64: String(reader.result || ""),
        });
      reader.readAsDataURL(file);
    });

  const handleGenerateImageUpload = async (fileList: FileList | null) => {
    const files = Array.from(fileList || []);
    if (files.length === 0) return;

    const validFiles = files.filter((file) => file.type.startsWith("image/"));
    if (validFiles.length === 0) {
      toast.error("Add image files for Photo OCR.");
      return;
    }

    try {
      const images = await Promise.all(validFiles.map((file) => readImageFile(file)));
      setAiGenerateImages((prev) => [...prev, ...images]);
      setAiGenerateSourceType("image");
      toast.success(`Added ${images.length} image(s).`);
    } catch (error: unknown) {
      toast.error("Image upload failed", { description: toError(error) });
    }
  };

  const removeGenerateImage = (imageId: string) => {
    setAiGenerateImages((prev) => prev.filter((image) => image.id !== imageId));
  };

  const extractGenerateImageText = async () => {
    if (aiLocked) {
      toast.error("Active Quiz Master AI subscription required.");
      return;
    }
    if (aiGenerateImages.length === 0) {
      toast.error("Add photo(s) first.");
      return;
    }

    setAiGenerateExtracting(true);

    try {
      const response = await premiumApi.post<{ extracted_text: string }>("/ai-evaluation/ocr", {
        images_base64: aiGenerateImages.map((image) => image.base64),
        ai_provider: "gemini",
        ai_model_name: "gemini-3-flash-preview",
      });
      const extractedText = String(response.data?.extracted_text || "").trim();
      if (!extractedText) {
        toast.error("No text was extracted from uploaded photos.");
        return;
      }

      setAiGenerateOcrText(extractedText);
      setAiGenerateSourceType("image");
      toast.success(`Extracted text from ${aiGenerateImages.length} image(s).`);
    } catch (error: unknown) {
      toast.error("Photo OCR failed", { description: toError(error) });
    } finally {
      setAiGenerateExtracting(false);
    }
  };

  const handleGeneratePdfUpload = async (file: File | null) => {
    if (!file) return;
    if (file.type !== "application/pdf" && !file.name.toLowerCase().endsWith(".pdf")) {
      toast.error("Only PDF files are allowed.");
      return;
    }
    setUploadingPdf(true);
    try {
      const formData = new FormData();
      formData.append("file", file);
      const response = await legacyPremiumAiApi.post<UploadedPDF>("/premium-ai-quizzes/upload-pdf", formData);
      const uploaded = response.data;
      await loadUploadedPdfs();
      setAiGenerateSourceType("pdf");
      setAiGenerateUploadedPdfId(String(uploaded.id));
      toast.success(`PDF uploaded: ${uploaded.filename}`);
    } catch (error: unknown) {
      toast.error("PDF upload failed", { description: toError(error) });
    } finally {
      setUploadingPdf(false);
    }
  };

  const handleDeleteUploadedPdf = async (pdfId: number) => {
    if (uploadingPdf || deletingPdfId !== null) return;
    setDeletingPdfId(pdfId);
    try {
      await legacyPremiumAiApi.delete(`/premium-ai-quizzes/uploaded-pdfs/${pdfId}`);
      setUploadedPdfs((prev) => prev.filter((row) => row.id !== pdfId));
      setAiGenerateUploadedPdfId((prev) => (prev === String(pdfId) ? "" : prev));
      toast.success("Uploaded PDF deleted.");
    } catch (error: unknown) {
      toast.error("Failed to delete PDF", { description: toError(error) });
    } finally {
      setDeletingPdfId(null);
    }
  };

  const refreshFinalCount = useCallback(async () => {
    try {
      const response = await premiumApi.get<PremiumContentItem[]>("/content", { params: { collection_id: collectionId } });
      setFinalCount(Array.isArray(response.data) ? response.data.length : 0);
    } catch {
      setFinalCount(null);
    }
  }, [collectionId]);

  useEffect(() => {
    void refreshFinalCount();
  }, [refreshFinalCount]);

  useEffect(() => {
    setDrafts((prev) =>
      prev.map((row) =>
        row.quiz_kind !== quizKind
          ? row
          : {
              ...row,
              category_ids: selectedCategoryIds.length > 0 ? [...selectedCategoryIds] : row.category_ids,
            },
      ),
    );
  }, [quizKind, selectedCategoryIds]);

  const ensureMetadataSelection = (): boolean => {
    return true;
  };

  const addDrafts = (forms: DraftForm[], sourceMethod: SourceKey): number => {
    if (forms.length === 0) return 0;
    const rows: DraftQuestion[] = forms.map((form) => ({
      ...form,
      local_id: newDraftId(),
      source_method: sourceMethod,
      selected: true,
      quiz_kind: quizKind,
      exam_id: null,
      category_ids: selectedCategoryIds.length > 0 ? [...selectedCategoryIds] : normalizeCategoryIds(form.category_ids),
    }));
    setDrafts((prev) => [...rows, ...prev]);
    return rows.length;
  };

  const submitManualDraft = () => {
    if (!ensureMetadataSelection()) return;
    if (!manualForm.question_statement.trim()) return toast.error("Question statement is required.");
    if (!manualForm.option_a.trim() || !manualForm.option_b.trim() || !manualForm.option_c.trim() || !manualForm.option_d.trim()) {
      return toast.error("Options A to D are required.");
    }
    if (quizKind === "passage" && !manualForm.passage_text.trim()) {
      return toast.error("Passage text is required for passage mode.");
    }

    if (editingDraftId) {
      setDrafts((prev) =>
        prev.map((row) =>
          row.local_id === editingDraftId
            ? {
                ...row,
                ...manualForm,
                quiz_kind: quizKind,
                exam_id: null,
                category_ids: selectedCategoryIds.length > 0 ? [...selectedCategoryIds] : normalizeCategoryIds(manualForm.category_ids),
              }
            : row,
        ),
      );
      setEditingDraftId(null);
      setManualForm(EMPTY_FORM);
      return toast.success("Draft updated.");
    }

    addDrafts([manualForm], "manual");
    setManualForm(EMPTY_FORM);
    toast.success("Draft added.");
  };

  const parseToDrafts = () => {
    if (!ensureMetadataSelection()) return;
    if (!parseInput.trim()) return toast.error("Paste source content first.");

    let rows: DraftForm[] = [];
    try {
      rows = extractDraftFormsFromAiPayload(JSON.parse(parseInput), quizKind, parseInput.trim());
    } catch {
      rows = parseTextBlocksToDraftForms(parseInput);
    }

    if (quizKind === "passage") {
      rows = rows.map((row) => ({
        ...row,
        passage_title: row.passage_title.trim() ? row.passage_title : parsePassageTitle.trim(),
        passage_text: row.passage_text.trim() ? row.passage_text : parsePassageText.trim(),
        source_reference: row.source_reference.trim() ? row.source_reference : parsePassageSource.trim(),
      }));
    }

    if (rows.length === 0) return toast.error("No parseable questions found.");
    if (quizKind === "passage" && !rows.some((row) => row.passage_text.trim())) {
      return toast.error("Passage text is required for passage mode.");
    }

    const added = addDrafts(rows.slice(0, parseDesiredCount(parseCount)), "parse");
    toast.success(`Added ${added} parsed draft question(s).`);
  };

  const runAiTab = async (mode: "ai_generate" | "ai_parse") => {
    if (authLoading) return toast.error("Loading permissions. Try again.");
    if (aiLocked) return toast.error("Active Quiz Master AI subscription required.");
    if (!ensureMetadataSelection()) return;

    if (mode === "ai_parse") {
      const content = aiParseContent.trim();
      if (!content) {
        return toast.error("Paste source content for AI parse.");
      }

      const desiredCount = estimateAiParseDesiredCount(content, quizKind);
      setWorking(true);
      try {
        const response = await legacyPremiumAiApi.post<PremiumPreviewResponse>(`/premium-ai-quizzes/preview/${quizKind}`, {
          content,
          content_type: CONTENT_TYPE_MAP[quizKind],
          desired_question_count: desiredCount,
          output_language: outputLanguage,
        });
        const rows = extractDraftFormsFromAiPayload(response.data?.parsed_quiz_data, quizKind, content);
        if (rows.length === 0) throw new Error("AI response did not return parseable questions.");
        const added = addDrafts(rows.slice(0, desiredCount), "ai_parse");
        toast.success(`Added ${added} draft question(s).`);
      } catch (error: unknown) {
        toast.error("AI parse failed", { description: toError(error) });
      } finally {
        setWorking(false);
      }
      return;
    }

    const sourceType = aiGenerateSourceType;
    const rawTextContent = aiGenerateContent.trim();
    const imageContent = aiGenerateOcrText.trim();
    const content = sourceType === "image" ? imageContent : rawTextContent;
    const sourceUrl = aiGenerateUrl.trim();
    const uploadedPdfIdRaw = aiGenerateUploadedPdfId;
    const uploadedPdfId = Number(uploadedPdfIdRaw);
    const normalizedUploadedPdfId = Number.isFinite(uploadedPdfId) && uploadedPdfId > 0 ? uploadedPdfId : undefined;
    const instructions = aiGenerateInstructions.trim();
    const desiredCount = parseDesiredCount(aiGenerateCount);
    const useCategorySource = aiGenerateUseCategorySource;
    const selectedAnalysisId = aiGenerateExampleAnalysisId;
    const exampleQuestion = aiGenerateExampleQuestion.trim();
    const exampleQuestions = parseExampleLines(aiGenerateExampleQuestions);
    const selectedAnalysis = aiGenerateSelectedAnalysis;
    const formattingInstructionText = extractAnalysisStyleInstructions(selectedAnalysis);
    if (useCategorySource && selectedCategoryIds.length === 0) {
      return toast.error("Select at least one category when category source mode is enabled.");
    }

    if (!useCategorySource) {
      if (sourceType === "text" && !content) {
        return toast.error("Enter topic/prompt for AI generate.");
      }
      if (sourceType === "image" && !content) {
        return toast.error("Extract text from uploaded photos first.");
      }
      if (sourceType === "url" && !sourceUrl) {
        return toast.error("Enter source URL.");
      }
      if (sourceType === "pdf" && !normalizedUploadedPdfId) {
        return toast.error("Select an uploaded PDF.");
      }
    }

    setWorking(true);
    try {
      const payload = {
        content: !useCategorySource && (sourceType === "text" || sourceType === "image") ? content : undefined,
        url: !useCategorySource && sourceType === "url" ? sourceUrl : undefined,
        uploaded_pdf_id: !useCategorySource && sourceType === "pdf" ? normalizedUploadedPdfId : undefined,
        content_type: CONTENT_TYPE_MAP[quizKind],
        desired_question_count: desiredCount,
        user_instructions: instructions || undefined,
        category_ids: selectedCategoryIds.length > 0 ? selectedCategoryIds : undefined,
        use_category_source: useCategorySource,
        example_analysis_id: selectedAnalysisId ? Number(selectedAnalysisId) : undefined,
        formatting_instruction_text: formattingInstructionText,
        example_question: exampleQuestion || undefined,
        example_questions: exampleQuestions.length > 0 ? exampleQuestions : undefined,
        output_language: outputLanguage,
      };
      const response = await legacyPremiumAiApi.post<PremiumPreviewResponse>(`/premium-ai-quizzes/preview/${quizKind}`, payload);
      const rows = extractDraftFormsFromAiPayload(response.data?.parsed_quiz_data, quizKind, content || sourceUrl);
      if (rows.length === 0) throw new Error("AI response did not return parseable questions.");
      const added = addDrafts(rows.slice(0, desiredCount), mode);
      toast.success(`Added ${added} draft question(s).`);
    } catch (error: unknown) {
      toast.error("AI action failed", { description: toError(error) });
    } finally {
      setWorking(false);
    }
  };

  const publishDrafts = async (scope: "selected" | "all") => {
    const target = drafts.filter((row) => (scope === "all" ? true : row.selected));
    if (target.length === 0) return toast.error("No draft selected.");
    if (!ensureMetadataSelection()) return;

    setWorking(true);
    const saved = new Set<string>();
    let failed = 0;

    for (const row of target) {
      const effectiveCategoryIds =
        row.quiz_kind === quizKind && selectedCategoryIds.length > 0
          ? [...selectedCategoryIds]
          : [...row.category_ids];
      const payload =
        row.quiz_kind === "passage"
          ? {
              title: row.passage_title.trim() || "Passage Quiz",
              type: "quiz_passage",
              collection_id: collectionId,
              data: {
                passage_title: row.passage_title.trim() || "Passage Quiz",
                passage_text: row.passage_text,
                source_reference: row.source_reference || null,
                source: row.source_reference || null,
                exam_id: null,
                category_ids: effectiveCategoryIds,
                premium_passage_category_ids: effectiveCategoryIds,
                alpha_cat_ids: parseIdsCsv(row.alpha_cat_ids_csv),
                questions: [
                  {
                    question_statement: row.question_statement,
                    supp_question_statement: row.supp_question_statement || null,
                    supplementary_statement: row.supp_question_statement || null,
                    statements_facts: parseFacts(row.statements_facts),
                    statement_facts: parseFacts(row.statements_facts),
                    question_prompt: row.question_prompt || null,
                    options: [
                      { label: "A", text: row.option_a },
                      { label: "B", text: row.option_b },
                      { label: "C", text: row.option_c },
                      { label: "D", text: row.option_d },
                      ...(row.option_e.trim() ? [{ label: "E", text: row.option_e.trim() }] : []),
                    ],
                    correct_answer: row.correct_answer,
                    answer: row.correct_answer,
                    explanation: row.explanation || null,
                    explanation_text: row.explanation || null,
                  },
                ],
              },
            }
          : {
              title: row.question_statement.slice(0, 120) || "Quiz Question",
              type: row.quiz_kind === "gk" ? "quiz_gk" : "quiz_maths",
              collection_id: collectionId,
              data: {
                question_statement: row.question_statement,
                supp_question_statement: row.supp_question_statement || null,
                supplementary_statement: row.supp_question_statement || null,
                statements_facts: parseFacts(row.statements_facts),
                statement_facts: parseFacts(row.statements_facts),
                question_prompt: row.question_prompt || null,
                option_a: row.option_a,
                option_b: row.option_b,
                option_c: row.option_c,
                option_d: row.option_d,
                option_e: row.option_e || null,
                options: [
                  { label: "A", text: row.option_a },
                  { label: "B", text: row.option_b },
                  { label: "C", text: row.option_c },
                  { label: "D", text: row.option_d },
                  ...(row.option_e.trim() ? [{ label: "E", text: row.option_e.trim() }] : []),
                ],
                correct_answer: row.correct_answer,
                answer: row.correct_answer,
                explanation: row.explanation || null,
                explanation_text: row.explanation || null,
                source_reference: row.source_reference || null,
                source: row.source_reference || null,
                exam_id: null,
                category_ids: effectiveCategoryIds,
                premium_gk_category_ids: row.quiz_kind === "gk" ? effectiveCategoryIds : [],
                premium_maths_category_ids: row.quiz_kind === "maths" ? effectiveCategoryIds : [],
                alpha_cat_ids: parseIdsCsv(row.alpha_cat_ids_csv),
              },
            };

      try {
        await premiumApi.post("/content", payload);
        saved.add(row.local_id);
      } catch {
        failed += 1;
      }
    }

    setWorking(false);
    if (saved.size > 0) {
      setDrafts((prev) => prev.filter((row) => !saved.has(row.local_id)));
      toast.success(`Published ${saved.size} draft question(s).`);
      await refreshFinalCount();
    }
    if (failed > 0) toast.error(`Failed to publish ${failed} draft question(s).`);
  };

  return (
    <div className="space-y-6">
      <section className="rounded-xl border border-slate-200 bg-white p-4 md:p-6">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-2xl font-bold text-slate-900">Question Builder: {collectionTitle}</h1>
            <p className="mt-1 text-sm text-slate-600">
              All 4 methods are tabs here. Draft list stays on this page. Final questions remain on a separate page.
            </p>
          </div>
          <div className="flex gap-2">
            <Link href={`/collections/${collectionId}`} className="rounded border border-slate-300 bg-white px-3 py-2 text-sm font-semibold text-slate-700">
              View Final Questions
            </Link>
          </div>
        </div>
        <p className="mt-3 rounded bg-slate-50 px-3 py-2 text-xs text-slate-600">
          Final count: <span className="font-semibold">{finalCount ?? "N/A"}</span>
        </p>
      </section>

      <section className="space-y-4 rounded-xl border border-slate-200 bg-white p-4 md:p-6">
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
          {(["gk", "maths", "passage"] as QuizKind[]).map((kind) => (
            <button key={kind} type="button" onClick={() => setQuizKind(kind)} className={`rounded border px-3 py-2 text-sm font-semibold ${quizKind === kind ? "border-slate-900 bg-slate-900 text-white" : "border-slate-300 bg-white text-slate-700"}`}>
              {kind.toUpperCase()}
            </button>
          ))}
        </div>

        <CategorySelector
          quizKind={quizKind}
          selectedCategoryIds={selectedCategoryIds}
          onCategoryIdsChange={setSelectedCategoryIds}
        />

        <p className="rounded border border-sky-200 bg-sky-50 px-3 py-2 text-xs text-sky-800">
          The selected exam and categories above are the active metadata for all four methods in the current quiz type and will be applied when you publish questions.
        </p>

        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          {(["manual", "parse", "ai_generate", "ai_parse"] as TabKey[]).map((key) => (
            <button key={key} type="button" onClick={() => setTab(key)} className={`rounded border px-3 py-2 text-sm font-semibold ${tab === key ? "border-indigo-600 bg-indigo-50 text-indigo-700" : "border-slate-300 bg-white text-slate-700"}`}>
              {key === "manual" ? "Manual" : key === "parse" ? "Parse" : key === "ai_generate" ? "AI Generate" : "AI Parse"}
            </button>
          ))}
        </div>

        {tab === "manual" ? (
          <div className="space-y-3 rounded border border-slate-200 bg-slate-50 p-3">
            <StandardDraftFields
              title="Standard Form: Manual Entry"
              hint="Use the complete posting form fields, then add/update draft."
              quizKind={quizKind}
              form={manualForm}
              onChange={(patch) => setManualForm((prev) => ({ ...prev, ...patch }))}
            />
            <div className="flex items-center justify-between gap-2">
              {editingDraftId ? (
                <button
                  type="button"
                  onClick={() => {
                    setEditingDraftId(null);
                    setManualForm(EMPTY_FORM);
                  }}
                  className="rounded border border-slate-300 bg-white px-3 py-2 text-sm font-semibold text-slate-700"
                >
                  Cancel Edit
                </button>
              ) : (
                <span />
              )}
              <button type="button" onClick={submitManualDraft} className="inline-flex items-center rounded bg-slate-900 px-3 py-2 text-sm font-semibold text-white">
                <Plus className="mr-1.5 h-4 w-4" />
                {editingDraftId ? "Update Draft" : "Add Draft"}
              </button>
            </div>
          </div>
        ) : null}

        {tab === "parse" ? (
          <div className="space-y-3 rounded border border-slate-200 bg-slate-50 p-3">
            <div className="space-y-1">
              <label className="text-xs font-semibold uppercase tracking-wide text-slate-500">Raw parse input</label>
              <textarea rows={8} value={parseInput} onChange={(e) => setParseInput(e.target.value)} className="w-full rounded border border-slate-300 bg-white px-3 py-2 text-sm" placeholder="Paste text blocks or JSON" />
            </div>
            {quizKind === "passage" ? (
              <div className="grid gap-2 md:grid-cols-2">
                <input value={parsePassageTitle} onChange={(e) => setParsePassageTitle(e.target.value)} className="rounded border border-slate-300 bg-white px-3 py-2 text-sm" placeholder="Passage title (used when missing in parsed input)" />
                <input value={parsePassageSource} onChange={(e) => setParsePassageSource(e.target.value)} className="rounded border border-slate-300 bg-white px-3 py-2 text-sm" placeholder="Passage source (used when missing in parsed input)" />
                <textarea rows={3} value={parsePassageText} onChange={(e) => setParsePassageText(e.target.value)} className="md:col-span-2 rounded border border-slate-300 bg-white px-3 py-2 text-sm" placeholder="Passage text (required if parsed input has no passage text)" />
              </div>
            ) : null}
            <div className="space-y-1">
              <label className="text-xs font-semibold uppercase tracking-wide text-slate-500">Desired draft count</label>
              <input type="number" min={1} max={100} value={parseCount} onChange={(e) => setParseCount(e.target.value)} className="w-28 rounded border border-slate-300 bg-white px-3 py-2 text-sm" />
            </div>
            <div className="flex items-center justify-end gap-2">
              <button type="button" onClick={parseToDrafts} className="rounded bg-slate-900 px-3 py-2 text-sm font-semibold text-white">
                Parse To Drafts
              </button>
            </div>
          </div>
        ) : null}

        {tab === "ai_generate" ? (
          <div className="space-y-3 rounded border border-indigo-200 bg-indigo-50 p-3">
            {aiLocked ? <p className="text-xs font-semibold text-amber-700">Active Quiz Master AI subscription required.</p> : null}
            <div className="grid gap-2 md:grid-cols-2">
              <div className="space-y-1">
                <label className="text-xs font-semibold uppercase tracking-wide text-slate-500">Source type</label>
                <select value={aiGenerateSourceType} onChange={(e) => setAiGenerateSourceType(e.target.value as AiSourceType)} className="w-full rounded border border-slate-300 bg-white px-3 py-2 text-sm">
                  <option value="text">Raw Text</option>
                  <option value="url">URL</option>
                  <option value="image">Photo OCR</option>
                  <option value="pdf">Uploaded PDF</option>
                </select>
              </div>
              <label className="inline-flex items-center gap-2 rounded border border-slate-300 bg-white px-3 py-2 text-xs font-semibold text-slate-700 md:mt-6">
                <input type="checkbox" checked={aiGenerateUseCategorySource} onChange={(e) => setAiGenerateUseCategorySource(e.target.checked)} />
                Use Category Source
              </label>
            </div>

            {!aiGenerateUseCategorySource ? (
              <>
                {aiGenerateSourceType === "text" ? (
                  <div className="space-y-1">
                    <label className="text-xs font-semibold uppercase tracking-wide text-slate-500">Topic or prompt</label>
                    <textarea rows={6} value={aiGenerateContent} onChange={(e) => setAiGenerateContent(e.target.value)} className="w-full rounded border border-slate-300 bg-white px-3 py-2 text-sm" placeholder="Topic or prompt" />
                  </div>
                ) : null}

                {aiGenerateSourceType === "url" ? (
                  <div className="space-y-1">
                    <label className="text-xs font-semibold uppercase tracking-wide text-slate-500">Source URL</label>
                    <input value={aiGenerateUrl} onChange={(e) => setAiGenerateUrl(e.target.value)} className="w-full rounded border border-slate-300 bg-white px-3 py-2 text-sm" placeholder="https://..." />
                  </div>
                ) : null}

                {aiGenerateSourceType === "image" ? (
                  <div className="space-y-2 rounded border border-slate-200 bg-white p-3">
                    <div className="flex flex-wrap items-center gap-2">
                      <label className="inline-flex cursor-pointer items-center rounded border border-slate-300 bg-white px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50">
                        Upload Photos
                        <input
                          type="file"
                          accept="image/*"
                          multiple
                          className="hidden"
                          onChange={(event) => {
                            void handleGenerateImageUpload(event.target.files);
                            event.currentTarget.value = "";
                          }}
                          disabled={aiLocked}
                        />
                      </label>
                      <button
                        type="button"
                        onClick={() => void extractGenerateImageText()}
                        className="rounded border border-slate-300 bg-white px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50"
                        disabled={aiLocked || aiGenerateExtracting || aiGenerateImages.length === 0}
                      >
                        {aiGenerateExtracting ? "Extracting..." : "Extract Text"}
                      </button>
                    </div>
                    {aiGenerateImages.length > 0 ? (
                      <div className="space-y-2">
                        {aiGenerateImages.map((image) => (
                          <div key={image.id} className="flex items-center justify-between rounded border border-slate-200 px-3 py-2 text-xs text-slate-700">
                            <span className="truncate">{image.name}</span>
                            <button type="button" onClick={() => removeGenerateImage(image.id)} className="text-rose-700 hover:underline">
                              Remove
                            </button>
                          </div>
                        ))}
                      </div>
                    ) : null}
                    <textarea
                      rows={5}
                      value={aiGenerateOcrText}
                      onChange={(e) => setAiGenerateOcrText(e.target.value)}
                      className="w-full rounded border border-slate-300 bg-white px-3 py-2 text-sm"
                      placeholder="Extracted OCR text will appear here"
                    />
                  </div>
                ) : null}

                {aiGenerateSourceType === "pdf" ? (
                  <div className="space-y-2 rounded border border-slate-200 bg-white p-3">
                    <div className="flex flex-wrap items-center gap-2">
                      <label className="inline-flex cursor-pointer items-center rounded border border-slate-300 bg-white px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50">
                        Upload PDF
                        <input
                          type="file"
                          accept="application/pdf,.pdf"
                          className="hidden"
                          onChange={(event) => {
                            const file = event.target.files?.[0] || null;
                            event.currentTarget.value = "";
                            void handleGeneratePdfUpload(file);
                          }}
                          disabled={uploadingPdf || aiLocked}
                        />
                      </label>
                      <button type="button" onClick={() => void loadUploadedPdfs()} className="rounded border border-slate-300 bg-white px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50" disabled={loadingUploadedPdfs}>
                        {loadingUploadedPdfs ? "Refreshing..." : "Refresh PDFs"}
                      </button>
                    </div>
                    <select value={aiGenerateUploadedPdfId} onChange={(e) => setAiGenerateUploadedPdfId(e.target.value)} className="w-full rounded border border-slate-300 bg-white px-3 py-2 text-sm" disabled={loadingUploadedPdfs || uploadedPdfs.length === 0}>
                      <option value="">{uploadedPdfs.length === 0 ? "No uploaded PDFs found" : "Select uploaded PDF"}</option>
                      {uploadedPdfs.map((pdf) => (
                        <option key={pdf.id} value={String(pdf.id)}>
                          {pdf.filename}
                        </option>
                      ))}
                    </select>
                    {aiGenerateUploadedPdfId ? (
                      <button
                        type="button"
                        onClick={() => void handleDeleteUploadedPdf(Number(aiGenerateUploadedPdfId))}
                        className="rounded border border-rose-300 bg-white px-3 py-2 text-xs font-semibold text-rose-700 hover:bg-rose-50"
                        disabled={deletingPdfId !== null}
                      >
                        {deletingPdfId === Number(aiGenerateUploadedPdfId) ? "Deleting..." : "Delete Selected PDF"}
                      </button>
                    ) : null}
                  </div>
                ) : null}
              </>
            ) : (
              <p className="rounded border border-indigo-200 bg-white px-3 py-2 text-xs text-indigo-700">
                Category source mode enabled. AI will use selected category sources.
              </p>
            )}

            <div className="space-y-1">
              <label className="text-xs font-semibold uppercase tracking-wide text-slate-500">Extra instructions</label>
              <textarea rows={3} value={aiGenerateInstructions} onChange={(e) => setAiGenerateInstructions(e.target.value)} className="w-full rounded border border-slate-300 bg-white px-3 py-2 text-sm" placeholder="Extra instructions" />
            </div>
            <div className="space-y-3 rounded border border-slate-200 bg-white p-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Example format guidance</p>
                  <p className="text-xs text-slate-600">Use saved premium examples or provide your own question samples.</p>
                </div>
                <button
                  type="button"
                  onClick={() => void loadExampleAnalyses()}
                  className="rounded border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50"
                  disabled={loadingExampleAnalyses}
                >
                  {loadingExampleAnalyses ? "Refreshing..." : "Refresh Formats"}
                </button>
              </div>
              <div className="space-y-1">
                <label className="text-xs font-semibold uppercase tracking-wide text-slate-500">Saved example format</label>
                <select
                  value={aiGenerateExampleAnalysisId}
                  onChange={(e) => setAiGenerateExampleAnalysisId(e.target.value)}
                  className="w-full rounded border border-slate-300 bg-white px-3 py-2 text-sm"
                  disabled={loadingExampleAnalyses}
                >
                  <option value="">Standard UPSC style</option>
                  {exampleAnalyses.map((item) => (
                    <option key={item.id} value={String(item.id)}>
                      {item.title}
                      {item.tag_level1 || item.tag_level2 ? ` (${[item.tag_level1, item.tag_level2].filter(Boolean).join(" / ")})` : ""}
                    </option>
                  ))}
                </select>
              </div>
              {aiGenerateSelectedAnalysis ? (
                <div className="rounded border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-700">
                  <span className="font-semibold">{aiGenerateSelectedAnalysis.title}</span>
                  {aiGenerateSelectedAnalysis.description ? `: ${aiGenerateSelectedAnalysis.description}` : ""}
                </div>
              ) : null}
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-xs text-slate-600">Apply saved examples to the custom example box, then edit if needed.</p>
                <button
                  type="button"
                  onClick={applySelectedExampleAnalysis}
                  className="rounded border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-60"
                  disabled={!aiGenerateSelectedAnalysis}
                >
                  Apply Saved Example
                </button>
              </div>
              <input
                value={aiGenerateExampleQuestion}
                onChange={(e) => setAiGenerateExampleQuestion(e.target.value)}
                className="w-full rounded border border-slate-300 bg-white px-3 py-2 text-sm"
                placeholder="Single example question (optional)"
              />
              <textarea
                rows={4}
                value={aiGenerateExampleQuestions}
                onChange={(e) => setAiGenerateExampleQuestions(e.target.value)}
                className="w-full rounded border border-slate-300 bg-white px-3 py-2 text-sm"
                placeholder="Example questions or format samples. Separate multiple examples with blank lines."
              />
            </div>
            <div className="grid gap-2 md:grid-cols-2">
              <input type="number" min={1} max={100} value={aiGenerateCount} onChange={(e) => setAiGenerateCount(e.target.value)} className="rounded border border-slate-300 bg-white px-3 py-2 text-sm" />
              <select value={outputLanguage} onChange={(e) => setOutputLanguage(persistOutputLanguage(e.target.value))} className="rounded border border-slate-300 bg-white px-3 py-2 text-sm">
                {OUTPUT_LANGUAGE_OPTIONS.map((opt) => <option key={opt.value} value={opt.value}>{opt.label}</option>)}
              </select>
            </div>
            <p className="text-xs text-slate-600">
              Generated drafts use the standard quiz schema. For full studio controls, open
              {" "}
              <Link href={`/quiz-master/ai-quiz/${quizKind}?collection_id=${collectionId}&bind_test=1`} className="font-semibold text-indigo-700 hover:underline">
                standard AI Quiz Generator
              </Link>.
            </p>
            <div className="flex items-center justify-end gap-2">
              <button type="button" onClick={() => void runAiTab("ai_generate")} disabled={working || aiLocked} className="inline-flex items-center rounded bg-indigo-700 px-3 py-2 text-sm font-semibold text-white disabled:opacity-60">
                {working ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <Sparkles className="mr-1.5 h-4 w-4" />}
                Generate Drafts
              </button>
            </div>
          </div>
        ) : null}

        {tab === "ai_parse" ? (
          <div className="space-y-3 rounded border border-indigo-200 bg-indigo-50 p-3">
            {aiLocked ? <p className="text-xs font-semibold text-amber-700">Active Quiz Master AI subscription required.</p> : null}
            <p className="text-xs text-slate-600">
              Paste as many questions as you want in one box. This uses the same premium AI parsing route used in the older UPSC app flow and auto-detects the batch size from your content.
            </p>
            <div className="space-y-1">
              <label className="text-xs font-semibold uppercase tracking-wide text-slate-500">Raw content</label>
              <textarea
                rows={12}
                value={aiParseContent}
                onChange={(e) => setAiParseContent(e.target.value)}
                className="w-full rounded border border-slate-300 bg-white px-3 py-2 text-sm"
                placeholder="Paste question blocks here. AI will identify individual questions, options, answers, explanations, and passage content when present."
              />
            </div>
            <div className="flex items-center justify-end gap-2">
              <button type="button" onClick={() => void runAiTab("ai_parse")} disabled={working || aiLocked} className="inline-flex items-center rounded bg-indigo-700 px-3 py-2 text-sm font-semibold text-white disabled:opacity-60">
                {working ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <Sparkles className="mr-1.5 h-4 w-4" />}
                Parse With AI
              </button>
            </div>
          </div>
        ) : null}
      </section>

      <section className="space-y-3 rounded-xl border border-slate-200 bg-white p-4 md:p-6">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-lg font-semibold text-slate-900">Draft Questions ({selectedDraftCount}/{drafts.length})</h2>
          <div className="flex flex-wrap gap-2">
            <button type="button" onClick={() => setDrafts((prev) => prev.map((row) => ({ ...row, selected: true })))} className="rounded border border-slate-300 bg-white px-2.5 py-1.5 text-xs">Select All</button>
            <button type="button" onClick={() => setDrafts((prev) => prev.map((row) => ({ ...row, selected: false })))} className="rounded border border-slate-300 bg-white px-2.5 py-1.5 text-xs">Unselect All</button>
            <button type="button" onClick={() => setDrafts((prev) => prev.filter((row) => !row.selected))} className="rounded border border-rose-300 bg-white px-2.5 py-1.5 text-xs text-rose-700">Remove Selected</button>
            <button type="button" onClick={() => void publishDrafts("selected")} disabled={selectedDraftCount === 0 || working} className="rounded border border-emerald-300 bg-white px-2.5 py-1.5 text-xs text-emerald-700 disabled:opacity-50">Publish Selected</button>
            <button type="button" onClick={() => void publishDrafts("all")} disabled={drafts.length === 0 || working} className="rounded bg-slate-900 px-2.5 py-1.5 text-xs font-semibold text-white disabled:opacity-50">{working ? "Publishing..." : "Publish All"}</button>
          </div>
        </div>

        {drafts.length === 0 ? (
          <p className="rounded border border-dashed border-slate-300 bg-slate-50 px-3 py-8 text-center text-sm text-slate-500">No drafts yet.</p>
        ) : (
          <div className="space-y-2">
            {drafts.map((row) => (
              <article key={row.local_id} className="rounded border border-slate-200 bg-slate-50 p-3">
                <div className="flex items-start justify-between gap-3">
                  <label className="flex min-w-0 items-start gap-2">
                    <input type="checkbox" checked={row.selected} onChange={() => setDrafts((prev) => prev.map((item) => item.local_id === row.local_id ? { ...item, selected: !item.selected } : item))} className="mt-1" />
                    <div className="min-w-0">
                      <p className="truncate text-sm font-semibold text-slate-900">{row.question_statement}</p>
                      <div className="mt-1 flex flex-wrap gap-1 text-[11px]">
                        <span className="rounded bg-slate-200 px-1.5 py-0.5 font-semibold text-slate-700">{row.quiz_kind.toUpperCase()}</span>
                        <span className="rounded bg-indigo-100 px-1.5 py-0.5 font-semibold text-indigo-700">{SOURCE_LABEL[row.source_method]}</span>
                      </div>
                    </div>
                  </label>
                  <div className="flex gap-1">
                    <button
                      type="button"
                      onClick={() => {
                        setTab("manual");
                        setQuizKind(row.quiz_kind);
                        if (selectedCategoryIds.length === 0 && row.category_ids.length > 0) {
                          setSelectedCategoryIds([...row.category_ids]);
                        }
                        setManualForm({ ...row });
                        setEditingDraftId(row.local_id);
                      }}
                      className="inline-flex items-center rounded border border-slate-300 bg-white px-2 py-1 text-xs"
                    >
                      <Edit3 className="mr-1 h-3.5 w-3.5" />
                      Edit
                    </button>
                    <button type="button" onClick={() => setDrafts((prev) => prev.filter((item) => item.local_id !== row.local_id))} className="inline-flex items-center rounded border border-rose-300 bg-white px-2 py-1 text-xs text-rose-700">
                      <Trash2 className="mr-1 h-3.5 w-3.5" />
                      Delete
                    </button>
                  </div>
                </div>
              </article>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
