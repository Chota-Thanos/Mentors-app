
"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import axios from "axios";
import { ArrowLeft, BookOpen, Calculator, ChevronLeft, ChevronRight, FileText, ListPlus, Loader2, Plus, X } from "lucide-react";
import { toast } from "sonner";

import { premiumApi, premiumApiRoot, premiumCompatApi } from "@/lib/premiumApi";
import type { PremiumExam, QuizKind } from "@/types/premium";

type CategoryNode = { id: number; name: string; children?: CategoryNode[]; total_question_count?: number | null };
type QuestionItem = { id: number; title: string; statement: string; isAttempted: boolean };
type Selection = {
  id: string;
  kind: "category" | "question";
  quizType: QuizKind;
  examId: number;
  categoryId: number;
  categoryName: string;
  count: number;
  includeAttempted: boolean;
  questionIds: number[];
};

type AddSheetState = {
  open: boolean;
  node: CategoryNode | null;
  loading: boolean;
  availableTotal: number;
  availableFresh: number;
  inputCount: string;
  includeAttempted: boolean;
};

type ManualModalState = {
  open: boolean;
  node: CategoryNode | null;
  loading: boolean;
  questions: QuestionItem[];
  selectedIds: number[];
  search: string;
};

const QUIZ_OPTIONS: Array<{ value: QuizKind; label: string; icon: typeof BookOpen }> = [
  { value: "gk", label: "GK / GS", icon: BookOpen },
  { value: "maths", label: "CSAT / Maths", icon: Calculator },
  { value: "passage", label: "Passage", icon: FileText },
];

const toErr = (e: unknown) => {
  if (!axios.isAxiosError(e)) return "Unknown error";
  return typeof e.response?.data?.detail === "string" ? e.response.data.detail : e.message;
};

const mapQuiz = (v: string | null): QuizKind => {
  const x = (v || "").toLowerCase();
  if (x === "math" || x === "maths") return "maths";
  if (x === "passage") return "passage";
  return "gk";
};

const attempted = (row: Record<string, unknown>) => {
  const data = (row.data || {}) as Record<string, unknown>;
  const flags = [row.is_attempted, row.user_attempted, data.is_attempted, data.user_attempted];
  return flags.some((v) => v === true || v === 1 || v === "1" || v === "true");
};

const flatQuestion = (row: Record<string, unknown>): QuestionItem | null => {
  const id = Number(row.id);
  if (!Number.isFinite(id)) return null;
  const data = (row.data || {}) as Record<string, unknown>;
  return {
    id,
    title: String(row.title || `Quiz #${id}`),
    statement: String(data.question_statement || data.passage_text || data.passage_title || ""),
    isAttempted: attempted(row),
  };
};

