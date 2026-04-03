"use client";

import axios from "axios";
import { Loader2 } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

import { useAuth } from "@/context/AuthContext";
import { premiumApi } from "@/lib/premiumApi";
import { collectionTestResultStorageKey } from "@/lib/collectionTestResultStorage";
import RichTextContent from "@/components/ui/RichTextContent";
import type {
  CollectionScorePayload,
  CollectionTestPayload,
  QuizQuestionComplaint,
  QuizQuestionComplaintStatus,
} from "@/types/premium";

interface CollectionTestResultProps {
  collectionId: string;
}

interface StoredCollectionResult {
  test: CollectionTestPayload;
  score: CollectionScorePayload;
  submitted_at?: string;
}

const toError = (error: unknown): string => {
  if (!axios.isAxiosError(error)) return "Unknown error";
  const detail = error.response?.data?.detail;
  return typeof detail === "string" && detail.trim() ? detail : error.message;
};

function complaintStatusLabel(status: QuizQuestionComplaintStatus): string {
  if (status === "pending") return "Pending";
  if (status === "resolved") return "Resolved";
  return "Received";
}

function complaintBadgeClass(status: QuizQuestionComplaintStatus): string {
  if (status === "pending") return "border-amber-300 bg-amber-50 text-amber-800";
  if (status === "resolved") return "border-emerald-300 bg-emerald-50 text-emerald-800";
  return "border-sky-300 bg-sky-50 text-sky-800";
}

function questionStatusBadge(detail?: CollectionScorePayload["details"][number] | null): {
  label: string;
  className: string;
} {
  if (!detail?.selected_option) {
    return {
      label: "Unanswered",
      className: "border-amber-300 bg-amber-100 text-amber-900",
    };
  }
  if (detail.is_correct) {
    return {
      label: "Correct",
      className: "border-emerald-300 bg-emerald-100 text-emerald-900",
    };
  }
  return {
    label: "Incorrect",
    className: "border-rose-300 bg-rose-100 text-rose-900",
  };
}

function reviewCardClass(detail?: CollectionScorePayload["details"][number] | null): string {
  if (!detail?.selected_option) return "border-amber-200 bg-amber-50/90";
  if (detail.is_correct) return "border-emerald-200 bg-emerald-50/90";
  return "border-rose-200 bg-rose-50/90";
}

function optionStateClass(
  optionLabel: string,
  selectedOption?: string | null,
  correctAnswer?: string | null,
): string {
  const normalizedLabel = String(optionLabel || "").trim().toUpperCase();
  const normalizedSelected = String(selectedOption || "").trim().toUpperCase();
  const normalizedCorrect = String(correctAnswer || "").trim().toUpperCase();
  const isSelected = normalizedLabel && normalizedLabel === normalizedSelected;
  const isCorrect = normalizedLabel && normalizedLabel === normalizedCorrect;

  if (isCorrect && isSelected) {
    return "border-emerald-300 bg-emerald-100 text-emerald-950 ring-1 ring-emerald-200";
  }
  if (isCorrect) {
    return "border-emerald-300 bg-emerald-50 text-emerald-950";
  }
  if (isSelected) {
    return "border-rose-300 bg-rose-100 text-rose-950 ring-1 ring-rose-200";
  }
  return "border-slate-200 bg-white text-slate-800";
}

