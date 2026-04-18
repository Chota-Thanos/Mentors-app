"use client";

import axios from "axios";
import Link from "next/link";
import Image from "next/image";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { BookOpenCheck, CalendarDays, ClipboardCheck, Radio, Tv } from "lucide-react";
import { toast } from "sonner";

import { createClient } from "@/lib/supabase/client";

import { useAuth } from "@/context/AuthContext";
import { useProfile } from "@/context/ProfileContext";
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
import type { ProgramUnit, ProgramUnitStep } from "@/types/db";

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
  slate: "border-[#c9d6fb] dark:border-[#2a3c6b] bg-[#eef4ff] dark:bg-[#16213e] text-[#1c263c] dark:text-gray-100",
  amber: "border-amber-300 bg-amber-50 text-amber-900",
  emerald: "border-emerald-300 bg-emerald-50 text-emerald-900",
  indigo: "border-indigo-300 bg-indigo-50 text-indigo-900",
};

export default function TestSeriesDetailView({ seriesId }: TestSeriesDetailViewProps) {
  const { user, isAuthenticated, showLoginModal } = useAuth();
  const { profileId } = useProfile();
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
  const supabase = createClient();
  const [copySubmissionsByTest, setCopySubmissionsByTest] = useState<Record<string, MainsCopySubmission[]>>({});
  const [quizAttemptCountsByTest, setQuizAttemptCountsByTest] = useState<Record<string, number> | null>(null);
  const [mentorshipRequests, setMentorshipRequests] = useState<MentorshipRequest[]>([]);
  const [mentorshipSessions, setMentorshipSessions] = useState<MentorshipSession[]>([]);
  const [expandedDiscussionKey, setExpandedDiscussionKey] = useState<string | null>(null);
  const autoBuyAttemptedRef = useRef(false);

  const isSeriesOwner = series?.creator_id === profileId;
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
      const supabase = createClient();
      
      // 1. Fetch Series Detail
      const { data: seriesData, error: seriesError } = await supabase
        .from("test_series")
        .select("*")
        .eq("id", seriesId)
        .single();
        
      if (seriesError) throw seriesError;
      setSeries({
        ...seriesData,
        title: seriesData.name, // Adapter for 'name' -> 'title'
      });

      // 2. Fetch Units and Steps
      const { data: unitsData, error: unitsError } = await supabase
        .from("program_units")
        .select(`
          *,
          steps:program_unit_steps(
            *,
            collection:premium_collections(*)
          )
        `)
        .eq("series_id", seriesId)
        .order("display_order", { ascending: true });

      if (unitsError) throw unitsError;

      // Flatten units into tests and program items for the existing UI logic
      const flatTests: TestSeriesTest[] = [];
      const flatItems: TestSeriesProgramItem[] = [];

      (unitsData as ProgramUnit[] || []).forEach(unit => {
        unit.steps?.forEach((step: ProgramUnitStep) => {
          if (step.step_type === "test" && step.collection) {
            flatTests.push({
              id: step.collection.id,
              series_id: seriesId,
              title: step.title || step.collection.name,
              description: step.description || step.collection.description,
              test_kind: step.collection.collection_type === "mains" ? "mains" : "prelims",
              test_label: step.collection.collection_type.toUpperCase(),
              series_order: step.display_order,
              question_count: 0, // Would need count query
              is_public: step.collection.is_public,
              is_active: step.collection.is_active,
              is_premium: step.collection.is_paid,
              price: Number(step.collection.price || 0),
              is_finalized: step.collection.is_finalized,
              meta: step.meta || {},
              exam_ids: [],
              created_at: step.created_at,
            });
          } else {
            flatItems.push({
              id: step.id,
              series_id: seriesId,
              item_type: step.step_type === "live_lecture" ? "lecture" : "pdf",
              title: step.title,
              description: step.description,
              resource_url: step.resource_url,
              scheduled_for: step.scheduled_for,
              duration_minutes: step.duration_minutes,
              series_order: step.display_order,
              is_active: step.is_active,
              meta: step.meta as any,
              created_at: step.created_at,
            });
          }
        });
      });

      setTests(flatTests);
      setProgramItems(flatItems);

      if (isAuthenticated && profileId) {
        // 3. Fetch Access / Enrollments
        const { data: accessData } = await supabase
          .from("user_content_access")
          .select("*")
          .eq("user_id", profileId) 
          .eq("test_series_id", seriesId)
          .eq("is_active", true);

        setEnrollments((accessData || []).map(a => ({
          id: a.id,
          series_id: a.test_series_id,
          user_id: a.user_id.toString(),
          status: "active",
          access_source: "direct",
          created_at: a.granted_at,
        })) as any);

        if (seriesData.series_kind === "mains") {
          // Fetch mentorship and submissions for mains
          const testIds = flatTests.map(t => t.id);
          const [requestsRes, sessionsRes, submissionsRes] = await Promise.all([
            supabase.from("mentorship_requests").select("*").eq("series_id", seriesId),
            supabase.from("mentorship_sessions").select("*").eq("mentor_id", seriesData.creator_id), // Approximated
            testIds.length > 0 
              ? supabase.from("mains_test_copy_submissions").select("*").in("series_id", [seriesId])
              : Promise.resolve({ data: [] }),
          ]);

          setMentorshipRequests(requestsRes.data || [] as any);
          setMentorshipSessions(sessionsRes.data || [] as any);
          
          const subMap: Record<string, MainsCopySubmission[]> = {};
          (submissionsRes.data || []).forEach(sub => {
             const tid = sub.collection_id?.toString() || sub.test_collection_id?.toString();
             if (tid) {
               if (!subMap[tid]) subMap[tid] = [];
               subMap[tid].push(sub as any);
             }
          });
          setCopySubmissionsByTest(subMap);
        }
      }
    } catch (error: unknown) {
      toast.error("Failed to load program details", { description: toError(error) });
    } finally {
      setLoading(false);
    }
  }, [isAuthenticated, user, seriesId]);

  useEffect(() => {
    void loadBase();
  }, [loadBase]);

  useEffect(() => {
    if (!seriesId) return;
    const channel = supabase
      .channel(`series-items-${seriesId}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "program_unit_steps",
        },
        () => {
          void loadBase();
        }
      )
      .subscribe();
    return () => {
      void supabase.removeChannel(channel);
    };
  }, [seriesId, supabase, loadBase]);

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
        const orderResponse = await premiumApi.post<any>("/payments/create-order", {
          item_type: "test_series",
          item_id: seriesId,
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
              await premiumApi.post("/payments/verify", {
                razorpay_order_id: response.razorpay_order_id,
                razorpay_payment_id: response.razorpay_payment_id,
                razorpay_signature: response.razorpay_signature,
                payment_record_id: order.payment_record_id,
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

      const supabase = createClient();
      const { error: enrollError } = await supabase
        .from("user_content_access")
        .insert({
          user_id: profileId,
          access_type: "test_series",
          test_series_id: seriesId,
          is_active: true,
          granted_at: new Date().toISOString(),
        });

      if (enrollError) throw enrollError;
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
    if (!isAuthenticated) return;
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
    return <div className="rounded-xl border border-[#dce3fb] dark:border-[#1e2a4a] bg-white dark:bg-[#0b1120] p-6 text-sm text-[#6c7590] dark:text-[#94a3b8]">Loading programs...</div>;
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
            <p className="text-sm font-semibold text-[#141b2d] dark:text-white">{discussion.title || defaultTitle}</p>
            <p className="mt-1 text-xs font-semibold uppercase tracking-wide text-violet-700">
              {isVideo ? "Discussion Video" : "Live Agora Class"}
            </p>
          </div>
          <span className="inline-flex rounded-full bg-white dark:bg-[#0b1120] px-2.5 py-1 text-[11px] font-semibold text-violet-700 ring-1 ring-violet-200">
            {hasSeriesAccess ? "Access Active" : "Locked"}
          </span>
        </div>
        {discussion.description ? (
          <div className="mt-2 text-sm text-[#334155] dark:text-gray-200">
            <RichTextContent value={discussion.description} />
          </div>
        ) : null}
        {isVideo ? (
          <div className="mt-3 space-y-3">
            {hasSeriesAccess ? (
              <button
                type="button"
                onClick={() => setExpandedDiscussionKey((current) => (current === discussionKey ? null : discussionKey))}
                className="rounded-md border border-violet-300 bg-white dark:bg-[#0b1120] px-3 py-2 text-sm font-semibold text-violet-700"
              >
                {isExpanded ? "Hide Video" : "Watch Discussion Video"}
              </button>
            ) : (
              <p className="text-xs text-[#636b86] dark:text-gray-300">Activate series access to watch this discussion.</p>
            )}
            {hasSeriesAccess && isExpanded && presentation ? (
              presentation.kind === "iframe" ? (
                <div className="overflow-hidden rounded-xl border border-[#dce3fb] dark:border-[#1e2a4a] bg-black">
                  <iframe
                    src={presentation.src}
                    title={discussion.title || defaultTitle}
                    allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                    allowFullScreen
                    className="aspect-video w-full"
                  />
                </div>
              ) : presentation.kind === "video" ? (
                <video controls className="aspect-video w-full rounded-xl border border-[#dce3fb] dark:border-[#1e2a4a] bg-black" src={presentation.src} />
              ) : (
                <a href={presentation.src} target="_blank" rel="noreferrer" className="inline-flex text-sm font-semibold text-violet-700 hover:underline">
                  Open discussion video
                </a>
              )
            ) : null}
          </div>
        ) : (
          <div className="mt-3 space-y-2 text-sm text-[#334155] dark:text-gray-200">
            <p>
              Scheduled for <span className="font-semibold">{formatDateTime(discussion.scheduled_for)}</span>
              {discussion.duration_minutes ? ` | ${discussion.duration_minutes} min` : ""}
            </p>
            <p className="text-xs text-[#636b86] dark:text-gray-300">
              This is a creator-led live class. Learners join the in-app Agora room directly from the series and can enter as soon as the host opens the session.
            </p>
            {hasSeriesAccess ? (
              <Link
                href={discussionHref}
                className="inline-flex rounded-md border border-violet-300 bg-white dark:bg-[#0b1120] px-3 py-2 text-sm font-semibold text-violet-700"
              >
                Join Live Class
              </Link>
            ) : (
              <p className="text-xs text-[#636b86] dark:text-gray-300">Activate series access to join this live class.</p>
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
        className="inline-flex items-center gap-1 text-sm text-[#636b86] dark:text-gray-300 hover:text-[#141b2d] dark:text-white"
        iconClassName="h-4 w-4"
      />

      <section className="overflow-hidden rounded-2xl border border-[#dce3fb] dark:border-[#1e2a4a] bg-white dark:bg-[#0b1120]">
        <div className="grid gap-0 md:grid-cols-[280px_1fr]">
          <div className="min-h-[180px] bg-[#eef4ff] dark:bg-[#16213e]">
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
                <h1 className="text-2xl font-bold text-[#141b2d] dark:text-white">{series.title}</h1>
                {series.description ? (
                  <RichTextContent value={series.description} className="mt-2 text-sm text-[#636b86] dark:text-gray-300" />
                ) : (
                  <p className="mt-2 text-sm text-[#636b86] dark:text-gray-300">No description provided.</p>
                )}
                <p className="mt-2 text-xs text-[#6c7590] dark:text-[#94a3b8]">
                  Access: <span className="font-semibold">{series.access_type}</span> | Type: <span className="font-semibold">{series.series_kind}</span> | Curriculum items: <span className="font-semibold">{sortedProgramEntries.length}</span>
                </p>
                <p className="mt-2 text-xs text-[#6c7590] dark:text-[#94a3b8]">{accessSummaryText}</p>
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
                  <span className="inline-flex items-center rounded-md bg-[#eef4ff] dark:bg-[#16213e] px-3 py-2 text-xs font-semibold text-[#334155] dark:text-gray-200">
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
                  <Link href="/mentorship/manage" className="rounded-md border border-[#c9d6fb] dark:border-[#2a3c6b] px-3 py-2 text-sm">
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

      <section className="rounded-xl border border-[#dce3fb] dark:border-[#1e2a4a] bg-white dark:bg-[#0b1120] p-4">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-lg font-semibold text-[#141b2d] dark:text-white">Program Curriculum</h2>
        </div>
        <p className="mb-3 text-xs text-[#636b86] dark:text-gray-300">
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
                <article key={entry.entry_key} className="rounded-lg border border-[#dce3fb] dark:border-[#1e2a4a] bg-[#f8faff] dark:bg-[#0f172a] p-3">
                  <div className="flex flex-col gap-3">
                    <div className="min-w-0">
                      <p className="text-base font-semibold text-[#141b2d] dark:text-white">{test.title}</p>
                      <p className="text-xs text-[#6c7590] dark:text-[#94a3b8] mt-0.5">{richTextToPlainText(test.description || "") || "No description"}</p>
                      <div className="mt-2 flex flex-wrap items-center gap-2 text-[11px] text-[#6c7590] dark:text-[#94a3b8]">
                        <span className="inline-flex items-center gap-1 rounded-full bg-slate-200 px-2 py-0.5">
                          <BookOpenCheck className="h-3.5 w-3.5" />
                          {test.test_label}
                        </span>
                        <span className="inline-flex items-center rounded-full bg-white dark:bg-[#0b1120] px-2 py-0.5 font-semibold text-[#636b86] dark:text-gray-300">
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
                        <Link href={testStartHref} className="w-full rounded border border-indigo-300 bg-white dark:bg-[#0b1120] px-2.5 py-2 text-center text-xs font-semibold text-indigo-700 sm:w-auto">
                          {test.test_kind === "mains" ? "Open Test" : "Start Test"}
                        </Link>
                      ) : (
                        <span className="w-full rounded border border-amber-300 bg-amber-50 px-2.5 py-2 text-center text-xs font-semibold text-amber-800 sm:w-auto">
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
                        <span className="inline-flex rounded-full border border-white/80 bg-white dark:bg-[#0b1120]/80 px-2 py-0.5 font-semibold">
                          {mainsFlow.sections[mainsFlow.activeSection].label}
                        </span>
                        <span className="inline-flex rounded-full border border-white/80 bg-white dark:bg-[#0b1120]/80 px-2 py-0.5 font-semibold">
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
              <article key={entry.entry_key} className="rounded-lg border border-[#dce3fb] dark:border-[#1e2a4a] bg-[#f8faff] dark:bg-[#0f172a] p-3">
                <div className="flex flex-col gap-3">
                  <div className="min-w-0">
                    <p className="text-base font-semibold text-[#141b2d] dark:text-white">{item.title}</p>
                    <p className="text-xs text-[#6c7590] dark:text-[#94a3b8] mt-0.5">{richTextToPlainText(item.description || "") || (isPdf ? "PDF handout" : "Scheduled lecture")}</p>
                    <div className="mt-2 flex flex-wrap items-center gap-2 text-[11px] text-[#6c7590] dark:text-[#94a3b8]">
                      <span className={`inline-flex items-center rounded-full px-2 py-0.5 font-semibold ${isPdf ? "bg-sky-100 text-sky-800" : "bg-violet-100 text-violet-800"}`}>
                        {isPdf ? "PDF Resource" : "Lecture Session"}
                      </span>
                      <span className="inline-flex items-center rounded-full bg-white dark:bg-[#0b1120] px-2 py-0.5 font-semibold text-[#636b86] dark:text-gray-300">
                        Order {Math.max(Number(item.series_order || 0), 0)}
                      </span>
                      {item.scheduled_for ? (
                        <span className="inline-flex items-center rounded-full bg-white dark:bg-[#0b1120] px-2 py-0.5 font-semibold text-[#636b86] dark:text-gray-300">
                          {formatDateTime(item.scheduled_for)}
                        </span>
                      ) : null}
                      {item.duration_minutes ? (
                        <span className="inline-flex items-center rounded-full bg-white dark:bg-[#0b1120] px-2 py-0.5 font-semibold text-[#636b86] dark:text-gray-300">
                          {item.duration_minutes} min
                        </span>
                      ) : null}
                    </div>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {(() => {
                      if (!hasSeriesAccess) {
                        return (
                          <span className="w-full rounded border border-amber-300 bg-amber-50 px-2.5 py-2 text-center text-xs font-semibold text-amber-800 sm:w-auto">
                            Access this program to unlock
                          </span>
                        );
                      }
                      
                      const itemMeta = (item.meta || {}) as Record<string, any>;
                      const isAgoraLecture = !isPdf && itemMeta.delivery_mode === "live_zoom";
                      const isLive = Boolean(itemMeta.is_live);
                      
                      if (isAgoraLecture) {
                        if (isLive || isSeriesOwner) {
                          return (
                             <Link
                               href={`/discussion/lecture/${item.id}?seriesId=${seriesId}&autojoin=1`}
                               className={`w-full flex items-center justify-center gap-2 rounded-md border px-4 py-2 text-center text-xs font-bold sm:w-auto shadow-md ${isLive ? "bg-violet-600 text-white border-violet-400 animate-pulse" : "bg-white text-violet-700 border-violet-200"}`}
                             >
                               {isLive && <span className="flex h-2 w-2 rounded-full bg-red-400 shadow-[0_0_8px_rgba(248,113,113,0.8)]" />}
                               {isLive ? "Join Live Class Now" : "Enter Classroom"}
                             </Link>
                          );
                        }
                        
                        return (
                          <div className="flex flex-col items-center gap-1 sm:items-end">
                            <span className="text-[10px] font-bold uppercase tracking-wider text-slate-500">Scheduled Lecture</span>
                            <span className="w-full text-center rounded border border-slate-200 bg-slate-50 px-2.5 py-2 text-xs font-semibold text-slate-600 sm:w-auto">
                              Starts at {item.scheduled_for ? new Date(item.scheduled_for).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'}) : 'TBD'}
                            </span>
                          </div>
                        );
                      }
                      
                      if (canOpenResource) {
                        return (
                          <a
                            href={item.resource_url || "#"}
                            target="_blank"
                            rel="noreferrer"
                            className={`w-full rounded border bg-white dark:bg-[#0b1120] px-2.5 py-2 text-center text-xs font-semibold sm:w-auto hover:opacity-80 transition-opacity ${isPdf ? "border-sky-300 text-sky-700" : "border-violet-300 text-violet-700"}`}
                          >
                            {isPdf ? "Open PDF" : "Open Lecture Link"}
                          </a>
                        );
                      }
                      
                      return (
                        <span className="w-full rounded border border-[#c9d6fb] dark:border-[#2a3c6b] bg-white dark:bg-[#0b1120] px-2.5 py-2 text-center text-xs font-semibold text-[#636b86] dark:text-gray-300 sm:w-auto">
                          {isPdf ? "PDF link pending" : "Lecture link pending"}
                        </span>
                      );
                    })()}
                  </div>
                </div>
              </article>
            );
          })}
          {sortedProgramEntries.length === 0 ? <p className="text-sm text-[#6c7590] dark:text-[#94a3b8]">No curriculum items published in this program yet.</p> : null}
        </div>
      </section>

      {finalDiscussion ? (
        <section className="rounded-xl border border-[#dce3fb] dark:border-[#1e2a4a] bg-white dark:bg-[#0b1120] p-4">
          <h2 className="text-lg font-semibold text-[#141b2d] dark:text-white">Series Wrap-Up Discussion</h2>
          <p className="mt-1 text-xs text-[#636b86] dark:text-gray-300">
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
