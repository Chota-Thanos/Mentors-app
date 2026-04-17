"use client";

import { Loader2, Plus, Trash2 } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import axios from "axios";

import { useProfile } from "@/context/ProfileContext";
import { createClient } from "@/lib/supabase/client";
import type { PremiumContentItem, QuizKind } from "@/types/premium";
import CategorySelector from "@/components/premium/ExamCategorySelector";

interface AddContentFormProps {
  collectionId: string;
}

type QuizQuestionDraft = {
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
};

type PassageQuestionDraft = {
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
};

const EMPTY_QUESTION: QuizQuestionDraft = {
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
};

const EMPTY_PASSAGE_QUESTION: PassageQuestionDraft = {
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
};

const readCategoryIds = (value: unknown): number[] => {
  if (!Array.isArray(value)) return [];
  return value
    .map((entry) => Number(entry))
    .filter((entry) => Number.isFinite(entry) && entry > 0);
};

const extractCategoryIdsForFilter = (item: PremiumContentItem, quizKind: QuizKind): number[] => {
  const data = (item.data || {}) as Record<string, unknown>;
  const base = readCategoryIds(data["category_ids"]);
  if (base.length > 0) return base;
  if (quizKind === "gk") return readCategoryIds(data["premium_gk_category_ids"]);
  if (quizKind === "maths") return readCategoryIds(data["premium_maths_category_ids"]);
  if (quizKind === "passage") return readCategoryIds(data["premium_passage_category_ids"]);
  return [];
};

const toErrorMessage = (error: unknown): string => {
  if (axios.isAxiosError(error) && typeof error.response?.data?.detail === "string") return error.response.data.detail;
  if (axios.isAxiosError(error)) return error.message;
  if (error instanceof Error) return error.message;
  return "Unknown error";
};

const categoryIdsFromJoin = (value: unknown): number[] => {
  if (!Array.isArray(value)) return [];
  return value
    .map((row) => {
      const record = row && typeof row === "object" ? (row as Record<string, unknown>) : {};
      return Number(record.category_id);
    })
    .filter((id) => Number.isFinite(id) && id > 0);
};

