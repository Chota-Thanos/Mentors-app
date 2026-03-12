"use client";

import { type ChangeEvent, useCallback, useEffect, useMemo, useState } from "react";
import Image from "next/image";
import { useRouter } from "next/navigation";
import axios from "axios";
import { ArrowDown, ArrowUp, Download, FileText, Loader2, Plus, RefreshCcw, Sparkles, Trash2, UploadCloud, Wand2 } from "lucide-react";
import { toast } from "sonner";

import { legacyPremiumAiApi } from "@/lib/legacyPremiumAiApi";
import { premiumApi } from "@/lib/premiumApi";
import { OUTPUT_LANGUAGE_OPTIONS, persistOutputLanguage, readOutputLanguage, type OutputLanguage } from "@/lib/outputLanguage";
import { createClient } from "@/lib/supabase/client";
import type {
  AIProvider,
  PremiumAIContentType,
  PremiumAIExampleAnalysis,
  PremiumAIExampleAnalysisListResponse,
  ConvertDraftToPremiumQuizResponse,
  PremiumAIDraftQuiz,
  PremiumAIQuizInstruction,
  PremiumPreviewResponse,
  QuizKind,
  UploadedPDF,
} from "@/types/premium";

const CONTENT_TYPE_MAP: Record<QuizKind, PremiumAIContentType> = {
  gk: "premium_gk_quiz",
  maths: "premium_maths_quiz",
  passage: "premium_passage_quiz",
};

const MODELS: Record<AIProvider, string[]> = {
  gemini: ["gemini-3-flash-preview", "gemini-2.5-flash", "gemini-2.5-pro"],
  openai: ["gpt-4o", "gpt-4o-mini"],
  perplexity: ["sonar-pro", "sonar"],
};

