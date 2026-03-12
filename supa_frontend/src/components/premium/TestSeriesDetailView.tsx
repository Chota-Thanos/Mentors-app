"use client";

import axios from "axios";
import Link from "next/link";
import Image from "next/image";
import { useCallback, useEffect, useMemo, useState } from "react";
import { BookOpenCheck, CalendarClock, ClipboardCheck, ShieldCheck } from "lucide-react";
import { toast } from "sonner";

import { useAuth } from "@/context/AuthContext";
import { isMentorLike, isModeratorLike, isProviderLike } from "@/lib/accessControl";
import { premiumApi } from "@/lib/premiumApi";
import { richTextToPlainText } from "@/lib/richText";
import UserLifecycleBoard from "@/components/premium/UserLifecycleBoard";
import HistoryBackButton from "@/components/ui/HistoryBackButton";
import RichTextContent from "@/components/ui/RichTextContent";
import type {
  MainsCopySubmission,
  MentorshipRequest,
  MentorshipSession,
  TestSeries,
  TestSeriesEnrollment,
  TestSeriesTest,
} from "@/types/premium";

interface TestSeriesDetailViewProps {
  seriesId: number;
}

const toError = (error: unknown): string => {
  if (!axios.isAxiosError(error)) return "Unknown error";
  const detail = error.response?.data?.detail;
  return typeof detail === "string" && detail.trim() ? detail : error.message;
};

