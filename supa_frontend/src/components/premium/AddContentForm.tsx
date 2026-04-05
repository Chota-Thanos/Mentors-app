"use client";

import { Loader2, Plus, Trash2 } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import axios from "axios";

import { premiumApi } from "@/lib/premiumApi";
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

export default function AddContentForm({ collectionId }: AddContentFormProps) {
  const router = useRouter();
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
        const params: Record<string, number> = {};
        if (existingFilterCategoryIds.length === 1) params.category_id = existingFilterCategoryIds[0];

        const response = await premiumApi.get<PremiumContentItem[]>(`/quizzes/${quizKind}`, { params });
        const rows = Array.isArray(response.data) ? response.data : [];

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
        const description = axios.isAxiosError(error) ? error.message : "Unknown error";
        toast.error("Failed to load quizzes", { description });
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
      const items = selectedContentIds.map((contentItemId) => ({ content_item_id: contentItemId, order: -1 }));
      await premiumApi.post(`/collections/${collectionId}/items/bulk-add`, { items });
      toast.success("Content added to test");
      router.push(`/collections/${collectionId}`);
      router.refresh();
    } catch (error: unknown) {
      const description = axios.isAxiosError(error)
        ? (typeof error.response?.data?.detail === "string" ? error.response.data.detail : error.message)
        : "Unknown error";
      toast.error("Failed to add content", { description });
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
      await premiumApi.post(`/quizzes/${quizKind}/bulk`, {
        title_prefix: titlePrefix || `${quizTitle} Quiz`,
        collection_id: Number(collectionId),
        exam_id: null,
        items: [
          {
            question_statement: questionDraft.question_statement,
            supp_question_statement: questionDraft.supp_question_statement || null,
            supplementary_statement: questionDraft.supp_question_statement || null,
            statements_facts: statementsFacts,
            question_prompt: questionDraft.question_prompt || null,
            option_a: questionDraft.option_a,
            option_b: questionDraft.option_b,
            option_c: questionDraft.option_c,
            option_d: questionDraft.option_d,
            option_e: questionDraft.option_e || null,
            options: optionPayload,
            correct_answer: questionDraft.correct_answer,
            answer: questionDraft.correct_answer,
            explanation: questionDraft.explanation || null,
            explanation_text: questionDraft.explanation || null,
            source_reference: questionDraft.source_reference || null,
            source: questionDraft.source_reference || null,
            category_ids: selectedCategoryIds,
            premium_gk_category_ids: quizKind === "gk" ? selectedCategoryIds : [],
            premium_maths_category_ids: quizKind === "maths" ? selectedCategoryIds : [],
            alpha_cat_ids: alphaIds,
          },
        ],
      });
      toast.success(`${quizTitle} quiz posted`);
      setQuestionDraft(EMPTY_QUESTION);
      router.push(`/collections/${collectionId}`);
      router.refresh();
    } catch (error: unknown) {
      const description = axios.isAxiosError(error)
        ? (typeof error.response?.data?.detail === "string" ? error.response.data.detail : error.message)
        : "Unknown error";
      toast.error("Failed to post quiz", { description });
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

    setIsLoading(true);
    try {
      const passageAlphaIds = parseCsvToIds(passageAlphaCatIdsCsv);
      await premiumApi.post("/quizzes/passage", {
        passage_title: passageTitle || null,
        passage_text: passageText,
        source_reference: passageSource || null,
        category_ids: selectedCategoryIds,
        premium_passage_category_ids: selectedCategoryIds,
        alpha_cat_ids: passageAlphaIds,
        collection_id: Number(collectionId),
        exam_id: null,
        questions: passageQuestions.map((question) => ({
          question_statement: question.question_statement,
          supp_question_statement: question.supp_question_statement || null,
          supplementary_statement: question.supp_question_statement || null,
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
          explanation_text: question.explanation || null,
        })),
      });
      toast.success("Passage quiz posted");
      setPassageTitle("");
      setPassageText("");
      setPassageSource("");
      setPassageAlphaCatIdsCsv("");
      setPassageQuestions([EMPTY_PASSAGE_QUESTION]);
      router.push(`/collections/${collectionId}`);
      router.refresh();
    } catch (error: unknown) {
      const description = axios.isAxiosError(error)
        ? (typeof error.response?.data?.detail === "string" ? error.response.data.detail : error.message)
        : "Unknown error";
      toast.error("Failed to post passage quiz", { description });
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