export default function CollectionTestResult({ collectionId }: CollectionTestResultProps) {
  const router = useRouter();
  const { isAuthenticated, showLoginModal } = useAuth();
  const [loading, setLoading] = useState(true);
  const [snapshot, setSnapshot] = useState<StoredCollectionResult | null>(null);
  const [complaintsByQuestion, setComplaintsByQuestion] = useState<Record<number, QuizQuestionComplaint>>({});
  const [complaintDrafts, setComplaintDrafts] = useState<Record<number, string>>({});
  const [expandedComplaintId, setExpandedComplaintId] = useState<number | null>(null);
  const [loadingComplaints, setLoadingComplaints] = useState(false);
  const [submittingComplaintId, setSubmittingComplaintId] = useState<number | null>(null);

  useEffect(() => {
    const key = collectionTestResultStorageKey(collectionId);
    try {
      const raw = sessionStorage.getItem(key);
      if (!raw) {
        setSnapshot(null);
      } else {
        setSnapshot(JSON.parse(raw) as StoredCollectionResult);
      }
    } catch {
      setSnapshot(null);
    } finally {
      setLoading(false);
    }
  }, [collectionId]);

  const detailMap = useMemo(() => {
    const map = new Map<number, CollectionScorePayload["details"][number]>();
    if (!snapshot?.score?.details) return map;
    for (const detail of snapshot.score.details) {
      map.set(detail.item_id, detail);
    }
    return map;
  }, [snapshot]);

  const attemptId = useMemo(() => {
    const value = Number(snapshot?.score?.attempt_id || 0);
    return Number.isFinite(value) && value > 0 ? Math.floor(value) : null;
  }, [snapshot]);
  const canRaiseComplaints = isAuthenticated && Boolean(attemptId);

  useEffect(() => {
    if (!canRaiseComplaints || !attemptId) {
      setComplaintsByQuestion({});
      setLoadingComplaints(false);
      return;
    }

    let active = true;
    setLoadingComplaints(true);
    premiumApi
      .get<QuizQuestionComplaint[]>(`/collections/${collectionId}/quiz-complaints/me`, {
        params: { attempt_id: attemptId },
      })
      .then((response) => {
        if (!active) return;
        const next: Record<number, QuizQuestionComplaint> = {};
        for (const row of Array.isArray(response.data) ? response.data : []) {
          if (Number.isFinite(row.question_item_id) && row.question_item_id > 0) {
            next[row.question_item_id] = row;
          }
        }
        setComplaintsByQuestion(next);
      })
      .catch((error: unknown) => {
        if (!active) return;
        setComplaintsByQuestion({});
        toast.error("Failed to load question complaints", { description: toError(error) });
      })
      .finally(() => {
        if (active) setLoadingComplaints(false);
      });

    return () => {
      active = false;
    };
  }, [attemptId, canRaiseComplaints, collectionId]);

  const submitComplaint = async (questionItemId: number) => {
    if (!isAuthenticated) {
      showLoginModal();
      return;
    }
    if (!attemptId) {
      toast.error("Complaint unavailable for this result", {
        description: "Retake the test while signed in so the server records an attempt for complaint tracking.",
      });
      return;
    }
    const complaintText = String(complaintDrafts[questionItemId] || "").trim();
    if (complaintText.length < 8) {
      toast.error("Complaint is too short", { description: "Write at least a short reason before submitting." });
      return;
    }

    setSubmittingComplaintId(questionItemId);
    try {
      const response = await premiumApi.post<QuizQuestionComplaint>(`/collections/${collectionId}/quiz-complaints`, {
        attempt_id: attemptId,
        question_item_id: questionItemId,
        complaint_text: complaintText,
      });
      setComplaintsByQuestion((current) => ({
        ...current,
        [questionItemId]: response.data,
      }));
      setComplaintDrafts((current) => ({
        ...current,
        [questionItemId]: "",
      }));
      setExpandedComplaintId((current) => (current === questionItemId ? null : current));
      toast.success("Complaint sent to the creator");
    } catch (error: unknown) {
      toast.error("Failed to send complaint", { description: toError(error) });
    } finally {
      setSubmittingComplaintId(null);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center rounded-xl border border-slate-200 bg-white p-16">
        <Loader2 className="h-6 w-6 animate-spin text-slate-500" />
      </div>
    );
  }

  if (!snapshot) {
    return (
      <div className="space-y-4 rounded-xl border border-amber-200 bg-amber-50 p-6">
        <h2 className="text-lg font-bold text-amber-900">Result not found</h2>
        <p className="text-sm text-amber-800">
          No recent result snapshot is available for this Prelims Test. Attempt the test and submit once to view category-wise analysis.
        </p>
        <div className="flex gap-2">
          <button
            onClick={() => router.push(`/collections/${collectionId}/test`)}
            className="rounded bg-amber-700 px-4 py-2 text-sm font-semibold text-white"
          >
            Start Prelims Test
          </button>
          <button
            onClick={() => router.push(`/collections/${collectionId}`)}
            className="rounded border border-amber-300 bg-white px-4 py-2 text-sm font-semibold text-amber-900"
          >
            Back to Test
          </button>
        </div>
      </div>
    );
  }

  const { test, score } = snapshot;

  return (
    <div className="space-y-6">
      <section className="rounded-2xl border border-indigo-200 bg-gradient-to-r from-indigo-50 via-white to-cyan-50 p-6">
        <p className="text-xs font-semibold uppercase tracking-wide text-indigo-700">{test.collection_title}</p>
        <h2 className="mt-2 text-2xl font-bold text-slate-900">
          Score {score.score}/{score.total_questions}
        </h2>
        <div className="mt-3 grid gap-3 sm:grid-cols-3">
          <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-3">
            <p className="text-xs uppercase text-emerald-700">Correct</p>
            <p className="text-xl font-bold text-emerald-900">{score.correct_answers}</p>
          </div>
          <div className="rounded-lg border border-rose-200 bg-rose-50 p-3">
            <p className="text-xs uppercase text-rose-700">Incorrect</p>
            <p className="text-xl font-bold text-rose-900">{score.incorrect_answers}</p>
          </div>
          <div className="rounded-lg border border-amber-200 bg-amber-50 p-3">
            <p className="text-xs uppercase text-amber-700">Unanswered</p>
            <p className="text-xl font-bold text-amber-900">{score.unanswered}</p>
          </div>
        </div>
      </section>

      <section className="space-y-3 rounded-xl border border-slate-200 bg-white p-5">
        <h3 className="text-lg font-bold text-slate-900">Category-wise Results</h3>
        {score.category_wise_results && score.category_wise_results.length > 0 ? (
          <div className="grid gap-3 md:grid-cols-2">
            {score.category_wise_results.map((category) => (
              <div key={category.category_id} className="rounded-lg border border-slate-200 bg-slate-50 p-4">
                <div className="flex items-center justify-between">
                  <p className="text-sm font-semibold text-slate-900">{category.category_name}</p>
                  <p className="text-xs font-semibold text-slate-600">{category.accuracy.toFixed(2)}%</p>
                </div>
                <div className="mt-2 h-2 rounded-full bg-slate-200">
                  <div
                    className="h-2 rounded-full bg-indigo-500"
                    style={{ width: `${Math.max(0, Math.min(100, category.accuracy))}%` }}
                  />
                </div>
                <p className="mt-2 text-xs text-slate-600">
                  Total: {category.total} | Correct: {category.correct} | Incorrect: {category.incorrect} | Unanswered: {category.unanswered}
                </p>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-sm text-slate-500">No category mapping found for this Prelims Test run.</p>
        )}
      </section>

      <section className="space-y-3">
        <h3 className="text-lg font-bold text-slate-900">Question Review</h3>
        {canRaiseComplaints ? (
          <p className="text-sm text-slate-600">
            Raise a complaint against any question exactly as attempted. The creator can then move it through received, pending, and resolved states.
          </p>
        ) : (
          <p className="text-sm text-slate-600">
            Question complaints are available only for signed-in attempts recorded on the server. Older saved results remain view-only.
          </p>
        )}
        {loadingComplaints && canRaiseComplaints ? <p className="text-xs text-slate-500">Loading existing complaints for this attempt...</p> : null}
        {test.questions.map((question, idx) => {
          const detail = detailMap.get(question.item_id);
          const complaint = complaintsByQuestion[question.item_id];
          const questionAny = (question as unknown as Record<string, unknown>) || {};
          const questionText = String(question.question_statement || questionAny.question || "").trim();
          const supplementaryText = String(
            question.supplementary_statement
              || questionAny.supp_question_statement
              || questionAny.supplementary
              || ""
          ).trim();
          const statements = Array.isArray(question.statements_facts)
            ? question.statements_facts
            : Array.isArray(questionAny.statement_facts)
              ? (questionAny.statement_facts as string[])
              : [];
          const promptText = String(question.question_prompt || questionAny.prompt || "").trim();
          const passageTitle = String(question.passage_title || "").trim();
          const passageText = String(question.passage_text || "").trim();
          const explanationText = String(detail?.explanation_text || question.explanation_text || "").trim();
          const statusBadge = questionStatusBadge(detail);
          return (
            <article key={question.item_id} className={`rounded-2xl border p-5 shadow-sm ${reviewCardClass(detail)}`}>
              <div className="flex flex-wrap items-start justify-between gap-3">
                <p className="text-sm font-semibold uppercase tracking-wide text-slate-600">
                  Question {idx + 1}
                </p>
                <span className={`inline-flex rounded-full border px-3 py-1 text-xs font-semibold ${statusBadge.className}`}>
                  {statusBadge.label}
                </span>
              </div>
              <RichTextContent
                value={questionText}
                className="mt-3 text-base font-semibold text-slate-950 [&_.prose]:max-w-none [&_p]:my-0 [&_ul]:my-2 [&_ol]:my-2"
              />
              {supplementaryText ? (
                <div className="mt-3 rounded-xl border border-slate-200 bg-white/80 p-3">
                  <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-slate-500">Supplement</p>
                  <RichTextContent value={supplementaryText} className="mt-2 text-sm text-slate-700 [&_p]:my-0" />
                </div>
              ) : null}
              {statements.length > 0 ? (
                <div className="mt-3 rounded-xl border border-slate-200 bg-white/80 p-3">
                  <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-slate-500">Statements</p>
                  <div className="mt-2 space-y-2">
                    {statements.map((fact, factIndex) => (
                      <div key={factIndex} className="flex gap-3">
                        <span className="mt-1 inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-slate-900 px-1.5 text-[10px] font-bold text-white">
                          {factIndex + 1}
                        </span>
                        <RichTextContent value={fact} className="min-w-0 flex-1 text-sm text-slate-700 [&_p]:my-0" />
                      </div>
                    ))}
                  </div>
                </div>
              ) : null}
              {passageTitle || passageText ? (
                <div className="mt-3 rounded-xl border border-indigo-200 bg-indigo-50/80 p-3">
                  <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-indigo-700">
                    {passageTitle || "Passage"}
                  </p>
                  {passageText ? (
                    <RichTextContent value={passageText} className="mt-2 text-sm text-slate-700 [&_p]:my-0" />
                  ) : null}
                </div>
              ) : null}
              {promptText ? (
                <div className="mt-3 rounded-xl border border-slate-200 bg-white/90 p-3">
                  <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-slate-500">Prompt</p>
                  <RichTextContent value={promptText} className="mt-2 text-sm italic text-slate-700 [&_p]:my-0" />
                </div>
              ) : null}

              <div className="mt-4 space-y-2">
                {question.options.map((option) => {
                  const normalizedLabel = String(option.label || "").trim().toUpperCase();
                  const normalizedSelected = String(detail?.selected_option || "").trim().toUpperCase();
                  const normalizedCorrect = String(detail?.correct_answer || question.correct_answer || "").trim().toUpperCase();
                  const isSelected = normalizedLabel !== "" && normalizedLabel === normalizedSelected;
                  const isCorrect = normalizedLabel !== "" && normalizedLabel === normalizedCorrect;
                  return (
                    <div
                      key={`${question.item_id}-${option.label}`}
                      className={`rounded-xl border px-4 py-3 ${optionStateClass(option.label, detail?.selected_option, detail?.correct_answer || question.correct_answer)}`}
                    >
                      <div className="flex flex-wrap items-start gap-3">
                        <span className="inline-flex min-w-8 items-center justify-center rounded-full border border-current/20 bg-white/70 px-2 py-1 text-xs font-bold">
                          {option.label}
                        </span>
                        <div className="min-w-0 flex-1 space-y-2">
                          <RichTextContent value={option.text} className="text-sm [&_p]:my-0" />
                          <div className="flex flex-wrap gap-2">
                            {isSelected ? (
                              <span className="inline-flex rounded-full border border-slate-300 bg-slate-100 px-2.5 py-1 text-[11px] font-semibold text-slate-800">
                                Your choice
                              </span>
                            ) : null}
                            {isCorrect ? (
                              <span className="inline-flex rounded-full border border-emerald-300 bg-emerald-100 px-2.5 py-1 text-[11px] font-semibold text-emerald-900">
                                Correct answer
                              </span>
                            ) : null}
                          </div>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>

              <div className="mt-4 grid gap-3 md:grid-cols-2">
                <div className="rounded-xl border border-slate-200 bg-white/90 p-3">
                  <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-slate-500">Your Answer</p>
                  <p className="mt-2 text-sm font-semibold text-slate-900">{detail?.selected_option || "Not answered"}</p>
                </div>
                <div className="rounded-xl border border-slate-200 bg-white/90 p-3">
                  <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-slate-500">Correct Answer</p>
                  <p className="mt-2 text-sm font-semibold text-slate-900">{detail?.correct_answer || question.correct_answer || "Not available"}</p>
                </div>
              </div>

              {explanationText ? (
                <div className="mt-4 rounded-xl border border-slate-200 bg-white/90 p-4">
                  <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-slate-500">Explanation</p>
                  <RichTextContent value={explanationText} className="mt-2 text-sm text-slate-700" />
                </div>
              ) : null}

              <div className="mt-3 rounded-xl border border-slate-200 bg-white/80 p-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="text-xs font-semibold uppercase tracking-wide text-slate-600">Question Complaint</p>
                  {complaint ? (
                    <span className={`inline-flex rounded-full border px-2.5 py-1 text-[11px] font-semibold ${complaintBadgeClass(complaint.status)}`}>
                      {complaintStatusLabel(complaint.status)}
                    </span>
                  ) : null}
                </div>
                {complaint ? (
                  <div className="mt-2 space-y-2 text-sm text-slate-700">
                    <p>{complaint.complaint_text}</p>
                    <p className="text-xs text-slate-500">
                      Filed on {new Date(complaint.created_at).toLocaleString()}
                      {complaint.resolved_at ? ` | Resolved on ${new Date(complaint.resolved_at).toLocaleString()}` : ""}
                    </p>
                    {complaint.creator_note ? (
                      <div className="rounded-lg border border-slate-200 bg-slate-50 p-2">
                        <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Creator Note</p>
                        <p className="mt-1 text-sm text-slate-700">{complaint.creator_note}</p>
                      </div>
                    ) : null}
                  </div>
                ) : canRaiseComplaints ? (
                  expandedComplaintId === question.item_id ? (
                    <div className="mt-2 space-y-2">
                      <textarea
                        value={complaintDrafts[question.item_id] || ""}
                        onChange={(event) =>
                          setComplaintDrafts((current) => ({
                            ...current,
                            [question.item_id]: event.target.value,
                          }))
                        }
                        rows={4}
                        placeholder="Write exactly what is wrong in this question, option set, explanation, or answer key."
                        className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-800 outline-none transition focus:border-slate-500"
                      />
                      <div className="flex flex-wrap gap-2">
                        <button
                          type="button"
                          onClick={() => void submitComplaint(question.item_id)}
                          disabled={submittingComplaintId === question.item_id}
                          className="rounded bg-slate-900 px-3 py-2 text-sm font-semibold text-white disabled:opacity-60"
                        >
                          {submittingComplaintId === question.item_id ? "Submitting..." : "Send to Creator"}
                        </button>
                        <button
                          type="button"
                          onClick={() => setExpandedComplaintId(null)}
                          className="rounded border border-slate-300 bg-white px-3 py-2 text-sm font-semibold text-slate-700"
                        >
                          Cancel
                        </button>
                      </div>
                    </div>
                  ) : (
                    <button
                      type="button"
                      onClick={() => setExpandedComplaintId(question.item_id)}
                      className="mt-2 rounded border border-slate-300 bg-white px-3 py-2 text-sm font-semibold text-slate-700"
                    >
                      Raise Complaint to Creator
                    </button>
                  )
                ) : (
                  <p className="mt-2 text-sm text-slate-500">
                    Complaint submission is available only for signed-in attempts with a recorded server-side attempt ID.
                  </p>
                )}
              </div>
            </article>
          );
        })}
      </section>

      <div className="flex gap-2">
        <button
          onClick={() => router.push(`/collections/${collectionId}/test`)}
          className="rounded bg-slate-900 px-4 py-2 text-sm font-semibold text-white"
        >
          Retake Prelims Test
        </button>
        <button
          onClick={() => router.push(`/collections/${collectionId}`)}
          className="rounded border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700"
        >
          Back to Test
        </button>
      </div>
    </div>
  );
}