export default function TestSeriesDetailView({ seriesId }: TestSeriesDetailViewProps) {
  const { user, isAuthenticated } = useAuth();
  const providerLike = useMemo(() => isProviderLike(user), [user]);
  const mentorLike = useMemo(() => isMentorLike(user), [user]);
  const moderatorLike = useMemo(() => isModeratorLike(user), [user]);
  const [loading, setLoading] = useState(true);
  const [series, setSeries] = useState<TestSeries | null>(null);
  const [tests, setTests] = useState<TestSeriesTest[]>([]);
  const [enrollments, setEnrollments] = useState<TestSeriesEnrollment[]>([]);
  const [copySubmissionsByTest, setCopySubmissionsByTest] = useState<Record<string, MainsCopySubmission[]>>({});
  const [mentorshipRequests, setMentorshipRequests] = useState<MentorshipRequest[]>([]);
  const [mentorshipSessions, setMentorshipSessions] = useState<MentorshipSession[]>([]);

  const userId = String(user?.id || "").trim();
  const isSeriesOwner = Boolean(providerLike && userId && series?.provider_user_id === userId);
  const canOpenManageView = Boolean(isAuthenticated && (isSeriesOwner || mentorLike || moderatorLike));

  const loadBase = useCallback(async () => {
    setLoading(true);
    try {
      const [seriesRes, testsRes] = await Promise.all([
        premiumApi.get<TestSeries>(`/test-series/${seriesId}`),
        premiumApi.get<TestSeriesTest[]>(`/test-series/${seriesId}/tests`),
      ]);
      const nextSeries = seriesRes.data;
      const nextTests = Array.isArray(testsRes.data) ? testsRes.data : [];
      setSeries(nextSeries);
      setTests(nextTests);

      if (isAuthenticated) {
        const [enrollRes, requestsRes, sessionsRes] = await Promise.all([
          premiumApi.get<TestSeriesEnrollment[]>("/test-series/my/enrollments"),
          premiumApi.get<MentorshipRequest[]>("/mentorship/requests", { params: { scope: "me" } }),
          premiumApi.get<MentorshipSession[]>("/mentorship/sessions", { params: { scope: "me" } }),
        ]);
        setEnrollments(Array.isArray(enrollRes.data) ? enrollRes.data : []);
        setMentorshipRequests(Array.isArray(requestsRes.data) ? requestsRes.data : []);
        setMentorshipSessions(Array.isArray(sessionsRes.data) ? sessionsRes.data : []);

        const mainsTests = nextTests.filter((test) => test.test_kind === "mains");
        const submissionsEntries = await Promise.all(
          mainsTests.map(async (test) => {
            try {
              const response = await premiumApi.get<MainsCopySubmission[]>(`/tests/${test.id}/copy-submissions`);
              return [String(test.id), Array.isArray(response.data) ? response.data : []] as const;
            } catch {
              return [String(test.id), []] as const;
            }
          }),
        );
        setCopySubmissionsByTest(Object.fromEntries(submissionsEntries));
      } else {
        setEnrollments([]);
        setMentorshipRequests([]);
        setMentorshipSessions([]);
        setCopySubmissionsByTest({});
      }
    } catch (error: unknown) {
      toast.error("Failed to load test series details", { description: toError(error) });
      setSeries(null);
      setTests([]);
    } finally {
      setLoading(false);
    }
  }, [isAuthenticated, seriesId]);

  useEffect(() => {
    void loadBase();
  }, [loadBase]);

  const isEnrolled = useMemo(
    () => enrollments.some((row) => row.series_id === seriesId && row.status === "active"),
    [enrollments, seriesId],
  );

  const lifecycleMetrics = useMemo(() => {
    const allSubmissions = Object.values(copySubmissionsByTest).flat();
    const requestedCount = mentorshipRequests.filter((request) => request.series_id === seriesId).length;
    const scheduledCount = mentorshipSessions.filter(
      (session) =>
        mentorshipRequests.some(
          (request) => request.id === session.request_id && request.series_id === seriesId,
        ) && session.status !== "cancelled",
    ).length;
    const completedCount = mentorshipSessions.filter(
      (session) =>
        mentorshipRequests.some(
          (request) => request.id === session.request_id && request.series_id === seriesId,
        ) && session.status === "completed",
    ).length;
    return {
      enrolled: isEnrolled || isSeriesOwner,
      attempted_tests: allSubmissions.length,
      copy_submissions: allSubmissions.length,
      copy_checked: allSubmissions.filter((submission) => submission.status === "checked").length,
      mentorship_requests: requestedCount,
      mentorship_scheduled: scheduledCount,
      mentorship_completed: completedCount,
    };
  }, [copySubmissionsByTest, isEnrolled, isSeriesOwner, mentorshipRequests, mentorshipSessions, seriesId]);

  const enroll = async () => {
    try {
      await premiumApi.post(`/test-series/${seriesId}/enroll`, { access_source: "self_service" });
      toast.success("Enrollment completed");
      await loadBase();
    } catch (error: unknown) {
      toast.error("Enrollment failed", { description: toError(error) });
    }
  };

  if (loading) {
    return <div className="rounded-xl border border-slate-200 bg-white p-6 text-sm text-slate-500">Loading test series...</div>;
  }

  if (!series) {
    return <div className="rounded-xl border border-rose-200 bg-rose-50 p-6 text-sm text-rose-700">Test series not found or inaccessible.</div>;
  }

  const fallbackHref =
    series.series_kind === "mains"
      ? "/test-series/mains"
      : series.series_kind === "quiz"
        ? "/test-series/prelims"
        : "/test-series";

  return (
    <div className="space-y-6">
      <HistoryBackButton
        fallbackHref={fallbackHref}
        label="Back to Test Series"
        className="inline-flex items-center gap-1 text-sm text-slate-600 hover:text-slate-900"
        iconClassName="h-4 w-4"
      />

      <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white">
        <div className="grid gap-0 md:grid-cols-[280px_1fr]">
          <div className="min-h-[180px] bg-slate-100">
            {series.cover_image_url ? (
              <Image
                src={series.cover_image_url}
                alt={series.title}
                width={560}
                height={360}
                unoptimized
                className="h-full w-full object-cover"
              />
            ) : (
              <div className="flex h-full items-center justify-center text-slate-400">No Cover</div>
            )}
          </div>
          <div className="p-5">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <h1 className="text-2xl font-bold text-slate-900">{series.title}</h1>
                {series.description ? (
                  <RichTextContent value={series.description} className="mt-2 text-sm text-slate-600" />
                ) : (
                  <p className="mt-2 text-sm text-slate-600">No description provided.</p>
                )}
                <p className="mt-2 rounded border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-600">
                  Flow: open the mains writing desk -&gt; submit answers -&gt; mentor shares checking ETA -&gt; mentor reviews the copy -&gt; mentor offers multiple call slots -&gt; you accept one slot -&gt; mentor completes the session.
                </p>
                <p className="mt-2 text-xs text-slate-500">
                  Access: <span className="font-semibold">{series.access_type}</span> | Type: <span className="font-semibold">{series.series_kind}</span> | Tests: <span className="font-semibold">{tests.length}</span>
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                {!isEnrolled && !isSeriesOwner ? (
                  <button type="button" onClick={() => void enroll()} className="rounded-md bg-slate-900 px-3 py-2 text-sm font-semibold text-white">
                    Enroll
                  </button>
                ) : (
                  <span className="inline-flex items-center rounded-md bg-emerald-100 px-3 py-2 text-xs font-semibold text-emerald-800">
                    Enrolled
                  </span>
                )}
                <Link href="/mentorship/manage" className="rounded-md border border-slate-300 px-3 py-2 text-sm">
                  Mentorship Management
                </Link>
                {canOpenManageView ? (
                  <Link href={`/test-series/${seriesId}/manage`} className="rounded-md border border-indigo-300 bg-indigo-50 px-3 py-2 text-sm font-semibold text-indigo-700">
                    Series Manage View
                  </Link>
                ) : null}
              </div>
            </div>
          </div>
        </div>
      </section>

      <UserLifecycleBoard metrics={lifecycleMetrics} />

      <section className="rounded-xl border border-slate-200 bg-white p-4">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-lg font-semibold text-slate-900">Tests in this Series</h2>
        </div>
        <p className="mb-3 text-xs text-slate-600">
          Every mains submission now creates one linked evaluation-plus-mentorship flow automatically. Track ETA, checked copy, mentor slot offers, and accepted call timing from the writing desk or mentorship manage page.
        </p>

        <div className="space-y-3">
          {tests.map((test) => {
            const submissions = copySubmissionsByTest[String(test.id)] || [];
            return (
              <article key={test.id} className="rounded-lg border border-slate-200 bg-slate-50 p-3">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div>
                    <p className="text-base font-semibold text-slate-900">{test.title}</p>
                    <p className="text-xs text-slate-500">{richTextToPlainText(test.description || "") || "No description"}</p>
                    <div className="mt-1 flex flex-wrap items-center gap-2 text-[11px] text-slate-500">
                      <span className="inline-flex items-center gap-1 rounded-full bg-slate-200 px-2 py-0.5">
                        <BookOpenCheck className="h-3.5 w-3.5" />
                        {test.test_label}
                      </span>
                      <span className="inline-flex items-center gap-1 rounded-full bg-slate-200 px-2 py-0.5">
                        <ClipboardCheck className="h-3.5 w-3.5" />
                        {submissions.length} copy submissions
                      </span>
                    </div>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <Link href={`/collections/${test.id}`} className="rounded border border-slate-300 bg-white px-2.5 py-1.5 text-xs">
                      Open Test
                    </Link>
                    <Link
                      href={test.test_kind === "mains" ? `/collections/${test.id}/mains-test` : `/collections/${test.id}/test`}
                      className="rounded border border-indigo-300 bg-white px-2.5 py-1.5 text-xs text-indigo-700"
                    >
                      {test.test_kind === "mains" ? "Write / Submit Answers" : "Start"}
                    </Link>
                  </div>
                </div>

                {test.test_kind === "mains" ? (
                  <div className="mt-3 space-y-2 rounded-md border border-slate-200 bg-white p-2">
                    <p className="text-xs text-slate-600">
                      Use the writing desk to read the full mains paper and submit either one PDF or question-wise answer photos. The same desk now shows the linked evaluation and mentorship workflow for each submission.
                    </p>
                    <div className="space-y-1">
                      {submissions.map((submission) => (
                        <div key={submission.id} className="flex flex-wrap items-center justify-between gap-2 rounded border border-slate-200 bg-slate-50 px-2 py-1 text-xs">
                          <div className="flex items-center gap-2">
                            <span className="font-semibold">#{submission.id}</span>
                            <span>{submission.status}</span>
                            {submission.provider_eta_text ? (
                              <span className="inline-flex items-center gap-1 rounded bg-amber-100 px-2 py-0.5 text-amber-800">
                                <CalendarClock className="h-3.5 w-3.5" />
                                {submission.provider_eta_text}
                              </span>
                            ) : null}
                            {submission.total_marks !== null && submission.total_marks !== undefined ? (
                              <span className="inline-flex items-center gap-1 rounded bg-emerald-100 px-2 py-0.5 text-emerald-800">
                                <ShieldCheck className="h-3.5 w-3.5" />
                                Marks: {submission.total_marks}
                              </span>
                            ) : null}
                          </div>
                          <div className="flex flex-wrap gap-2">
                            {submission.answer_pdf_url ? (
                              <a href={submission.answer_pdf_url} target="_blank" rel="noreferrer" className="text-indigo-700 hover:underline">
                                Answer PDF
                              </a>
                            ) : null}
                            {submission.question_responses.length > 0 ? <span className="text-slate-600">{submission.question_responses.length} answer-photo sets</span> : null}
                            {submission.checked_copy_pdf_url ? (
                              <a href={submission.checked_copy_pdf_url} target="_blank" rel="noreferrer" className="text-emerald-700 hover:underline">
                                Checked Copy
                              </a>
                            ) : null}
                          </div>
                        </div>
                      ))}
                      {submissions.length === 0 ? (
                        <p className="text-xs text-slate-500">No copy submissions yet for this test.</p>
                      ) : null}
                    </div>
                  </div>
                ) : null}
              </article>
            );
          })}
          {tests.length === 0 ? <p className="text-sm text-slate-500">No tests published in this series yet.</p> : null}
        </div>
      </section>
    </div>
  );
}
