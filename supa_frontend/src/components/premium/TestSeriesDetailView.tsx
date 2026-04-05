"use client";

import axios from "axios";
import Link from "next/link";
import Image from "next/image";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { BookOpenCheck, ClipboardCheck } from "lucide-react";
import { toast } from "sonner";

import { useAuth } from "@/context/AuthContext";
import { resolveMainsTestFlowSummary, type MainsTestSectionTone } from "@/lib/mainsTestFlow";
import { isMentorLike, isModeratorLike, isProviderLike } from "@/lib/accessControl";
import { premiumApi } from "@/lib/premiumApi";
import { loadRazorpayCheckout, type RazorpaySuccessResponse } from "@/lib/razorpayCheckout";
import { richTextToPlainText } from "@/lib/richText";
import { getDiscussionFromMeta, resolveVideoPresentation } from "@/lib/testSeriesDiscussion";
import UserLifecycleBoard from "@/components/premium/UserLifecycleBoard";
import HistoryBackButton from "@/components/ui/HistoryBackButton";
import RichTextContent from "@/components/ui/RichTextContent";
import type {
  MainsCopySubmission,
  MentorshipRequest,
  MentorshipSession,
  TestSeriesProgramItem,
  TestSeries,
  TestSeriesDiscussion,
  TestSeriesEnrollment,
  TestSeriesPaymentOrder,
  TestSeriesTest,
} from "@/types/premium";

interface TestSeriesDetailViewProps {
  seriesId: number;
}

interface UserQuizAttemptCountsPayload {
  counts?: Record<string, number> | null;
}

type ProgramEntry =
  | {
      entry_type: "test";
      entry_key: string;
      series_order: number;
      created_at?: string | null;
      test: TestSeriesTest;
    }
  | {
      entry_type: "pdf" | "lecture";
      entry_key: string;
      series_order: number;
      created_at?: string | null;
      item: TestSeriesProgramItem;
    };

const toError = (error: unknown): string => {
  if (!axios.isAxiosError(error)) return "Unknown error";
  const detail = error.response?.data?.detail;
  return typeof detail === "string" && detail.trim() ? detail : error.message;
};

const normalizeAttemptCounts = (payload?: UserQuizAttemptCountsPayload | null): Record<string, number> => {
  const rawCounts = payload?.counts && typeof payload.counts === "object" ? payload.counts : {};
  const output: Record<string, number> = {};
  for (const [key, value] of Object.entries(rawCounts)) {
    const count = Number(value);
    output[key] = Number.isFinite(count) && count > 0 ? Math.floor(count) : 0;
  }
  return output;
};

const formatDateTime = (value?: string | null): string => {
  if (!value) return "n/a";
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? "n/a" : parsed.toLocaleString();
};

const isSafeMobileReturnUrl = (value: string | null): value is string =>
  Boolean(value && value.trim().startsWith("mentorsappmobile://"));

const mainsStatusToneClasses: Record<MainsTestSectionTone, string> = {
  slate: "border-slate-300 bg-slate-100 text-slate-800",
  amber: "border-amber-300 bg-amber-50 text-amber-900",
  emerald: "border-emerald-300 bg-emerald-50 text-emerald-900",
  indigo: "border-indigo-300 bg-indigo-50 text-indigo-900",
};

