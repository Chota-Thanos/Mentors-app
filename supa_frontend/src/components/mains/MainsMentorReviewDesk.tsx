"use client";

import { ExternalLink, FileText, ImagePlus, Loader2, ShieldCheck } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";

import { premiumApi } from "@/lib/premiumApi";
import type {
  MainsCheckedCopyPayload,
  MainsCopyEtaPayload,
  MainsCopyMarkPayload,
  MainsCopySubmission,
  MainsCollectionTestPayload,
  MainsCollectionTestQuestion,
} from "@/types/premium";

interface MainsMentorReviewDeskProps {
  collectionId: string;
  payload: MainsCollectionTestPayload;
  totalMarks: number;
}

interface ReviewQuestionDraft {
  marks_awarded: string;
  remark: string;
}

interface SubmissionReviewDraft {
  etaHours: string;
  etaText: string;
  checkedCopyUrl: string;
  providerNote: string;
  questionMarks: Record<string, ReviewQuestionDraft>;
}

const toError = (error: unknown): string => {
  if (typeof error === "object" && error !== null && "response" in error) {
    const response = (error as { response?: { data?: { detail?: string } } }).response;
    if (response?.data?.detail) return response.data.detail;
  }
  if (error instanceof Error) return error.message;
  return "Unknown error";
};

const questionKey = (question: { content_item_id: number; question_number: number }) =>
  `${question.content_item_id}:${question.question_number}`;

const formatDateTime = (value?: string | null): string => {
  if (!value) return "Not available";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString();
};

const buildReviewDraft = (
  submission: MainsCopySubmission,
  questions: MainsCollectionTestQuestion[],
): SubmissionReviewDraft => {
  const questionMarks: Record<string, ReviewQuestionDraft> = {};
  for (const question of questions) {
    const mark =
      submission.question_marks.find(
        (item) =>
          item.question_item_id === question.content_item_id ||
          item.question_number === question.question_number,
      ) || null;
    questionMarks[questionKey(question)] = {
      marks_awarded: mark ? String(mark.marks_awarded) : "",
      remark: mark?.remark || "",
    };
  }
  return {
    etaHours: submission.provider_eta_hours ? String(submission.provider_eta_hours) : "",
    etaText: submission.provider_eta_text || "",
    checkedCopyUrl: submission.checked_copy_pdf_url || "",
    providerNote: submission.provider_note || "",
    questionMarks,
  };
};

const sumQuestionMarks = (questionMarks: MainsCopyMarkPayload[]): number =>
  questionMarks.reduce((sum, item) => sum + Number(item.marks_awarded || 0), 0);

