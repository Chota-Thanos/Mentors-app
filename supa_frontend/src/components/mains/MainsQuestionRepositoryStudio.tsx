"use client";

import Link from "next/link";
import { Loader2, Plus, Sparkles, Trash2 } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import axios from "axios";
import { toast } from "sonner";

import MainsCategorySelector from "@/components/mains/MainsCategorySelector";
import { useAuth } from "@/context/AuthContext";
import { hasGenerationSubscription } from "@/lib/accessControl";
import { isMainsTestCollection } from "@/lib/collectionKind";
import { OUTPUT_LANGUAGE_OPTIONS, persistOutputLanguage, readOutputLanguage, type OutputLanguage } from "@/lib/outputLanguage";
import { premiumApi } from "@/lib/premiumApi";
import type {
  MainsCategory,
  PremiumAIExampleAnalysis,
  PremiumAIExampleAnalysisListResponse,
  PremiumCollection,
  PremiumContentItem,
} from "@/types/premium";

interface MainsQuestionRepositoryStudioProps {
  boundCollectionId?: number | null;
  boundCollectionTitle?: string;
}

type SourceType = "text" | "url";
type MainsTabKey = "manual" | "ai_generate" | "ai_parse";

type ParsedMainsQuestion = {
  question_text: string;
  answer_approach?: string;
  model_answer?: string;
  word_limit?: number;
  source_reference?: string | null;
  mains_category_ids?: number[];
  mains_category_id?: number | null;
  category_ids?: number[];
  description?: string;
};

type MainsParseResponse = {
  questions: ParsedMainsQuestion[];
};

type MainsDraftItem = {
  local_id: string;
  question_text: string;
  answer_approach: string;
  model_answer: string;
  word_limit: number;
  source_reference: string;
  mains_category_ids: number[];
  selected: boolean;
};

type MainsRepositoryItem = {
  id: number;
  title: string;
  question_text: string;
  answer_approach: string;
  model_answer: string;
  word_limit: number;
  source_reference: string;
  mains_category_ids: number[];
};

const MAINS_MODES = new Set(["mains", "mains_ai", "mains_ai_question", "mains_question", "mains_test"]);

const toError = (error: unknown): string => {
  if (axios.isAxiosError(error)) {
    const detail = error.response?.data?.detail;
    if (typeof detail === "string" && detail.trim()) return detail;
    return error.message;
  }
  if (error instanceof Error) return error.message;
  return "Unknown error";
};

const normalizeWordLimit = (value: unknown, fallback = 150): number => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return Math.floor(parsed);
};

const normalizeIdList = (value: unknown): number[] => {
  if (!Array.isArray(value)) return [];
  const output: number[] = [];
  for (const item of value) {
    const parsed = Number(item);
    if (!Number.isFinite(parsed) || parsed <= 0 || output.includes(parsed)) continue;
    output.push(parsed);
  }
  return output;
};

const extractMainsCategoryIds = (data: Record<string, unknown>): number[] => {
  const fromArray = normalizeIdList(data.mains_category_ids || data.category_ids);
  const single = Number(data.mains_category_id);
  if (Number.isFinite(single) && single > 0 && !fromArray.includes(single)) {
    return [...fromArray, single];
  }
  return fromArray;
};

const toQuestionTitle = (questionText: string): string => {
  const normalized = questionText.trim().replace(/\s+/g, " ");
  if (!normalized) return "Mains Question";
  if (normalized.length <= 120) return normalized;
  return `${normalized.slice(0, 117).trimEnd()}...`;
};

const flattenMainsCategories = (nodes: MainsCategory[]): MainsCategory[] => {
  const output: MainsCategory[] = [];
  const stack = [...nodes];
  while (stack.length > 0) {
    const current = stack.shift();
    if (!current) continue;
    output.push(current);
    if (Array.isArray(current.children) && current.children.length > 0) {
      stack.unshift(...current.children);
    }
  }
  return output;
};

const toRepositoryItem = (item: PremiumContentItem): MainsRepositoryItem | null => {
  const data = item.data && typeof item.data === "object" ? (item.data as Record<string, unknown>) : {};
  const mode = String(data.mode || data.kind || "").trim().toLowerCase();
  const questionText = String(data.question_text || data.question_statement || data.question || "").trim();
  if (!questionText) return null;
  if (mode && !MAINS_MODES.has(mode)) return null;

  return {
    id: Number(item.id),
    title: String(item.title || toQuestionTitle(questionText)),
    question_text: questionText,
    answer_approach: String(data.answer_approach || "").trim(),
    model_answer: String(data.model_answer || "").trim(),
    word_limit: normalizeWordLimit(data.word_limit, 150),
    source_reference: String(data.source_reference || data.source || "").trim(),
    mains_category_ids: extractMainsCategoryIds(data),
  };
};

