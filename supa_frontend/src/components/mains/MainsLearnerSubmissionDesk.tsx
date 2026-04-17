"use client";

import Link from "next/link";
import { ChevronDown, ChevronUp, Clock3, ExternalLink, FileText, ImagePlus, Loader2, NotebookPen, ShieldCheck } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";

import CopyEvaluationFlowStatus from "@/components/premium/CopyEvaluationFlowStatus";
import MentorshipSlotOfferList from "@/components/premium/MentorshipSlotOfferList";
import { useAuth } from "@/context/AuthContext";
import {
  buildCopyEvaluationFlowSteps,
  offeredSlotsForRequest,
} from "@/lib/copyEvaluationFlow";
import {
  resolveMainsTestFlowSummary,
  type MainsTestSectionKey,
  type MainsTestSectionTone,
} from "@/lib/mainsTestFlow";
import { mentorshipCurrentStatusLabel, mentorshipNextActionLabel } from "@/lib/mentorshipOrderFlow";
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

const currentLearnerLabel = (user: { email?: string | null; user_metadata?: Record<string, unknown> } | null | undefined): string => {
  const metadata = user?.user_metadata || {};
  for (const key of ["full_name", "name", "display_name"] as const) {
    const value = String(metadata[key] || "").trim();
    if (value) return value;
  }
  const firstName = String(metadata["first_name"] || "").trim();
  const lastName = String(metadata["last_name"] || "").trim();
  return `${firstName} ${lastName}`.trim();
};

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

const stageToneClasses: Record<
  MainsTestSectionTone,
  {
    toggle: string;
    icon: string;
    badge: string;
    body: string;
    summary: string;
  }
> = {
  slate: {
    toggle: "border-slate-300 bg-slate-50 text-slate-900",
    icon: "border-slate-300 bg-white text-slate-700",
    badge: "border-slate-300 bg-white text-slate-700",
    body: "border-slate-300 bg-slate-50/80",
    summary: "border-slate-300 bg-slate-50 text-slate-900",
  },
  amber: {
    toggle: "border-amber-300 bg-gradient-to-r from-amber-50 to-orange-50 text-amber-950",
    icon: "border-amber-300 bg-amber-100 text-amber-900",
    badge: "border-amber-300 bg-amber-100 text-amber-900",
    body: "border-amber-200 bg-amber-50/80",
    summary: "border-amber-300 bg-amber-50 text-amber-950",
  },
  emerald: {
    toggle: "border-emerald-300 bg-gradient-to-r from-emerald-50 to-teal-50 text-emerald-950",
    icon: "border-emerald-300 bg-emerald-100 text-emerald-900",
    badge: "border-emerald-300 bg-emerald-100 text-emerald-900",
    body: "border-emerald-200 bg-emerald-50/80",
    summary: "border-emerald-300 bg-emerald-50 text-emerald-950",
  },
  indigo: {
    toggle: "border-indigo-300 bg-gradient-to-r from-indigo-50 to-sky-50 text-indigo-950",
    icon: "border-indigo-300 bg-indigo-100 text-indigo-900",
    badge: "border-indigo-300 bg-indigo-100 text-indigo-900",
    body: "border-indigo-200 bg-indigo-50/80",
    summary: "border-indigo-300 bg-indigo-50 text-indigo-950",
  },
};

const stageNumbers: Record<MainsTestSectionKey, string> = {
  question_paper: "1",
  evaluation: "2",
  mentorship: "3",
};