export default function UserCollectionBuilder() {
  const router = useRouter();
  const searchParams = useSearchParams();

  const [collectionName, setCollectionName] = useState(() => searchParams.get("prefill_name") || "");
  const [maxQuestions, setMaxQuestions] = useState("10");
  const [quizType, setQuizType] = useState<QuizKind>(() => mapQuiz(searchParams.get("quizType") || searchParams.get("quiz_type")));
  const [selectedExamId, setSelectedExamId] = useState<number | null>(() => {
    const v = Number(searchParams.get("exam_id"));
    return Number.isFinite(v) ? v : null;
  });

  const [exams, setExams] = useState<PremiumExam[]>([]);
  const [tree, setTree] = useState<CategoryNode[]>([]);
  const [active, setActive] = useState<CategoryNode | null>(null);
  const [history, setHistory] = useState<CategoryNode[]>([]);
  const [selections, setSelections] = useState<Selection[]>([]);

  const [loadingExams, setLoadingExams] = useState(false);
  const [loadingCats, setLoadingCats] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const [addSheet, setAddSheet] = useState<AddSheetState>({
    open: false,
    node: null,
    loading: false,
    availableTotal: 0,
    availableFresh: 0,
    inputCount: "",
    includeAttempted: false,
  });

  const [manual, setManual] = useState<ManualModalState>({ open: false, node: null, loading: false, questions: [], selectedIds: [], search: "" });
  const maxTotal = useMemo(() => {
    const n = Number(maxQuestions);
    return Number.isFinite(n) && n > 0 ? n : 0;
  }, [maxQuestions]);

  const totalSelected = useMemo(() => selections.reduce((s, i) => s + i.count, 0), [selections]);
  const nodes = useMemo(() => (active ? active.children || [] : tree), [active, tree]);

  const summaryRows = useMemo(() => {
    const m = new Map<string, { quizType: QuizKind; categoryName: string; count: number; ids: string[] }>();
    for (const s of selections) {
      const k = `${s.quizType}-${s.categoryId}`;
      const e = m.get(k);
      if (e) {
        e.count += s.count;
        e.ids.push(s.id);
      } else {
        m.set(k, { quizType: s.quizType, categoryName: s.categoryName, count: s.count, ids: [s.id] });
      }
    }
    return Array.from(m.entries()).map(([key, row]) => ({ key, ...row }));
  }, [selections]);

  const filteredQuestions = useMemo(() => {
    const q = manual.search.trim().toLowerCase();
    if (!q) return manual.questions;
    return manual.questions.filter((i) => i.title.toLowerCase().includes(q) || i.statement.toLowerCase().includes(q));
  }, [manual]);

  useEffect(() => {
    const run = async () => {
      setLoadingExams(true);
      try {
        const res = await premiumApi.get<PremiumExam[]>("/exams", { params: { active_only: true } });
        const rows = res.data || [];
        setExams(rows);
        if (rows.length && (selectedExamId === null || !rows.some((x) => x.id === selectedExamId))) setSelectedExamId(rows[0].id);
      } catch (e: unknown) {
        setExams([]);
        toast.error("Failed to load exams", { description: toErr(e) });
      } finally {
        setLoadingExams(false);
      }
    };
    run();
  }, [selectedExamId]);

  useEffect(() => {
    const run = async () => {
      if (!selectedExamId) {
        setTree([]);
        return;
      }
      setLoadingCats(true);
      try {
        const res = await axios.get<CategoryNode[]>(`${premiumApiRoot}/api/v1/premium-categories/${quizType}/`, {
          params: { hierarchical: true, exam_id: selectedExamId },
        });
        setTree(res.data || []);
      } catch (e: unknown) {
        setTree([]);
        toast.error("Failed to load categories", { description: toErr(e) });
      } finally {
        setLoadingCats(false);
      }
    };
    run();
  }, [quizType, selectedExamId]);

  useEffect(() => {
    setActive(null);
    setHistory([]);
  }, [tree]);

  const fetchQuestions = async (k: QuizKind, examId: number, categoryId: number) => {
    const res = await premiumApi.get<Record<string, unknown>[]>(`/quizzes/${k}`, { params: { category_id: categoryId, exam_id: examId, limit: 1000 } });
    return res.data || [];
  };

  const openAddSheet = async (node: CategoryNode) => {
    if (!selectedExamId) return toast.error("Select exam first");
    const id = `category-${quizType}-${selectedExamId}-${node.id}`;
    const existing = selections.find((s) => s.id === id);
    setAddSheet({ open: true, node, loading: true, availableTotal: 0, availableFresh: 0, inputCount: existing ? String(existing.count) : "", includeAttempted: existing?.includeAttempted || false });
    try {
      const rows = await fetchQuestions(quizType, selectedExamId, node.id);
      setAddSheet((p) => ({ ...p, loading: false, availableTotal: rows.length, availableFresh: rows.filter((r) => !attempted(r)).length }));
    } catch (e: unknown) {
      setAddSheet((p) => ({ ...p, loading: false }));
      toast.error("Failed to load category questions", { description: toErr(e) });
    }
  };

  const saveAddSelection = () => {
    if (!addSheet.node || !selectedExamId) return;
    const count = Number(addSheet.inputCount);
    if (!Number.isFinite(count) || count <= 0) return toast.error("Enter a valid count");
    const maxAvail = addSheet.includeAttempted ? addSheet.availableTotal : addSheet.availableFresh;
    if (count > maxAvail) return toast.error(`Only ${maxAvail} questions available for this setting`);
    const id = `category-${quizType}-${selectedExamId}-${addSheet.node.id}`;
    setSelections((prev) => {
      const next = prev.filter((x) => x.id !== id);
      const projected = next.reduce((s, x) => s + x.count, 0) + count;
      if (maxTotal > 0 && projected > maxTotal) {
        toast.error(`Max ${maxTotal} questions allowed`);
        return prev;
      }
      return [...next, { id, kind: "category", quizType, examId: selectedExamId, categoryId: addSheet.node!.id, categoryName: addSheet.node!.name, count, includeAttempted: addSheet.includeAttempted, questionIds: [] }];
    });
    setAddSheet((p) => ({ ...p, open: false, node: null }));
  };

  const openManual = async (node: CategoryNode) => {
    if (!selectedExamId) return toast.error("Select exam first");
    const id = `question-${quizType}-${selectedExamId}-${node.id}`;
    const existing = selections.find((s) => s.id === id);
    setManual({ open: true, node, loading: true, questions: [], selectedIds: existing?.questionIds || [], search: "" });
    try {
      const rows = await fetchQuestions(quizType, selectedExamId, node.id);
      setManual((p) => ({ ...p, loading: false, questions: rows.map(flatQuestion).filter((i): i is QuestionItem => i !== null) }));
    } catch (e: unknown) {
      setManual((p) => ({ ...p, loading: false }));
      toast.error("Failed to load questions", { description: toErr(e) });
    }
  };

  const saveManual = () => {
    if (!manual.node || !selectedExamId) return;
    const ids = Array.from(new Set(manual.selectedIds));
    if (!ids.length) return toast.error("Select at least one question");
    const id = `question-${quizType}-${selectedExamId}-${manual.node.id}`;
    setSelections((prev) => {
      const next = prev.filter((x) => x.id !== id);
      const projected = next.reduce((s, x) => s + x.count, 0) + ids.length;
      if (maxTotal > 0 && projected > maxTotal) {
        toast.error(`Max ${maxTotal} questions allowed`);
        return prev;
      }
      return [...next, { id, kind: "question", quizType, examId: selectedExamId, categoryId: manual.node!.id, categoryName: manual.node!.name, count: ids.length, includeAttempted: true, questionIds: ids }];
    });
    setManual((p) => ({ ...p, open: false, node: null }));
  };

  const createTest = async () => {
    if (!collectionName.trim()) return toast.error("Please enter a name");
    if (!selectedExamId) return toast.error("Please select exam");
    if (!selections.length) return toast.error("Add at least one selection");
    setSubmitting(true);
    let collectionId: number | null = null;
    try {
      const created = await premiumCompatApi.post<{ id: number }>("/", {
        name: collectionName.trim(),
        description: null,
        category_ids: [],
        test_kind: "prelims",
      });
      collectionId = Number(created.data?.id || 0);
      if (!collectionId) throw new Error("Prelims Test created but ID missing");

      const picked = new Set<number>();
      for (const s of selections) {
        if (s.kind === "question") {
          for (const id of s.questionIds) picked.add(id);
          continue;
        }
        const rows = await fetchQuestions(s.quizType, s.examId, s.categoryId);
        const ids = rows
          .filter((row) => s.includeAttempted || !attempted(row))
          .map((row) => Number(row.id))
          .filter((id) => Number.isFinite(id) && !picked.has(id));
        if (ids.length < s.count) throw new Error(`Not enough questions in ${s.categoryName}. Requested ${s.count}, found ${ids.length}.`);
        for (const id of ids.slice(0, s.count)) picked.add(id);
      }

      const finalIds = Array.from(picked);
      if (!finalIds.length) throw new Error("No questions selected");

      await premiumApi.post(`/collections/${collectionId}/items/bulk-add`, { items: finalIds.map((content_item_id, order) => ({ content_item_id, order })) });
      await premiumApi.put(`/collections/${collectionId}`, { is_finalized: true });
      toast.success(`Test created with ${finalIds.length} questions`);
      router.push(`/collections/${collectionId}/test`);
    } catch (e: unknown) {
      toast.error("Failed to create test", { description: toErr(e) });
      if (collectionId) router.push(`/collections/${collectionId}`);
    } finally {
      setSubmitting(false);
    }
  };
  return (
    <div className="min-h-screen bg-gray-50/50 pb-20 md:pb-6">
      <div className="mx-auto max-w-4xl space-y-6 p-4 md:p-6">
        <div className="flex items-center gap-2">
          <button type="button" onClick={() => router.push("/collections")} className="inline-flex h-8 w-8 items-center justify-center rounded hover:bg-gray-200">
            <ChevronLeft className="h-5 w-5" />
          </button>
          <h1 className="text-xl font-bold tracking-tight text-gray-900 md:text-2xl">Create New Prelims Test</h1>
        </div>
        <p className="text-sm text-gray-600">
          Need a descriptive answer-writing set?{" "}
          <button
            type="button"
            onClick={() => router.push("/mains/evaluate")}
            className="font-semibold text-indigo-700 hover:text-indigo-900"
          >
            Create a Mains Test
          </button>
          .
        </p>

        <div className="rounded-lg border border-gray-200 bg-white shadow-sm">
          <div className="space-y-6 p-4 md:p-6">
            <div className="grid gap-4 md:grid-cols-3">
              <div className="space-y-2 md:col-span-2">
                <label className="text-sm font-medium text-gray-700">Prelims Test Name</label>
                <input value={collectionName} onChange={(e) => setCollectionName(e.target.value)} placeholder="e.g., Weekly Prelims Revision Set" className="h-10 w-full rounded-md border border-gray-300 px-3 text-base" />
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium text-gray-700">Max Questions</label>
                <input type="number" min={1} value={maxQuestions} onChange={(e) => setMaxQuestions(e.target.value)} className="h-10 w-full rounded-md border border-gray-300 px-3 text-base" />
              </div>
            </div>

            <div className="space-y-4 pt-2">
              <div className="space-y-3">
                <label className="text-sm font-medium text-gray-700">Content Type</label>
                <div className="grid grid-cols-3 gap-1 rounded-lg bg-gray-100 p-1">
                  {QUIZ_OPTIONS.map((opt) => {
                    const Icon = opt.icon;
                    const activeTab = quizType === opt.value;
                    return (
                      <button key={opt.value} type="button" onClick={() => setQuizType(opt.value)} className={`flex items-center justify-center gap-2 rounded-md py-2.5 transition-all ${activeTab ? "bg-white font-semibold text-blue-600 shadow-sm" : "font-semibold text-gray-700 hover:bg-gray-200"}`}>
                        <Icon className="h-4 w-4" />
                        <span>{opt.label}</span>
                      </button>
                    );
                  })}
                </div>
              </div>

              <div className="space-y-2">
                <label className="text-sm font-medium text-gray-700">Target Exam</label>
                <select value={selectedExamId ?? ""} onChange={(e) => setSelectedExamId(e.target.value ? Number(e.target.value) : null)} disabled={loadingExams || exams.length === 0} className="h-11 w-full rounded-md border border-gray-300 bg-white px-3 text-sm">
                  <option value="">{loadingExams ? "Loading exams..." : "Choose an Exam..."}</option>
                  {exams.map((exam) => <option key={exam.id} value={String(exam.id)}>{exam.name}</option>)}
                </select>
              </div>
            </div>

            <div className="space-y-3 pt-2">
              <div className="flex items-center justify-between">
                <label className="text-base font-semibold text-gray-800">Select Categories</label>
                {selections.length > 0 ? <button type="button" onClick={() => setSelections([])} className="h-8 rounded px-2 text-sm text-red-600 hover:bg-red-50 hover:text-red-700">Clear All</button> : null}
              </div>

              {!selectedExamId ? (
                <div className="rounded-lg border border-dashed border-gray-300 bg-gray-50 p-8 text-center text-gray-500">
                  <BookOpen className="mx-auto mb-2 h-8 w-8 opacity-20" />
                  <p>Select an exam above to browse topics.</p>
                </div>
              ) : loadingCats ? (
                <div className="animate-pulse rounded-lg bg-gray-50 p-8 text-center text-gray-500">Loading categories...</div>
              ) : tree.length === 0 ? (
                <div className="rounded-lg bg-yellow-50 p-8 text-center text-yellow-700">No categories found for this exam.</div>
              ) : (
                <div className="overflow-hidden rounded-lg border border-gray-200 bg-white">
                  <div className="flex items-center border-b border-gray-100 bg-gray-50 p-3">
                    {active ? (
                      <button type="button" onClick={() => { const prev = history.length ? history[history.length - 1] : null; setActive(prev); setHistory((v) => v.slice(0, -1)); }} className="inline-flex items-center text-sm font-medium text-gray-600 hover:text-blue-600">
                        <ArrowLeft className="mr-1 h-4 w-4" />
                        {active.name}
                      </button>
                    ) : <span className="px-1 text-sm font-semibold text-gray-700">Top Level Categories</span>}
                  </div>

                  <div className="space-y-1 p-2">
                    {nodes.length === 0 ? <p className="p-4 text-center text-sm text-gray-400">No items here.</p> : nodes.map((node) => {
                      const hasChildren = (node.children || []).length > 0;
                      const selected = selections.find((s) => s.id === `category-${quizType}-${selectedExamId}-${node.id}`);
                      return (
                        <div key={node.id} className="flex items-center justify-between rounded-lg border border-gray-200 bg-white p-3 shadow-sm transition-all hover:border-blue-300 hover:bg-gray-50">
                          <button type="button" className="flex min-w-0 flex-1 items-center gap-3 text-left" onClick={() => { if (!hasChildren) return; setHistory((v) => (active ? [...v, active] : v)); setActive(node); }}>
                            <span className={`rounded-md p-1 ${hasChildren ? "bg-blue-100 text-blue-600" : "bg-gray-100 text-gray-400"}`}>{hasChildren ? <ChevronRight className="h-4 w-4" /> : <div className="h-4 w-4" />}</span>
                            <span className="min-w-0">
                              <span className="block truncate text-sm font-medium text-gray-900">{node.name}</span>
                              <span className="block text-xs text-gray-500">Total: {Number(node.total_question_count || 0)}</span>
                            </span>
                          </button>
                          <div className="ml-3 flex items-center gap-2">
                            <button type="button" onClick={() => openManual(node)} className="inline-flex h-8 w-8 items-center justify-center rounded text-gray-500 hover:bg-blue-50 hover:text-blue-600" title="Select manually"><ListPlus className="h-4 w-4" /></button>
                            {selected ? <button type="button" onClick={() => openAddSheet(node)} className="h-8 rounded border border-green-200 bg-green-100 px-3 text-xs text-green-700 hover:bg-green-200">Selected ({selected.count})</button> : <button type="button" onClick={() => openAddSheet(node)} className="inline-flex h-8 w-8 items-center justify-center rounded-full bg-blue-600 text-white hover:bg-blue-700"><Plus className="h-4 w-4" /></button>}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>

        {summaryRows.length > 0 ? (
          <div className="overflow-hidden rounded-lg border border-gray-200 bg-white shadow-sm">
            <div className="flex items-center justify-between border-b bg-gray-50 px-4 py-3">
              <span className="font-semibold text-gray-800">Selected Questions</span>
              <span className={`rounded-full px-2 py-0.5 text-xs font-bold ${maxTotal > 0 && totalSelected > maxTotal ? "bg-red-100 text-red-700" : "bg-blue-100 text-blue-700"}`}>{totalSelected}{maxTotal > 0 ? ` / ${maxTotal}` : ""}</span>
            </div>
            <div className="max-h-[300px] divide-y divide-gray-100 overflow-y-auto">
              {summaryRows.map((row) => (
                <div key={row.key} className="flex items-center justify-between px-4 py-3 hover:bg-gray-50">
                  <div><p className="text-sm font-medium text-gray-900">{row.categoryName}</p><p className="text-xs uppercase text-gray-500">{row.quizType}</p></div>
                  <div className="flex items-center gap-4">
                    <span className="font-mono text-sm font-medium text-gray-700">{row.count}</span>
                    <button type="button" onClick={() => setSelections((v) => v.filter((item) => !row.ids.includes(item.id)))} className="inline-flex h-8 w-8 items-center justify-center rounded text-gray-400 hover:text-red-600"><X className="h-4 w-4" /></button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        ) : null}

        <div className="fixed bottom-0 left-0 right-0 z-10 border-t bg-white p-4 md:static md:border-0 md:bg-transparent md:p-0">
          <div className="mx-auto flex max-w-4xl gap-3">
            <button type="button" onClick={() => router.push("/collections")} disabled={submitting} className="flex-1 rounded border border-gray-300 px-4 py-2 text-sm md:flex-none">Cancel</button>
            <button type="button" onClick={createTest} disabled={submitting || loadingExams || loadingCats || selections.length === 0 || !collectionName.trim()} className="inline-flex flex-1 items-center justify-center rounded bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-60">
              {submitting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              {submitting ? "Creating..." : "Create Prelims Test"}
            </button>
          </div>
        </div>
        <div className="h-16 md:hidden" />
      </div>
      {addSheet.open ? (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-md rounded-xl border bg-white p-4 shadow-xl">
            <h3 className="text-lg font-semibold text-gray-900">{addSheet.node?.name}</h3>
            {addSheet.loading ? (
              <div className="py-6 text-center text-sm text-gray-500">Loading category stats...</div>
            ) : (
              <div className="mt-4 space-y-4">
                <div className="grid grid-cols-2 gap-3">
                  <div className="rounded-lg border border-gray-100 bg-gray-50 p-3"><div className="text-xs font-semibold uppercase tracking-wide text-gray-500">Total</div><div className="text-2xl font-bold text-gray-900">{addSheet.availableTotal}</div></div>
                  <div className="rounded-lg border border-green-100 bg-green-50 p-3"><div className="text-xs font-semibold uppercase tracking-wide text-green-600">Fresh / New</div><div className="text-2xl font-bold text-green-700">{addSheet.availableFresh}</div></div>
                </div>
                <div>
                  <label className="text-sm font-medium text-gray-700">Number of Questions to Add</label>
                  <input type="number" min={1} value={addSheet.inputCount} onChange={(e) => setAddSheet((p) => ({ ...p, inputCount: e.target.value }))} placeholder={`Max ${addSheet.includeAttempted ? addSheet.availableTotal : addSheet.availableFresh}`} className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-base" />
                </div>
                <label className="flex items-start gap-3 rounded border bg-gray-50 p-3">
                  <input type="checkbox" checked={addSheet.includeAttempted} onChange={(e) => setAddSheet((p) => ({ ...p, includeAttempted: e.target.checked }))} className="mt-1" />
                  <div><p className="text-sm font-medium text-gray-800">Include attempted questions</p><p className="text-xs text-gray-500">Keep this off to prioritize fresh questions.</p></div>
                </label>
              </div>
            )}
            <div className="mt-6 flex justify-end gap-2">
              <button type="button" onClick={() => setAddSheet((p) => ({ ...p, open: false, node: null }))} className="rounded border border-gray-300 px-3 py-2 text-sm">Cancel</button>
              <button type="button" disabled={addSheet.loading} onClick={saveAddSelection} className="rounded bg-blue-600 px-3 py-2 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-60">Save Selection</button>
            </div>
          </div>
        </div>
      ) : null}

      {manual.open ? (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/40 p-4">
          <div className="flex h-[85vh] w-full max-w-3xl flex-col rounded-xl border bg-white p-4 shadow-xl">
            <h3 className="text-lg font-semibold text-gray-900">Select Questions - {manual.node?.name}</h3>
            <input value={manual.search} onChange={(e) => setManual((p) => ({ ...p, search: e.target.value }))} className="mt-3 rounded-md border border-gray-300 px-3 py-2 text-sm" placeholder="Search questions..." />
            <div className="mt-3 flex-1 overflow-y-auto rounded border">
              {manual.loading ? <div className="p-4 text-sm text-gray-500">Loading questions...</div> : filteredQuestions.length === 0 ? <div className="p-4 text-sm text-gray-500">No questions found.</div> : (
                <div className="divide-y">
                  {filteredQuestions.map((item) => (
                    <label key={item.id} className="flex cursor-pointer items-start gap-3 p-3">
                      <input type="checkbox" checked={manual.selectedIds.includes(item.id)} onChange={(e) => {
                        const checked = e.target.checked;
                        setManual((p) => {
                          const next = checked ? [...p.selectedIds, item.id] : p.selectedIds.filter((id) => id !== item.id);
                          return { ...p, selectedIds: Array.from(new Set(next)) };
                        });
                      }} />
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-medium text-gray-800">{item.title}</p>
                        {item.statement ? <p className="mt-1 text-xs text-gray-600">{item.statement}</p> : null}
                        {item.isAttempted ? <span className="mt-1 inline-block rounded bg-amber-50 px-2 py-0.5 text-xs text-amber-700">Attempted</span> : null}
                      </div>
                    </label>
                  ))}
                </div>
              )}
            </div>
            <div className="mt-4 flex items-center justify-between">
              <p className="text-sm text-gray-600">Selected: <strong>{manual.selectedIds.length}</strong></p>
              <div className="flex gap-2">
                <button type="button" onClick={() => setManual((p) => ({ ...p, open: false, node: null }))} className="rounded border border-gray-300 px-3 py-2 text-sm">Cancel</button>
                <button type="button" onClick={saveManual} className="rounded bg-blue-600 px-3 py-2 text-sm font-semibold text-white hover:bg-blue-700">Save Questions</button>
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
