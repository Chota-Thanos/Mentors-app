"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { toast } from "sonner";

import { useProfile } from "@/context/ProfileContext";
import { roleIsMainsExpert, roleIsModerator, roleIsPrelimsExpert } from "@/lib/accessControl";
import { richTextToPlainText } from "@/lib/richText";
import { createClient } from "@/lib/supabase/client";

export interface CollectionContentListItem {
  collection_item_id: number;
  content_item_id: number;
  order: number;
  title: string | null;
  type: string;
  data?: Record<string, unknown> | null;
  description?: string;
  is_free?: boolean;
  url?: string;
}

interface CollectionContentListProps {
  collectionId: number;
  manageHref: string;
  items: CollectionContentListItem[];
}

interface ContentItemResponse {
  id: number;
  title?: string | null;
  type?: string | null;
  data?: Record<string, unknown> | null;
}

type QuizEditState = {
  title: string;
  question_statement: string;
  supplementary_statement: string;
  statements_facts: string;
  question_prompt: string;
  option_a: string;
  option_b: string;
  option_c: string;
  option_d: string;
  option_e: string;
  correct_answer: string;
  explanation_text: string;
  source_reference: string;
};

type MainsEditState = {
  title: string;
  question_text: string;
  answer_approach: string;
  model_answer: string;
  answer_style_guidance: string;
  word_limit: string;
  max_marks: string;
};

type OptionShape = { label: string; text: string };

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : {};
}