export default function MainsQuestionRepositoryStudio({
  boundCollectionId = null,
  boundCollectionTitle,
}: MainsQuestionRepositoryStudioProps) {
  const { user, isAuthenticated, showLoginModal } = useAuth();
  const hasBoundCollection = Number.isFinite(boundCollectionId) && Number(boundCollectionId) > 0;
  const normalizedBoundCollectionId = hasBoundCollection ? Number(boundCollectionId) : null;

  const [selectedCategoryIds, setSelectedCategoryIds] = useState<number[]>([]);
  const [categoryNameMap, setCategoryNameMap] = useState<Map<number, string>>(new Map());
  const [tab, setTab] = useState<MainsTabKey>("manual");

  const [sourceType, setSourceType] = useState<SourceType>("text");
  const [sourceValue, setSourceValue] = useState("");
  const [useMainsCategorySource, setUseMainsCategorySource] = useState(false);
  const [parseCount, setParseCount] = useState("2");
  const [draftWordLimit, setDraftWordLimit] = useState("150");
  const [generateSourceType, setGenerateSourceType] = useState<SourceType>("text");
  const [generateSourceValue, setGenerateSourceValue] = useState("");
  const [generateUseMainsCategorySource, setGenerateUseMainsCategorySource] = useState(false);
  const [generateCount, setGenerateCount] = useState("2");
  const [generateWordLimit, setGenerateWordLimit] = useState("150");
  const [generateInstructions, setGenerateInstructions] = useState("");
  const [generateExampleAnalysisId, setGenerateExampleAnalysisId] = useState("");
  const [generateFormattingGuidance, setGenerateFormattingGuidance] = useState("");
  const [outputLanguage, setOutputLanguage] = useState<OutputLanguage>("en");

  const [manualQuestion, setManualQuestion] = useState("");
  const [manualApproach, setManualApproach] = useState("");
  const [manualModelAnswer, setManualModelAnswer] = useState("");
  const [manualSource, setManualSource] = useState("");

  const [drafts, setDrafts] = useState<MainsDraftItem[]>([]);
  const [isParsing, setIsParsing] = useState(false);
  const [isGenerating, setIsGenerating] = useState(false);
  const [isSavingDrafts, setIsSavingDrafts] = useState(false);
  const [exampleAnalyses, setExampleAnalyses] = useState<PremiumAIExampleAnalysis[]>([]);
  const [loadingExampleAnalyses, setLoadingExampleAnalyses] = useState(false);

  const [repoSearch, setRepoSearch] = useState("");
  const [repoItems, setRepoItems] = useState<MainsRepositoryItem[]>([]);
  const [selectedRepoIds, setSelectedRepoIds] = useState<number[]>([]);
  const [isRepoLoading, setIsRepoLoading] = useState(false);

  const [collections, setCollections] = useState<PremiumCollection[]>([]);
  const [selectedCollectionId, setSelectedCollectionId] = useState("");
  const [isAddingToCollection, setIsAddingToCollection] = useState(false);

  const effectiveWordLimit = useMemo(() => normalizeWordLimit(draftWordLimit, 150), [draftWordLimit]);
  const effectiveParseCount = useMemo(() => {
    const parsed = Number(parseCount);
    if (!Number.isFinite(parsed) || parsed <= 0) return 1;
    return Math.max(1, Math.min(10, Math.floor(parsed)));
  }, [parseCount]);
  const effectiveGenerateCount = useMemo(() => {
    const parsed = Number(generateCount);
    if (!Number.isFinite(parsed) || parsed <= 0) return 1;
    return Math.max(1, Math.min(10, Math.floor(parsed)));
  }, [generateCount]);
  const effectiveGenerateWordLimit = useMemo(
    () => normalizeWordLimit(generateWordLimit, 150),
    [generateWordLimit],
  );
  const selectedExampleAnalysis = useMemo(
    () => exampleAnalyses.find((item) => String(item.id) === generateExampleAnalysisId) || null,
    [exampleAnalyses, generateExampleAnalysisId],
  );

  const mainsCollections = useMemo(
    () => collections.filter((collection) => isMainsTestCollection(collection)),
    [collections],
  );

  const selectedDraftCount = useMemo(
    () => drafts.reduce((count, draft) => count + (draft.selected ? 1 : 0), 0),
    [drafts],
  );

  const selectedRepoCount = selectedRepoIds.length;

  useEffect(() => {
    setOutputLanguage(readOutputLanguage());
  }, []);

  useEffect(() => {
    const loadCategoryNames = async () => {
      if (!isAuthenticated) {
        setCategoryNameMap(new Map());
        return;
      }
      try {
        const response = await premiumApi.get<MainsCategory[]>("/mains/categories", {
          params: { hierarchical: true, active_only: true },
        });
        const flattened = flattenMainsCategories(Array.isArray(response.data) ? response.data : []);
        const lookup = new Map<number, string>();
        for (const row of flattened) {
          lookup.set(Number(row.id), String(row.name || `Category ${row.id}`));
        }
        setCategoryNameMap(lookup);
      } catch {
        setCategoryNameMap(new Map());
      }
    };

    void loadCategoryNames();
  }, [isAuthenticated]);

  const loadMainsCollections = useCallback(async () => {
    if (!isAuthenticated) {
      setCollections([]);
      setSelectedCollectionId("");
      return;
    }
    try {
      const response = await premiumApi.get<PremiumCollection[]>("/collections", {
        params: { mine_only: true, test_kind: "mains" },
      });
      const rows = Array.isArray(response.data) ? response.data : [];
      setCollections(rows);
    } catch (error: unknown) {
      toast.error("Failed to load Mains Tests", { description: toError(error) });
    }
  }, [isAuthenticated]);

  const loadRepository = useCallback(async () => {
    if (!isAuthenticated) {
      setRepoItems([]);
      setSelectedRepoIds([]);
      return;
    }
    setIsRepoLoading(true);
    try {
      const params: Record<string, unknown> = {
        limit: 500,
        search: repoSearch.trim() || undefined,
      };
      if (selectedCategoryIds.length === 1) {
        params.category_id = selectedCategoryIds[0];
      }
      const response = await premiumApi.get<PremiumContentItem[]>("/mains/questions", { params });
      const rows = (Array.isArray(response.data) ? response.data : [])
        .map((item) => toRepositoryItem(item))
        .filter((item): item is MainsRepositoryItem => Boolean(item));

      const filtered = selectedCategoryIds.length > 1
        ? rows.filter((item) => item.mains_category_ids.some((id) => selectedCategoryIds.includes(id)))
        : rows;
      setRepoItems(filtered);
    } catch (error: unknown) {
      setRepoItems([]);
      toast.error("Failed to load mains repository", { description: toError(error) });
    } finally {
      setIsRepoLoading(false);
    }
  }, [isAuthenticated, repoSearch, selectedCategoryIds]);

  const loadExampleAnalyses = useCallback(async () => {
    if (!isAuthenticated) {
      setExampleAnalyses([]);
      return;
    }
    setLoadingExampleAnalyses(true);
    try {
      const response = await premiumApi.get<PremiumAIExampleAnalysisListResponse>("/ai/example-analyses", {
        params: { content_type: "mains_question_generation", include_admin: true },
      });
      setExampleAnalyses(Array.isArray(response.data?.items) ? response.data.items : []);
    } catch (error: unknown) {
      setExampleAnalyses([]);
      toast.error("Failed to load mains generation styles", { description: toError(error) });
    } finally {
      setLoadingExampleAnalyses(false);
    }
  }, [isAuthenticated]);

  useEffect(() => {
    void loadMainsCollections();
  }, [loadMainsCollections]);

  useEffect(() => {
    void loadRepository();
  }, [loadRepository]);

  useEffect(() => {
    void loadExampleAnalyses();
  }, [loadExampleAnalyses]);

  useEffect(() => {
    setSelectedCollectionId((previous) => {
      if (normalizedBoundCollectionId) return String(normalizedBoundCollectionId);
      if (!previous) return mainsCollections[0] ? String(mainsCollections[0].id) : "";
      const stillExists = mainsCollections.some((collection) => String(collection.id) === previous);
      if (stillExists) return previous;
      return mainsCollections[0] ? String(mainsCollections[0].id) : "";
    });
  }, [mainsCollections, normalizedBoundCollectionId]);

  useEffect(() => {
    if (selectedRepoIds.length === 0) return;
    const available = new Set(repoItems.map((item) => item.id));
    setSelectedRepoIds((prev) => prev.filter((id) => available.has(id)));
  }, [repoItems, selectedRepoIds.length]);

  const ensureAuth = (): boolean => {
    if (isAuthenticated) return true;
    showLoginModal();
    return false;
  };

  const ensureGenerationAccess = (): boolean => {
    if (!ensureAuth()) return false;
    if (!hasGenerationSubscription(user)) {
      toast.error("Active subscription required for AI mains generation and parsing.");
      return false;
    }
    return true;
  };

  const buildDraftsFromAiRows = useCallback((
    rows: ParsedMainsQuestion[],
    fallbackWordLimit: number,
    fallbackSourceReference: string,
  ): MainsDraftItem[] => (
    rows
      .map((row) => {
        const questionText = String(row.question_text || "").trim();
        if (!questionText) return null;
        const resolvedCategoryIds = extractMainsCategoryIds(row as unknown as Record<string, unknown>);
        return {
          local_id: `draft-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
          question_text: questionText,
          answer_approach: String(row.answer_approach || "").trim(),
          model_answer: String(row.model_answer || "").trim(),
          word_limit: normalizeWordLimit(row.word_limit, fallbackWordLimit),
          source_reference: String(row.source_reference || fallbackSourceReference).trim(),
          mains_category_ids: resolvedCategoryIds.length > 0 ? resolvedCategoryIds : [...selectedCategoryIds],
          selected: true,
        } as MainsDraftItem;
      })
      .filter((item): item is MainsDraftItem => Boolean(item))
  ), [selectedCategoryIds]);

  const categoryLabel = (ids: number[]): string => {
    if (ids.length === 0) return "Uncategorized";
    const labels = ids.map((id) => categoryNameMap.get(id) || `ID ${id}`);
    return labels.join(", ");
  };

  const handleAddManualDraft = () => {
    const questionText = manualQuestion.trim();
    if (!questionText) {
      toast.error("Question text is required.");
      return;
    }

    const nextItem: MainsDraftItem = {
      local_id: `draft-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      question_text: questionText,
      answer_approach: manualApproach.trim(),
      model_answer: manualModelAnswer.trim(),
      word_limit: effectiveWordLimit,
      source_reference: manualSource.trim(),
      mains_category_ids: [...selectedCategoryIds],
      selected: true,
    };

    setDrafts((prev) => [nextItem, ...prev]);
    setManualQuestion("");
    setManualApproach("");
    setManualModelAnswer("");
    setManualSource("");
    toast.success("Draft added.");
  };

  const handleParseWithAi = async () => {
    if (!ensureGenerationAccess()) return;

    if (useMainsCategorySource && selectedCategoryIds.length === 0) {
      toast.error("Select at least one mains category when category source mode is enabled.");
      return;
    }
    if (!useMainsCategorySource && !sourceValue.trim()) {
      toast.error(sourceType === "url" ? "Source URL is required." : "Source text is required.");
      return;
    }

    setIsParsing(true);
    try {
      const payload: Record<string, unknown> = {
        mains_category_ids: selectedCategoryIds.length > 0 ? selectedCategoryIds : undefined,
        use_mains_category_source: useMainsCategorySource,
        number_of_questions: effectiveParseCount,
        word_limit: effectiveWordLimit,
      };
      if (!useMainsCategorySource) {
        if (sourceType === "text") payload.content = sourceValue;
        if (sourceType === "url") payload.url = sourceValue;
      }

      const response = await premiumApi.post<MainsParseResponse>("/mains/questions/parse", payload);
      const rows = Array.isArray(response.data?.questions) ? response.data.questions : [];
      const normalized = buildDraftsFromAiRows(
        rows,
        effectiveWordLimit,
        sourceType === "url" ? sourceValue : "",
      );

      if (normalized.length === 0) {
        throw new Error("AI did not return parseable mains questions.");
      }

      setDrafts((prev) => [...normalized, ...prev]);
      setTab("manual");
      toast.success(`AI parsed ${normalized.length} mains question(s) into drafts.`);
    } catch (error: unknown) {
      toast.error("Failed to parse mains questions", { description: toError(error) });
    } finally {
      setIsParsing(false);
    }
  };

  const handleGenerateWithAi = async () => {
    if (!ensureGenerationAccess()) return;

    if (generateUseMainsCategorySource && selectedCategoryIds.length === 0) {
      toast.error("Select at least one mains category when category source mode is enabled.");
      return;
    }
    if (!generateUseMainsCategorySource && !generateSourceValue.trim()) {
      toast.error(generateSourceType === "url" ? "Source URL is required." : "Source text is required.");
      return;
    }

    setIsGenerating(true);
    try {
      const payload: Record<string, unknown> = {
        mains_category_ids: selectedCategoryIds.length > 0 ? selectedCategoryIds : undefined,
        use_mains_category_source: generateUseMainsCategorySource,
        number_of_questions: effectiveGenerateCount,
        word_limit: effectiveGenerateWordLimit,
        example_format_id: generateExampleAnalysisId ? Number(generateExampleAnalysisId) : undefined,
        example_formatting_guidance: generateFormattingGuidance.trim() || undefined,
        user_instructions: generateInstructions.trim() || undefined,
        output_language: outputLanguage,
      };
      if (!generateUseMainsCategorySource) {
        if (generateSourceType === "text") payload.content = generateSourceValue;
        if (generateSourceType === "url") payload.url = generateSourceValue;
      }

      const response = await premiumApi.post<MainsParseResponse>("/ai-mains-questions/generate", payload);
      const rows = Array.isArray(response.data?.questions) ? response.data.questions : [];
      const normalized = buildDraftsFromAiRows(
        rows,
        effectiveGenerateWordLimit,
        generateSourceType === "url" ? generateSourceValue : "",
      );

      if (normalized.length === 0) {
        throw new Error("AI did not return any mains questions.");
      }

      setDrafts((prev) => [...normalized, ...prev]);
      setTab("manual");
      toast.success(`AI generated ${normalized.length} mains question(s) into drafts.`);
    } catch (error: unknown) {
      toast.error("Failed to generate mains questions", { description: toError(error) });
    } finally {
      setIsGenerating(false);
    }
  };

  const updateDraft = (localId: string, patch: Partial<MainsDraftItem>) => {
    setDrafts((prev) => prev.map((item) => (item.local_id === localId ? { ...item, ...patch } : item)));
  };

  const toggleDraftSelection = (localId: string) => {
    setDrafts((prev) => prev.map((item) => (
      item.local_id === localId ? { ...item, selected: !item.selected } : item
    )));
  };

  const toggleRepoSelection = (id: number) => {
    setSelectedRepoIds((prev) => (
      prev.includes(id) ? prev.filter((item) => item !== id) : [...prev, id]
    ));
  };

  const saveSelectedDrafts = async () => {
    if (!ensureAuth()) return;

    const selectedDrafts = drafts.filter((item) => item.selected);
    if (selectedDrafts.length === 0) {
      toast.error("Select at least one draft.");
      return;
    }

    setIsSavingDrafts(true);
    const savedIds = new Set<string>();
    let failedCount = 0;

    for (const draft of selectedDrafts) {
      const questionText = draft.question_text.trim();
      const categoryIds = draft.mains_category_ids.length > 0 ? draft.mains_category_ids : selectedCategoryIds;
      if (!questionText) {
        failedCount += 1;
        continue;
      }

      const payload = {
        title: toQuestionTitle(questionText),
        type: "question",
        collection_id: normalizedBoundCollectionId || undefined,
        data: {
          mode: "mains_ai",
          kind: "mains_ai_question",
          question_text: questionText,
          answer_approach: draft.answer_approach.trim() || null,
          model_answer: draft.model_answer.trim() || null,
          word_limit: normalizeWordLimit(draft.word_limit, 150),
          mains_category_ids: categoryIds.length > 0 ? categoryIds : undefined,
          mains_category_id: categoryIds[0] || null,
          category_ids: categoryIds.length > 0 ? categoryIds : undefined,
          source_reference: draft.source_reference.trim() || null,
          description: questionText,
        },
      };

      try {
        await premiumApi.post("/content", payload);
        savedIds.add(draft.local_id);
      } catch {
        failedCount += 1;
      }
    }

    const savedCount = savedIds.size;
    if (savedCount > 0) {
      setDrafts((prev) => prev.filter((item) => !savedIds.has(item.local_id)));
      await loadRepository();
      toast.success(
        normalizedBoundCollectionId
          ? `Saved ${savedCount} mains question(s) and added them to this test.`
          : `Saved ${savedCount} mains question(s) to repository.`,
      );
    }
    if (failedCount > 0) {
      toast.error(`Failed to save ${failedCount} draft(s).`);
    }

    setIsSavingDrafts(false);
  };

  const addSelectedRepoToMainsTest = async () => {
    if (!ensureAuth()) return;
    if (selectedRepoIds.length === 0) {
      toast.error("Select at least one repository item.");
      return;
    }

    const collectionId = normalizedBoundCollectionId || Number(selectedCollectionId);
    if (!Number.isFinite(collectionId) || collectionId <= 0) {
      toast.error("Select a valid Mains Test.");
      return;
    }

    setIsAddingToCollection(true);
    try {
      await premiumApi.post(`/collections/${collectionId}/items/bulk-add`, {
        items: selectedRepoIds.map((contentItemId) => ({ content_item_id: contentItemId, order: -1 })),
      });
      toast.success(`Added ${selectedRepoIds.length} item(s) to Mains Test.`);
      setSelectedRepoIds([]);
    } catch (error: unknown) {
      toast.error("Failed to add repository items", { description: toError(error) });
    } finally {
      setIsAddingToCollection(false);
    }
  };

  return (
    <div className="space-y-6">
      <section className="space-y-4 rounded-xl border border-slate-200 bg-white p-4 shadow-sm md:p-6">
        {normalizedBoundCollectionId ? (
          <div className="rounded-lg border border-sky-200 bg-sky-50 px-3 py-2 text-sm text-sky-800">
            Target mains test: <span className="font-semibold">{boundCollectionTitle || `Test #${normalizedBoundCollectionId}`}</span>
          </div>
        ) : null}

        <div className="space-y-2">
          <label className="text-sm font-semibold text-slate-800">Mains Categories</label>
          <MainsCategorySelector
            selectedCategoryIds={selectedCategoryIds}
            onCategoryIdsChange={setSelectedCategoryIds}
          />
        </div>

        <p className="rounded-lg border border-sky-200 bg-sky-50 px-3 py-2 text-sm text-sky-800">
          Selected mains categories act as an override. If you leave them empty, AI-generated and saved mains questions can still be auto-classified from the source/question text.
        </p>
      </section>

      <section className="space-y-4 rounded-xl border border-slate-200 bg-white p-4 shadow-sm md:p-6">
        <div className="grid gap-2 md:grid-cols-3">
          {([
            ["manual", "Manual"],
            ["ai_generate", "AI Generate"],
            ["ai_parse", "AI Parse"],
          ] as const).map(([key, label]) => {
            const active = tab === key;
            return (
              <button
                key={key}
                type="button"
                onClick={() => setTab(key)}
                className={`rounded-lg border px-4 py-3 text-base font-semibold ${
                  active
                    ? "border-indigo-500 bg-indigo-50 text-indigo-700"
                    : "border-slate-300 bg-white text-slate-700"
                }`}
              >
                {label}
              </button>
            );
          })}
        </div>

        {tab === "manual" ? (
          <div className="space-y-3 rounded border border-slate-200 bg-slate-50 p-4">
            <div>
              <h2 className="text-lg font-semibold text-slate-900">Standard Form: Manual Mains Entry</h2>
              <p className="mt-1 text-sm text-slate-600">
                Add mains question drafts manually, then review them in the draft queue before saving{normalizedBoundCollectionId ? " to the repository and this test" : " to the repository"}.
              </p>
            </div>
            <textarea
              rows={4}
              value={manualQuestion}
              onChange={(event) => setManualQuestion(event.target.value)}
              placeholder="question_text"
              className="w-full rounded border border-slate-300 bg-white px-3 py-2 text-sm"
            />
            <textarea
              rows={4}
              value={manualApproach}
              onChange={(event) => setManualApproach(event.target.value)}
              placeholder="answer_approach (optional)"
              className="w-full rounded border border-slate-300 bg-white px-3 py-2 text-sm"
            />
            <textarea
              rows={6}
              value={manualModelAnswer}
              onChange={(event) => setManualModelAnswer(event.target.value)}
              placeholder="model_answer (optional)"
              className="w-full rounded border border-slate-300 bg-white px-3 py-2 text-sm"
            />
            <div className="grid gap-3 md:grid-cols-2">
              <input
                value={manualSource}
                onChange={(event) => setManualSource(event.target.value)}
                placeholder="source_reference (optional URL)"
                className="w-full rounded border border-slate-300 bg-white px-3 py-2 text-sm"
              />
              <input
                type="number"
                min={50}
                max={600}
                value={draftWordLimit}
                onChange={(event) => setDraftWordLimit(event.target.value)}
                className="w-full rounded border border-slate-300 bg-white px-3 py-2 text-sm"
              />
            </div>
            <div className="flex justify-end">
              <button
                type="button"
                onClick={handleAddManualDraft}
                className="inline-flex items-center rounded bg-slate-900 px-3 py-2 text-sm font-semibold text-white"
              >
                <Plus className="mr-1.5 h-4 w-4" />
                Add Manual Draft
              </button>
            </div>
          </div>
        ) : null}

        {tab === "ai_generate" ? (
          <div className="space-y-4 rounded border border-indigo-200 bg-indigo-50 p-4">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div>
                <h2 className="text-lg font-semibold text-slate-900">AI Generate Mains Questions</h2>
                <p className="mt-1 text-sm text-slate-600">
                  Generate fresh mains question drafts using the selected mains categories above.
                </p>
              </div>
              <Link
                href={normalizedBoundCollectionId
                  ? `/mains-mentor/ai-mains?collection_id=${normalizedBoundCollectionId}&bind_test=1&mode=mains_mentor`
                  : "/mains-mentor/ai-mains"}
                className="rounded border border-violet-300 bg-white px-3 py-2 text-xs font-semibold text-violet-700"
              >
                Full AI Mains Studio
              </Link>
            </div>

            <div className="grid grid-cols-3 gap-2">
              <button
                type="button"
                onClick={() => {
                  setGenerateUseMainsCategorySource(false);
                  setGenerateSourceType("text");
                }}
                className={`rounded border px-3 py-2 text-sm ${
                  !generateUseMainsCategorySource && generateSourceType === "text"
                    ? "border-indigo-600 bg-white text-indigo-700"
                    : "border-indigo-200 bg-indigo-50 text-indigo-600"
                }`}
              >
                Source Text
              </button>
              <button
                type="button"
                onClick={() => {
                  setGenerateUseMainsCategorySource(false);
                  setGenerateSourceType("url");
                }}
                className={`rounded border px-3 py-2 text-sm ${
                  !generateUseMainsCategorySource && generateSourceType === "url"
                    ? "border-indigo-600 bg-white text-indigo-700"
                    : "border-indigo-200 bg-indigo-50 text-indigo-600"
                }`}
              >
                Source URL
              </button>
              <button
                type="button"
                onClick={() => setGenerateUseMainsCategorySource(true)}
                className={`rounded border px-3 py-2 text-sm ${
                  generateUseMainsCategorySource
                    ? "border-indigo-600 bg-white text-indigo-700"
                    : "border-indigo-200 bg-indigo-50 text-indigo-600"
                }`}
              >
                Category Source
              </button>
            </div>

            {generateUseMainsCategorySource ? (
              <p className="rounded border border-indigo-200 bg-white px-3 py-2 text-xs text-indigo-700">
                Category source mode is active. The selected mains categories will be used as the AI source and applied to generated drafts.
              </p>
            ) : generateSourceType === "url" ? (
              <input
                value={generateSourceValue}
                onChange={(event) => setGenerateSourceValue(event.target.value)}
                placeholder="https://..."
                className="w-full rounded border border-indigo-200 bg-white px-3 py-2 text-sm"
              />
            ) : (
              <textarea
                rows={8}
                value={generateSourceValue}
                onChange={(event) => setGenerateSourceValue(event.target.value)}
                placeholder="Paste article, editorial, notes, or instructions for mains question generation..."
                className="w-full rounded border border-indigo-200 bg-white px-3 py-2 text-sm"
              />
            )}

            <div className="grid gap-3 md:grid-cols-3">
              <div className="space-y-1">
                <label className="text-xs font-semibold uppercase tracking-wide text-slate-500">Question count</label>
                <input
                  type="number"
                  min={1}
                  max={10}
                  value={generateCount}
                  onChange={(event) => setGenerateCount(event.target.value)}
                  className="w-full rounded border border-indigo-200 bg-white px-3 py-2 text-sm"
                />
              </div>
              <div className="space-y-1">
                <label className="text-xs font-semibold uppercase tracking-wide text-slate-500">Word limit</label>
                <select
                  value={String(effectiveGenerateWordLimit)}
                  onChange={(event) => setGenerateWordLimit(event.target.value)}
                  className="w-full rounded border border-indigo-200 bg-white px-3 py-2 text-sm"
                >
                  {[150, 250].map((value) => (
                    <option key={value} value={String(value)}>
                      {value} words
                    </option>
                  ))}
                </select>
              </div>
              <div className="space-y-1">
                <label className="text-xs font-semibold uppercase tracking-wide text-slate-500">Output language</label>
                <select
                  value={outputLanguage}
                  onChange={(event) => setOutputLanguage(persistOutputLanguage(event.target.value))}
                  className="w-full rounded border border-indigo-200 bg-white px-3 py-2 text-sm"
                >
                  {OUTPUT_LANGUAGE_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div className="space-y-3 rounded border border-slate-200 bg-white p-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Generation style</p>
                  <p className="text-xs text-slate-600">Use saved mains generation formats or add your own style guidance.</p>
                </div>
                <button
                  type="button"
                  onClick={() => void loadExampleAnalyses()}
                  className="rounded border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700"
                  disabled={loadingExampleAnalyses}
                >
                  {loadingExampleAnalyses ? "Refreshing..." : "Refresh Styles"}
                </button>
              </div>
              <div className="space-y-1">
                <label className="text-xs font-semibold uppercase tracking-wide text-slate-500">Saved example format</label>
                <select
                  value={generateExampleAnalysisId}
                  onChange={(event) => setGenerateExampleAnalysisId(event.target.value)}
                  className="w-full rounded border border-slate-300 bg-white px-3 py-2 text-sm"
                  disabled={loadingExampleAnalyses}
                >
                  <option value="">Standard mains style</option>
                  {exampleAnalyses.map((item) => (
                    <option key={item.id} value={String(item.id)}>
                      {item.title}
                      {item.tag_level1 || item.tag_level2 ? ` (${[item.tag_level1, item.tag_level2].filter(Boolean).join(" / ")})` : ""}
                    </option>
                  ))}
                </select>
              </div>
              {selectedExampleAnalysis ? (
                <div className="rounded border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-700">
                  <span className="font-semibold">{selectedExampleAnalysis.title}</span>
                  {selectedExampleAnalysis.description ? `: ${selectedExampleAnalysis.description}` : ""}
                </div>
              ) : null}
              <textarea
                rows={3}
                value={generateFormattingGuidance}
                onChange={(event) => setGenerateFormattingGuidance(event.target.value)}
                placeholder="Custom style / formatting guidance (optional)"
                className="w-full rounded border border-slate-300 bg-white px-3 py-2 text-sm"
              />
            </div>

            <div className="space-y-1">
              <label className="text-xs font-semibold uppercase tracking-wide text-slate-500">Extra instructions</label>
              <textarea
                rows={4}
                value={generateInstructions}
                onChange={(event) => setGenerateInstructions(event.target.value)}
                placeholder="Extra generation instructions (optional)"
                className="w-full rounded border border-indigo-200 bg-white px-3 py-2 text-sm"
              />
            </div>

            <div className="flex justify-end">
              <button
                type="button"
                disabled={isGenerating}
                onClick={() => void handleGenerateWithAi()}
                className="inline-flex items-center rounded bg-indigo-700 px-3 py-2 text-sm font-semibold text-white disabled:opacity-60"
              >
                {isGenerating ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <Sparkles className="mr-1.5 h-4 w-4" />}
                Generate with AI
              </button>
            </div>
          </div>
        ) : null}

        {tab === "ai_parse" ? (
          <div className="space-y-3 rounded border border-indigo-200 bg-indigo-50 p-4">
            <div>
              <h2 className="text-lg font-semibold text-slate-900">AI Parse Mains Questions</h2>
              <p className="mt-1 text-sm text-slate-600">
                Parse source material into mains question drafts using the selected mains categories above.
              </p>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => setSourceType("text")}
                className={`rounded border px-3 py-2 text-sm ${
                  sourceType === "text" ? "border-indigo-600 bg-white text-indigo-700" : "border-indigo-200 bg-indigo-50 text-indigo-600"
                }`}
              >
                Source Text
              </button>
              <button
                type="button"
                onClick={() => setSourceType("url")}
                className={`rounded border px-3 py-2 text-sm ${
                  sourceType === "url" ? "border-indigo-600 bg-white text-indigo-700" : "border-indigo-200 bg-indigo-50 text-indigo-600"
                }`}
              >
                Source URL
              </button>
            </div>

            <label className="flex items-start gap-2 text-xs text-indigo-800">
              <input
                type="checkbox"
                checked={useMainsCategorySource}
                onChange={(event) => setUseMainsCategorySource(event.target.checked)}
                className="mt-0.5"
              />
              <span>Use mains category source mode. Selected category source files will be used as AI input.</span>
            </label>

            <textarea
              rows={sourceType === "url" ? 3 : 8}
              value={sourceValue}
              onChange={(event) => setSourceValue(event.target.value)}
              placeholder={sourceType === "url" ? "https://..." : "Paste source content for AI parsing..."}
              disabled={useMainsCategorySource}
              className="w-full rounded border border-indigo-200 bg-white px-3 py-2 text-sm disabled:bg-indigo-100"
            />

            <div className="grid gap-3 md:grid-cols-2">
              <input
                type="number"
                min={1}
                max={10}
                value={parseCount}
                onChange={(event) => setParseCount(event.target.value)}
                className="w-full rounded border border-indigo-200 bg-white px-3 py-2 text-sm"
                placeholder="Question count"
              />
              <input
                type="number"
                min={50}
                max={600}
                value={draftWordLimit}
                onChange={(event) => setDraftWordLimit(event.target.value)}
                className="w-full rounded border border-indigo-200 bg-white px-3 py-2 text-sm"
                placeholder="Word limit"
              />
            </div>

            <div className="flex justify-end">
              <button
                type="button"
                disabled={isParsing}
                onClick={() => void handleParseWithAi()}
                className="inline-flex items-center rounded bg-indigo-700 px-3 py-2 text-sm font-semibold text-white disabled:opacity-60"
              >
                {isParsing ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <Sparkles className="mr-1.5 h-4 w-4" />}
                Parse with AI
              </button>
            </div>
          </div>
        ) : null}

      </section>

      <section className="space-y-3 rounded-xl border border-slate-200 bg-white p-4 shadow-sm md:p-6">
        <div className="flex items-center justify-between">
          <h3 className="text-lg font-semibold text-slate-900">Draft Queue</h3>
          <p className="text-xs text-slate-500">Selected: {selectedDraftCount}</p>
        </div>

        <div className="max-h-[720px] space-y-3 overflow-y-auto rounded border border-slate-200 p-3">
          {drafts.map((draft) => (
            <div key={draft.local_id} className="space-y-2 rounded border border-slate-100 bg-slate-50 p-3">
              <div className="flex items-center justify-between gap-3">
                <label className="inline-flex items-center gap-2 text-xs text-slate-600">
                  <input
                    type="checkbox"
                    checked={draft.selected}
                    onChange={() => toggleDraftSelection(draft.local_id)}
                  />
                  Ready to save
                </label>
                <button
                  type="button"
                  onClick={() => setDrafts((prev) => prev.filter((item) => item.local_id !== draft.local_id))}
                  className="inline-flex items-center rounded border border-rose-200 bg-rose-50 px-2 py-1 text-xs font-semibold text-rose-700"
                >
                  <Trash2 className="mr-1 h-3.5 w-3.5" />
                  Remove
                </button>
              </div>

              <textarea
                rows={4}
                value={draft.question_text}
                onChange={(event) => updateDraft(draft.local_id, { question_text: event.target.value })}
                className="w-full rounded border border-slate-300 bg-white px-3 py-2 text-sm"
              />
              <textarea
                rows={3}
                value={draft.answer_approach}
                onChange={(event) => updateDraft(draft.local_id, { answer_approach: event.target.value })}
                className="w-full rounded border border-slate-300 bg-white px-3 py-2 text-sm"
                placeholder="answer_approach"
              />
              <textarea
                rows={5}
                value={draft.model_answer}
                onChange={(event) => updateDraft(draft.local_id, { model_answer: event.target.value })}
                className="w-full rounded border border-slate-300 bg-white px-3 py-2 text-sm"
                placeholder="model_answer"
              />
              <div className="grid gap-2 md:grid-cols-2">
                <input
                  type="number"
                  min={50}
                  max={600}
                  value={draft.word_limit}
                  onChange={(event) => updateDraft(draft.local_id, { word_limit: normalizeWordLimit(event.target.value, 150) })}
                  className="w-full rounded border border-slate-300 bg-white px-3 py-2 text-sm"
                />
                <input
                  value={draft.source_reference}
                  onChange={(event) => updateDraft(draft.local_id, { source_reference: event.target.value })}
                  className="w-full rounded border border-slate-300 bg-white px-3 py-2 text-sm"
                  placeholder="source_reference"
                />
              </div>
              <p className="text-[11px] text-slate-500">Categories: {categoryLabel(draft.mains_category_ids)}</p>
            </div>
          ))}

          {!isParsing && drafts.length === 0 ? (
            <p className="text-sm text-slate-500">No drafts yet. Add manual drafts or parse with AI.</p>
          ) : null}
        </div>

        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="space-x-2">
            <button
              type="button"
              onClick={() => setDrafts((prev) => prev.map((item) => ({ ...item, selected: true })))}
              className="rounded border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700"
            >
              Select All
            </button>
            <button
              type="button"
              onClick={() => setDrafts((prev) => prev.map((item) => ({ ...item, selected: false })))}
              className="rounded border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700"
            >
              Clear Selection
            </button>
          </div>
          <button
            type="button"
            disabled={isSavingDrafts}
            onClick={() => void saveSelectedDrafts()}
            className="inline-flex items-center rounded bg-emerald-700 px-4 py-2 text-sm font-semibold text-white disabled:opacity-60"
          >
            {isSavingDrafts ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : null}
            Save Selected to Repository
          </button>
        </div>
      </section>

      <section className="space-y-4 rounded-xl border border-slate-200 bg-white p-4 shadow-sm md:p-6">
        <div>
          <h2 className="text-lg font-semibold text-slate-900">Mains Repository</h2>
          <p className="mt-1 text-sm text-slate-600">
            Review existing mains repository items and add selected questions directly into this test.
          </p>
        </div>

        <div className="grid gap-3 sm:grid-cols-[1fr_auto]">
          <input
            value={repoSearch}
            onChange={(event) => setRepoSearch(event.target.value)}
            placeholder="Search repository by question text..."
            className="w-full rounded border border-slate-300 bg-white px-3 py-2 text-sm"
          />
          <button
            type="button"
            onClick={() => void loadRepository()}
            className="rounded border border-slate-300 bg-white px-3 py-2 text-sm font-semibold text-slate-700"
          >
            Refresh
          </button>
        </div>

        <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 space-y-3">
          <label className="text-xs font-semibold uppercase tracking-wide text-slate-500">
            {normalizedBoundCollectionId ? "Add Selected to This Mains Test" : "Add Selected to Mains Test"}
          </label>
          <div className="flex flex-col gap-2 sm:flex-row">
            {normalizedBoundCollectionId ? (
              <div className="flex-1 rounded border border-slate-300 bg-white px-3 py-2 text-sm text-slate-700">
                {boundCollectionTitle || `Mains Test ${normalizedBoundCollectionId}`}
              </div>
            ) : (
              <select
                value={selectedCollectionId}
                onChange={(event) => setSelectedCollectionId(event.target.value)}
                className="flex-1 rounded border border-slate-300 bg-white px-3 py-2 text-sm"
              >
                <option value="">Select Mains Test</option>
                {mainsCollections.map((collection) => (
                  <option key={collection.id} value={String(collection.id)}>
                    {collection.title || collection.name || `Mains Test ${collection.id}`}
                  </option>
                ))}
              </select>
            )}
            <button
              type="button"
              disabled={isAddingToCollection || selectedRepoCount === 0 || (!normalizedBoundCollectionId && !selectedCollectionId)}
              onClick={() => void addSelectedRepoToMainsTest()}
              className="rounded bg-slate-900 px-3 py-2 text-sm font-semibold text-white disabled:opacity-60"
            >
              {isAddingToCollection ? "Adding..." : `Add (${selectedRepoCount})`}
            </button>
          </div>
          {!normalizedBoundCollectionId && mainsCollections.length === 0 ? (
            <p className="text-xs text-slate-500">No Mains Test found. Create one from the Mains AI page first.</p>
          ) : null}
        </div>

        <div className="max-h-[760px] space-y-2 overflow-y-auto rounded border border-slate-200 bg-white p-3">
          {repoItems.map((item) => (
            <label key={item.id} className="block cursor-pointer rounded border border-slate-100 bg-slate-50 p-3 hover:bg-slate-100">
              <div className="flex items-start gap-3">
                <input
                  type="checkbox"
                  checked={selectedRepoIds.includes(item.id)}
                  onChange={() => toggleRepoSelection(item.id)}
                  className="mt-1"
                />
                <div className="min-w-0 flex-1">
                  <p className="font-semibold text-slate-900">{item.title}</p>
                  <p className="mt-1 line-clamp-3 text-sm text-slate-700">{item.question_text}</p>
                  <p className="mt-1 text-[11px] text-slate-500">Categories: {categoryLabel(item.mains_category_ids)}</p>
                  <p className="mt-1 text-[11px] text-slate-500">Word limit: {item.word_limit}</p>
                </div>
              </div>
            </label>
          ))}

          {!isRepoLoading && repoItems.length === 0 ? (
            <p className="text-sm text-slate-500">No mains repository items found for the selected filters.</p>
          ) : null}
          {isRepoLoading ? (
            <div className="flex items-center gap-2 text-sm text-slate-500">
              <Loader2 className="h-4 w-4 animate-spin" />
              Loading repository...
            </div>
          ) : null}
        </div>
      </section>
    </div>
  );
}