function toError(error: unknown): string {
  if (axios.isAxiosError(error)) {
    if (typeof error.response?.data?.detail === "string") return error.response.data.detail;
    return error.message;
  }
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

function normalizeQuestionStatements(question: Record<string, unknown>): string[] {
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

type OptionShape = { label: string; text: string; is_correct?: boolean };
type OcrImageFile = {
  id: string;
  name: string;
  preview: string;
  base64: string;
};

function normalizeOptions(raw: unknown, correctAnswer?: string | null): OptionShape[] {
  const desired = (correctAnswer || "").toUpperCase();

  if (Array.isArray(raw)) {
    const normalized: OptionShape[] = raw.map((opt, idx) => {
      const fallbackLabel = String.fromCharCode(65 + idx);
      if (typeof opt === "string") {
        return { label: fallbackLabel, text: opt, is_correct: desired === fallbackLabel };
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

function resolveCorrectAnswer(raw: Record<string, unknown>, fallback = "A"): string {
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

export default function AIStudio() {
  const router = useRouter();
  const [quizKind, setQuizKind] = useState<QuizKind>("gk");
  const [provider, setProvider] = useState<AIProvider>("gemini");
  const [model, setModel] = useState(MODELS.gemini[0]);

  const [instructions, setInstructions] = useState<PremiumAIQuizInstruction[]>([]);
  const [selectedInstructionId, setSelectedInstructionId] = useState("");

  const [analyses, setAnalyses] = useState<PremiumAIExampleAnalysis[]>([]);
  const [selectedAnalysisId, setSelectedAnalysisId] = useState("");
  const [analysisTagL1Filter, setAnalysisTagL1Filter] = useState("");
  const [analysisTagL2Filter, setAnalysisTagL2Filter] = useState("");

  const [contentSourceType, setContentSourceType] = useState<"text" | "url" | "pdf" | "image">("text");
  const [contentText, setContentText] = useState("");
  const [contentUrl, setContentUrl] = useState("");
  const [ocrImages, setOcrImages] = useState<OcrImageFile[]>([]);
  const [ocrExtractedText, setOcrExtractedText] = useState("");
  const [extractingImageText, setExtractingImageText] = useState(false);
  const [uploadedPdfs, setUploadedPdfs] = useState<UploadedPDF[]>([]);
  const [selectedUploadedPdfId, setSelectedUploadedPdfId] = useState("");
  const [loadingUploadedPdfs, setLoadingUploadedPdfs] = useState(false);
  const [uploadingPdf, setUploadingPdf] = useState(false);
  const [deletingPdfId, setDeletingPdfId] = useState<number | null>(null);
  const [ocrOnUpload, setOcrOnUpload] = useState(true);
  const [additionalInstructions, setAdditionalInstructions] = useState("");
  const [exampleQuestion, setExampleQuestion] = useState("");
  const [exampleQuestionsInput, setExampleQuestionsInput] = useState("");
  const [desiredQuestionCount, setDesiredQuestionCount] = useState("5");
  const [useCategorySource, setUseCategorySource] = useState(false);
  const [outputLanguage, setOutputLanguage] = useState<OutputLanguage>("en");

  const [showAnalysisEditor, setShowAnalysisEditor] = useState(false);
  const [analysisTitle, setAnalysisTitle] = useState("");
  const [analysisDescription, setAnalysisDescription] = useState("");
  const [analysisTagLevel1, setAnalysisTagLevel1] = useState("");
  const [analysisTagLevel2, setAnalysisTagLevel2] = useState("");
  const [analysisTags, setAnalysisTags] = useState("");
  const [analysisStyleProfile, setAnalysisStyleProfile] = useState('{\n  "style_instructions": ""\n}');
  const [analysisExampleQuestions, setAnalysisExampleQuestions] = useState("");

  const [loading, setLoading] = useState(false);
  const [savingAnalysis, setSavingAnalysis] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [savingDraft, setSavingDraft] = useState(false);
  const [sendingToFinal, setSendingToFinal] = useState(false);
  const [isGeneratingPdf, setIsGeneratingPdf] = useState(false);

  const [result, setResult] = useState<Record<string, unknown> | null>(null);
  const [recentQuestions, setRecentQuestions] = useState<string[]>([]);
  const [selectedExamId, setSelectedExamId] = useState("");
  const [selectedCategoryIdsCsv, setSelectedCategoryIdsCsv] = useState("");
  const [draftNotes, setDraftNotes] = useState("");
  const [lastDraftId, setLastDraftId] = useState<number | null>(null);

  const selectedContentType = CONTENT_TYPE_MAP[quizKind];

  useEffect(() => {
    setOutputLanguage(readOutputLanguage());
  }, []);

  const selectedInstruction = useMemo(
    () => instructions.find((item) => String(item.id) === selectedInstructionId) || null,
    [instructions, selectedInstructionId],
  );
  const selectedAnalysis = useMemo(
    () => analyses.find((item) => String(item.id) === selectedAnalysisId) || null,
    [analyses, selectedAnalysisId],
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

  const loadInstructions = useCallback(async () => {
    const response = await legacyPremiumAiApi.get<PremiumAIQuizInstruction[]>("/admin/premium-ai-settings/");
    const current = (response.data || []).filter((item) => item.content_type === selectedContentType);
    setInstructions(current);
    if (current.length > 0 && !current.some((item) => String(item.id) === selectedInstructionId)) {
      setSelectedInstructionId(String(current[0].id));
    }
  }, [selectedContentType, selectedInstructionId]);

  const loadAnalyses = useCallback(async () => {
    const params = new URLSearchParams();
    params.set("content_type", selectedContentType);
    params.set("include_admin", "true");
    const response = await legacyPremiumAiApi.get<PremiumAIExampleAnalysisListResponse>(
      `/premium-ai-quizzes/example-analyses?${params.toString()}`,
    );
    setAnalyses(response.data?.items || []);
    if (response.data?.items?.length && !response.data.items.some((item) => String(item.id) === selectedAnalysisId)) {
      setSelectedAnalysisId(String(response.data.items[0].id));
    }
  }, [selectedContentType, selectedAnalysisId]);

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
      await Promise.all([loadInstructions(), loadAnalyses()]);
    } catch (error: unknown) {
      toast.error("Failed to load premium AI settings", { description: toError(error) });
    } finally {
      setLoading(false);
    }
  }, [loadInstructions, loadAnalyses]);

  useEffect(() => {
    loadAll();
  }, [loadAll]);

  useEffect(() => {
    if (contentSourceType !== "pdf") return;
    loadUploadedPdfs();
  }, [contentSourceType, loadUploadedPdfs]);

  useEffect(() => {
    const nextModel = MODELS[provider][0] || "";
    if (!MODELS[provider].includes(model)) setModel(nextModel);
  }, [provider, model]);

  const applySelectedAnalysisToForm = () => {
    if (!selectedAnalysis) return;
    if ((selectedAnalysis.example_questions || []).length > 0) {
      setExampleQuestionsInput(selectedAnalysis.example_questions.join("\n"));
    }
    toast.success("Example analysis applied to formatting guidance.");
  };

  const setAnalysisEditorFromSelection = () => {
    if (!selectedAnalysis) return;
    setShowAnalysisEditor(true);
    setAnalysisTitle(selectedAnalysis.title || "");
    setAnalysisDescription(selectedAnalysis.description || "");
    setAnalysisTagLevel1(selectedAnalysis.tag_level1 || "");
    setAnalysisTagLevel2(selectedAnalysis.tag_level2 || "");
    setAnalysisTags((selectedAnalysis.tags || []).join(", "));
    setAnalysisStyleProfile(JSON.stringify(selectedAnalysis.style_profile || {}, null, 2));
    setAnalysisExampleQuestions((selectedAnalysis.example_questions || []).join("\n"));
  };

  const clearAnalysisEditor = () => {
    setAnalysisTitle("");
    setAnalysisDescription("");
    setAnalysisTagLevel1("");
    setAnalysisTagLevel2("");
    setAnalysisTags("");
    setAnalysisStyleProfile('{\n  "style_instructions": ""\n}');
    setAnalysisExampleQuestions("");
  };

  const saveAnalysis = async () => {
    let parsedStyleProfile: Record<string, unknown>;
    try {
      parsedStyleProfile = analysisStyleProfile.trim() ? JSON.parse(analysisStyleProfile) : {};
    } catch {
      toast.error("Invalid style_profile JSON.");
      return;
    }
    if (!analysisTitle.trim()) {
      toast.error("Analysis title is required.");
      return;
    }
    if (analysisTagLevel2.trim() && !analysisTagLevel1.trim()) {
      toast.error("Tag level 1 is required when tag level 2 is set.");
      return;
    }

    setSavingAnalysis(true);
    try {
      const payload = {
        title: analysisTitle.trim(),
        description: analysisDescription.trim() || null,
        tag_level1: analysisTagLevel1.trim().toLowerCase() || null,
        tag_level2: analysisTagLevel2.trim().toLowerCase() || null,
        content_type: selectedContentType,
        style_profile: parsedStyleProfile,
        example_questions: parseExampleLines(analysisExampleQuestions),
        tags: parseLines(analysisTags.replaceAll(",", "\n")).map((item) => item.toLowerCase()),
        is_active: true,
      };

      if (selectedAnalysisId && selectedAnalysis) {
        await legacyPremiumAiApi.put(`/premium-ai-quizzes/example-analyses/${selectedAnalysis.id}`, payload);
        toast.success("Example analysis updated.");
      } else {
        const created = await legacyPremiumAiApi.post<PremiumAIExampleAnalysis>("/premium-ai-quizzes/example-analyses", payload);
        toast.success("Example analysis created.");
        setSelectedAnalysisId(String(created.data.id));
      }

      await loadAnalyses();
      clearAnalysisEditor();
      setShowAnalysisEditor(false);
    } catch (error: unknown) {
      toast.error("Failed to save analysis.", { description: toError(error) });
    } finally {
      setSavingAnalysis(false);
    }
  };

  const deleteSelectedAnalysis = async () => {
    if (!selectedAnalysis) return;
    if (!window.confirm(`Delete analysis \"${selectedAnalysis.title}\"?`)) return;
    try {
      await legacyPremiumAiApi.delete(`/premium-ai-quizzes/example-analyses/${selectedAnalysis.id}`);
      toast.success("Example analysis deleted.");
      setSelectedAnalysisId("");
      await loadAnalyses();
    } catch (error: unknown) {
      toast.error("Failed to delete analysis.", { description: toError(error) });
    }
  };

  const handlePdfUpload = useCallback(async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
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
      toast.error("PDF upload failed.", { description: toError(error) });
    } finally {
      setUploadingPdf(false);
    }
  }, [loadUploadedPdfs, ocrOnUpload]);

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
      toast.error("Failed to delete PDF.", { description: toError(error) });
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
    if (ocrImages.length === 0) {
      toast.error("Add photo(s) first.");
      return;
    }

    setExtractingImageText(true);
    try {
      const response = await premiumApi.post<{ extracted_text: string }>("/ai-evaluation/ocr", {
        images_base64: ocrImages.map((file) => file.base64),
        ai_provider: provider,
        ai_model_name: model,
      });
      const extracted = String(response.data?.extracted_text || "").trim();
      if (!extracted) {
        toast.error("No text was extracted from uploaded photos.");
        return;
      }
      setOcrExtractedText(extracted);
      toast.success(`Text extracted from ${ocrImages.length} image(s).`);
    } catch (error: unknown) {
      toast.error("Image OCR failed.", { description: toError(error) });
    } finally {
      setExtractingImageText(false);
    }
  }, [model, ocrImages, provider]);

  const generatePreview = async () => {
    const categoryIds = parseCategoryIds(selectedCategoryIdsCsv);
    const content = contentSourceType === "text"
      ? contentText.trim()
      : contentSourceType === "image"
        ? ocrExtractedText.trim()
        : "";
    const url = contentSourceType === "url" ? contentUrl.trim() : "";
    const uploadedPdfId = contentSourceType === "pdf" ? Number(selectedUploadedPdfId) : NaN;
    const normalizedUploadedPdfId = Number.isFinite(uploadedPdfId) && uploadedPdfId > 0 ? uploadedPdfId : undefined;
    if (useCategorySource && categoryIds.length === 0) {
      toast.error("Select at least one category in category source mode.");
      return;
    }
    if (!useCategorySource && !content && !url && !normalizedUploadedPdfId) {
      toast.error("Provide source content (text, URL, photo OCR, or uploaded PDF).");
      return;
    }

    setGenerating(true);
    setResult(null);
    try {
      const styleInstruction = String(selectedAnalysis?.style_profile?.style_instructions || "").trim();
      const mergedInstructions = [additionalInstructions.trim()].filter(Boolean).join("\n\n");
      const payload = {
        content: useCategorySource ? undefined : (content || undefined),
        uploaded_pdf_id: useCategorySource ? undefined : normalizedUploadedPdfId,
        url: useCategorySource ? undefined : (url || undefined),
        content_type: selectedContentType,
        ai_instruction_id: selectedInstructionId ? Number(selectedInstructionId) : undefined,
        example_analysis_id: selectedAnalysisId ? Number(selectedAnalysisId) : undefined,
        ai_provider: provider,
        ai_model_name: model,
        category_ids: categoryIds.length > 0 ? categoryIds : undefined,
        use_category_source: useCategorySource,
        user_instructions: mergedInstructions || undefined,
        formatting_instruction_text: styleInstruction || undefined,
        example_question: exampleQuestion.trim() || undefined,
        example_questions: parseExampleLines(exampleQuestionsInput),
        recent_questions: recentQuestions.slice(-10),
        desired_question_count: Math.max(1, Math.min(100, Number(desiredQuestionCount || "5") || 5)),
        output_language: outputLanguage,
      };

      const response = await legacyPremiumAiApi.post<PremiumPreviewResponse>(`/premium-ai-quizzes/preview/${quizKind}`, payload);
      setResult(response.data.parsed_quiz_data || null);

      if (quizKind === "passage") {
        const questions = Array.isArray(response.data.parsed_quiz_data?.questions)
          ? (response.data.parsed_quiz_data.questions as Record<string, unknown>[])
          : [];
        const newQuestions = questions.map((item) => String(item.question_statement || item.question || "")).filter(Boolean);
        setRecentQuestions((prev) => [...prev, ...newQuestions].slice(-30));
      } else {
        const parsedQuestions = Array.isArray(response.data.parsed_quiz_data?.questions)
          ? (response.data.parsed_quiz_data.questions as Record<string, unknown>[])
          : [];
        if (parsedQuestions.length > 0) {
          const statements = parsedQuestions.map((item) => String(item.question_statement || item.question || "").trim()).filter(Boolean);
          if (statements.length > 0) {
            setRecentQuestions((prev) => [...prev, ...statements].slice(-30));
          }
        } else {
          const statement = String(response.data.parsed_quiz_data?.question_statement || response.data.parsed_quiz_data?.question || "").trim();
          if (statement) setRecentQuestions((prev) => [...prev, statement].slice(-30));
        }
      }

      toast.success("Preview generated.");
    } catch (error: unknown) {
      toast.error("Generation failed.", { description: toError(error) });
    } finally {
      setGenerating(false);
    }
  };

  function parseCategoryIds(value: string): number[] {
    return value
      .split(",")
      .map((item) => Number(item.trim()))
      .filter((id) => Number.isFinite(id) && id > 0);
  }

  const saveDraft = async (): Promise<PremiumAIDraftQuiz | null> => {
    if (!result) {
      toast.error("Generate a preview first.");
      return null;
    }

    const categoryIds = parseCategoryIds(selectedCategoryIdsCsv);
    const examIdParsed = Number(selectedExamId);

    setSavingDraft(true);
    try {
      const payload = {
        parsed_quiz_data: result,
        category_ids: categoryIds,
        exam_id: Number.isFinite(examIdParsed) && examIdParsed > 0 ? examIdParsed : null,
        ai_instruction_id: selectedInstructionId ? Number(selectedInstructionId) : null,
        source_url: contentSourceType === "url" ? (contentUrl.trim() || null) : null,
        source_pdf_id: contentSourceType === "pdf" ? (Number(selectedUploadedPdfId) || null) : null,
        notes: draftNotes.trim() || null,
      };
      const response = await legacyPremiumAiApi.post<PremiumAIDraftQuiz>(`/premium-ai-quizzes/save-draft/${quizKind}`, payload);
      const draft = response.data;
      setLastDraftId(draft.id);
      toast.success(`Saved draft #${draft.id}`);
      return draft;
    } catch (error: unknown) {
      toast.error("Failed to save draft.", { description: toError(error) });
      return null;
    } finally {
      setSavingDraft(false);
    }
  };

  const saveAndSendToFinal = async () => {
    const draft = await saveDraft();
    if (!draft) return;

    setSendingToFinal(true);
    try {
      const response = await legacyPremiumAiApi.post<ConvertDraftToPremiumQuizResponse>(
        "/premium-ai-quizzes/convert-draft-to-premium-quiz",
        { draft_quiz_id: draft.id },
      );
      toast.success(response.data.message || "Converted to premium quiz.");
      router.push(`/content/${response.data.new_quiz_id}`);
    } catch (error: unknown) {
      toast.error("Draft conversion failed.", { description: toError(error) });
    } finally {
      setSendingToFinal(false);
    }
  };

  const createPdf = async () => {
    if (!result) {
      toast.error("Generate preview first.");
      return;
    }
    setIsGeneratingPdf(true);
    try {
      const raw = result as unknown;
      let items: unknown[] = [];
      if (quizKind === "passage") {
        if (Array.isArray(raw)) items = raw;
        else if (raw && typeof raw === "object" && Array.isArray((raw as Record<string, unknown>).passages)) {
          items = (raw as Record<string, unknown>).passages as unknown[];
        } else {
          items = [raw];
        }
      } else if (raw && typeof raw === "object" && Array.isArray((raw as Record<string, unknown>).questions)) {
        items = (raw as Record<string, unknown>).questions as unknown[];
      } else if (Array.isArray(raw)) {
        items = raw;
      } else {
        items = [raw];
      }

      const title = `AI ${quizKind.toUpperCase()} Quiz`;
      const response = await premiumApi.post("/generate-pdf", {
        title,
        items,
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
  };

  const resultView = (() => {
    if (!result) return <p className="text-sm text-slate-500">No generated output yet.</p>;

    if (quizKind === "passage") {
      const questions = Array.isArray(result.questions) ? (result.questions as Record<string, unknown>[]) : [];
      return (
        <div className="space-y-3">
          <div className="rounded-md border border-slate-200 bg-slate-50 p-3">
            <p className="text-xs text-slate-500">Passage Title</p>
            <p className="text-sm font-semibold text-slate-900">{String(result.passage_title || "Untitled Passage")}</p>
            <p className="mt-2 whitespace-pre-wrap text-sm text-slate-700">{String(result.passage_text || "")}</p>
            {result.source_reference ? <p className="mt-2 text-xs text-slate-500">Source: {String(result.source_reference)}</p> : null}
          </div>
          {questions.map((question, idx) => {
            const correctAnswer = resolveCorrectAnswer(question);
            const options = normalizeOptions(question.options, correctAnswer);
            const statements = normalizeQuestionStatements(question);
            let questionText = String(question.question_statement || question.question || "").trim();
            let promptText = String(question.question_prompt || question.prompt || "").trim();
            if (statements.length > 0 && /\bstatement\s*(?:\d+|[ivxlcdm]+)\b/i.test(questionText)) {
              const split = splitStatementStructure(questionText);
              if (split.lead) questionText = split.lead;
              else questionText = "Consider the following statements:";
              if (!promptText && split.prompt) promptText = split.prompt;
            }
            if (statements.length > 0) {
              if (questionText && promptText && looksLikePromptText(questionText) && !looksLikePromptText(promptText)) {
                const originalQuestionText = questionText;
                questionText = promptText;
                promptText = originalQuestionText;
              }
              if (questionText && looksLikePromptText(questionText)) {
                if (!promptText) promptText = questionText;
                questionText = "Consider the following statements:";
              } else if (!questionText) {
                if (promptText && !looksLikePromptText(promptText)) {
                  questionText = promptText;
                  promptText = "";
                } else {
                  questionText = "Consider the following statements:";
                }
              }
            }
            return (
              <div key={idx} className="rounded-md border border-slate-200 p-3">
                <p className="text-sm font-semibold text-slate-900">Q{idx + 1}. {questionText}</p>
                {(question.supp_question_statement || question.supplementary_statement) ? (
                  <p className="mt-1 text-sm text-slate-600">{String(question.supp_question_statement || question.supplementary_statement)}</p>
                ) : null}
                {statements.length > 0 ? (
                  <ul className="mt-2 list-disc pl-5 text-sm text-slate-700">
                    {statements.map((fact, factIndex) => <li key={factIndex}>{fact}</li>)}
                  </ul>
                ) : null}
                {promptText ? <p className="mt-2 text-sm italic text-slate-700">{promptText}</p> : null}
                <div className="mt-2 space-y-1">
                  {options.map((option) => (
                    <p key={option.label} className={`text-sm ${option.is_correct ? "font-semibold text-green-700" : "text-slate-700"}`}>
                      {option.label}. {option.text}
                    </p>
                  ))}
                </div>
                <p className="mt-2 text-xs text-slate-500">Correct Answer: {correctAnswer || "-"}</p>
                {question.explanation ? <p className="mt-2 whitespace-pre-wrap text-sm text-slate-700">{String(question.explanation)}</p> : null}
              </div>
            );
          })}
        </div>
      );
    }

    const correctAnswer = resolveCorrectAnswer(result);
    const options = normalizeOptions(result.options, correctAnswer);
    const statements = normalizeQuestionStatements(result);
    let questionText = String(result.question_statement || result.question || "").trim();
    let promptText = String(result.question_prompt || result.prompt || "").trim();
    if (statements.length > 0 && /\bstatement\s*(?:\d+|[ivxlcdm]+)\b/i.test(questionText)) {
      const split = splitStatementStructure(questionText);
      if (split.lead) questionText = split.lead;
      else questionText = "Consider the following statements:";
      if (!promptText && split.prompt) promptText = split.prompt;
    }
    if (statements.length > 0) {
      if (questionText && promptText && looksLikePromptText(questionText) && !looksLikePromptText(promptText)) {
        const originalQuestionText = questionText;
        questionText = promptText;
        promptText = originalQuestionText;
      }
      if (questionText && looksLikePromptText(questionText)) {
        if (!promptText) promptText = questionText;
        questionText = "Consider the following statements:";
      } else if (!questionText) {
        if (promptText && !looksLikePromptText(promptText)) {
          questionText = promptText;
          promptText = "";
        } else {
          questionText = "Consider the following statements:";
        }
      }
    }
    return (
      <div className="rounded-md border border-slate-200 p-3">
        <p className="text-sm font-semibold text-slate-900">{questionText}</p>
        {(result.supp_question_statement || result.supplementary_statement) ? <p className="mt-1 text-sm text-slate-600">{String(result.supp_question_statement || result.supplementary_statement)}</p> : null}
        {statements.length > 0 ? (
          <ul className="mt-2 list-disc pl-5 text-sm text-slate-700">
            {statements.map((fact, idx) => <li key={idx}>{fact}</li>)}
          </ul>
        ) : null}
        {promptText ? <p className="mt-2 text-sm italic text-slate-700">{promptText}</p> : null}
        <div className="mt-2 space-y-1">
          {options.map((option) => (
            <p key={option.label} className={`text-sm ${option.is_correct ? "font-semibold text-green-700" : "text-slate-700"}`}>
              {option.label}. {option.text}
            </p>
          ))}
        </div>
        <p className="mt-2 text-xs text-slate-500">Correct Answer: {correctAnswer || "-"}</p>
        {(result.explanation || result.explanation_text) ? (
          <p className="mt-2 whitespace-pre-wrap text-sm text-slate-700">{String(result.explanation || result.explanation_text)}</p>
        ) : null}
        {result.source_reference ? <p className="mt-2 text-xs text-slate-500">Source: {String(result.source_reference)}</p> : null}
      </div>
    );
  })();

  return (
    <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
      <section className="space-y-4 rounded-md border bg-white p-5">
        <div className="flex items-center gap-2">
          <Sparkles className="h-5 w-5 text-amber-500" />
          <h2 className="text-lg font-bold text-slate-900">Premium AI Quiz Generator</h2>
        </div>

        <div className="rounded-md border border-slate-200 bg-slate-50 p-3 text-xs text-slate-600">
          <p className="font-semibold text-slate-800">How to generate</p>
          <p className="mt-1">1. Select quiz type and instruction set.</p>
          <p>2. Optionally apply example analysis format.</p>
          <p>3. Provide source text/URL/photo OCR/uploaded PDF and generate preview.</p>
        </div>

        <div className="grid gap-2 sm:grid-cols-3">
          {(["gk", "maths", "passage"] as QuizKind[]).map((kind) => (
            <button
              key={kind}
              type="button"
              onClick={() => setQuizKind(kind)}
              className={`rounded-md px-3 py-2 text-sm font-semibold ${quizKind === kind ? "bg-slate-900 text-white" : "border border-slate-300 text-slate-700"}`}
            >
              {kind.toUpperCase()}
            </button>
          ))}
        </div>

        <div className="grid gap-3 md:grid-cols-2">
          <select className="rounded-md border border-slate-300 bg-white px-3 py-2 text-sm" value={provider} onChange={(event) => setProvider(event.target.value as AIProvider)}>
            <option value="gemini">gemini</option>
            <option value="openai">openai</option>
            <option value="perplexity">perplexity</option>
          </select>
          <select className="rounded-md border border-slate-300 bg-white px-3 py-2 text-sm" value={model} onChange={(event) => setModel(event.target.value)}>
            {MODELS[provider].map((name) => <option key={name} value={name}>{name}</option>)}
          </select>
        </div>

        {loading ? <p className="flex items-center gap-2 text-sm text-slate-500"><Loader2 className="h-4 w-4 animate-spin" />Loading...</p> : null}

        <div>
          <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-500">AI Instruction Set</p>
          <select className="rounded-md border border-slate-300 bg-white w-full px-3 py-2 text-sm" value={selectedInstructionId} onChange={(event) => setSelectedInstructionId(event.target.value)}>
            <option value="">Auto</option>
            {instructions.map((item) => <option key={item.id} value={String(item.id)}>{item.content_type} (ID: {item.id})</option>)}
          </select>
        </div>

        <div className="rounded-md border border-slate-200 bg-slate-50 p-3">
          <div className="mb-2 flex items-center justify-between">
            <p className="text-sm font-semibold text-slate-800">Example Analysis Library</p>
            <button type="button" className="text-xs text-slate-700" onClick={() => setShowAnalysisEditor((prev) => !prev)}>
              <Plus className="mr-1 inline-block h-3 w-3" /> {showAnalysisEditor ? "Hide" : "Create / Edit"}
            </button>
          </div>
          <div className="grid gap-2 md:grid-cols-2">
            <select className="rounded-md border border-slate-300 bg-white px-3 py-2 text-sm" value={analysisTagL1Filter} onChange={(event) => { setAnalysisTagL1Filter(event.target.value); setAnalysisTagL2Filter(""); }}>
              <option value="">All L1 tags</option>
              {analysisTagHierarchy.level1.map((tag) => <option key={tag} value={tag}>{tag}</option>)}
            </select>
            <select className="rounded-md border border-slate-300 bg-white px-3 py-2 text-sm" value={analysisTagL2Filter} onChange={(event) => setAnalysisTagL2Filter(event.target.value)} disabled={!analysisTagL1Filter}>
              <option value="">All L2 tags</option>
              {analysisTagL1Filter && Array.from(analysisTagHierarchy.level2ByLevel1.get(normalizeTag(analysisTagL1Filter)) || []).map((tag) => (
                <option key={tag} value={tag}>{tag}</option>
              ))}
            </select>
          </div>
          <div className="mt-2 grid gap-2 md:grid-cols-[1fr_auto_auto_auto]">
            <select className="rounded-md border border-slate-300 bg-white px-3 py-2 text-sm" value={selectedAnalysisId} onChange={(event) => setSelectedAnalysisId(event.target.value)}>
              <option value="">No analysis selected</option>
              {filteredAnalyses.map((item) => <option key={item.id} value={String(item.id)}>{item.title}</option>)}
            </select>
            <button type="button" className="rounded-md border border-slate-300 bg-white text-slate-700 px-3 py-2 text-xs" onClick={applySelectedAnalysisToForm} disabled={!selectedAnalysisId}>Apply</button>
            <button type="button" className="rounded-md border border-slate-300 bg-white text-slate-700 px-3 py-2 text-xs" onClick={setAnalysisEditorFromSelection} disabled={!selectedAnalysisId}>Edit</button>
            <button type="button" className="rounded-md border border-red-300 px-3 py-2 text-xs text-red-700" onClick={deleteSelectedAnalysis} disabled={!selectedAnalysisId}>Delete</button>
          </div>

          {showAnalysisEditor ? (
            <div className="mt-3 space-y-2 border-t border-slate-200 pt-3">
              <input className="rounded-md border border-slate-300 bg-white w-full px-3 py-2 text-sm" value={analysisTitle} onChange={(event) => setAnalysisTitle(event.target.value)} placeholder="analysis title" />
              <input className="rounded-md border border-slate-300 bg-white w-full px-3 py-2 text-sm" value={analysisDescription} onChange={(event) => setAnalysisDescription(event.target.value)} placeholder="description (optional)" />
              <div className="grid gap-2 md:grid-cols-2">
                <input
                  className="rounded-md border border-slate-300 bg-white px-3 py-2 text-sm"
                  value={analysisTagLevel1}
                  onChange={(event) => {
                    setAnalysisTagLevel1(event.target.value);
                    if (!event.target.value.trim()) setAnalysisTagLevel2("");
                  }}
                  placeholder="tag level 1"
                />
                <input
                  className="rounded-md border border-slate-300 bg-white px-3 py-2 text-sm"
                  value={analysisTagLevel2}
                  onChange={(event) => setAnalysisTagLevel2(event.target.value)}
                  placeholder="tag level 2"
                  disabled={!analysisTagLevel1.trim()}
                />
              </div>
              <input className="rounded-md border border-slate-300 bg-white w-full px-3 py-2 text-sm" value={analysisTags} onChange={(event) => setAnalysisTags(event.target.value)} placeholder="tags (comma separated)" />
              <textarea className="rounded-md border border-slate-300 bg-white min-h-[90px] w-full px-3 py-2 text-sm" value={analysisExampleQuestions} onChange={(event) => setAnalysisExampleQuestions(event.target.value)} placeholder="example questions (one per line)" />
              <textarea className="rounded-md border border-slate-300 bg-white min-h-[130px] w-full px-3 py-2 font-mono text-xs" value={analysisStyleProfile} onChange={(event) => setAnalysisStyleProfile(event.target.value)} placeholder="style_profile json" />
              <button type="button" className="rounded-md bg-slate-900 text-white px-3 py-2 text-xs font-semibold disabled:opacity-60" onClick={saveAnalysis} disabled={savingAnalysis}>
                {savingAnalysis ? <Loader2 className="mr-1 inline-block h-3 w-3 animate-spin" /> : null}
                Save Analysis
              </button>
            </div>
          ) : null}
        </div>

        <div className="grid gap-2 md:grid-cols-4">
          <select className="rounded-md border border-slate-300 bg-white px-3 py-2 text-sm" value={contentSourceType} onChange={(event) => setContentSourceType(event.target.value as "text" | "url" | "pdf" | "image") }>
            <option value="text">Raw Text</option>
            <option value="url">URL</option>
            <option value="image">Photo OCR</option>
            <option value="pdf">Uploaded PDF</option>
          </select>
          <select
            className="rounded-md border border-slate-300 bg-white px-3 py-2 text-sm"
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
          <label className="inline-flex items-center gap-2 rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-700">
            <input
              type="checkbox"
              className="h-4 w-4 rounded border-slate-300"
              checked={useCategorySource}
              onChange={(event) => setUseCategorySource(event.target.checked)}
            />
            Use category source
          </label>
          <input className="rounded-md border border-slate-300 bg-white px-3 py-2 text-sm" value={desiredQuestionCount} onChange={(event) => setDesiredQuestionCount(event.target.value)} placeholder="desired question count" />
        </div>
        {useCategorySource ? (
          <p className="text-xs text-emerald-700">
            Category source mode is active. Generation will use attached category source content.
          </p>
        ) : null}

        {contentSourceType === "text" ? (
          <textarea className="rounded-md border border-slate-300 bg-white min-h-[160px] w-full px-3 py-2 text-sm" value={contentText} onChange={(event) => setContentText(event.target.value)} placeholder="Paste content text for quiz generation" />
        ) : null}
        {contentSourceType === "url" ? (
          <input className="rounded-md border border-slate-300 bg-white w-full px-3 py-2 text-sm" value={contentUrl} onChange={(event) => setContentUrl(event.target.value)} placeholder="https://example.com/content" />
        ) : null}
        {contentSourceType === "image" ? (
          <div className="space-y-3 rounded-md border border-slate-200 bg-slate-50 p-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-xs text-slate-600">Upload photo pages and extract text in the same sequence.</p>
              <label className="inline-flex cursor-pointer items-center gap-2 rounded-md border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-100">
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
                  <div key={file.id} className="flex items-center gap-3 rounded-md border border-slate-200 bg-white px-3 py-2">
                    <Image
                      src={file.preview}
                      alt={file.name}
                      width={36}
                      height={48}
                      unoptimized
                      className="h-12 w-9 rounded border border-slate-200 object-cover"
                    />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-xs font-semibold text-slate-800">Page {index + 1}</p>
                      <p className="truncate text-[11px] text-slate-500">{file.name}</p>
                    </div>
                    <div className="flex items-center gap-1">
                      <button
                        type="button"
                        className="rounded-md border border-slate-300 bg-white px-1.5 py-1 text-slate-600 hover:bg-slate-100 disabled:opacity-40"
                        onClick={() => moveOcrImage(index, "up")}
                        disabled={index === 0}
                      >
                        <ArrowUp className="h-3.5 w-3.5" />
                      </button>
                      <button
                        type="button"
                        className="rounded-md border border-slate-300 bg-white px-1.5 py-1 text-slate-600 hover:bg-slate-100 disabled:opacity-40"
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
              <p className="text-xs text-slate-500">No photos added yet.</p>
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
              className="min-h-[120px] w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm"
              value={ocrExtractedText}
              onChange={(event) => setOcrExtractedText(event.target.value)}
              placeholder="Extracted text will appear here. You can edit before generation."
            />
          </div>
        ) : null}
        {contentSourceType === "pdf" ? (
          <div className="space-y-3 rounded-md border border-slate-200 bg-slate-50 p-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <label className="inline-flex items-center gap-2 text-xs text-slate-700">
                <input
                  type="checkbox"
                  checked={ocrOnUpload}
                  onChange={(event) => setOcrOnUpload(event.target.checked)}
                  className="h-4 w-4 rounded border-slate-300"
                />
                Enable OCR for low-text/scanned PDFs
              </label>
              <button
                type="button"
                className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-100 disabled:opacity-60"
                onClick={() => loadUploadedPdfs()}
                disabled={loadingUploadedPdfs}
              >
                {loadingUploadedPdfs ? "Refreshing..." : "Refresh list"}
              </button>
            </div>

            <label className="inline-flex cursor-pointer items-center gap-2 rounded-md border border-slate-300 bg-white px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-100">
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
                className="w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm"
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
                      <div key={pdf.id} className={`flex items-center justify-between rounded-md border px-3 py-2 ${isSelected ? "border-indigo-300 bg-indigo-50" : "border-slate-200 bg-white"}`}>
                        <div className="min-w-0">
                          <p className="truncate text-xs font-semibold text-slate-800">{pdf.filename}</p>
                          <p className="text-[11px] text-slate-500">
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
                            className="rounded-md border border-slate-300 bg-white px-2 py-1 text-[11px] font-semibold text-slate-700 hover:bg-slate-100"
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
                <p className="text-xs text-slate-500">No uploaded PDFs found. Upload one to use it as content source.</p>
              )}
            </div>
          </div>
        ) : null}

        <textarea className="rounded-md border border-slate-300 bg-white min-h-[90px] w-full px-3 py-2 text-sm" value={additionalInstructions} onChange={(event) => setAdditionalInstructions(event.target.value)} placeholder="Additional instructions" />
        <input className="rounded-md border border-slate-300 bg-white w-full px-3 py-2 text-sm" value={exampleQuestion} onChange={(event) => setExampleQuestion(event.target.value)} placeholder="Single example question (optional)" />
        <textarea className="rounded-md border border-slate-300 bg-white min-h-[80px] w-full px-3 py-2 text-sm" value={exampleQuestionsInput} onChange={(event) => setExampleQuestionsInput(event.target.value)} placeholder="Example questions (one per line)" />

        <div className="flex flex-wrap gap-2">
          <button type="button" className="rounded-md bg-slate-900 text-white inline-flex items-center px-4 py-2 text-sm font-semibold disabled:opacity-60" onClick={generatePreview} disabled={generating}>
            {generating ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Wand2 className="mr-2 h-4 w-4" />}
            Generate {quizKind.toUpperCase()} Preview
          </button>
          <button
            type="button"
            className="rounded-md border border-slate-300 bg-white text-slate-700 inline-flex items-center px-4 py-2 text-sm"
            onClick={() => {
              setResult(null);
              setAdditionalInstructions("");
              setExampleQuestion("");
              setExampleQuestionsInput("");
              setOcrImages([]);
              setOcrExtractedText("");
            }}
          >
            <RefreshCcw className="mr-2 h-4 w-4" /> Reset
          </button>
        </div>
      </section>

      <section className="space-y-3 rounded-md border bg-white p-5">
        <h2 className="text-lg font-bold text-slate-900">Generated Output</h2>

        {selectedInstruction ? (
          <div className="rounded-md border border-slate-200 bg-slate-50 p-3 text-xs text-slate-600">
            <p className="font-semibold text-slate-800">Instruction: {selectedInstruction.content_type}</p>
            <p className="mt-1">Provider/Model: {selectedInstruction.ai_provider}/{selectedInstruction.ai_model_name}</p>
            <p className="mt-2 font-semibold text-slate-700">System Instructions</p>
            <p className="mt-1 whitespace-pre-wrap">{selectedInstruction.system_instructions}</p>
          </div>
        ) : null}

        {selectedAnalysis ? (
          <div className="rounded-md border border-slate-200 bg-slate-50 p-3 text-xs text-slate-600">
            <p className="font-semibold text-slate-800">Applied Analysis: {selectedAnalysis.title}</p>
            {selectedAnalysis.description ? <p className="mt-1">{selectedAnalysis.description}</p> : null}
            {(selectedAnalysis.tag_level1 || selectedAnalysis.tag_level2) ? (
              <p className="mt-1">Tags: {[selectedAnalysis.tag_level1, selectedAnalysis.tag_level2].filter(Boolean).join(" / ")}</p>
            ) : null}
          </div>
        ) : null}

        {resultView}

        <div className="mt-4 rounded-md border border-slate-200 bg-slate-50 p-3 space-y-3">
          <p className="text-sm font-semibold text-slate-800">Draft & Publish (Admin)</p>
          <div className="grid gap-2 md:grid-cols-2">
            <input
              className="rounded-md border border-slate-300 bg-white px-3 py-2 text-sm"
              value={selectedExamId}
              onChange={(event) => setSelectedExamId(event.target.value)}
              placeholder="exam_id (optional)"
            />
            <input
              className="rounded-md border border-slate-300 bg-white px-3 py-2 text-sm"
              value={selectedCategoryIdsCsv}
              onChange={(event) => setSelectedCategoryIdsCsv(event.target.value)}
              placeholder="category_ids CSV (e.g. 12,45)"
            />
          </div>
          <textarea
            className="min-h-[72px] w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm"
            value={draftNotes}
            onChange={(event) => setDraftNotes(event.target.value)}
            placeholder="Draft notes (optional)"
          />
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              className="inline-flex items-center rounded-md border border-indigo-300 bg-white px-3 py-2 text-xs font-semibold text-indigo-700 hover:bg-indigo-50 disabled:opacity-60"
              onClick={createPdf}
              disabled={!result || isGeneratingPdf || savingDraft || sendingToFinal}
            >
              {isGeneratingPdf ? <Loader2 className="mr-1 h-3 w-3 animate-spin" /> : <Download className="mr-1 h-3 w-3" />}
              {isGeneratingPdf ? "Creating PDF..." : "Create PDF"}
            </button>
            <button
              type="button"
              className="inline-flex items-center rounded-md border border-slate-300 bg-white px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-100 disabled:opacity-60"
              onClick={saveDraft}
              disabled={!result || savingDraft || sendingToFinal}
            >
              {savingDraft ? <Loader2 className="mr-1 h-3 w-3 animate-spin" /> : null}
              Save as Draft
            </button>
            <button
              type="button"
              className="inline-flex items-center rounded-md bg-slate-900 px-3 py-2 text-xs font-semibold text-white disabled:opacity-60"
              onClick={saveAndSendToFinal}
              disabled={!result || savingDraft || sendingToFinal}
            >
              {sendingToFinal ? <Loader2 className="mr-1 h-3 w-3 animate-spin" /> : null}
              Send to Premium Quiz List
            </button>
            <button
              type="button"
              className="rounded-md border border-slate-300 bg-white px-3 py-2 text-xs text-slate-700 hover:bg-slate-100"
              onClick={() => router.push("/admin/premium/ai-drafts")}
            >
              Open Drafts
            </button>
          </div>
          {lastDraftId ? (
            <p className="text-xs text-slate-500">Last saved draft ID: {lastDraftId}</p>
          ) : null}
        </div>
      </section>
    </div>
  );
}