export default function MainsMentorReviewDesk({ collectionId, payload, totalMarks }: MainsMentorReviewDeskProps) {
  const [submissions, setSubmissions] = useState<MainsCopySubmission[]>([]);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [selectedSubmissionId, setSelectedSubmissionId] = useState<number | null>(null);
  const [reviewDrafts, setReviewDrafts] = useState<Record<string, SubmissionReviewDraft>>({});
  const [savingEtaSubmissionId, setSavingEtaSubmissionId] = useState<number | null>(null);
  const [savingReviewSubmissionId, setSavingReviewSubmissionId] = useState<number | null>(null);

  const refreshSubmissions = async () => {
    if (!payload.series_id) {
      setSubmissions([]);
      return;
    }
    setIsRefreshing(true);
    try {
      const response = await premiumApi.get<MainsCopySubmission[]>(`/tests/${collectionId}/copy-submissions`);
      setSubmissions(Array.isArray(response.data) ? response.data : []);
    } catch (error: unknown) {
      toast.error("Failed to load learner submissions", { description: toError(error) });
    } finally {
      setIsRefreshing(false);
    }
  };

  useEffect(() => {
    void refreshSubmissions();
  }, [collectionId, payload.series_id]);

  useEffect(() => {
    const nextDrafts: Record<string, SubmissionReviewDraft> = {};
    for (const submission of submissions) {
      nextDrafts[String(submission.id)] = buildReviewDraft(submission, payload.questions);
    }
    setReviewDrafts(nextDrafts);
    setSelectedSubmissionId((prev) => {
      if (prev && submissions.some((submission) => submission.id === prev)) return prev;
      return submissions[0]?.id || null;
    });
  }, [payload.questions, submissions]);

  const selectedSubmission = useMemo(
    () => submissions.find((submission) => submission.id === selectedSubmissionId) || null,
    [selectedSubmissionId, submissions],
  );

  const selectedDraft = useMemo(
    () => (selectedSubmission ? reviewDrafts[String(selectedSubmission.id)] || null : null),
    [reviewDrafts, selectedSubmission],
  );

  const updateDraft = (submissionId: number, updater: (draft: SubmissionReviewDraft) => SubmissionReviewDraft) => {
    setReviewDrafts((prev) => {
      const current = prev[String(submissionId)];
      if (!current) return prev;
      return { ...prev, [String(submissionId)]: updater(current) };
    });
  };

  const saveEta = async (submissionId: number) => {
    const draft = reviewDrafts[String(submissionId)];
    if (!draft) return;
    const requestPayload: MainsCopyEtaPayload = {
      provider_eta_hours: draft.etaHours.trim() ? Number(draft.etaHours) : undefined,
      provider_eta_text: draft.etaText.trim() || undefined,
    };
    setSavingEtaSubmissionId(submissionId);
    try {
      await premiumApi.put(`/copy-submissions/${submissionId}/eta`, requestPayload);
      toast.success("ETA updated");
      await refreshSubmissions();
    } catch (error: unknown) {
      toast.error("Failed to save ETA", { description: toError(error) });
    } finally {
      setSavingEtaSubmissionId(null);
    }
  };

  const buildQuestionMarks = (draft: SubmissionReviewDraft): MainsCopyMarkPayload[] => {
    const questionMarks: MainsCopyMarkPayload[] = [];
    for (const question of payload.questions) {
      const questionDraft = draft.questionMarks[questionKey(question)];
      const rawMarks = String(questionDraft?.marks_awarded || "").trim();
      if (!rawMarks) continue;
      const marksValue = Number(rawMarks);
      if (!Number.isFinite(marksValue)) continue;
      questionMarks.push({
        question_item_id: question.content_item_id,
        question_number: question.question_number,
        marks_awarded: marksValue,
        max_marks: question.max_marks,
        remark: questionDraft?.remark?.trim() || undefined,
      });
    }
    return questionMarks;
  };

  const saveReview = async (submissionId: number) => {
    const draft = reviewDrafts[String(submissionId)];
    if (!draft) return;

    const questionMarks = buildQuestionMarks(draft);
    const requestPayload: MainsCheckedCopyPayload = {
      checked_copy_pdf_url: draft.checkedCopyUrl.trim() || undefined,
      provider_note: draft.providerNote.trim() || undefined,
      question_marks: questionMarks,
      total_marks: questionMarks.length > 0 ? Number(sumQuestionMarks(questionMarks).toFixed(2)) : undefined,
    };

    setSavingReviewSubmissionId(submissionId);
    try {
      await premiumApi.put(`/copy-submissions/${submissionId}/checked-copy`, requestPayload);
      toast.success("Question-wise review saved");
      await refreshSubmissions();
    } catch (error: unknown) {
      toast.error("Failed to save review", { description: toError(error) });
    } finally {
      setSavingReviewSubmissionId(null);
    }
  };

  return (
    <section className="space-y-4 rounded-2xl border border-slate-200 bg-white p-6">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h3 className="text-lg font-semibold text-slate-900">Mentor Review Desk</h3>
          <p className="text-sm text-slate-500">Review submissions here and save question-wise marks for learner analytics.</p>
        </div>
        <button type="button" onClick={() => void refreshSubmissions()} className="rounded border border-slate-300 bg-white px-3 py-1.5 text-xs" disabled={isRefreshing}>
          {isRefreshing ? "Refreshing..." : "Refresh"}
        </button>
      </div>

      {submissions.length > 0 ? (
        <>
          <select
            value={selectedSubmissionId ? String(selectedSubmissionId) : ""}
            onChange={(event) => setSelectedSubmissionId(Number(event.target.value))}
            className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
          >
            {submissions.map((submission) => (
              <option key={submission.id} value={String(submission.id)}>
                Submission #{submission.id} | User {submission.user_id} | {submission.status}
              </option>
            ))}
          </select>

          {selectedSubmission && selectedDraft ? (
            <div className="space-y-4">
              <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <p className="text-sm font-semibold text-slate-900">Submission #{selectedSubmission.id}</p>
                    <p className="text-xs text-slate-500">
                      Learner {selectedSubmission.user_id} | {selectedSubmission.submission_mode.replace("_", " ")} | Submitted {formatDateTime(selectedSubmission.submitted_at)}
                    </p>
                  </div>
                  {selectedSubmission.total_marks !== null && selectedSubmission.total_marks !== undefined ? (
                    <span className="rounded-full bg-emerald-100 px-2 py-1 text-xs font-semibold text-emerald-800">
                      Stored total: {selectedSubmission.total_marks}
                    </span>
                  ) : null}
                </div>

                <div className="mt-3 flex flex-wrap gap-3 text-xs">
                  {selectedSubmission.answer_pdf_url ? (
                    <a href={selectedSubmission.answer_pdf_url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-indigo-700 hover:underline">
                      <FileText className="h-3.5 w-3.5" />
                      Open Answer PDF
                    </a>
                  ) : null}
                  {selectedSubmission.checked_copy_pdf_url ? (
                    <a href={selectedSubmission.checked_copy_pdf_url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-emerald-700 hover:underline">
                      <ExternalLink className="h-3.5 w-3.5" />
                      Open Checked Copy
                    </a>
                  ) : null}
                </div>
              </div>

              <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
                <div className="grid gap-2 md:grid-cols-[160px_1fr_auto]">
                  <input
                    type="number"
                    min={1}
                    value={selectedDraft.etaHours}
                    onChange={(event) => updateDraft(selectedSubmission.id, (draft) => ({ ...draft, etaHours: event.target.value }))}
                    className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
                    placeholder="ETA hours"
                  />
                  <input
                    value={selectedDraft.etaText}
                    onChange={(event) => updateDraft(selectedSubmission.id, (draft) => ({ ...draft, etaText: event.target.value }))}
                    className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
                    placeholder="ETA note"
                  />
                  <button
                    type="button"
                    onClick={() => void saveEta(selectedSubmission.id)}
                    disabled={savingEtaSubmissionId === selectedSubmission.id}
                    className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm disabled:opacity-60"
                  >
                    {savingEtaSubmissionId === selectedSubmission.id ? "Saving..." : "Save ETA"}
                  </button>
                </div>
              </div>

              <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
                <label className="block text-xs font-semibold uppercase tracking-wide text-slate-500">Checked Copy PDF URL</label>
                <input
                  value={selectedDraft.checkedCopyUrl}
                  onChange={(event) => updateDraft(selectedSubmission.id, (draft) => ({ ...draft, checkedCopyUrl: event.target.value }))}
                  className="mt-2 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                  placeholder="Optional checked copy URL"
                />

                <label className="mt-4 block text-xs font-semibold uppercase tracking-wide text-slate-500">Mentor Note</label>
                <textarea
                  value={selectedDraft.providerNote}
                  onChange={(event) => updateDraft(selectedSubmission.id, (draft) => ({ ...draft, providerNote: event.target.value }))}
                  className="mt-2 min-h-[96px] w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                  placeholder="Feedback note for the learner"
                />
              </div>

              <div className="space-y-3">
                {payload.questions.map((question) => {
                  const response =
                    selectedSubmission.question_responses.find(
                      (item) =>
                        item.question_item_id === question.content_item_id ||
                        item.question_number === question.question_number,
                    ) || null;
                  const markDraft = selectedDraft.questionMarks[questionKey(question)] || { marks_awarded: "", remark: "" };

                  return (
                    <article key={`review-${questionKey(question)}`} className="rounded-xl border border-slate-200 bg-white p-4">
                      <div className="flex flex-wrap items-center gap-2 text-[11px]">
                        <span className="rounded-full bg-slate-100 px-2 py-0.5 font-semibold text-slate-700">Q{question.question_number}</span>
                        <span className="rounded-full bg-emerald-100 px-2 py-0.5 font-semibold text-emerald-700">{question.max_marks} marks</span>
                        <span className="rounded-full bg-sky-100 px-2 py-0.5 font-semibold text-sky-700">{question.word_limit} words</span>
                      </div>
                      <p className="mt-3 whitespace-pre-wrap text-sm text-slate-800">{question.question_text}</p>

                      {response?.answer_image_urls?.length ? (
                        <div className="mt-3 flex flex-wrap gap-2">
                          {response.answer_image_urls.map((url, index) => (
                            <a key={`${url}-${index}`} href={url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 rounded border border-slate-300 bg-slate-50 px-2 py-1 text-xs text-slate-700">
                              <ImagePlus className="h-3.5 w-3.5" />
                              Answer Image {index + 1}
                            </a>
                          ))}
                        </div>
                      ) : (
                        <p className="mt-3 text-xs text-slate-500">No question-wise answer image attached. Use the combined PDF if the learner submitted one copy for the full paper.</p>
                      )}

                      <div className="mt-4 grid gap-2 md:grid-cols-[160px_1fr]">
                        <input
                          type="number"
                          min={0}
                          max={question.max_marks}
                          step="0.5"
                          value={markDraft.marks_awarded}
                          onChange={(event) =>
                            updateDraft(selectedSubmission.id, (draft) => ({
                              ...draft,
                              questionMarks: {
                                ...draft.questionMarks,
                                [questionKey(question)]: {
                                  ...draft.questionMarks[questionKey(question)],
                                  marks_awarded: event.target.value,
                                },
                              },
                            }))
                          }
                          className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
                          placeholder={`Marks / ${question.max_marks}`}
                        />
                        <textarea
                          value={markDraft.remark}
                          onChange={(event) =>
                            updateDraft(selectedSubmission.id, (draft) => ({
                              ...draft,
                              questionMarks: {
                                ...draft.questionMarks,
                                [questionKey(question)]: {
                                  ...draft.questionMarks[questionKey(question)],
                                  remark: event.target.value,
                                },
                              },
                            }))
                          }
                          className="min-h-[88px] rounded-lg border border-slate-300 px-3 py-2 text-sm"
                          placeholder="Question-wise remark"
                        />
                      </div>
                    </article>
                  );
                })}
              </div>

              <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-200 bg-slate-50 px-4 py-3">
                <div className="text-sm text-slate-600">
                  Auto total:{" "}
                  <span className="font-semibold text-slate-900">
                    {sumQuestionMarks(buildQuestionMarks(selectedDraft))} / {totalMarks}
                  </span>
                </div>
                <button
                  type="button"
                  onClick={() => void saveReview(selectedSubmission.id)}
                  disabled={savingReviewSubmissionId === selectedSubmission.id}
                  className="inline-flex items-center rounded-lg bg-slate-900 px-4 py-2 text-sm font-semibold text-white disabled:opacity-60"
                >
                  {savingReviewSubmissionId === selectedSubmission.id ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <ShieldCheck className="mr-2 h-4 w-4" />}
                  Save Review
                </button>
              </div>
            </div>
          ) : null}
        </>
      ) : (
        <p className="text-sm text-slate-500">No learner submissions have been recorded for this mains paper yet.</p>
      )}
    </section>
  );
}