export default function AddContentForm({ collectionId }: AddContentFormProps) {
  const router = useRouter();
  const { profileId } = useProfile();
  const supabase = useMemo(() => createClient(), []);
  const [mode, setMode] = useState<"existing" | "post">("existing");
  const [quizKind, setQuizKind] = useState<QuizKind>("gk");
  const [isLoading, setIsLoading] = useState(false);

  const [existingQuizzes, setExistingQuizzes] = useState<PremiumContentItem[]>([]);
  const [selectedContentIds, setSelectedContentIds] = useState<number[]>([]);
  const [existingFilterCategoryIds, setExistingFilterCategoryIds] = useState<number[]>([]);

  const [questionDraft, setQuestionDraft] = useState<QuizQuestionDraft>(EMPTY_QUESTION);
  const [titlePrefix, setTitlePrefix] = useState("");
  const [selectedCategoryIds, setSelectedCategoryIds] = useState<number[]>([]);

  const [passageTitle, setPassageTitle] = useState("");
  const [passageText, setPassageText] = useState("");
  const [passageSource, setPassageSource] = useState("");
  const [passageAlphaCatIdsCsv, setPassageAlphaCatIdsCsv] = useState("");
  const [passageQuestions, setPassageQuestions] = useState<PassageQuestionDraft[]>([EMPTY_PASSAGE_QUESTION]);

  const quizTitle = useMemo(() => quizKind.toUpperCase(), [quizKind]);
  const isGk = quizKind === "gk";
  const isMaths = quizKind === "maths";

  useEffect(() => {
    const loadExisting = async () => {
      if (mode !== "existing") return;
      setIsLoading(true);
      try {
        let rows: PremiumContentItem[] = [];
        if (quizKind === "passage") {
          let query = supabase
            .from("passage_quizzes")
            .select("id,passage_title,passage_text,source_reference,passage_quiz_categories(category_id)")
            .limit(500);
          if (existingFilterCategoryIds.length === 1) {
            query = supabase
              .from("passage_quizzes")
              .select("id,passage_title,passage_text,source_reference,passage_quiz_categories!inner(category_id)")
              .eq("passage_quiz_categories.category_id", existingFilterCategoryIds[0])
              .limit(500);
          }
          const { data, error } = await query;
          if (error) throw error;
          rows = (data || []).map((row) => {
            const record = row as Record<string, unknown>;
            const categoryIds = categoryIdsFromJoin(record.passage_quiz_categories);
            return {
              id: Number(record.id),
              title: String(record.passage_title || `Passage #${record.id}`),
              type: "quiz_passage",
              data: {
                passage_title: record.passage_title,
                passage_text: record.passage_text,
                source_reference: record.source_reference,
                category_ids: categoryIds,
                premium_passage_category_ids: categoryIds,
              },
            };
          });
        } else {
          let query = supabase
            .from("quizzes")
            .select("id,title,quiz_type,question_statement,question_prompt,quiz_categories(category_id)")
            .eq("quiz_type", quizKind)
            .limit(500);
          if (existingFilterCategoryIds.length === 1) {
            query = supabase
              .from("quizzes")
              .select("id,title,quiz_type,question_statement,question_prompt,quiz_categories!inner(category_id)")
              .eq("quiz_type", quizKind)
              .eq("quiz_categories.category_id", existingFilterCategoryIds[0])
              .limit(500);
          }
          const { data, error } = await query;
          if (error) throw error;
          rows = (data || []).map((row) => {
            const record = row as Record<string, unknown>;
            const categoryIds = categoryIdsFromJoin(record.quiz_categories);
            return {
              id: Number(record.id),
              title: record.title ? String(record.title) : `Quiz #${record.id}`,
              type: quizKind === "maths" ? "quiz_maths" : "quiz_gk",
              data: {
                question_statement: record.question_statement,
                question_prompt: record.question_prompt,
                category_ids: categoryIds,
                premium_gk_category_ids: quizKind === "gk" ? categoryIds : [],
                premium_maths_category_ids: quizKind === "maths" ? categoryIds : [],
              },
            };
          });
        }

        if (existingFilterCategoryIds.length > 1) {
          const filtered = rows.filter((row) => {
            const rowCategoryIds = extractCategoryIdsForFilter(row, quizKind);
            return rowCategoryIds.some((categoryId) => existingFilterCategoryIds.includes(categoryId));
          });
          setExistingQuizzes(filtered);
        } else {
          setExistingQuizzes(rows);
        }
      } catch (error: unknown) {
        toast.error("Failed to load quizzes", { description: toErrorMessage(error) });
      } finally {
        setIsLoading(false);
      }
    };
    loadExisting();
  }, [mode, quizKind, existingFilterCategoryIds]);

  useEffect(() => {
    setSelectedCategoryIds([]);
  }, [quizKind]);

  useEffect(() => {
    setExistingFilterCategoryIds([]);
  }, [quizKind]);

  useEffect(() => {
    if (selectedContentIds.length === 0) return;
    const available = new Set(existingQuizzes.map((quiz) => quiz.id));
    setSelectedContentIds((prev) => prev.filter((id) => available.has(id)));
  }, [existingQuizzes, selectedContentIds.length]);

  const parseCsvToIds = (csv: string) =>
    csv
      .split(",")
      .map((item) => Number(item.trim()))
      .filter((value) => Number.isFinite(value));

  const toggleContent = (id: number) => {
    setSelectedContentIds((prev) => (prev.includes(id) ? prev.filter((item) => item !== id) : [...prev, id]));
  };

  const addSelectedExisting = async () => {
    if (selectedContentIds.length === 0) {
      toast.error("Select at least one posted quiz");
      return;
    }
    setIsLoading(true);
    try {
      const { count } = await supabase
        .from("premium_collection_items")
        .select("id", { count: "exact", head: true })
        .eq("premium_collection_id", Number(collectionId));
      const { error } = await supabase.from("premium_collection_items").insert(
        selectedContentIds.map((contentItemId, index) => ({
          premium_collection_id: Number(collectionId),
          order_index: (count || 0) + index,
          item_type: quizKind === "passage" ? "passage_quiz" : quizKind === "maths" ? "maths_quiz" : "gk_quiz",
          quiz_id: quizKind === "passage" ? null : contentItemId,
          passage_quiz_id: quizKind === "passage" ? contentItemId : null,
          category_id: existingFilterCategoryIds[0] || null,
        })),
      );
      if (error) throw error;
      toast.success("Content added to test");
      router.push(`/collections/${collectionId}`);
      router.refresh();
    } catch (error: unknown) {
      toast.error("Failed to add content", { description: toErrorMessage(error) });
    } finally {
      setIsLoading(false);
    }
  };

  const postSingleQuestionQuiz = async () => {
    if (!questionDraft.question_statement.trim()) {
      toast.error("question_statement is required");
      return;
    }
    if (!questionDraft.option_a || !questionDraft.option_b || !questionDraft.option_c || !questionDraft.option_d) {
      toast.error("option_a to option_d are required");
      return;
    }
    if (selectedCategoryIds.length === 0) {
      toast.error("Select at least one category");
      return;
    }
    if (!profileId) {
      toast.error("Creator profile is not loaded.");
      return;
    }

    setIsLoading(true);
    try {
      const statementsFacts = isGk && questionDraft.statements_facts
        ? questionDraft.statements_facts.split("\n").map((item) => item.trim()).filter(Boolean)
        : [];
      const alphaIds = parseCsvToIds(questionDraft.alpha_cat_ids_csv);
      const optionPayload = [
        { label: "A", text: questionDraft.option_a },
        { label: "B", text: questionDraft.option_b },
        { label: "C", text: questionDraft.option_c },
        { label: "D", text: questionDraft.option_d },
        ...(questionDraft.option_e ? [{ label: "E", text: questionDraft.option_e }] : []),
      ];
      void alphaIds;
      const { data: quiz, error: quizError } = await supabase
        .from("quizzes")
        .insert({
          quiz_type: quizKind,
          title: titlePrefix || `${quizTitle} Quiz`,
          question_statement: questionDraft.question_statement,
          supp_question_statement: questionDraft.supp_question_statement || null,
          statements_facts: statementsFacts,
          question_prompt: questionDraft.question_prompt || null,
          options: optionPayload,
          correct_answer: questionDraft.correct_answer,
          explanation: questionDraft.explanation || null,
          sources: questionDraft.source_reference ? [{ title: "Source", url: questionDraft.source_reference }] : [],
          author_id: profileId,
        })
        .select("id")
        .single();
      if (quizError) throw quizError;
      const quizId = Number(quiz.id);
      const { error: categoryError } = await supabase.from("quiz_categories").insert(
        selectedCategoryIds.map((categoryId) => ({ quiz_id: quizId, category_id: categoryId })),
      );
      if (categoryError) throw categoryError;
      const { error: itemError } = await supabase.from("premium_collection_items").insert({
        premium_collection_id: Number(collectionId),
        order_index: Date.now(),
        item_type: quizKind === "maths" ? "maths_quiz" : "gk_quiz",
        quiz_id: quizId,
        category_id: selectedCategoryIds[0] || null,
      });
      if (itemError) throw itemError;
      toast.success(`${quizTitle} quiz posted`);
      setQuestionDraft(EMPTY_QUESTION);
      router.push(`/collections/${collectionId}`);
      router.refresh();
    } catch (error: unknown) {
      toast.error("Failed to post quiz", { description: toErrorMessage(error) });
    } finally {
      setIsLoading(false);
    }
  };

  const updatePassageQuestion = (index: number, patch: Partial<PassageQuestionDraft>) => {
    setPassageQuestions((prev) => prev.map((item, i) => (i === index ? { ...item, ...patch } : item)));
  };

  const addPassageQuestion = () => setPassageQuestions((prev) => [...prev, { ...EMPTY_PASSAGE_QUESTION }]);
  const removePassageQuestion = (index: number) => {
    setPassageQuestions((prev) => (prev.length === 1 ? prev : prev.filter((_, i) => i !== index)));
  };

  const postPassageQuiz = async () => {
    if (!passageText.trim()) {
      toast.error("passage_text is required");
      return;
    }
    if (selectedCategoryIds.length === 0) {
      toast.error("Select at least one category");
      return;
    }
    if (!profileId) {
      toast.error("Creator profile is not loaded.");
      return;
    }

    setIsLoading(true);
    try {
      const passageAlphaIds = parseCsvToIds(passageAlphaCatIdsCsv);
      void passageAlphaIds;
      const { data: passage, error: passageError } = await supabase.from("passage_quizzes").insert({
        passage_title: passageTitle || null,
        passage_text: passageText,
        source_reference: passageSource || null,
        author_id: profileId,
      }).select("id").single();
      if (passageError) throw passageError;
      const passageId = Number(passage.id);
      const { error: questionsError } = await supabase.from("passage_questions").insert(
        passageQuestions.map((question, index) => ({
          passage_quiz_id: passageId,
          question_statement: question.question_statement,
          supp_question_statement: question.supp_question_statement || null,
          statements_facts: question.statements_facts
            ? question.statements_facts.split("\n").map((item) => item.trim()).filter(Boolean)
            : [],
          question_prompt: question.question_prompt || null,
          options: [
            { label: "A", text: question.option_a },
            { label: "B", text: question.option_b },
            { label: "C", text: question.option_c },
            { label: "D", text: question.option_d },
            ...(question.option_e ? [{ label: "E", text: question.option_e }] : []),
          ],
          correct_answer: question.correct_answer,
          explanation: question.explanation || null,
          category_id: selectedCategoryIds[0] || null,
          display_order: index,
        })),
      );
      if (questionsError) throw questionsError;
      const { error: categoryError } = await supabase.from("passage_quiz_categories").insert(
        selectedCategoryIds.map((categoryId) => ({ passage_quiz_id: passageId, category_id: categoryId })),
      );
      if (categoryError) throw categoryError;
      const { error: itemError } = await supabase.from("premium_collection_items").insert({
        premium_collection_id: Number(collectionId),
        order_index: Date.now(),
        item_type: "passage_quiz",
        passage_quiz_id: passageId,
        category_id: selectedCategoryIds[0] || null,
      });
      if (itemError) throw itemError;
      toast.success("Passage quiz posted");
      setPassageTitle("");
      setPassageText("");
      setPassageSource("");
      setPassageAlphaCatIdsCsv("");
      setPassageQuestions([EMPTY_PASSAGE_QUESTION]);
      router.push(`/collections/${collectionId}`);
      router.refresh();
    } catch (error: unknown) {
      toast.error("Failed to post passage quiz", { description: toErrorMessage(error) });
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="space-y-6 rounded-lg border border-gray-200 bg-white p-4 shadow-sm md:p-6">
      <div className="grid grid-cols-2 gap-1 rounded-lg bg-gray-100 p-1">
        <button
          type="button"
          onClick={() => setMode("existing")}
          className={`rounded-md px-3 py-2 text-sm font-semibold ${mode === "existing" ? "bg-white text-blue-600 shadow-sm" : "text-gray-700 hover:bg-gray-200"}`}
        >
          Add existing
        </button>
        <button
          type="button"
          onClick={() => setMode("post")}
          className={`rounded-md px-3 py-2 text-sm font-semibold ${mode === "post" ? "bg-white text-blue-600 shadow-sm" : "text-gray-700 hover:bg-gray-200"}`}
        >
          Post new quiz
        </button>
      </div>

      <div className="rounded-md border border-blue-200 bg-blue-50 p-3">
        <label className="mb-2 block text-sm font-semibold text-slate-800">Quiz type</label>
        <select
          value={quizKind}
          onChange={(event) => setQuizKind(event.target.value as QuizKind)}
          className="w-full rounded border border-gray-300 bg-white px-3 py-2 text-sm"
        >
          <option value="gk">GK</option>
          <option value="maths">Maths</option>
          <option value="passage">Passage</option>
        </select>
      </div>

      {mode === "existing" ? (
        <div className="space-y-4">
          <div className="rounded border border-blue-200 bg-blue-50 p-3">
            <p className="mb-2 text-sm font-semibold text-slate-800">Filter posted quizzes by category</p>
            <CategorySelector
              quizKind={quizKind}
              selectedCategoryIds={existingFilterCategoryIds}
              onCategoryIdsChange={setExistingFilterCategoryIds}
            />
          </div>

          <div className="max-h-[420px] space-y-2 overflow-y-auto rounded border border-gray-200 p-3">
            {existingQuizzes.map((quiz) => {
              const data = (quiz.data || {}) as Record<string, unknown>;
              return (
                <label key={quiz.id} className="flex cursor-pointer items-start gap-3 rounded border border-gray-100 bg-white p-3 text-sm hover:bg-gray-50">
                  <input
                    type="checkbox"
                    checked={selectedContentIds.includes(quiz.id)}
                    onChange={() => toggleContent(quiz.id)}
                    className="mt-1"
                  />
                  <div>
                    <p className="font-semibold text-gray-900">{quiz.title || `Quiz #${quiz.id}`}</p>
                    <p className="mt-1 line-clamp-2 text-xs text-gray-500">
                      {String(data["question_statement"] || data["passage_text"] || "")}
                    </p>
                  </div>
                </label>
              );
            })}
            {existingQuizzes.length === 0 ? <p className="text-sm text-gray-500">No posted quizzes found for this type.</p> : null}
          </div>

          <div className="flex justify-end">
            <button
              type="button"
              disabled={isLoading}
              onClick={addSelectedExisting}
              className="inline-flex items-center rounded bg-gray-900 px-4 py-2 text-sm font-semibold text-white disabled:opacity-60"
            >
              {isLoading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              Add selected to test
            </button>
          </div>
        </div>
      ) : null}

      {mode === "post" && quizKind !== "passage" ? (
        <div className="space-y-4">
          <div className="rounded border border-blue-200 bg-blue-50 px-3 py-2 text-sm text-slate-700">
            {isGk
              ? "GK posting fields: category, statement/facts, prompt, options, explanation."
              : isMaths
                ? "Maths posting fields: category, prompt, options, explanation."
                : "Quiz posting fields."}
          </div>
          <CategorySelector
            quizKind={quizKind}
            selectedCategoryIds={selectedCategoryIds}
            onCategoryIdsChange={setSelectedCategoryIds}
          />
          <input
            value={titlePrefix}
            onChange={(event) => setTitlePrefix(event.target.value)}
            className="w-full rounded border border-gray-300 px-3 py-2 text-sm"
            placeholder="title_prefix"
          />
          <textarea
            rows={3}
            value={questionDraft.question_statement}
            onChange={(event) => setQuestionDraft((prev) => ({ ...prev, question_statement: event.target.value }))}
            className="w-full rounded border border-gray-300 px-3 py-2 text-sm"
            placeholder="question_statement"
          />
          <textarea
            rows={2}
            value={questionDraft.supp_question_statement}
            onChange={(event) => setQuestionDraft((prev) => ({ ...prev, supp_question_statement: event.target.value }))}
            className="w-full rounded border border-gray-300 px-3 py-2 text-sm"
            placeholder="supp_question_statement"
          />
          {isGk ? (
            <textarea
              rows={2}
              value={questionDraft.statements_facts}
              onChange={(event) => setQuestionDraft((prev) => ({ ...prev, statements_facts: event.target.value }))}
              className="w-full rounded border border-gray-300 px-3 py-2 text-sm"
              placeholder="statements_facts (one per line)"
            />
          ) : null}
          <textarea
            rows={2}
            value={questionDraft.question_prompt}
            onChange={(event) => setQuestionDraft((prev) => ({ ...prev, question_prompt: event.target.value }))}
            className="w-full rounded border border-gray-300 px-3 py-2 text-sm"
            placeholder="question_prompt"
          />

          <div className="grid gap-2 md:grid-cols-2">
            {(["option_a", "option_b", "option_c", "option_d", "option_e"] as const).map((field) => (
              <input
                key={field}
                value={questionDraft[field]}
                onChange={(event) => setQuestionDraft((prev) => ({ ...prev, [field]: event.target.value }))}
                className="rounded border border-gray-300 px-3 py-2 text-sm"
                placeholder={field}
              />
            ))}
          </div>

          <div className="grid gap-2 md:grid-cols-3">
            <select
              value={questionDraft.correct_answer}
              onChange={(event) => setQuestionDraft((prev) => ({ ...prev, correct_answer: event.target.value }))}
              className="rounded border border-gray-300 px-3 py-2 text-sm"
            >
              <option value="A">A</option>
              <option value="B">B</option>
              <option value="C">C</option>
              <option value="D">D</option>
              <option value="E">E</option>
            </select>
            <input
              value={questionDraft.source_reference}
              onChange={(event) => setQuestionDraft((prev) => ({ ...prev, source_reference: event.target.value }))}
              className="rounded border border-gray-300 px-3 py-2 text-sm"
              placeholder="source_reference"
            />
            <input
              value={questionDraft.alpha_cat_ids_csv}
              onChange={(event) => setQuestionDraft((prev) => ({ ...prev, alpha_cat_ids_csv: event.target.value }))}
              className="rounded border border-gray-300 px-3 py-2 text-sm"
              placeholder="alpha_cat_ids comma separated"
            />
          </div>

          <textarea
            rows={3}
            value={questionDraft.explanation}
            onChange={(event) => setQuestionDraft((prev) => ({ ...prev, explanation: event.target.value }))}
            className="w-full rounded border border-gray-300 px-3 py-2 text-sm"
            placeholder="explanation"
          />

          <div className="flex justify-end">
            <button
              type="button"
              disabled={isLoading}
              onClick={postSingleQuestionQuiz}
              className="inline-flex items-center rounded bg-gray-900 px-4 py-2 text-sm font-semibold text-white disabled:opacity-60"
            >
              {isLoading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              Post {quizTitle} quiz and add
            </button>
          </div>
        </div>
      ) : null}

      {mode === "post" && quizKind === "passage" ? (
        <div className="space-y-4">
          <CategorySelector
            quizKind={quizKind}
            selectedCategoryIds={selectedCategoryIds}
            onCategoryIdsChange={setSelectedCategoryIds}
          />
          <input
            value={passageTitle}
            onChange={(event) => setPassageTitle(event.target.value)}
            className="w-full rounded border border-gray-300 px-3 py-2 text-sm"
            placeholder="passage_title"
          />
          <textarea
            rows={6}
            value={passageText}
            onChange={(event) => setPassageText(event.target.value)}
            className="w-full rounded border border-gray-300 px-3 py-2 text-sm"
            placeholder="passage_text"
          />
          <div className="grid gap-2 md:grid-cols-2">
            <input
              value={passageSource}
              onChange={(event) => setPassageSource(event.target.value)}
              className="rounded border border-gray-300 px-3 py-2 text-sm"
              placeholder="source_reference"
            />
            <input
              value={passageAlphaCatIdsCsv}
              onChange={(event) => setPassageAlphaCatIdsCsv(event.target.value)}
              className="rounded border border-gray-300 px-3 py-2 text-sm"
              placeholder="alpha_cat_ids comma separated"
            />
          </div>

          <div className="space-y-3">
            {passageQuestions.map((question, index) => (
              <div key={index} className="rounded border border-gray-200 bg-gray-50 p-3">
                <div className="mb-2 flex items-center justify-between">
                  <p className="text-sm font-medium">Question {index + 1}</p>
                  <button type="button" onClick={() => removePassageQuestion(index)} className="text-gray-500 hover:text-red-600">
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
                <div className="space-y-2">
                  <textarea value={question.question_statement} onChange={(event) => updatePassageQuestion(index, { question_statement: event.target.value })} className="w-full rounded border border-gray-300 bg-white px-3 py-2 text-sm" placeholder="question_statement" rows={2} />
                  <textarea value={question.supp_question_statement} onChange={(event) => updatePassageQuestion(index, { supp_question_statement: event.target.value })} className="w-full rounded border border-gray-300 bg-white px-3 py-2 text-sm" placeholder="supp_question_statement" rows={2} />
                  <textarea value={question.statements_facts} onChange={(event) => updatePassageQuestion(index, { statements_facts: event.target.value })} className="w-full rounded border border-gray-300 bg-white px-3 py-2 text-sm" placeholder="statements_facts one per line" rows={2} />
                  <textarea value={question.question_prompt} onChange={(event) => updatePassageQuestion(index, { question_prompt: event.target.value })} className="w-full rounded border border-gray-300 bg-white px-3 py-2 text-sm" placeholder="question_prompt" rows={2} />
                  <div className="grid gap-2 md:grid-cols-2">
                    {(["option_a", "option_b", "option_c", "option_d", "option_e"] as const).map((field) => (
                      <input key={field} value={question[field]} onChange={(event) => updatePassageQuestion(index, { [field]: event.target.value } as Partial<PassageQuestionDraft>)} className="rounded border border-gray-300 bg-white px-3 py-2 text-sm" placeholder={field} />
                    ))}
                  </div>
                  <div className="grid gap-2 md:grid-cols-2">
                    <select value={question.correct_answer} onChange={(event) => updatePassageQuestion(index, { correct_answer: event.target.value })} className="rounded border border-gray-300 bg-white px-3 py-2 text-sm">
                      <option value="A">A</option>
                      <option value="B">B</option>
                      <option value="C">C</option>
                      <option value="D">D</option>
                      <option value="E">E</option>
                    </select>
                    <input value={question.explanation} onChange={(event) => updatePassageQuestion(index, { explanation: event.target.value })} className="rounded border border-gray-300 bg-white px-3 py-2 text-sm" placeholder="explanation" />
                  </div>
                </div>
              </div>
            ))}
          </div>

          <button type="button" onClick={addPassageQuestion} className="inline-flex items-center gap-1 rounded border border-gray-300 bg-white px-3 py-2 text-sm hover:bg-gray-50">
            <Plus className="h-4 w-4" />
            Add question
          </button>

          <div className="flex justify-end">
            <button type="button" disabled={isLoading} onClick={postPassageQuiz} className="inline-flex items-center rounded bg-gray-900 px-4 py-2 text-sm font-semibold text-white disabled:opacity-60">
              {isLoading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              Post passage quiz and add
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