export default function TestSeriesDetailView({ seriesId }: TestSeriesDetailViewProps) {
  const { user, isAuthenticated, showLoginModal } = useAuth();
  const searchParams = useSearchParams();
  const providerLike = useMemo(() => isProviderLike(user), [user]);
  const mentorLike = useMemo(() => isMentorLike(user), [user]);
  const moderatorLike = useMemo(() => isModeratorLike(user), [user]);
  const [loading, setLoading] = useState(true);
  const [enrolling, setEnrolling] = useState(false);
  const [series, setSeries] = useState<TestSeries | null>(null);
  const [tests, setTests] = useState<TestSeriesTest[]>([]);
  const [programItems, setProgramItems] = useState<TestSeriesProgramItem[]>([]);
  const [enrollments, setEnrollments] = useState<TestSeriesEnrollment[]>([]);
  const [copySubmissionsByTest, setCopySubmissionsByTest] = useState<Record<string, MainsCopySubmission[]>>({});
  const [quizAttemptCountsByTest, setQuizAttemptCountsByTest] = useState<Record<string, number> | null>(null);
  const [mentorshipRequests, setMentorshipRequests] = useState<MentorshipRequest[]>([]);
  const [mentorshipSessions, setMentorshipSessions] = useState<MentorshipSession[]>([]);
  const [expandedDiscussionKey, setExpandedDiscussionKey] = useState<string | null>(null);
  const autoBuyAttemptedRef = useRef(false);

  const userId = String(user?.id || "").trim();
  const isSeriesOwner = Boolean(providerLike && userId && series?.provider_user_id === userId);
  const canOpenManageView = Boolean(
    isAuthenticated
    && (
      isSeriesOwner
      || moderatorLike
      || (series?.series_kind === "mains" && mentorLike)
    ),
  );

  const loadBase = useCallback(async () => {
    setLoading(true);
    try {
      const [seriesRes, testsRes, itemsRes] = await Promise.all([
        premiumApi.get<TestSeries>(`/programs/${seriesId}`),
        premiumApi.get<TestSeriesTest[]>(`/programs/${seriesId}/tests`),
        premiumApi.get<TestSeriesProgramItem[]>(`/programs/${seriesId}/program-items`),
      ]);
      const nextSeries = seriesRes.data;
      const nextTests = Array.isArray(testsRes.data) ? testsRes.data : [];
      const nextProgramItems = Array.isArray(itemsRes.data) ? itemsRes.data : [];
      setSeries(nextSeries);
      setTests(nextTests);
      setProgramItems(nextProgramItems);

      if (isAuthenticated) {
        const enrollmentsPromise = premiumApi.get<TestSeriesEnrollment[]>("/programs/my/enrollments");
        const nextIsMainsSeries = String(nextSeries?.series_kind || "").trim().toLowerCase() === "mains";

        if (nextIsMainsSeries) {
          const mainsTests = nextTests.filter((test) => test.test_kind === "mains");
          const [enrollRes, requestsRes, sessionsRes, submissionsEntries] = await Promise.all([
            enrollmentsPromise,
            premiumApi.get<MentorshipRequest[]>("/mentorship/requests", { params: { scope: "me" } }),
            premiumApi.get<MentorshipSession[]>("/mentorship/sessions", { params: { scope: "me" } }),
            Promise.all(
              mainsTests.map(async (test) => {
                try {
                  const response = await premiumApi.get<MainsCopySubmission[]>(`/tests/${test.id}/copy-submissions`);
                  return [String(test.id), Array.isArray(response.data) ? response.data : []] as const;
                } catch {
                  return [String(test.id), []] as const;
                }
              }),
            ),
          ]);
          setEnrollments(Array.isArray(enrollRes.data) ? enrollRes.data : []);
          setMentorshipRequests(Array.isArray(requestsRes.data) ? requestsRes.data : []);
          setMentorshipSessions(Array.isArray(sessionsRes.data) ? sessionsRes.data : []);
          setCopySubmissionsByTest(Object.fromEntries(submissionsEntries));
          setQuizAttemptCountsByTest(null);
        } else {
          const prelimsTestIds = nextTests
            .filter((test) => test.test_kind !== "mains" && Number.isFinite(test.id) && test.id > 0)
            .map((test) => test.id);
          const [enrollRes, attemptCountsRes] = await Promise.all([
            enrollmentsPromise,
            prelimsTestIds.length > 0
              ? premiumApi
                  .get<UserQuizAttemptCountsPayload>("/user/quiz-attempt-counts", {
                    params: { collection_ids: prelimsTestIds.join(",") },
                  })
                  .catch(() => null)
              : Promise.resolve({ data: { counts: {} } as UserQuizAttemptCountsPayload }),
          ]);
          setEnrollments(Array.isArray(enrollRes.data) ? enrollRes.data : []);
          setMentorshipRequests([]);
          setMentorshipSessions([]);
          setCopySubmissionsByTest({});
          setQuizAttemptCountsByTest(attemptCountsRes ? normalizeAttemptCounts(attemptCountsRes.data) : null);
        }
      } else {
        setEnrollments([]);
        setMentorshipRequests([]);
        setMentorshipSessions([]);
        setCopySubmissionsByTest({});
        setQuizAttemptCountsByTest(null);
      }
    } catch (error: unknown) {
      toast.error("Failed to load programs details", { description: toError(error) });
      setSeries(null);
      setTests([]);
      setProgramItems([]);
      setEnrollments([]);
      setMentorshipRequests([]);
      setMentorshipSessions([]);
      setCopySubmissionsByTest({});
      setQuizAttemptCountsByTest(null);
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
  const seriesIsFree = Boolean(series && (String(series.access_type || "").toLowerCase() === "free" || Number(series.price || 0) <= 0));
  const hasSeriesAccess = Boolean(isSeriesOwner || isEnrolled);
  const returnToUrl = searchParams.get("return_to");

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

  const enroll = useCallback(async () => {
    if (!series) return;
    setEnrolling(true);
    try {
      const requiresOnlinePayment = !seriesIsFree && Number(series.price || 0) > 0;
      if (requiresOnlinePayment) {
        const orderResponse = await premiumApi.post<TestSeriesPaymentOrder>(`/programs/${seriesId}/payment/order`, {
          access_source: "self_service",
          payment_method: "razorpay",
        });
        const order = orderResponse.data;
        await loadRazorpayCheckout();
        if (!window.Razorpay) {
          throw new Error("Razorpay checkout is unavailable.");
        }
        const checkout = new window.Razorpay({
          key: order.key_id,
          amount: order.amount,
          currency: order.currency,
          name: order.name,
          description: order.description,
          order_id: order.order_id,
          prefill: order.prefill,
          notes: order.notes,
          theme: { color: "#0f172a" },
          modal: {
            ondismiss: () => {
              setEnrolling(false);
            },
          },
          handler: async (response: RazorpaySuccessResponse) => {
            try {
              await premiumApi.post(`/programs/${seriesId}/payment/verify`, {
                ...response,
                access_source: "self_service",
                payment_method: "razorpay",
              });
              toast.success("Series unlocked successfully");
              await loadBase();
              if (typeof window !== "undefined" && isSafeMobileReturnUrl(returnToUrl)) {
                window.setTimeout(() => {
                  window.location.assign(returnToUrl);
                }, 900);
              }
            } catch (error: unknown) {
              toast.error("Payment verification failed", { description: toError(error) });
            } finally {
              setEnrolling(false);
            }
          },
        });
        checkout.on("payment.failed", (response) => {
          const description = response.error?.description || response.error?.reason || "Payment was not completed.";
          toast.error("Payment failed", { description });
          setEnrolling(false);
        });
        checkout.open();
        return;
      }

      await premiumApi.post(`/programs/${seriesId}/enroll`, { access_source: "self_service" });
      toast.success("Enrollment completed");
      await loadBase();
      if (typeof window !== "undefined" && isSafeMobileReturnUrl(returnToUrl)) {
        window.setTimeout(() => {
          window.location.assign(returnToUrl);
        }, 900);
      }
      setEnrolling(false);
    } catch (error: unknown) {
      toast.error("Enrollment failed", { description: toError(error) });
      setEnrolling(false);
    }
  }, [loadBase, returnToUrl, series, seriesId, seriesIsFree]);

  useEffect(() => {
    if (!series || !isAuthenticated) return;
    if (searchParams.get("autobuy") !== "1" || autoBuyAttemptedRef.current || enrolling || hasSeriesAccess) return;
    autoBuyAttemptedRef.current = true;
    void enroll();
  }, [enroll, enrolling, hasSeriesAccess, isAuthenticated, searchParams, series]);

  // Must be declared before early returns to satisfy Rules of Hooks
  const sortedProgramEntries = useMemo<ProgramEntry[]>(() => {
    const testEntries: ProgramEntry[] = tests.map((test) => ({
      entry_type: "test",
      entry_key: `test-${test.id}`,
      series_order: Number.isFinite(test.series_order) ? Number(test.series_order) : Number.MAX_SAFE_INTEGER,
      created_at: test.created_at || null,
      test,
    }));
    const customEntries: ProgramEntry[] = programItems.map((item) => ({
      entry_type: item.item_type,
      entry_key: `${item.item_type}-${item.id}`,
      series_order: Number.isFinite(item.series_order) ? Number(item.series_order) : Number.MAX_SAFE_INTEGER,
      created_at: item.created_at || null,
      item,
    }));
    return [...testEntries, ...customEntries].sort((left, right) => {
      if (left.series_order !== right.series_order) return left.series_order - right.series_order;
      const leftCreatedAt = left.created_at ? new Date(left.created_at).getTime() : 0;
      const rightCreatedAt = right.created_at ? new Date(right.created_at).getTime() : 0;
      if (leftCreatedAt !== rightCreatedAt) return leftCreatedAt - rightCreatedAt;
      return left.entry_key.localeCompare(right.entry_key);
    });
  }, [programItems, tests]);

  if (loading) {
    return <div className="rounded-xl border border-slate-200 bg-white p-6 text-sm text-slate-500">Loading programs...</div>;
  }

  if (!series) {
    return <div className="rounded-xl border border-rose-200 bg-rose-50 p-6 text-sm text-rose-700">Programs not found or inaccessible.</div>;
  }

  const fallbackHref =
    series.series_kind === "mains"
      ? "/programs/mains"
      : series.series_kind === "quiz"
        ? "/programs/prelims"
        : "/programs";
  const sortedTests = [...tests].sort((left, right) => {
    const leftOrder = Number.isFinite(left.series_order) ? Number(left.series_order) : Number.MAX_SAFE_INTEGER;
    const rightOrder = Number.isFinite(right.series_order) ? Number(right.series_order) : Number.MAX_SAFE_INTEGER;
    if (leftOrder !== rightOrder) return leftOrder - rightOrder;
    return left.id - right.id;
  });
  // sortedProgramEntries is now declared above the early returns (Rules of Hooks)
  const firstTest = sortedTests[0] || null;
  const firstTestHref = firstTest
    ? firstTest.test_kind === "mains"
      ? `/collections/${firstTest.id}`
      : `/collections/${firstTest.id}/test`
    : null;
  const isMainsSeries = String(series.series_kind || "").trim().toLowerCase() === "mains";
  const canStartFromHeader = Boolean(firstTestHref && hasSeriesAccess);
  const headerStartLabel = firstTest?.test_kind === "mains" ? "Open First Paper" : "Start First Test";
  const requiresSeriesPayment = !seriesIsFree && Number(series.price || 0) > 0;
  const accessActionLabel = !isAuthenticated
    ? "Sign In to Access Series"
    : seriesIsFree
      ? "Get Free Access"
      : requiresSeriesPayment
        ? "Pay to Unlock"
        : String(series.access_type || "").trim().toLowerCase() === "subscription"
        ? "Subscribe to Access"
        : "Unlock Series";
  const accessSummaryText = hasSeriesAccess
    ? "Series access is active. You can open the tests below."
    : requiresSeriesPayment
      ? "Complete the Razorpay checkout to unlock this series and its discussion sessions."
    : "Activate this series first. Tests stay locked until the series is added to your account.";
  const manageViewLabel = isMainsSeries ? "Series Manage View" : "Manage Series";
  const finalDiscussion = getDiscussionFromMeta(series.meta, "final_discussion");

  const renderDiscussionCard = (
    discussion: TestSeriesDiscussion,
    discussionKey: string,
    defaultTitle: string,
    discussionHref: string,
  ) => {
    const isVideo = discussion.delivery_mode === "video";
    const isExpanded = expandedDiscussionKey === discussionKey;
    const presentation = isVideo ? resolveVideoPresentation(discussion.video_url) : null;

    return (
      <div className="mt-3 rounded-xl border border-violet-200 bg-violet-50 p-4">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div>
            <p className="text-sm font-semibold text-slate-900">{discussion.title || defaultTitle}</p>
            <p className="mt-1 text-xs font-semibold uppercase tracking-wide text-violet-700">
              {isVideo ? "Discussion Video" : "Live Agora Class"}
            </p>
          </div>
          <span className="inline-flex rounded-full bg-white px-2.5 py-1 text-[11px] font-semibold text-violet-700 ring-1 ring-violet-200">
            {hasSeriesAccess ? "Access Active" : "Locked"}
          </span>
        </div>
        {discussion.description ? (
          <div className="mt-2 text-sm text-slate-700">
            <RichTextContent value={discussion.description} />
          </div>
        ) : null}
        {isVideo ? (
          <div className="mt-3 space-y-3">
            {hasSeriesAccess ? (
              <button
                type="button"
                onClick={() => setExpandedDiscussionKey((current) => (current === discussionKey ? null : discussionKey))}
                className="rounded-md border border-violet-300 bg-white px-3 py-2 text-sm font-semibold text-violet-700"
              >
                {isExpanded ? "Hide Video" : "Watch Discussion Video"}
              </button>
            ) : (
              <p className="text-xs text-slate-600">Activate series access to watch this discussion.</p>
            )}
            {hasSeriesAccess && isExpanded && presentation ? (
              presentation.kind === "iframe" ? (
                <div className="overflow-hidden rounded-xl border border-slate-200 bg-black">
                  <iframe
                    src={presentation.src}
                    title={discussion.title || defaultTitle}
                    allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                    allowFullScreen
                    className="aspect-video w-full"
                  />
                </div>
              ) : presentation.kind === "video" ? (
                <video controls className="aspect-video w-full rounded-xl border border-slate-200 bg-black" src={presentation.src} />
              ) : (
                <a href={presentation.src} target="_blank" rel="noreferrer" className="inline-flex text-sm font-semibold text-violet-700 hover:underline">
                  Open discussion video
                </a>
              )
            ) : null}
          </div>
        ) : (
          <div className="mt-3 space-y-2 text-sm text-slate-700">
            <p>
              Scheduled for <span className="font-semibold">{formatDateTime(discussion.scheduled_for)}</span>
              {discussion.duration_minutes ? ` | ${discussion.duration_minutes} min` : ""}
            </p>
            <p className="text-xs text-slate-600">
              This is a creator-led live class. Learners join the in-app Agora room directly from the series and can enter as soon as the host opens the session.
            </p>
            {hasSeriesAccess ? (
              <Link
                href={discussionHref}
                className="inline-flex rounded-md border border-violet-300 bg-white px-3 py-2 text-sm font-semibold text-violet-700"
              >
                Join Live Class
              </Link>
            ) : (
              <p className="text-xs text-slate-600">Activate series access to join this live class.</p>
            )}
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="space-y-6">
      <HistoryBackButton
        fallbackHref={fallbackHref}
        label="Back to Programs"
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
                <p className="mt-2 text-xs text-slate-500">
                  Access: <span className="font-semibold">{series.access_type}</span> | Type: <span className="font-semibold">{series.series_kind}</span> | Curriculum items: <span className="font-semibold">{sortedProgramEntries.length}</span>
                </p>
                <p className="mt-2 text-xs text-slate-500">{accessSummaryText}</p>
                {finalDiscussion ? (
                  <div className="mt-3 flex flex-wrap gap-2">
                    <span className="inline-flex rounded-full border border-violet-200 bg-violet-50 px-3 py-1 text-[11px] font-semibold text-violet-800">
                      {finalDiscussion.delivery_mode === "video" ? "Series wrap-up discussion video" : "Series wrap-up live class"}
                    </span>
                  </div>
                ) : null}
              </div>
              <div className="flex flex-wrap gap-2">
                {canStartFromHeader && firstTestHref ? (
                  <Link href={firstTestHref} className="rounded-md border border-emerald-300 bg-emerald-50 px-3 py-2 text-sm font-semibold text-emerald-800">
                    {headerStartLabel}
                  </Link>
                ) : hasSeriesAccess ? (
                  <span className="inline-flex items-center rounded-md bg-slate-100 px-3 py-2 text-xs font-semibold text-slate-700">
                    No Published Tests Yet
                  </span>
                ) : (
                  <button
                    type="button"
                    onClick={() => {
                      if (!isAuthenticated) {
                        showLoginModal();
                        return;
                      }
                      void enroll();
                    }}
                    disabled={enrolling}
                    className="rounded-md bg-slate-900 px-3 py-2 text-sm font-semibold text-white disabled:opacity-60"
                  >
                    {enrolling ? "Processing..." : accessActionLabel}
                  </button>
                )}
                {hasSeriesAccess ? (
                  <span className="inline-flex items-center rounded-md bg-emerald-100 px-3 py-2 text-xs font-semibold text-emerald-800">
                    Access Active
                  </span>
                ) : (
                  <span className="inline-flex items-center rounded-md bg-amber-100 px-3 py-2 text-xs font-semibold text-amber-800">
                    Locked Until Access
                  </span>
                )}
                {isMainsSeries ? (
                  <Link href="/mentorship/manage" className="rounded-md border border-slate-300 px-3 py-2 text-sm">
                    Mentorship Management
                  </Link>
                ) : null}
                {canOpenManageView ? (
                  <Link href={`/programs/${seriesId}/manage`} className="rounded-md border border-indigo-300 bg-indigo-50 px-3 py-2 text-sm font-semibold text-indigo-700">
                    {manageViewLabel}
                  </Link>
                ) : null}
              </div>
            </div>
          </div>
        </div>
      </section>

      {isMainsSeries ? <UserLifecycleBoard metrics={lifecycleMetrics} /> : null}

      <section className="rounded-xl border border-slate-200 bg-white p-4">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-lg font-semibold text-slate-900">Program Curriculum</h2>
        </div>
        <p className="mb-3 text-xs text-slate-600">
          {isMainsSeries
            ? "This program can now mix mains papers, PDF handouts, and scheduled lecture blocks in one ordered preparation flow."
            : hasSeriesAccess
              ? "Your prelims program is unlocked. Open any test, PDF handout, or lecture block from this ordered curriculum."
              : "The curriculum is visible for planning, but every locked test, PDF, and lecture stays restricted until you activate access first."}
        </p>

        <div className="space-y-3">
          {sortedProgramEntries.map((entry) => {
            if (entry.entry_type === "test") {
              const { test } = entry;
              const submissions = copySubmissionsByTest[String(test.id)] || [];
              const attemptCount = quizAttemptCountsByTest?.[String(test.id)] || 0;
              const showAttemptCount = isAuthenticated && quizAttemptCountsByTest !== null && test.test_kind !== "mains";
              const testStartHref = test.test_kind === "mains" ? `/collections/${test.id}` : `/collections/${test.id}/test`;
              const canOpenTest = Boolean(hasSeriesAccess || test.test_kind === "mains" && isSeriesOwner);
              const testDiscussion = getDiscussionFromMeta(test.meta, "test_discussion");
              const mainsFlow = test.test_kind === "mains"
                ? resolveMainsTestFlowSummary({
                    submissions,
                    requests: mentorshipRequests,
                    sessions: mentorshipSessions,
                  })
                : null;
              return (
                <article key={entry.entry_key} className="rounded-lg border border-slate-200 bg-slate-50 p-3">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div>
                      <p className="text-base font-semibold text-slate-900">{test.title}</p>
                      <p className="text-xs text-slate-500">{richTextToPlainText(test.description || "") || "No description"}</p>
                      <div className="mt-1 flex flex-wrap items-center gap-2 text-[11px] text-slate-500">
                        <span className="inline-flex items-center gap-1 rounded-full bg-slate-200 px-2 py-0.5">
                          <BookOpenCheck className="h-3.5 w-3.5" />
                          {test.test_label}
                        </span>
                        <span className="inline-flex items-center rounded-full bg-white px-2 py-0.5 font-semibold text-slate-600">
                          Order {Math.max(Number(test.series_order || 0), 0)}
                        </span>
                        {showAttemptCount ? (
                          <span className="inline-flex items-center rounded-full bg-emerald-100 px-2 py-0.5 font-semibold text-emerald-800">
                            Attempts: {attemptCount}
                          </span>
                        ) : null}
                        {testDiscussion ? (
                          <span className="inline-flex items-center rounded-full bg-violet-100 px-2 py-0.5 font-semibold text-violet-800">
                            {testDiscussion.delivery_mode === "video" ? "Post-test video discussion" : "Post-test live class"}
                          </span>
                        ) : null}
                        {test.test_kind === "mains" ? (
                          <span className="inline-flex items-center gap-1 rounded-full bg-slate-200 px-2 py-0.5">
                            <ClipboardCheck className="h-3.5 w-3.5" />
                            {submissions.length} copy submissions
                          </span>
                        ) : null}
                        {mainsFlow ? (
                          <span className="inline-flex items-center rounded-full bg-indigo-100 px-2 py-0.5 font-semibold text-indigo-800">
                            Status: {mainsFlow.overallStatus}
                          </span>
                        ) : null}
                      </div>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      {canOpenTest ? (
                        <Link href={testStartHref} className="rounded border border-indigo-300 bg-white px-2.5 py-1.5 text-xs font-semibold text-indigo-700">
                          {test.test_kind === "mains" ? "Open Test" : "Start Test"}
                        </Link>
                      ) : (
                        <span className="rounded border border-amber-300 bg-amber-50 px-2.5 py-1.5 text-xs font-semibold text-amber-800">
                          Access this program to unlock
                        </span>
                      )}
                    </div>
                  </div>
                  {testDiscussion
                    ? renderDiscussionCard(
                        testDiscussion,
                        `test-${test.id}`,
                        "Post-Test Discussion",
                        `/discussion/test/${test.id}?autojoin=1`,
                      )
                    : null}

                  {test.test_kind === "mains" && mainsFlow ? (
                    <div className={`mt-3 rounded-xl border px-3 py-3 text-xs ${mainsStatusToneClasses[mainsFlow.sections[mainsFlow.activeSection].tone]}`}>
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-[11px] font-bold uppercase tracking-[0.22em]">Active Status</span>
                        <span className="inline-flex rounded-full border border-white/80 bg-white/80 px-2 py-0.5 font-semibold">
                          {mainsFlow.sections[mainsFlow.activeSection].label}
                        </span>
                        <span className="inline-flex rounded-full border border-white/80 bg-white/80 px-2 py-0.5 font-semibold">
                          {mainsFlow.overallStatus}
                        </span>
                      </div>
                      <p className="mt-2 leading-5">{mainsFlow.sections[mainsFlow.activeSection].detail}</p>
                    </div>
                  ) : null}
                </article>
              );
            }

            const item = entry.item;
            const isPdf = item.item_type === "pdf";
            const canOpenResource = Boolean(hasSeriesAccess && item.resource_url);
            return (
              <article key={entry.entry_key} className="rounded-lg border border-slate-200 bg-slate-50 p-3">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div>
                    <p className="text-base font-semibold text-slate-900">{item.title}</p>
                    <p className="text-xs text-slate-500">{richTextToPlainText(item.description || "") || (isPdf ? "PDF handout" : "Scheduled lecture")}</p>
                    <div className="mt-1 flex flex-wrap items-center gap-2 text-[11px] text-slate-500">
                      <span className={`inline-flex items-center rounded-full px-2 py-0.5 font-semibold ${isPdf ? "bg-sky-100 text-sky-800" : "bg-violet-100 text-violet-800"}`}>
                        {isPdf ? "PDF Resource" : "Lecture Session"}
                      </span>
                      <span className="inline-flex items-center rounded-full bg-white px-2 py-0.5 font-semibold text-slate-600">
                        Order {Math.max(Number(item.series_order || 0), 0)}
                      </span>
                      {item.scheduled_for ? (
                        <span className="inline-flex items-center rounded-full bg-white px-2 py-0.5 font-semibold text-slate-600">
                          {formatDateTime(item.scheduled_for)}
                        </span>
                      ) : null}
                      {item.duration_minutes ? (
                        <span className="inline-flex items-center rounded-full bg-white px-2 py-0.5 font-semibold text-slate-600">
                          {item.duration_minutes} min
                        </span>
                      ) : null}
                    </div>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {canOpenResource ? (
                      <a
                        href={item.resource_url || "#"}
                        target="_blank"
                        rel="noreferrer"
                        className={`rounded border bg-white px-2.5 py-1.5 text-xs font-semibold ${isPdf ? "border-sky-300 text-sky-700" : "border-violet-300 text-violet-700"}`}
                      >
                        {isPdf ? "Open PDF" : "Open Lecture Link"}
                      </a>
                    ) : hasSeriesAccess ? (
                      <span className="rounded border border-slate-300 bg-white px-2.5 py-1.5 text-xs font-semibold text-slate-600">
                        {isPdf ? "PDF link pending" : "Lecture link pending"}
                      </span>
                    ) : (
                      <span className="rounded border border-amber-300 bg-amber-50 px-2.5 py-1.5 text-xs font-semibold text-amber-800">
                        Access this program to unlock
                      </span>
                    )}
                  </div>
                </div>
              </article>
            );
          })}
          {sortedProgramEntries.length === 0 ? <p className="text-sm text-slate-500">No curriculum items published in this program yet.</p> : null}
        </div>
      </section>

      {finalDiscussion ? (
        <section className="rounded-xl border border-slate-200 bg-white p-4">
          <h2 className="text-lg font-semibold text-slate-900">Series Wrap-Up Discussion</h2>
          <p className="mt-1 text-xs text-slate-600">
            Use this after learners finish the series or when you want a guided final debrief.
          </p>
          {renderDiscussionCard(
            finalDiscussion,
            `series-${seriesId}`,
            "Series Wrap-Up Discussion",
            `/discussion/series/${seriesId}?autojoin=1`,
          )}
        </section>
      ) : null}
    </div>
  );
}