function asText(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function asNumber(value: unknown): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function parseLines(value: string): string[] {
  return value.split("\n").map((line) => line.trim()).filter(Boolean);
}

function normalizeOptions(data: Record<string, unknown>): OptionShape[] {
  if (Array.isArray(data.options)) {
    const fromOptions = data.options
      .map((option) => {
        const record = asRecord(option);
        const label = asText(record.label).toUpperCase();
        const text = asText(record.text);
        return label && text ? { label, text } : null;
      })
      .filter((option): option is OptionShape => Boolean(option));
    if (fromOptions.length > 0) return fromOptions;
  }
  const fallback: OptionShape[] = [];
  for (const label of ["A", "B", "C", "D", "E"] as const) {
    const text = asText(data[`option_${label.toLowerCase()}`]);
    if (text) fallback.push({ label, text });
  }
  return fallback;
}

function isStandardQuiz(item: CollectionContentListItem): boolean {
  return item.type === "quiz_gk" || item.type === "quiz_maths";
}

function isPassageQuiz(item: CollectionContentListItem): boolean {
  return item.type === "quiz_passage";
}

function isMainsQuestion(item: CollectionContentListItem): boolean {
  return item.type === "question";
}

function itemHeading(item: CollectionContentListItem): string {
  const data = asRecord(item.data);
  return asText(item.title) || asText(data.question_statement || data.question_text || data.passage_title) || `Item #${item.content_item_id}`;
}

function itemExcerpt(item: CollectionContentListItem): string {
  const data = asRecord(item.data);
  const description = richTextToPlainText(item.description || "").trim();
  if (description) return description;
  if (isStandardQuiz(item)) return asText(data.question_statement || data.question_prompt) || "Question ready for review.";
  if (isPassageQuiz(item)) return `${Array.isArray(data.questions) ? data.questions.length : 0} passage question(s) attached.`;
  if (isMainsQuestion(item)) return asText(data.question_text) || "Mains question ready for review.";
  return "Content item ready for review.";
}

function buildQuizEdit(item: CollectionContentListItem): QuizEditState {
  const data = asRecord(item.data);
  const options = normalizeOptions(data);
  const statements = Array.isArray(data.statements_facts) ? data.statements_facts : Array.isArray(data.statement_facts) ? data.statement_facts : [];
  return {
    title: asText(item.title),
    question_statement: asText(data.question_statement),
    supplementary_statement: asText(data.supplementary_statement || data.supp_question_statement),
    statements_facts: statements.map((row) => asText(row)).filter(Boolean).join("\n"),
    question_prompt: asText(data.question_prompt),
    option_a: options.find((option) => option.label === "A")?.text || "",
    option_b: options.find((option) => option.label === "B")?.text || "",
    option_c: options.find((option) => option.label === "C")?.text || "",
    option_d: options.find((option) => option.label === "D")?.text || "",
    option_e: options.find((option) => option.label === "E")?.text || "",
    correct_answer: asText(data.correct_answer || data.answer).toUpperCase() || "A",
    explanation_text: asText(data.explanation_text || data.explanation),
    source_reference: asText(data.source_reference || data.source),
  };
}

function buildMainsEdit(item: CollectionContentListItem): MainsEditState {
  const data = asRecord(item.data);
  return {
    title: asText(item.title),
    question_text: asText(data.question_text),
    answer_approach: asText(data.answer_approach),
    model_answer: asText(data.model_answer),
    answer_style_guidance: asText(data.answer_style_guidance),
    word_limit: String(asNumber(data.word_limit) || ""),
    max_marks: String(asNumber(data.max_marks) || ""),
  };
}

function mergeUpdated(current: CollectionContentListItem, updated: ContentItemResponse): CollectionContentListItem {
  const data = updated.data && typeof updated.data === "object" ? updated.data : current.data || null;
  return {
    ...current,
    title: typeof updated.title === "string" ? updated.title : current.title,
    type: typeof updated.type === "string" && updated.type.trim() ? updated.type : current.type,
    data,
    description: asText(asRecord(data).description) || current.description,
    url: asText(asRecord(data).url) || current.url,
  };
}

export default function CollectionContentList({ collectionId, manageHref, items }: CollectionContentListProps) {
  const router = useRouter();
  void collectionId;
  const { role } = useProfile();
  const [rows, setRows] = useState(items);
  const [previewId, setPreviewId] = useState<number | null>(null);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [quizEdit, setQuizEdit] = useState<QuizEditState | null>(null);
  const [mainsEdit, setMainsEdit] = useState<MainsEditState | null>(null);
  const [savingId, setSavingId] = useState<number | null>(null);
  const [deletingId, setDeletingId] = useState<number | null>(null);

  const canManage = useMemo(
    () => roleIsModerator(role) || roleIsPrelimsExpert(role) || roleIsMainsExpert(role),
    [role],
  );

  const previewItem = useMemo(() => rows.find((item) => item.collection_item_id === previewId) || null, [previewId, rows]);
  const editingItem = useMemo(() => rows.find((item) => item.collection_item_id === editingId) || null, [editingId, rows]);

  const closeEdit = () => {
    setEditingId(null);
    setQuizEdit(null);
    setMainsEdit(null);
  };

  const openEdit = (item: CollectionContentListItem) => {
    setEditingId(item.collection_item_id);
    if (isStandardQuiz(item)) {
      setQuizEdit(buildQuizEdit(item));
      setMainsEdit(null);
      return;
    }
    if (isMainsQuestion(item)) {
      setMainsEdit(buildMainsEdit(item));
      setQuizEdit(null);
      return;
    }
    setQuizEdit(null);
    setMainsEdit(null);
  };

  const saveEdit = async () => {
    if (!editingItem) return;
    const currentData = asRecord(editingItem.data);
    setSavingId(editingItem.collection_item_id);
    try {
      const supabase = createClient();
      if (isStandardQuiz(editingItem) && quizEdit) {
        const options = [
          { label: "A", text: quizEdit.option_a.trim() },
          { label: "B", text: quizEdit.option_b.trim() },
          { label: "C", text: quizEdit.option_c.trim() },
          { label: "D", text: quizEdit.option_d.trim() },
          ...(quizEdit.option_e.trim() ? [{ label: "E", text: quizEdit.option_e.trim() }] : []),
        ].filter((option) => option.text);
        const facts = parseLines(quizEdit.statements_facts);
        const correctAnswer = (quizEdit.correct_answer || "A").trim().toUpperCase();
        const { data, error } = await supabase
          .from("quizzes")
          .update({
            title: quizEdit.title.trim() || quizEdit.question_statement.trim().slice(0, 120) || editingItem.title,
            question_statement: quizEdit.question_statement.trim(),
            supp_question_statement: quizEdit.supplementary_statement.trim() || null,
            statements_facts: facts,
            question_prompt: quizEdit.question_prompt.trim() || null,
            options,
            correct_answer: correctAnswer,
            explanation: quizEdit.explanation_text.trim() || null,
          })
          .eq("id", editingItem.content_item_id)
          .select("id,title,quiz_type,question_statement,supp_question_statement,statements_facts,question_prompt,options,correct_answer,explanation")
          .single();
        if (error) throw error;
        const updated: ContentItemResponse = {
          id: Number(data.id),
          title: quizEdit.title.trim() || quizEdit.question_statement.trim().slice(0, 120) || editingItem.title,
          type: data.quiz_type === "maths" ? "quiz_maths" : "quiz_gk",
          data: {
            ...currentData,
            question_statement: quizEdit.question_statement.trim(),
            supp_question_statement: quizEdit.supplementary_statement.trim() || null,
            supplementary_statement: quizEdit.supplementary_statement.trim() || null,
            statements_facts: facts,
            statement_facts: facts,
            question_prompt: quizEdit.question_prompt.trim() || null,
            options,
            correct_answer: correctAnswer,
            answer: correctAnswer,
            explanation: quizEdit.explanation_text.trim() || null,
            explanation_text: quizEdit.explanation_text.trim() || null,
            source_reference: quizEdit.source_reference.trim() || null,
            source: quizEdit.source_reference.trim() || null,
          },
        };
        setRows((current) => current.map((item) => item.collection_item_id === editingItem.collection_item_id ? mergeUpdated(item, updated) : item));
        toast.success("Question updated.");
        closeEdit();
        router.refresh();
        return;
      }

      if (isMainsQuestion(editingItem) && mainsEdit) {
        const { data, error } = await supabase
          .from("mains_questions")
          .update({
            question_text: mainsEdit.question_text.trim(),
            approach: mainsEdit.answer_approach.trim() || null,
            model_answer: mainsEdit.model_answer.trim() || null,
            word_limit: Math.max(0, Number(mainsEdit.word_limit) || 0),
          })
          .eq("id", editingItem.content_item_id)
          .select("id,question_text,approach,model_answer,word_limit,source_reference")
          .single();
        if (error) throw error;
        const updated: ContentItemResponse = {
          id: Number(data.id),
          title: mainsEdit.title.trim() || mainsEdit.question_text.trim().slice(0, 120) || editingItem.title,
          type: "question",
          data: {
            ...currentData,
            question_text: data.question_text,
            answer_approach: data.approach || null,
            model_answer: data.model_answer || null,
            answer_style_guidance: mainsEdit.answer_style_guidance.trim() || currentData.answer_style_guidance || null,
            word_limit: data.word_limit,
            max_marks: Math.max(0, Number(mainsEdit.max_marks) || 0),
          },
        };
        setRows((current) => current.map((item) => item.collection_item_id === editingItem.collection_item_id ? mergeUpdated(item, updated) : item));
        toast.success("Question updated.");
        closeEdit();
        router.refresh();
      }
    } catch (error: unknown) {
      toast.error("Update failed", { description: error instanceof Error ? error.message : "The item could not be updated." });
    } finally {
      setSavingId(null);
    }
  };

  const deleteItem = async (item: CollectionContentListItem) => {
    if (!window.confirm("Remove this question from the test?")) return;
    setDeletingId(item.collection_item_id);
    try {
      const supabase = createClient();
      const { error } = await supabase
        .from("premium_collection_items")
        .delete()
        .eq("id", item.collection_item_id);
      if (error) throw error;
      setRows((current) => current.filter((row) => row.collection_item_id !== item.collection_item_id));
      if (previewId === item.collection_item_id) setPreviewId(null);
      if (editingId === item.collection_item_id) closeEdit();
      toast.success("Question removed from this test.");
      router.refresh();
    } catch (error: unknown) {
      toast.error("Delete failed", { description: error instanceof Error ? error.message : "The item could not be removed." });
    } finally {
      setDeletingId(null);
    }
  };

  const renderPreview = (item: CollectionContentListItem) => {
    const data = asRecord(item.data);
    if (isStandardQuiz(item)) {
      const statements = Array.isArray(data.statements_facts) ? data.statements_facts : Array.isArray(data.statement_facts) ? data.statement_facts : [];
      const options = normalizeOptions(data);
      const correctAnswer = asText(data.correct_answer || data.answer).toUpperCase();
      let questionText = asText(data.question_statement);
      let promptText = asText(data.question_prompt);
      const supplementaryText = asText(data.supplementary_statement || data.supp_question_statement);
      const promptLikePattern = /\b(which|what|how many|how much|select|choose|identify|find|determine)\b.+\?/i;
      if (statements.length > 0 && questionText && !promptText && promptLikePattern.test(questionText)) {
        promptText = questionText;
        questionText = supplementaryText || "Consider the following statements:";
      } else if (!questionText && statements.length > 0) {
        questionText = supplementaryText || "Consider the following statements:";
      }
      return (
        <div className="space-y-4">
          <p className="text-sm text-slate-700 whitespace-pre-line">{questionText}</p>
          {supplementaryText && supplementaryText !== questionText ? <p className="text-sm text-slate-600 whitespace-pre-line">{supplementaryText}</p> : null}
          {statements.length > 0 ? <div className="space-y-1">{statements.map((statement, index) => <p key={`${item.collection_item_id}-${index}`} className="text-sm text-slate-700">{index + 1}. {asText(statement)}</p>)}</div> : null}
          {promptText ? <p className="text-sm text-slate-600">{promptText}</p> : null}
          <div className="space-y-2">{options.map((option) => <div key={`${item.collection_item_id}-${option.label}`} className={`rounded border px-3 py-2 text-sm ${option.label === correctAnswer ? "border-emerald-300 bg-emerald-50 text-emerald-900" : "border-slate-200 bg-slate-50 text-slate-700"}`}><span className="font-semibold">{option.label}.</span> {option.text}</div>)}</div>
          {asText(data.explanation_text || data.explanation) ? <p className="text-sm text-slate-700 whitespace-pre-line">{asText(data.explanation_text || data.explanation)}</p> : null}
        </div>
      );
    }
    if (isPassageQuiz(item)) {
      const questions = Array.isArray(data.questions) ? data.questions : [];
      return (
        <div className="space-y-4">
          {asText(data.passage_title) ? <p className="text-sm font-semibold text-slate-900">{asText(data.passage_title)}</p> : null}
          {asText(data.passage_text) ? <p className="text-sm text-slate-700 whitespace-pre-line">{asText(data.passage_text)}</p> : null}
          <div className="space-y-3">{questions.map((question, index) => <div key={`${item.collection_item_id}-passage-${index}`} className="rounded border border-slate-200 bg-slate-50 p-3"><p className="text-sm font-semibold text-slate-900">{index + 1}. {asText(asRecord(question).question_statement)}</p></div>)}</div>
        </div>
      );
    }
    if (isMainsQuestion(item)) {
      return (
        <div className="space-y-4">
          <p className="text-sm text-slate-700 whitespace-pre-line">{asText(data.question_text)}</p>
          <p className="text-sm text-slate-600">Word limit: {asNumber(data.word_limit) || "n/a"} | Max marks: {asNumber(data.max_marks) || "n/a"}</p>
          {asText(data.answer_approach) ? <p className="text-sm text-slate-700 whitespace-pre-line">{asText(data.answer_approach)}</p> : null}
          {asText(data.model_answer) ? <p className="text-sm text-slate-700 whitespace-pre-line">{asText(data.model_answer)}</p> : null}
        </div>
      );
    }
    return (
      <div className="space-y-3">
        <p className="text-sm text-slate-700">{itemExcerpt(item)}</p>
        {item.url ? <a href={item.url} target="_blank" rel="noreferrer" className="inline-flex rounded border border-slate-300 px-3 py-2 text-sm font-semibold text-slate-700">Open content link</a> : null}
      </div>
    );
  };

  return (
    <>
      {rows.length === 0 ? (
        <div className="rounded-xl border-2 border-dashed border-slate-200 bg-slate-50 py-16 text-center">
          <p className="font-medium text-slate-500">No content items remain in this test.</p>
        </div>
      ) : null}

      <div className="grid gap-4 md:grid-cols-1">
        {rows.map((item) => (
          <article key={item.collection_item_id} className="rounded-xl border border-slate-200 bg-white p-5 transition-all hover:border-slate-300 hover:shadow-md">
            <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <p className="text-base font-semibold text-slate-900">{itemHeading(item)}</p>
                  <span className="inline-flex items-center rounded-full bg-slate-100 px-2.5 py-0.5 text-xs font-medium text-slate-600">{item.type}</span>
                  <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${item.is_free ? "bg-green-50 text-green-700 ring-1 ring-inset ring-green-600/20" : "bg-slate-100 text-slate-600 ring-1 ring-inset ring-slate-500/10"}`}>
                    {item.is_free ? "Free" : "Locked"}
                  </span>
                </div>
                <p className="mt-1 line-clamp-2 text-sm text-slate-500">{itemExcerpt(item)}</p>
              </div>

              <div className="flex flex-wrap gap-2">
                <button type="button" onClick={() => setPreviewId(item.collection_item_id)} className="rounded-md border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50">
                  View
                </button>
                {canManage ? (
                  isStandardQuiz(item) || isMainsQuestion(item) ? (
                    <button type="button" onClick={() => openEdit(item)} className="rounded-md border border-indigo-300 bg-indigo-50 px-3 py-2 text-sm font-medium text-indigo-700 hover:bg-indigo-100">
                      Edit
                    </button>
                  ) : (
                    <Link href={manageHref} className="rounded-md border border-indigo-300 bg-indigo-50 px-3 py-2 text-sm font-medium text-indigo-700 hover:bg-indigo-100">
                      Edit
                    </Link>
                  )
                ) : null}
                {canManage ? (
                  <button
                    type="button"
                    onClick={() => void deleteItem(item)}
                    disabled={deletingId === item.collection_item_id}
                    className="rounded-md border border-rose-300 bg-rose-50 px-3 py-2 text-sm font-medium text-rose-700 hover:bg-rose-100 disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    {deletingId === item.collection_item_id ? "Deleting..." : "Delete"}
                  </button>
                ) : null}
              </div>
            </div>
          </article>
        ))}
      </div>

      {previewItem ? (
        <div className="fixed inset-0 z-50 bg-slate-900/50 p-4">
          <div className="mx-auto flex min-h-full max-w-4xl items-center justify-center">
            <div className="max-h-[90vh] w-full overflow-y-auto rounded-2xl border border-slate-200 bg-white p-6 shadow-xl">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-500">Question preview</p>
                  <h3 className="mt-1 text-2xl font-bold text-slate-900">{itemHeading(previewItem)}</h3>
                </div>
                <button type="button" onClick={() => setPreviewId(null)} className="rounded border border-slate-300 px-3 py-2 text-sm text-slate-700">
                  Close
                </button>
              </div>
              <div className="mt-6">{renderPreview(previewItem)}</div>
            </div>
          </div>
        </div>
      ) : null}

      {editingItem ? (
        <div className="fixed inset-0 z-50 bg-slate-900/50 p-4">
          <div className="mx-auto flex min-h-full max-w-4xl items-center justify-center">
            <div className="max-h-[90vh] w-full overflow-y-auto rounded-2xl border border-slate-200 bg-white p-6 shadow-xl">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-500">Edit question</p>
                  <h3 className="mt-1 text-2xl font-bold text-slate-900">{itemHeading(editingItem)}</h3>
                </div>
                <button type="button" onClick={closeEdit} className="rounded border border-slate-300 px-3 py-2 text-sm text-slate-700">
                  Close
                </button>
              </div>

              {isStandardQuiz(editingItem) && quizEdit ? (
                <div className="mt-6 space-y-3">
                  <input value={quizEdit.title} onChange={(event) => setQuizEdit((current) => (current ? { ...current, title: event.target.value } : current))} className="w-full rounded border border-slate-300 px-3 py-2 text-sm" placeholder="Question title" />
                  <textarea value={quizEdit.question_statement} onChange={(event) => setQuizEdit((current) => (current ? { ...current, question_statement: event.target.value } : current))} rows={4} className="w-full rounded border border-slate-300 px-3 py-2 text-sm" placeholder="Question statement" />
                  <textarea value={quizEdit.supplementary_statement} onChange={(event) => setQuizEdit((current) => (current ? { ...current, supplementary_statement: event.target.value } : current))} rows={3} className="w-full rounded border border-slate-300 px-3 py-2 text-sm" placeholder="Supplementary statement" />
                  <textarea value={quizEdit.statements_facts} onChange={(event) => setQuizEdit((current) => (current ? { ...current, statements_facts: event.target.value } : current))} rows={4} className="w-full rounded border border-slate-300 px-3 py-2 text-sm" placeholder="Statements / facts, one per line" />
                  <input value={quizEdit.question_prompt} onChange={(event) => setQuizEdit((current) => (current ? { ...current, question_prompt: event.target.value } : current))} className="w-full rounded border border-slate-300 px-3 py-2 text-sm" placeholder="Question prompt" />
                  <div className="grid gap-3 md:grid-cols-2">
                    <input value={quizEdit.option_a} onChange={(event) => setQuizEdit((current) => (current ? { ...current, option_a: event.target.value } : current))} className="rounded border border-slate-300 px-3 py-2 text-sm" placeholder="Option A" />
                    <input value={quizEdit.option_b} onChange={(event) => setQuizEdit((current) => (current ? { ...current, option_b: event.target.value } : current))} className="rounded border border-slate-300 px-3 py-2 text-sm" placeholder="Option B" />
                    <input value={quizEdit.option_c} onChange={(event) => setQuizEdit((current) => (current ? { ...current, option_c: event.target.value } : current))} className="rounded border border-slate-300 px-3 py-2 text-sm" placeholder="Option C" />
                    <input value={quizEdit.option_d} onChange={(event) => setQuizEdit((current) => (current ? { ...current, option_d: event.target.value } : current))} className="rounded border border-slate-300 px-3 py-2 text-sm" placeholder="Option D" />
                    <input value={quizEdit.option_e} onChange={(event) => setQuizEdit((current) => (current ? { ...current, option_e: event.target.value } : current))} className="rounded border border-slate-300 px-3 py-2 text-sm md:col-span-2" placeholder="Option E (optional)" />
                  </div>
                  <div className="grid gap-3 md:grid-cols-2">
                    <select value={quizEdit.correct_answer} onChange={(event) => setQuizEdit((current) => (current ? { ...current, correct_answer: event.target.value } : current))} className="rounded border border-slate-300 px-3 py-2 text-sm">
                      {["A", "B", "C", "D", "E"].map((label) => <option key={label} value={label}>Correct answer: {label}</option>)}
                    </select>
                    <input value={quizEdit.source_reference} onChange={(event) => setQuizEdit((current) => (current ? { ...current, source_reference: event.target.value } : current))} className="rounded border border-slate-300 px-3 py-2 text-sm" placeholder="Source reference" />
                  </div>
                  <textarea value={quizEdit.explanation_text} onChange={(event) => setQuizEdit((current) => (current ? { ...current, explanation_text: event.target.value } : current))} rows={5} className="w-full rounded border border-slate-300 px-3 py-2 text-sm" placeholder="Explanation" />
                </div>
              ) : null}

              {isMainsQuestion(editingItem) && mainsEdit ? (
                <div className="mt-6 space-y-3">
                  <input value={mainsEdit.title} onChange={(event) => setMainsEdit((current) => (current ? { ...current, title: event.target.value } : current))} className="w-full rounded border border-slate-300 px-3 py-2 text-sm" placeholder="Question title" />
                  <textarea value={mainsEdit.question_text} onChange={(event) => setMainsEdit((current) => (current ? { ...current, question_text: event.target.value } : current))} rows={5} className="w-full rounded border border-slate-300 px-3 py-2 text-sm" placeholder="Question text" />
                  <div className="grid gap-3 md:grid-cols-2">
                    <input value={mainsEdit.word_limit} onChange={(event) => setMainsEdit((current) => (current ? { ...current, word_limit: event.target.value } : current))} className="rounded border border-slate-300 px-3 py-2 text-sm" placeholder="Word limit" />
                    <input value={mainsEdit.max_marks} onChange={(event) => setMainsEdit((current) => (current ? { ...current, max_marks: event.target.value } : current))} className="rounded border border-slate-300 px-3 py-2 text-sm" placeholder="Max marks" />
                  </div>
                  <textarea value={mainsEdit.answer_approach} onChange={(event) => setMainsEdit((current) => (current ? { ...current, answer_approach: event.target.value } : current))} rows={4} className="w-full rounded border border-slate-300 px-3 py-2 text-sm" placeholder="Answer approach" />
                  <textarea value={mainsEdit.model_answer} onChange={(event) => setMainsEdit((current) => (current ? { ...current, model_answer: event.target.value } : current))} rows={6} className="w-full rounded border border-slate-300 px-3 py-2 text-sm" placeholder="Model answer" />
                  <textarea value={mainsEdit.answer_style_guidance} onChange={(event) => setMainsEdit((current) => (current ? { ...current, answer_style_guidance: event.target.value } : current))} rows={4} className="w-full rounded border border-slate-300 px-3 py-2 text-sm" placeholder="Answer style guidance" />
                </div>
              ) : null}

              {!isStandardQuiz(editingItem) && !isMainsQuestion(editingItem) ? (
                <div className="mt-6 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">
                  This item type is not edited inline here yet. Open the question management workspace for structured editing.
                </div>
              ) : null}

              <div className="mt-6 flex flex-wrap justify-end gap-2">
                <button type="button" onClick={closeEdit} className="rounded border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-700">Cancel</button>
                {isStandardQuiz(editingItem) || isMainsQuestion(editingItem) ? (
                  <button type="button" onClick={() => void saveEdit()} disabled={savingId === editingItem.collection_item_id} className="rounded bg-slate-900 px-4 py-2 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-60">
                    {savingId === editingItem.collection_item_id ? "Saving..." : "Save Changes"}
                  </button>
                ) : (
                  <Link href={manageHref} className="rounded bg-slate-900 px-4 py-2 text-sm font-semibold text-white">
                    Open Question Management
                  </Link>
                )}
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