export default function MainsLearnerSubmissionDesk({ collectionId, payload }: MainsLearnerSubmissionDeskProps) {
  const { isAuthenticated, user } = useAuth();
  const [submissions, setSubmissions] = useState<MainsCopySubmission[]>([]);
  const [requests, setRequests] = useState<MentorshipRequest[]>([]);
  const [sessions, setSessions] = useState<MentorshipSession[]>([]);
  const [providerSlotsByProviderId, setProviderSlotsByProviderId] = useState<Record<string, MentorshipSlot[]>>({});
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [acceptingSlotId, setAcceptingSlotId] = useState<number | null>(null);
  const [requestingMentorshipSubmissionId, setRequestingMentorshipSubmissionId] = useState<number | null>(null);
  const [evaluationOpen, setEvaluationOpen] = useState(true);
  const [mentorshipOpen, setMentorshipOpen] = useState(false);
  const [submissionMode, setSubmissionMode] = useState<"pdf" | "question_wise" | "digital_text">("pdf");
  const [answerPdfUrl, setAnswerPdfUrl] = useState("");
  const [submissionNote, setSubmissionNote] = useState("");
  const [mentorshipNote, setMentorshipNote] = useState("");
  const [preferredMode, setPreferredMode] = useState<"video" | "audio">("video");
  const [questionImageUrlsByQuestion, setQuestionImageUrlsByQuestion] = useState<Record<string, string[]>>(
    buildQuestionImageDrafts(payload.questions),
  );
  const [questionTextDraftsByQuestion, setQuestionTextDraftsByQuestion] = useState<Record<string, string>>({});

  const refreshSubmissions = useCallback(async () => {
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
        .map((request) => String(request.mentor_id))
        .filter((value, index, array) => value && array.indexOf(value) === index);
      if (providerIds.length === 0) {
        setProviderSlotsByProviderId({});
      } else {
        const slotEntries = await Promise.all(
          providerIds.map(async (providerUserId) => {
            try {
              const response = await premiumApi.get<MentorshipSlot[]>("/mentorship/slots", {
                params: { mentor_id: providerUserId, only_available: false },
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
  }, [collectionId, isAuthenticated, payload.series_id]);

  useEffect(() => {
    setQuestionImageUrlsByQuestion(buildQuestionImageDrafts(payload.questions));
  }, [payload.questions]);

  useEffect(() => {
    void refreshSubmissions();
  }, [refreshSubmissions]);

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
      toast.error("This mains paper is not linked to a programs yet.");
      return;
    }

    const questionResponses: MainsCopyQuestionResponsePayload[] = [];
    if (submissionMode === "digital_text") {
      for (const question of payload.questions) {
        const text = (questionTextDraftsByQuestion[questionKey(question)] || "").trim();
        if (text) {
          questionResponses.push({
            question_item_id: question.content_item_id,
            question_number: question.question_number,
            answer_image_urls: [],
            answer_text: text,
          });
        }
      }
    } else {
      for (const question of payload.questions) {
        const urls = (questionImageUrlsByQuestion[questionKey(question)] || [])
          .map((item) => item.trim())
          .filter(Boolean);
        if (urls.length > 0) {
          questionResponses.push({
            question_item_id: question.content_item_id,
            question_number: question.question_number,
            answer_image_urls: urls,
          });
        }
      }
    }

    if (submissionMode === "pdf" && !answerPdfUrl.trim()) {
      toast.error("Answer PDF URL is required.");
      return;
    }
    if ((submissionMode === "question_wise" || submissionMode === "digital_text") && questionResponses.length === 0) {
      toast.error(submissionMode === "digital_text" ? "Enter text for at least one answer." : "Attach at least one answer image.");
      return;
    }

    setIsSubmitting(true);
    try {
      await premiumApi.post(`/tests/${collectionId}/copy-submissions`, {
        answer_pdf_url: submissionMode === "pdf" ? answerPdfUrl.trim() : undefined,
        question_responses: (submissionMode === "question_wise" || submissionMode === "digital_text") ? questionResponses : undefined,
        note: submissionNote.trim() || undefined,
        submission_mode: submissionMode,
      });
      toast.success("Mains submission recorded.");
      setAnswerPdfUrl("");
      setSubmissionNote("");
      setQuestionImageUrlsByQuestion(buildQuestionImageDrafts(payload.questions));
      setQuestionTextDraftsByQuestion({});
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

  const flowSummary = useMemo(
    () =>
      resolveMainsTestFlowSummary({
        submissions,
        requests,
        sessions,
      }),
    [requests, sessions, submissions],
  );

  useEffect(() => {
    if (flowSummary.activeSection === "evaluation") {
      setEvaluationOpen(true);
    } else if (flowSummary.activeSection === "mentorship") {
      setMentorshipOpen(true);
    }
  }, [flowSummary.activeSection]);

  const latestSubmission = flowSummary.latestSubmission;
  const latestRequest = flowSummary.latestRequest;
  const latestOpenRequest = useMemo(
    () =>
      latestSubmission
        ? requests
          .filter(
            (request) =>
              Number(request.submission_id || 0) === latestSubmission.id
              && ["requested", "accepted", "scheduled"].includes(String(request.status || "").trim().toLowerCase()),
          )
          .sort((left, right) => new Date(right.requested_at).getTime() - new Date(left.requested_at).getTime())[0] || null
        : null,
    [latestSubmission, requests],
  );
  const activeMentorshipRequest = latestOpenRequest || latestRequest;
  const latestSession = flowSummary.latestSession;
  const latestPublishedSlots = activeMentorshipRequest
    ? (providerSlotsByProviderId[String(activeMentorshipRequest.mentor_id)] || []).filter(
        (slot) =>
          Boolean(slot.is_active) &&
          (slot.booked_count || 0) < (slot.max_bookings || 1) &&
          new Date(slot.ends_at).getTime() > Date.now(),
      )
    : [];
  const latestOfferedSlots = activeMentorshipRequest
    ? offeredSlotsForRequest(activeMentorshipRequest, providerSlotsByProviderId[String(activeMentorshipRequest.mentor_id)] || [])
    : [];
  const latestBookableSlots = activeMentorshipRequest
    ? activeMentorshipRequest.booking_open
      ? latestPublishedSlots
      : latestOfferedSlots
    : [];
  const activeSectionSummary = flowSummary.sections[flowSummary.activeSection];

  const requestMentorship = async (submissionId: number) => {
    setRequestingMentorshipSubmissionId(submissionId);
    try {
      const learnerName = currentLearnerLabel(user);
      const learnerEmail = String(user?.email || "").trim();
      await premiumApi.post("/mentorship/requests", {
        submission_id: submissionId,
        preferred_mode: preferredMode,
        note: mentorshipNote.trim() || undefined,
        learner_name: learnerName || undefined,
        learner_email: learnerEmail || undefined,
      });
      toast.success("Mentorship requested.");
      setMentorshipNote("");
      await refreshSubmissions();
    } catch (error: unknown) {
      toast.error("Failed to request mentorship", { description: toError(error) });
    } finally {
      setRequestingMentorshipSubmissionId(null);
    }
  };

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

  const renderStackedSection = (
    sectionKey: MainsTestSectionKey,
    titleOverride: string,
    isOpen: boolean,
    toggleOpen: (() => void) | null,
    children: React.ReactNode
  ) => {
    const section = flowSummary.sections[sectionKey];
    const tone = stageToneClasses[section.tone];
    
    return (
      <div className={`overflow-hidden rounded-2xl border-2 transition-all duration-300 shadow-sm ${tone.body} border-slate-200 bg-white`}>
        <div
          onClick={toggleOpen || undefined}
          className={`w-full px-5 py-4 text-left ${toggleOpen ? `${tone.toggle} hover:bg-slate-50 cursor-pointer` : "bg-white"}`}
        >
          <div className="flex w-full items-center justify-between">
            <div className="flex items-center gap-4">
              <span className={`inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl border text-base font-black ${tone.icon}`}>
                {stageNumbers[sectionKey]}
              </span>
              <div className="space-y-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-[14px] font-bold uppercase tracking-wide text-slate-800">{titleOverride}</span>
                  <span className={`inline-flex rounded-full border px-2.5 py-1 text-[11px] font-bold ${tone.badge}`}>{section.status}</span>
                </div>
                <p className="text-sm leading-6">{section.detail}</p>
              </div>
            </div>
            {toggleOpen ? (
              <span className={`ml-3 inline-flex shrink-0 rounded-full border p-2 ${tone.icon}`}>
                {isOpen ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
              </span>
            ) : null}
          </div>
        </div>
        {isOpen && (
          <div className="border-t-2 border-dashed border-slate-200 p-5 bg-white">
            {children}
          </div>
        )}
      </div>
    );
  };

  return (
    <section className="space-y-6">
      <div className={`rounded-xl border px-5 py-4 shadow-sm ${stageToneClasses[flowSummary.sections[flowSummary.activeSection].tone].body} border-slate-200`}>
        <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
          <div>
            <span className="text-[11px] font-bold uppercase tracking-widest text-slate-500">Present Step</span>
            <div className="mt-1 flex items-center gap-2">
              <span className={`inline-flex rounded-full border px-3 py-1 text-xs font-bold shadow-sm ${stageToneClasses[flowSummary.sections[flowSummary.activeSection].tone].badge}`}>
                {flowSummary.sections[flowSummary.activeSection].label}
              </span>
              <span className={`inline-flex rounded-full border px-3 py-1 text-xs font-bold shadow-sm ${stageToneClasses[flowSummary.sections[flowSummary.activeSection].tone].badge}`}>
                Status: {flowSummary.overallStatus}
              </span>
            </div>
          </div>
        </div>
      </div>

      <div className="space-y-4">
        {renderStackedSection("question_paper", "Step 1: Read Question Paper", true, null, (
          <div className="space-y-4">
            <p className="text-sm text-slate-600">
              Read the full paper here. Write and submit your answers in the evaluation section below.
            </p>
            <div className="space-y-4">
              {payload.questions.map((question) => (
                <article key={`paper-${questionKey(question)}`} className="rounded-xl border border-slate-200 bg-white p-4">
                  <div className="flex flex-wrap items-center gap-2 text-[11px]">
                    <span className="rounded-full bg-slate-100 px-2 py-0.5 font-semibold text-slate-700">Q{question.question_number}</span>
                    <span className="rounded-full bg-emerald-100 px-2 py-0.5 font-semibold text-emerald-700">{question.max_marks} marks</span>
                    <span className="rounded-full bg-sky-100 px-2 py-0.5 font-semibold text-sky-700">{question.word_limit} words</span>
                  </div>
                  <p className="mt-3 whitespace-pre-wrap text-sm leading-7 text-slate-800">{question.question_text}</p>
                </article>
              ))}
            </div>
          </div>
        ))}

        {renderStackedSection("evaluation", "Step 2: Submit Your Answers", evaluationOpen, () => setEvaluationOpen(!evaluationOpen), (
          <div className="space-y-4">
            {!isAuthenticated ? (
              <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
                Sign in to submit your answers and track mentor evaluation.
              </div>
            ) : !payload.series_id ? (
              <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
                Evaluation is available only after this paper is linked to a mains programs.
              </div>
            ) : (
              <>
                <div className="inline-flex rounded-lg border border-slate-200 bg-white p-1">
                  <button
                    type="button"
                    onClick={() => setSubmissionMode("digital_text")}
                    className={`rounded px-3 py-1.5 text-xs font-semibold ${submissionMode === "digital_text" ? "bg-slate-900 text-white shadow-sm" : "text-slate-600"}`}
                  >
                    Digital Text Input
                  </button>
                  <button
                    type="button"
                    onClick={() => setSubmissionMode("pdf")}
                    className={`rounded px-3 py-1.5 text-xs font-semibold ${submissionMode === "pdf" ? "bg-slate-900 text-white shadow-sm" : "text-slate-600"}`}
                  >
                    Complete PDF
                  </button>
                  <button
                    type="button"
                    onClick={() => setSubmissionMode("question_wise")}
                    className={`rounded px-3 py-1.5 text-xs font-semibold ${submissionMode === "question_wise" ? "bg-slate-900 text-white shadow-sm" : "text-slate-600"}`}
                  >
                    Question-wise Photos
                  </button>
                </div>

                {submissionMode === "pdf" ? (
                  <div className="rounded-xl border border-slate-200 bg-white p-4">
                    <label className="block text-xs font-semibold uppercase tracking-wide text-slate-500">Answer PDF URL</label>
                    <input
                      value={answerPdfUrl}
                      onChange={(event) => setAnswerPdfUrl(event.target.value)}
                      className="mt-2 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                      placeholder="Paste the uploaded PDF URL"
                    />
                  </div>
                ) : submissionMode === "digital_text" ? (
                  <div className="space-y-4">
                    {payload.questions.map((question) => {
                      const textDraft = questionTextDraftsByQuestion[questionKey(question)] || "";
                      return (
                        <div key={`text-${questionKey(question)}`} className="rounded-xl border border-slate-200 bg-white p-4">
                          <div className="flex flex-wrap items-center justify-between gap-2">
                            <div>
                              <p className="text-sm font-semibold text-slate-900">Q{question.question_number}</p>
                              <p className="text-xs text-slate-500">{question.max_marks} marks | {question.word_limit} words</p>
                            </div>
                          </div>
                          <p className="mt-2 text-sm text-slate-700">{question.question_text}</p>
                          <textarea
                            value={textDraft}
                            onChange={(event) => setQuestionTextDraftsByQuestion((prev) => ({ ...prev, [questionKey(question)]: event.target.value }))}
                            className="mt-4 min-h-[160px] w-full rounded-lg border border-indigo-200 bg-indigo-50/30 px-4 py-3 text-sm text-slate-800 focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
                            placeholder="Type your answer here..."
                          />
                        </div>
                      );
                    })}
                  </div>
                ) : (
                  <div className="space-y-3">
                    {payload.questions.map((question) => {
                      const draftUrls = questionImageUrlsByQuestion[questionKey(question)] || [""];
                      return (
                        <div key={`draft-${questionKey(question)}`} className="rounded-xl border border-slate-200 bg-white p-4">
                          <div className="flex flex-wrap items-center justify-between gap-2">
                            <div>
                              <p className="text-sm font-semibold text-slate-900">Q{question.question_number}</p>
                              <p className="text-xs text-slate-500">{question.max_marks} marks | {question.word_limit} words</p>
                            </div>
                            <button type="button" onClick={() => addQuestionImageField(question)} className="rounded border border-slate-300 bg-slate-50 px-2 py-1 text-xs text-slate-700">
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

                <div className="rounded-xl border border-slate-200 bg-white p-4">
                  <label className="block text-xs font-semibold uppercase tracking-wide text-slate-500">Submission Note</label>
                  <textarea
                    value={submissionNote}
                    onChange={(event) => setSubmissionNote(event.target.value)}
                    className="mt-2 min-h-[96px] w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                    placeholder="Optional note for the mentor"
                  />
                  <div className="mt-3 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-600">
                    Submitting the copy moves this paper into evaluation. Mentorship stays separate until the checked copy and marks are ready.
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

            <div className="mb-3 flex items-center justify-between gap-2">
              <div>
                <h4 className="text-base font-semibold text-slate-900">Your Submission History</h4>
                <p className="text-sm text-slate-500">Track uploaded copies, question-wise answer photos, checked copies, and marks.</p>
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
                    ? offeredSlotsForRequest(linkedRequest, providerSlotsByProviderId[String(linkedRequest.mentor_id)] || [])
                    : [];
                const publishedSlots = linkedRequest
                  ? (providerSlotsByProviderId[String(linkedRequest.mentor_id)] || []).filter(
                      (slot) =>
                        Boolean(slot.is_active) &&
                        (slot.booked_count || 0) < (slot.max_bookings || 1) &&
                        new Date(slot.ends_at).getTime() > Date.now(),
                    )
                  : [];
                const bookableSlots = linkedRequest?.booking_open ? publishedSlots : offeredSlots;
                const currentStatus = linkedRequest
                  ? mentorshipCurrentStatusLabel(linkedRequest, linkedSession, submission, bookableSlots.length)
                  : submission.status === "checked"
                    ? "Checked"
                    : submission.provider_eta_text
                      ? "Under review"
                      : "Evaluation awaited";
                const nextAction = linkedRequest
                  ? mentorshipNextActionLabel(linkedRequest, linkedSession, submission, bookableSlots.length)
                  : submission.status === "checked"
                    ? "Request mentorship from the mentorship section if you want a follow-up session."
                    : "Wait for the mentor to finish the evaluation and share the checked copy.";

                return (
                  <article key={submission.id} className="rounded-xl border border-slate-200 bg-white p-4">
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
                          <div key={`submission-${submission.id}-${response.question_number || response.question_item_id || "q"}`} className="rounded-lg border border-slate-200 bg-slate-50 p-3">
                            <p className="text-xs font-semibold text-slate-800">
                              Q{response.question_number || "?"} {response.question_text ? `| ${response.question_text}` : ""}
                            </p>
                            {response.answer_text ? (
                              <p className="mt-2 whitespace-pre-wrap text-xs text-slate-700">{response.answer_text}</p>
                            ) : null}
                            {response.answer_image_urls && response.answer_image_urls.length > 0 ? (
                              <div className="mt-2 flex flex-wrap gap-2">
                                {response.answer_image_urls.map((url, index) => (
                                  <a key={`${url}-${index}`} href={url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 rounded border border-slate-300 bg-white px-2 py-1 text-[11px] text-slate-700">
                                    <ImagePlus className="h-3.5 w-3.5" />
                                    Answer Image {index + 1}
                                  </a>
                                ))}
                              </div>
                            ) : null}
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

                    <div className="mt-4 rounded-lg border border-slate-200 bg-slate-50 p-3">
                      <p className="text-xs font-semibold text-slate-900">{currentStatus}</p>
                      <p className="mt-1 text-xs text-slate-600">{nextAction}</p>
                    </div>
                  </article>
                );
              })}
              {submissions.length === 0 ? <p className="text-sm text-slate-500">No submissions yet for this mains paper.</p> : null}
            </div>
          </div>
        ))}

        {renderStackedSection("mentorship", "Step 3: Mentorship", mentorshipOpen, () => setMentorshipOpen(!mentorshipOpen), (
          <div className="space-y-4">
            {!isAuthenticated ? (
              <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
                Sign in to request mentorship after evaluation.
              </div>
            ) : !payload.series_id ? (
              <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
                Mentorship opens only for mains papers linked to a programs.
              </div>
            ) : !latestSubmission ? (
              <div className="rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-700">
                Submit one answer copy from the evaluation section before mentorship can unlock.
              </div>
            ) : latestSubmission.status !== "checked" && !latestRequest ? (
              <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
                Mentorship is still locked. Wait for the checked copy and marks to be published first.
              </div>
            ) : !latestOpenRequest ? (
              <div className="space-y-4 rounded-xl border border-indigo-200 bg-white p-4">
                <div>
                  <h4 className="text-base font-semibold text-slate-900">Request Mentorship for Submission #{latestSubmission.id}</h4>
                  <p className="text-sm text-slate-500">Your checked copy is ready. Send one mentorship request if you want a follow-up discussion on this evaluated submission.</p>
                </div>
                <div className="grid gap-3 md:grid-cols-2">
                  <select
                    value={preferredMode}
                    onChange={(event) => setPreferredMode(event.target.value as "video" | "audio")}
                    className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
                  >
                    <option value="video">Preferred call: Video</option>
                    <option value="audio">Preferred call: Audio</option>
                  </select>
                  <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-600">
                    One active request per mentor is allowed at a time for this flow.
                  </div>
                </div>
                <textarea
                  value={mentorshipNote}
                  onChange={(event) => setMentorshipNote(event.target.value)}
                  className="min-h-[96px] w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                  placeholder="Optional note for the mentorship request"
                />
                <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-600">
                  <span>Checked copy: {latestSubmission.checked_copy_pdf_url ? "Ready" : "Not attached"}</span>
                  <span>
                    {latestSubmission.total_marks !== null && latestSubmission.total_marks !== undefined
                      ? `Marks: ${latestSubmission.total_marks}`
                      : "Marks ready in mentor response"}
                  </span>
                </div>
                <div className="flex justify-end">
                  <button
                    type="button"
                    onClick={() => void requestMentorship(latestSubmission.id)}
                    disabled={requestingMentorshipSubmissionId === latestSubmission.id}
                    className="inline-flex items-center rounded-lg bg-indigo-700 px-4 py-2 text-sm font-semibold text-white disabled:opacity-60"
                  >
                    {requestingMentorshipSubmissionId === latestSubmission.id ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <ShieldCheck className="mr-2 h-4 w-4" />}
                    Request Mentorship
                  </button>
                </div>
              </div>
            ) : (
              <div className="space-y-4 rounded-xl border border-slate-200 bg-white p-4">
                {["requested", "accepted", "scheduled"].includes(String(latestOpenRequest?.status || "").trim().toLowerCase()) ? (
                  <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs font-semibold text-amber-800">
                    You already have an active mentorship request with this mentor. Continue inside the current request instead of sending another one.
                  </div>
                ) : null}
                <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
                  <p className="text-xs font-semibold text-slate-900">
                    {mentorshipCurrentStatusLabel(activeMentorshipRequest!, latestSession, latestSubmission, latestBookableSlots.length)}
                  </p>
                  <p className="mt-1 text-xs text-slate-600">
                    {mentorshipNextActionLabel(activeMentorshipRequest!, latestSession, latestSubmission, latestBookableSlots.length)}
                  </p>
                </div>

                {latestSubmission?.checked_copy_pdf_url ? (
                  <a href={latestSubmission.checked_copy_pdf_url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-sm font-semibold text-emerald-700 hover:underline">
                    <ExternalLink className="h-4 w-4" />
                    Open Checked Copy
                  </a>
                ) : null}

                {latestSession?.join_available && (latestSession.status === "scheduled" || latestSession.status === "live") ? (
                  <>
                    <p className="text-xs text-emerald-700">
                      Session window: {formatDateTime(latestSession.starts_at)} - {formatDateTime(latestSession.ends_at)}
                    </p>
                    <Link
                      href={`/mentorship/session/${latestSession.id}?autojoin=1`}
                      className="inline-flex w-fit rounded border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700"
                    >
                      {latestSession.status === "live" ? "Join Live Call" : "Join Call"}
                    </Link>
                  </>
                ) : activeMentorshipRequest!.booking_open && latestBookableSlots.length > 0 ? (
                  <>
                    <p className="text-xs font-semibold text-slate-900">Choose one published mentorship slot.</p>
                    <MentorshipSlotOfferList
                      slots={latestBookableSlots}
                      acceptingSlotId={acceptingSlotId}
                      onAccept={(slotId) => void acceptOfferedSlot(activeMentorshipRequest!, slotId)}
                    />
                  </>
                ) : activeMentorshipRequest!.workflow_stage === "feedback_ready" ? (
                  <p className="text-xs text-amber-700">
                    Evaluation is complete and mentorship has been requested. Waiting for the mentor to publish session time.
                  </p>
                ) : activeMentorshipRequest!.workflow_stage === "scheduled" ? (
                  <p className="text-xs text-emerald-700">
                    Session scheduled for {latestSession ? formatDateTime(latestSession.starts_at) : "the confirmed slot"}.
                  </p>
                ) : activeMentorshipRequest!.workflow_stage === "completed" ? (
                  <p className="text-xs text-emerald-700">This mentorship workflow is complete.</p>
                ) : activeMentorshipRequest!.workflow_stage === "cancelled" || activeMentorshipRequest!.status === "cancelled" || activeMentorshipRequest!.status === "rejected" ? (
                  <p className="text-xs text-rose-700">This mentorship workflow was closed.</p>
                ) : (
                  <p className="text-xs text-slate-500">The mentorship request is recorded. Refresh to pick up mentor updates.</p>
                )}
                {activeMentorshipRequest ? (
                  <Link
                    href={`/my-purchases/mentorship/${activeMentorshipRequest.id}`}
                    className="inline-flex w-fit rounded border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700"
                  >
                    Open Current Request
                  </Link>
                ) : null}
              </div>
            )}
          </div>
        ))}
      </div>
    </section>
  );
}
