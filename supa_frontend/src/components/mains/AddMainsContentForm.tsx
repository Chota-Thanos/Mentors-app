"use client";

import { Loader2 } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import axios from "axios";

import { useProfile } from "@/context/ProfileContext";
import { createClient } from "@/lib/supabase/client";
import type { MainsCategory, PremiumContentItem } from "@/types/premium";
import MainsCategorySelector from "@/components/mains/MainsCategorySelector";

interface AddMainsContentFormProps {
  collectionId: string;
}

type FormMode = "existing" | "post";

const toError = (error: unknown): string => {
  if (axios.isAxiosError(error)) {
    const detail = error.response?.data?.detail;
    if (typeof detail === "string" && detail.trim()) return detail;
    return error.message;
  }
  if (error instanceof Error) return error.message;
  return "Unknown error";
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

const buildMainsCategoryTree = (rows: MainsCategory[]): MainsCategory[] => {
  const byId = new Map<number, MainsCategory>();
  const roots: MainsCategory[] = [];
  rows.forEach((row) => byId.set(row.id, { ...row, children: [] }));
  byId.forEach((row) => {
    const parent = row.parent_id ? byId.get(row.parent_id) : null;
    if (parent) parent.children = [...(parent.children || []), row];
    else roots.push(row);
  });
  return roots;
};

const extractMainsCategoryIds = (item: PremiumContentItem): number[] => {
  const data = (item.data && typeof item.data === "object") ? (item.data as Record<string, unknown>) : {};
  const fromArray = normalizeIdList(data.mains_category_ids || data.category_ids);
  const single = Number(data.mains_category_id);
  if (Number.isFinite(single) && single > 0 && !fromArray.includes(single)) {
    return [...fromArray, single];
  }
  return fromArray;
};

const getQuestionText = (item: PremiumContentItem): string => {
  const data = (item.data && typeof item.data === "object") ? (item.data as Record<string, unknown>) : {};
  return String(data.question_text || data.question_statement || data.question || "").trim();
};

const isMainsQuestionItem = (item: PremiumContentItem): boolean => {
  if (String(item.type || "").trim().toLowerCase() !== "question") return false;
  const data = (item.data && typeof item.data === "object") ? (item.data as Record<string, unknown>) : {};
  const mode = String(data.mode || data.kind || "").trim().toLowerCase();
  if (["mains_ai", "mains_ai_question", "mains_question", "mains_test"].includes(mode)) return true;
  return Boolean(getQuestionText(item) && (data.model_answer || data.answer_approach));
};

export default function AddMainsContentForm({ collectionId }: AddMainsContentFormProps) {
  const router = useRouter();
  const { profileId } = useProfile();
  const supabase = useMemo(() => createClient(), []);

  const [mode, setMode] = useState<FormMode>("existing");
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState("");
  const [selectedCategoryIds, setSelectedCategoryIds] = useState<number[]>([]);
  const [categoryNameMap, setCategoryNameMap] = useState<Map<number, string>>(new Map());

  const [existingQuestions, setExistingQuestions] = useState<PremiumContentItem[]>([]);
  const [selectedContentIds, setSelectedContentIds] = useState<number[]>([]);

  const [questionText, setQuestionText] = useState("");
  const [answerApproach, setAnswerApproach] = useState("");
  const [modelAnswer, setModelAnswer] = useState("");
  const [wordLimit, setWordLimit] = useState("150");
  const [maxMarks, setMaxMarks] = useState("10");

  useEffect(() => {
    const loadCategoryNames = async () => {
      try {
        const { data, error } = await supabase
          .from("categories")
          .select("id,name,slug,description,parent_id,is_active,created_at,updated_at")
          .eq("domain", "mains")
          .eq("is_active", true)
          .order("display_order", { ascending: true })
          .order("name", { ascending: true });
        if (error) throw error;
        const rows = (data || []).map((row) => ({
          id: Number(row.id),
          name: String(row.name || ""),
          slug: row.slug ? String(row.slug) : null,
          description: row.description ? String(row.description) : null,
          parent_id: row.parent_id ? Number(row.parent_id) : null,
          is_active: row.is_active !== false,
          created_at: String(row.created_at || ""),
          updated_at: row.updated_at ? String(row.updated_at) : null,
        }));
        const flattened = flattenMainsCategories(buildMainsCategoryTree(rows));
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
  }, [supabase]);

  useEffect(() => {
    const loadExisting = async () => {
      if (mode !== "existing") return;
      setLoading(true);
      try {
        let query = supabase
          .from("mains_questions")
          .select("id,question_text,approach,model_answer,word_limit,marks,category_id")
          .limit(500);
        if (selectedCategoryIds.length === 1) {
          query = query.eq("category_id", selectedCategoryIds[0]);
        }
        const normalizedSearch = search.trim();
        if (normalizedSearch) {
          query = query.ilike("question_text", `%${normalizedSearch}%`);
        }
        const { data, error } = await query;
        if (error) throw error;
        const rows: PremiumContentItem[] = (data || []).map((row) => ({
          id: Number(row.id),
          title: String(row.question_text || "").slice(0, 120),
          type: "question",
          data: {
            mode: "mains_question",
            kind: "mains_question",
            question_text: row.question_text,
            answer_approach: row.approach,
            model_answer: row.model_answer,
            word_limit: row.word_limit,
            max_marks: row.marks,
            mains_category_ids: row.category_id ? [Number(row.category_id)] : [],
            mains_category_id: row.category_id ? Number(row.category_id) : null,
            category_ids: row.category_id ? [Number(row.category_id)] : [],
          },
        }));
        const mainsRows = rows.filter(isMainsQuestionItem);
        const filtered = selectedCategoryIds.length > 1
          ? mainsRows.filter((item) =>
              extractMainsCategoryIds(item).some((id) => selectedCategoryIds.includes(id)),
            )
          : mainsRows;
        setExistingQuestions(filtered);
      } catch (error: unknown) {
        setExistingQuestions([]);
        toast.error("Failed to load mains questions", { description: toError(error) });
      } finally {
        setLoading(false);
      }
    };
    void loadExisting();
  }, [mode, search, selectedCategoryIds]);

  useEffect(() => {
    if (selectedContentIds.length === 0) return;
    const available = new Set(existingQuestions.map((item) => Number(item.id)));
    setSelectedContentIds((prev) => prev.filter((id) => available.has(id)));
  }, [existingQuestions, selectedContentIds.length]);

  const selectedCount = selectedContentIds.length;
  const parsedWordLimit = useMemo(() => {
    const parsed = Number(wordLimit);
    if (!Number.isFinite(parsed) || parsed <= 0) return 150;
    return Math.floor(parsed);
  }, [wordLimit]);
  const parsedMaxMarks = useMemo(() => {
    const parsed = Number(maxMarks);
    if (!Number.isFinite(parsed) || parsed <= 0) return 10;
    return parsed;
  }, [maxMarks]);

  const toggleSelectedContent = (id: number) => {
    setSelectedContentIds((prev) => (
      prev.includes(id) ? prev.filter((item) => item !== id) : [...prev, id]
    ));
  };

  const formatMainsCategories = (ids: number[]): string => {
    if (ids.length === 0) return "Uncategorized";
    return ids.map((id) => categoryNameMap.get(id) || `ID ${id}`).join(", ");
  };

  const addSelectedExisting = async () => {
    if (selectedContentIds.length === 0) {
      toast.error("Select at least one mains question.");
      return;
    }
    setLoading(true);
    try {
      const { count } = await supabase
        .from("premium_collection_items")
        .select("id", { count: "exact", head: true })
        .eq("premium_collection_id", Number(collectionId));
      const { error } = await supabase.from("premium_collection_items").insert(
        selectedContentIds.map((questionId, index) => ({
          premium_collection_id: Number(collectionId),
          order_index: (count || 0) + index,
          item_type: "mains_question",
          mains_question_id: questionId,
          category_id: selectedCategoryIds[0] || null,
        })),
      );
      if (error) throw error;
      toast.success("Mains questions added to test.");
      router.push(`/collections/${collectionId}`);
      router.refresh();
    } catch (error: unknown) {
      toast.error("Failed to add mains questions", { description: toError(error) });
    } finally {
      setLoading(false);
    }
  };

  const postNewMainsQuestion = async () => {
    const normalizedQuestion = questionText.trim();
    if (!normalizedQuestion) {
      toast.error("Question text is required.");
      return;
    }
    if (selectedCategoryIds.length === 0) {
      toast.error("Select at least one mains category.");
      return;
    }
    if (!profileId) {
      toast.error("Creator profile is not loaded.");
      return;
    }

    setLoading(true);
    try {
      const { data: question, error: questionError } = await supabase.from("mains_questions").insert({
        question_text: normalizedQuestion,
        approach: answerApproach.trim() || null,
        model_answer: modelAnswer.trim() || null,
        word_limit: parsedWordLimit,
        marks: Math.floor(parsedMaxMarks),
        category_id: selectedCategoryIds[0] || null,
        author_id: profileId,
      }).select("id").single();
      if (questionError) throw questionError;
      const { error: itemError } = await supabase.from("premium_collection_items").insert({
        premium_collection_id: Number(collectionId),
        order_index: Date.now(),
        item_type: "mains_question",
        mains_question_id: Number(question.id),
        category_id: selectedCategoryIds[0] || null,
      });
      if (itemError) throw itemError;
      toast.success("Mains question posted and added.");
      setQuestionText("");
      setAnswerApproach("");
      setModelAnswer("");
      setWordLimit("150");
      setMaxMarks("10");
      router.push(`/collections/${collectionId}`);
      router.refresh();
    } catch (error: unknown) {
      toast.error("Failed to post mains question", { description: toError(error) });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-6 rounded-lg border border-gray-200 bg-white p-4 shadow-sm md:p-6">
      <div className="rounded-md border border-indigo-200 bg-indigo-50 px-3 py-2 text-sm text-indigo-800">
        Dedicated mains test content flow: category-linked descriptive questions with AI-evaluable structure.
      </div>

      <div className="grid grid-cols-2 gap-1 rounded-lg bg-gray-100 p-1">
        <button
          type="button"
          onClick={() => setMode("existing")}
          className={`rounded-md px-3 py-2 text-sm font-semibold ${mode === "existing" ? "bg-white text-indigo-700 shadow-sm" : "text-gray-700 hover:bg-gray-200"}`}
        >
          Add Existing
        </button>
        <button
          type="button"
          onClick={() => setMode("post")}
          className={`rounded-md px-3 py-2 text-sm font-semibold ${mode === "post" ? "bg-white text-indigo-700 shadow-sm" : "text-gray-700 hover:bg-gray-200"}`}
        >
          Post New Mains Question
        </button>
      </div>

      <div className="space-y-2">
        <label className="text-sm font-semibold text-slate-800">Mains Category Selection</label>
        <MainsCategorySelector
          selectedCategoryIds={selectedCategoryIds}
          onCategoryIdsChange={setSelectedCategoryIds}
        />
      </div>

      {mode === "existing" ? (
        <div className="space-y-4">
          <input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            className="w-full rounded border border-gray-300 px-3 py-2 text-sm"
            placeholder="Search mains questions by text..."
          />

          <div className="max-h-[460px] space-y-2 overflow-y-auto rounded border border-gray-200 p-3">
            {existingQuestions.map((item) => {
              const mainsCategoryIds = extractMainsCategoryIds(item);
              const preview = getQuestionText(item);
              return (
                <label key={item.id} className="flex cursor-pointer items-start gap-3 rounded border border-gray-100 bg-white p-3 text-sm hover:bg-gray-50">
                  <input
                    type="checkbox"
                    checked={selectedContentIds.includes(item.id)}
                    onChange={() => toggleSelectedContent(item.id)}
                    className="mt-1"
                  />
                  <div className="min-w-0 flex-1">
                    <p className="font-semibold text-gray-900">
                      {item.title || `Mains Question #${item.id}`}
                    </p>
                    <p className="mt-1 line-clamp-3 text-xs text-gray-600">{preview || "No question text found."}</p>
                    <p className="mt-1 text-[11px] text-slate-500">
                      Categories: {formatMainsCategories(mainsCategoryIds)}
                    </p>
                  </div>
                </label>
              );
            })}
            {!loading && existingQuestions.length === 0 ? (
              <p className="text-sm text-gray-500">
                No mains questions found for the selected filters.
              </p>
            ) : null}
          </div>

          <div className="flex items-center justify-between">
            <p className="text-sm text-slate-600">Selected: {selectedCount}</p>
            <button
              type="button"
              disabled={loading}
              onClick={addSelectedExisting}
              className="inline-flex items-center rounded bg-slate-900 px-4 py-2 text-sm font-semibold text-white disabled:opacity-60"
            >
              {loading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              Add Selected to Mains Test
            </button>
          </div>
        </div>
      ) : (
        <div className="space-y-4">
          <textarea
            rows={4}
            value={questionText}
            onChange={(event) => setQuestionText(event.target.value)}
            className="w-full rounded border border-gray-300 px-3 py-2 text-sm"
            placeholder="question_text"
          />
          <textarea
            rows={4}
            value={answerApproach}
            onChange={(event) => setAnswerApproach(event.target.value)}
            className="w-full rounded border border-gray-300 px-3 py-2 text-sm"
            placeholder="answer_approach (optional)"
          />
          <textarea
            rows={5}
            value={modelAnswer}
            onChange={(event) => setModelAnswer(event.target.value)}
            className="w-full rounded border border-gray-300 px-3 py-2 text-sm"
            placeholder="model_answer (optional but recommended)"
          />
          <div className="max-w-[220px]">
            <label className="mb-1 block text-sm font-medium text-slate-700">Word limit</label>
            <input
              type="number"
              min={50}
              max={600}
              value={wordLimit}
              onChange={(event) => setWordLimit(event.target.value)}
              className="w-full rounded border border-gray-300 px-3 py-2 text-sm"
            />
          </div>
          <div className="max-w-[220px]">
            <label className="mb-1 block text-sm font-medium text-slate-700">Max marks</label>
            <input
              type="number"
              min={1}
              max={50}
              step="0.5"
              value={maxMarks}
              onChange={(event) => setMaxMarks(event.target.value)}
              className="w-full rounded border border-gray-300 px-3 py-2 text-sm"
            />
          </div>
          <div className="flex justify-end">
            <button
              type="button"
              disabled={loading}
              onClick={postNewMainsQuestion}
              className="inline-flex items-center rounded bg-indigo-700 px-4 py-2 text-sm font-semibold text-white disabled:opacity-60"
            >
              {loading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              Post Mains Question and Add
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
