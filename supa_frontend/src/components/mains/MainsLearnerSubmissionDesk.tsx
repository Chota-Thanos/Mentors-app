"use client";

import { Clock3, ExternalLink, FileText, ImagePlus, Loader2, NotebookPen, ShieldCheck } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";

import CopyEvaluationFlowStatus from "@/components/premium/CopyEvaluationFlowStatus";
import MentorshipSlotOfferList from "@/components/premium/MentorshipSlotOfferList";
import { useAuth } from "@/context/AuthContext";
import {
  buildCopyEvaluationFlowSteps,
  offeredSlotsForRequest,
} from "@/lib/copyEvaluationFlow";
import { premiumApi } from "@/lib/premiumApi";
import type {
  MainsCopyQuestionResponsePayload,
  MainsCopySubmission,
  MainsCollectionTestPayload,
  MainsCollectionTestQuestion,
  MentorshipRequest,
  MentorshipSession,
  MentorshipSlot,
} from "@/types/premium";

interface MainsLearnerSubmissionDeskProps {
  collectionId: string;
  payload: MainsCollectionTestPayload;
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

const buildQuestionImageDrafts = (questions: MainsCollectionTestQuestion[]): Record<string, string[]> => {
  const next: Record<string, string[]> = {};
  for (const question of questions) {
    next[questionKey(question)] = [""];
  }
  return next;
};

export default function MainsLearnerSubmissionDesk({ collectionId, payload }: MainsLearnerSubmissionDeskProps) {
  const { isAuthenticated } = useAuth();
  const [submissions, setSubmissions] = useState<MainsCopySubmission[]>([]);
  const [requests, setRequests] = useState<MentorshipRequest[]>([]);
  const [sessions, setSessions] = useState<MentorshipSession[]>([]);
  const [providerSlotsByProviderId, setProviderSlotsByProviderId] = useState<Record<string, MentorshipSlot[]>>({});
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [acceptingSlotId, setAcceptingSlotId] = useState<number | null>(null);
  const [submissionMode, setSubmissionMode] = useState<"pdf" | "question_wise">("pdf");
  const [answerPdfUrl, setAnswerPdfUrl] = useState("");
  const [submissionNote, setSubmissionNote] = useState("");
  const [preferredMode, setPreferredMode] = useState<"video" | "audio">("video");
  const [questionImageUrlsByQuestion, setQuestionImageUrlsByQuestion] = useState<Record<string, string[]>>(
    buildQuestionImageDrafts(payload.questions),
  );

  const refreshSubmissions = async () => {
    if (!payload.series_id || !isAuthenticated) {
      setSubmissions([]);
      setRequests([]);
      setSessions([]);
      setProviderSlotsByProviderId({});
      return;
    }
    setIsRefreshing(true);
    try {
      const [submissionResponse, requestsResponse, sessionsResponse] = await Promise.all([
        premiumApi.get<MainsCopySubmission[]>(`/tests/${collectionId}/copy-submissions`),
        premiumApi.get<MentorshipRequest[]>("/mentorship/requests", { params: { scope: "me" } }),
        premiumApi.get<MentorshipSession[]>("/mentorship/sessions", { params: { scope: "me" } }),
      ]);
      const nextSubmissions = Array.isArray(submissionResponse.data) ? submissionResponse.data : [];
      const nextRequestsRaw = Array.isArray(requestsResponse.data) ? requestsResponse.data : [];
      const linkedSubmissionIds = new Set(nextSubmissions.map((submission) => submission.id));
      const nextRequests = nextRequestsRaw.filter((request) => {
        const submissionId = Number(request.submission_id || 0);
        return submissionId > 0 && linkedSubmissionIds.has(submissionId);
      });
      const requestIdSet = new Set(nextRequests.map((request) => request.id));
      const nextSessions = (Array.isArray(sessionsResponse.data) ? sessionsResponse.data : []).filter((session) =>
        requestIdSet.has(session.request_id),
      );

      setSubmissions(nextSubmissions);
      setRequests(nextRequests);
      setSessions(nextSessions);

      const providerIds = nextRequests
        .map((request) => String(request.provider_user_id || "").trim())
        .filter((value, index, array) => value && array.indexOf(value) === index);
      if (providerIds.length === 0) {
        setProviderSlotsByProviderId({});
      } else {
        const slotEntries = await Promise.all(
          providerIds.map(async (providerUserId) => {
            try {
              const response = await premiumApi.get<MentorshipSlot[]>("/mentorship/slots", {
                params: { provider_user_id: providerUserId, only_available: false },
              });
              return [providerUserId, Array.isArray(response.data) ? response.data : []] as const;
            } catch {
              return [providerUserId, []] as const;
            }
          }),
        );
        setProviderSlotsByProviderId(Object.fromEntries(slotEntries));
      }
    } catch (error: unknown) {
      toast.error("Failed to load submissions", { description: toError(error) });
    } finally {
      setIsRefreshing(false);
    }
  };

  useEffect(() => {
    setQuestionImageUrlsByQuestion(buildQuestionImageDrafts(payload.questions));
  }, [payload.questions]);

  useEffect(() => {
    void refreshSubmissions();
  }, [collectionId, isAuthenticated, payload.series_id]);

  const updateQuestionImageUrl = (question: MainsCollectionTestQuestion, index: number, value: string) => {
    const key = questionKey(question);
    setQuestionImageUrlsByQuestion((prev) => {
      const current = [...(prev[key] || [""])];
      current[index] = value;
      return { ...prev, [key]: current };
    });
  };

  const addQuestionImageField = (question: MainsCollectionTestQuestion) => {
    const key = questionKey(question);
    setQuestionImageUrlsByQuestion((prev) => ({ ...prev, [key]: [...(prev[key] || [""]), ""] }));
  };

  const removeQuestionImageField = (question: MainsCollectionTestQuestion, index: number) => {
    const key = questionKey(question);
    setQuestionImageUrlsByQuestion((prev) => {
      const current = [...(prev[key] || [""])];
      current.splice(index, 1);
      return { ...prev, [key]: current.length > 0 ? current : [""] };
    });
  };

  const submitAttempt = async () => {
    if (!payload.series_id) {
      toast.error("This mains paper is not linked to a test series yet.");
      return;
    }

    const questionResponses: MainsCopyQuestionResponsePayload[] = [];
    for (const question of payload.questions) {
      const urls = (questionImageUrlsByQuestion[questionKey(question)] || [])
        .map((item) => item.trim())
        .filter(Boolean);
      if (urls.length === 0) continue;
      questionResponses.push({
        question_item_id: question.content_item_id,
        question_number: question.question_number,
        answer_image_urls: urls,
      });
    }

    if (submissionMode === "pdf" && !answerPdfUrl.trim()) {
      toast.error("Answer PDF URL is required.");
      return;
    }
    if (submissionMode === "question_wise" && questionResponses.length === 0) {
      toast.error("Attach at least one answer image.");
      return;
    }

    setIsSubmitting(true);
    try {
      await premiumApi.post(`/tests/${collectionId}/copy-submissions`, {
        answer_pdf_url: submissionMode === "pdf" ? answerPdfUrl.trim() : undefined,
        question_responses: submissionMode === "question_wise" ? questionResponses : undefined,
        note: submissionNote.trim() || undefined,
        preferred_mode: preferredMode,
      });
      toast.success("Mains submission recorded.");
      setAnswerPdfUrl("");
      setSubmissionNote("");
      setPreferredMode("video");
      setQuestionImageUrlsByQuestion(buildQuestionImageDrafts(payload.questions));
      await refreshSubmissions();
    } catch (error: unknown) {
      toast.error("Failed to submit mains answers", { description: toError(error) });
    } finally {
      setIsSubmitting(false);
    }
  };

  const requestBySubmissionId = useMemo(() => {
    const map: Record<string, MentorshipRequest> = {};
    for (const request of requests) {
      const submissionId = Number(request.submission_id || 0);
      if (submissionId > 0) {
        map[String(submissionId)] = request;
      }
    }
    return map;
  }, [requests]);

  const sessionByRequestId = useMemo(() => {
    const map: Record<string, MentorshipSession> = {};
    for (const session of sessions) {
      map[String(session.request_id)] = session;
    }
    return map;
  }, [sessions]);

  const acceptOfferedSlot = async (request: MentorshipRequest, slotId: number) => {
    setAcceptingSlotId(slotId);
    try {
      await premiumApi.post(`/mentorship/requests/${request.id}/accept-slot`, { slot_id: slotId });
      toast.success("Mentorship slot accepted.");
      await refreshSubmissions();
    } catch (error: unknown) {
      toast.error("Failed to accept mentor slot", { description: toError(error) });
    } finally {
      setAcceptingSlotId(null);
    }
  };

  return (
    <section className="space-y-4 rounded-2xl border border-slate-200 bg-white p-6">
      <div>
        <h3 className="text-lg font-semibold text-slate-900">Submission Desk</h3>
        <p className="text-sm text-slate-500">Submit the full paper once after finishing all answers.</p>
        <p className="mt-1 text-xs text-amber-700">Mentorship stays inactive until the mentor has checked your submission.</p>
      </div>

      {!isAuthenticated ? (
        <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          Sign in to submit your answers and track mentor review.
        </div>
      ) : !payload.series_id ? (
        <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          Submission is available only after this paper is linked to a mains test series.
        </div>
      ) : (
        <>
          <div className="inline-flex rounded-lg border border-slate-200 bg-slate-50 p-1">
            <button
              type="button"
              onClick={() => setSubmissionMode("pdf")}
              className={`rounded px-3 py-1.5 text-xs font-semibold ${submissionMode === "pdf" ? "bg-white text-slate-900 shadow-sm" : "text-slate-600"}`}
            >
              Complete PDF
            </button>
            <button
              type="button"
              onClick={() => setSubmissionMode("question_wise")}
              className={`rounded px-3 py-1.5 text-xs font-semibold ${submissionMode === "question_wise" ? "bg-white text-slate-900 shadow-sm" : "text-slate-600"}`}
            >
              Question-wise Photos
            </button>
          </div>

          {submissionMode === "pdf" ? (
            <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
              <label className="block text-xs font-semibold uppercase tracking-wide text-slate-500">Answer PDF URL</label>
              <input
                value={answerPdfUrl}
                onChange={(event) => setAnswerPdfUrl(event.target.value)}
                className="mt-2 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                placeholder="Paste the uploaded PDF URL"
              />
            </div>
          ) : (
            <div className="space-y-3">
              {payload.questions.map((question) => {
                const draftUrls = questionImageUrlsByQuestion[questionKey(question)] || [""];
                return (
                  <div key={`draft-${questionKey(question)}`} className="rounded-xl border border-slate-200 bg-slate-50 p-4">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div>
                        <p className="text-sm font-semibold text-slate-900">Q{question.question_number}</p>
                        <p className="text-xs text-slate-500">{question.max_marks} marks | {question.word_limit} words</p>
                      </div>
                      <button type="button" onClick={() => addQuestionImageField(question)} className="rounded border border-slate-300 bg-white px-2 py-1 text-xs text-slate-700">
                        Add Photo URL
                      </button>
                    </div>
                    <p className="mt-2 text-sm text-slate-700">{question.question_text}</p>
                    <div className="mt-3 space-y-2">
                      {draftUrls.map((url, index) => (
                        <div key={`${questionKey(question)}-${index}`} className="flex gap-2">
                          <input
                            value={url}
                            onChange={(event) => updateQuestionImageUrl(question, index, event.target.value)}
                            className="flex-1 rounded-lg border border-slate-300 px-3 py-2 text-sm"
                            placeholder={`Answer image URL ${index + 1}`}
                          />
                          {draftUrls.length > 1 ? (
                            <button type="button" onClick={() => removeQuestionImageField(question, index)} className="rounded border border-rose-300 bg-white px-3 py-2 text-xs text-rose-700">
                              Remove
                            </button>
                          ) : null}
                        </div>
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
            <label className="block text-xs font-semibold uppercase tracking-wide text-slate-500">Submission Note</label>
            <textarea
              value={submissionNote}
              onChange={(event) => setSubmissionNote(event.target.value)}
              className="mt-2 min-h-[96px] w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
              placeholder="Optional note for the mentor"
            />
            <div className="mt-3 grid gap-2 md:grid-cols-[220px_1fr]">
              <select
                value={preferredMode}
                onChange={(event) => setPreferredMode(event.target.value as "video" | "audio")}
                className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
              >
                <option value="video">Preferred call: Video</option>
                <option value="audio">Preferred call: Audio</option>
              </select>
              <div className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs text-slate-600">
                Same flow for every submission: copy upload -&gt; mentor ETA -&gt; checked copy -&gt; mentor offers slots -&gt; you accept one.
              </div>
            </div>
          </div>

          <div className="flex justify-end">
            <button
              type="button"
              onClick={() => void submitAttempt()}
              disabled={isSubmitting}
              className="inline-flex items-center rounded-lg bg-slate-900 px-4 py-2 text-sm font-semibold text-white disabled:opacity-60"
            >
              {isSubmitting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <NotebookPen className="mr-2 h-4 w-4" />}
              Submit Mains Answers
            </button>
          </div>
        </>
      )}

      <div className="border-t border-slate-200 pt-4">
        <div className="mb-3 flex items-center justify-between gap-2">
          <div>
            <h4 className="text-base font-semibold text-slate-900">Your Submission History</h4>
            <p className="text-sm text-slate-500">Track uploaded copies, question-wise answer photos, and checked marks.</p>
          </div>
          <button type="button" onClick={() => void refreshSubmissions()} className="rounded border border-slate-300 bg-white px-3 py-1.5 text-xs" disabled={isRefreshing}>
            {isRefreshing ? "Refreshing..." : "Refresh"}
          </button>
        </div>

        <div className="space-y-3">
          {submissions.map((submission) => {
            const linkedRequest = requestBySubmissionId[String(submission.id)] || null;
            const linkedSession = linkedRequest ? sessionByRequestId[String(linkedRequest.id)] || null : null;
            const offeredSlots = linkedRequest
              ? offeredSlotsForRequest(linkedRequest, providerSlotsByProviderId[linkedRequest.provider_user_id] || [])
              : [];

            return (
              <article key={submission.id} className="rounded-xl border border-slate-200 bg-slate-50 p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="space-y-1">
                    <p className="text-sm font-semibold text-slate-900">Submission #{submission.id}</p>
                    <p className="text-xs text-slate-500">
                      {submission.submission_mode.replace("_", " ")} | {submission.status} | Submitted {formatDateTime(submission.submitted_at)}
                    </p>
                    {submission.provider_eta_text ? (
                      <p className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-semibold text-amber-800">
                        <Clock3 className="h-3.5 w-3.5" />
                        {submission.provider_eta_text}
                      </p>
                    ) : null}
                  </div>
                  {submission.total_marks !== null && submission.total_marks !== undefined ? (
                    <span className="inline-flex items-center gap-1 rounded-full bg-emerald-100 px-2 py-1 text-xs font-semibold text-emerald-800">
                      <ShieldCheck className="h-3.5 w-3.5" />
                      Total: {submission.total_marks}
                    </span>
                  ) : null}
                </div>

                <div className="mt-3 flex flex-wrap gap-3 text-xs">
                  {submission.answer_pdf_url ? (
                    <a href={submission.answer_pdf_url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-indigo-700 hover:underline">
                      <FileText className="h-3.5 w-3.5" />
                      Open Answer PDF
                    </a>
                  ) : null}
                  {submission.checked_copy_pdf_url ? (
                    <a href={submission.checked_copy_pdf_url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-emerald-700 hover:underline">
                      <ExternalLink className="h-3.5 w-3.5" />
                      Open Checked Copy
                    </a>
                  ) : null}
                </div>

                {submission.learner_note ? (
                  <p className="mt-3 text-xs text-slate-600">Your note: {submission.learner_note}</p>
                ) : null}
                {submission.provider_note ? (
                  <p className="mt-1 text-xs text-slate-600">Mentor note: {submission.provider_note}</p>
                ) : null}

                <div className="mt-4">
                  <CopyEvaluationFlowStatus
                    steps={buildCopyEvaluationFlowSteps(submission, linkedRequest, linkedSession)}
                  />
                </div>

                {submission.question_responses.length > 0 ? (
                  <div className="mt-4 space-y-2">
                    {submission.question_responses.map((response) => (
                      <div key={`submission-${submission.id}-${response.question_number || response.question_item_id || "q"}`} className="rounded-lg border border-slate-200 bg-white p-3">
                        <p className="text-xs font-semibold text-slate-800">
                          Q{response.question_number || "?"} {response.question_text ? `| ${response.question_text}` : ""}
                        </p>
                        <div className="mt-2 flex flex-wrap gap-2">
                          {response.answer_image_urls.map((url, index) => (
                            <a key={`${url}-${index}`} href={url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 rounded border border-slate-300 bg-white px-2 py-1 text-[11px] text-slate-700">
                              <ImagePlus className="h-3.5 w-3.5" />
                              Answer Image {index + 1}
                            </a>
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                ) : null}

                {submission.question_marks.length > 0 ? (
                  <div className="mt-4 grid gap-2 md:grid-cols-2">
                    {submission.question_marks.map((mark) => (
                      <div key={`mark-${submission.id}-${mark.id}`} className="rounded-lg border border-emerald-100 bg-emerald-50 px-3 py-2 text-xs text-emerald-900">
                        Q{mark.question_number || "?"}: {mark.marks_awarded}/{mark.max_marks}
                        {mark.remark ? <p className="mt-1 text-[11px] text-emerald-800">{mark.remark}</p> : null}
                      </div>
                    ))}
                  </div>
                ) : null}

                <div className="mt-4 rounded-lg border border-slate-200 bg-white p-3">
                  {!linkedRequest ? (
                    <p className="text-xs text-slate-500">Workflow record is being prepared.</p>
                  ) : linkedRequest.status === "requested" && offeredSlots.length > 0 ? (
                    <>
                      <p className="mb-2 text-xs font-semibold text-slate-900">Mentor has offered slots. Accept one option only.</p>
                      <MentorshipSlotOfferList
                        slots={offeredSlots}
                        acceptingSlotId={acceptingSlotId}
                        onAccept={(slotId) => void acceptOfferedSlot(linkedRequest, slotId)}
                      />
                    </>
                  ) : linkedRequest.status === "requested" ? (
                    <p className="text-xs text-slate-500">
                      {submission.status === "checked"
                        ? "Copy checked. Mentor will share multiple call slots next."
                        : "Mentor will first share ETA, review the copy, and then offer call slots."}
                    </p>
                  ) : linkedRequest.status === "scheduled" ? (
                    <p className="text-xs text-emerald-700">
                      Call scheduled for {linkedSession ? formatDateTime(linkedSession.starts_at) : "the accepted slot"}.
                    </p>
                  ) : linkedRequest.status === "completed" ? (
                    <p className="text-xs text-emerald-700">This copy evaluation and mentorship flow is completed.</p>
                  ) : linkedRequest.status === "cancelled" ? (
                    <p className="text-xs text-rose-700">This workflow was cancelled.</p>
                  ) : (
                    <p className="text-xs text-rose-700">This workflow was rejected.</p>
                  )}
                </div>
              </article>
            );
          })}
          {submissions.length === 0 ? <p className="text-sm text-slate-500">No submissions yet for this mains paper.</p> : null}
        </div>
      </div>
    </section>
  );
}
