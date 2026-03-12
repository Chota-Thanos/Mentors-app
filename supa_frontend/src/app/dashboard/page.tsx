"use client";

import axios from "axios";
import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { AlertCircle, ArrowRight, Loader2, ShieldCheck } from "lucide-react";
import { toast } from "sonner";

import AppLayout from "@/components/layouts/AppLayout";
import { useAuth } from "@/context/AuthContext";
import { getUserRole, isMentorLike, isModeratorLike, isProviderLike } from "@/lib/accessControl";
import { premiumApi } from "@/lib/premiumApi";
import type {
  DashboardAnalyticsPayload,
  LifecycleTrackingIssue,
  LifecycleTrackingPayload,
  MentorshipRequest,
  MentorshipSession,
  MentorshipSlot,
  ModerationActivitySummary,
  ProfessionalOnboardingApplication,
  ProfessionalPublicProfileDetail,
  ProviderDashboardSummary,
  TestSeries,
  TestSeriesEnrollment,
} from "@/types/premium";

type DashboardKind = "learner" | "mains_mentor" | "quiz_master" | "moderator";

interface MentorDashboardData {
  tracking: LifecycleTrackingPayload;
  requests: MentorshipRequest[];
  slots: MentorshipSlot[];
  sessions: MentorshipSession[];
  mainsSeries: TestSeries[];
}

interface QuizMasterSeriesInsight {
  series: TestSeries;
  totalEnrollments: number;
  activeEnrollments: number;
}

interface QuizMasterDashboardData {
  summary: ProviderDashboardSummary;
  series: TestSeries[];
  seriesInsights: QuizMasterSeriesInsight[];
  tracking: LifecycleTrackingPayload;
  profileDetail: ProfessionalPublicProfileDetail | null;
}

interface ModeratorDashboardData {
  summary: ModerationActivitySummary;
  pendingOnboarding: ProfessionalOnboardingApplication[];
  tracking: LifecycleTrackingPayload;
}

interface LearnerHighlightCard {
  key: string;
  title: string;
  metric: string;
  detail: string;
  href: string;
  actionLabel: string;
}

const QUIZ_MASTER_ROLES = new Set(["provider", "institute", "creator", "quiz_master", "quizmaster"]);

const dashboardCopy: Record<DashboardKind, { title: string; subtitle: string }> = {
  learner: {
    title: "Performance Dashboard",
    subtitle: "Your learning analytics and improvement focus areas.",
  },
  mains_mentor: {
    title: "Mains Mentor Dashboard",
    subtitle: "Mains mentorship queue, live slots, and session progress.",
  },
  quiz_master: {
    title: "Quiz Master Dashboard",
    subtitle: "Prelims-focused test series operations and learner activity.",
  },
  moderator: {
    title: "Moderation Dashboard",
    subtitle: "Platform moderation activity and onboarding approvals.",
  },
};

const emptyProviderSummary: ProviderDashboardSummary = {
  series_count: 0,
  test_count: 0,
  active_enrollments: 0,
  pending_copy_checks: 0,
  mentorship_pending_requests: 0,
  upcoming_slots: 0,
};

const emptyModerationSummary: ModerationActivitySummary = {
  series_count: 0,
  active_series_count: 0,
  test_count: 0,
  active_test_count: 0,
  active_enrollments: 0,
  copy_submissions_total: 0,
  pending_copy_checks: 0,
  mentorship_requests_total: 0,
  mentorship_pending_requests: 0,
};

const emptyLifecycleTracking: LifecycleTrackingPayload = {
  generated_at: "",
  summary: {
    users: 0,
    mentorship_cycles: 0,
    pending_mentorship: 0,
    scheduled_mentorship: 0,
    completed_mentorship: 0,
    pending_copy_checks: 0,
    delayed_items: 0,
    technical_issues: 0,
  },
  mentorship_cycles: [],
  user_rows: [],
};

function toError(error: unknown, fallback: string): string {
  if (!axios.isAxiosError(error)) return fallback;
  const detail = error.response?.data?.detail;
  if (typeof detail === "string" && detail.trim()) return detail;
  return error.message || fallback;
}

function resolveDashboardKind(user: unknown): DashboardKind {
  const role = getUserRole(user);
  if (isModeratorLike(user)) return "moderator";
  if (role === "mentor" || role === "mains_mentor" || role === "mainsmentor") return "mains_mentor";
  if (QUIZ_MASTER_ROLES.has(role)) return "quiz_master";
  if (isProviderLike(user)) return "quiz_master";
  if (isMentorLike(user)) return "mains_mentor";
  return "learner";
}

function StatCard({ label, value, hint }: { label: string; value: number | string; hint?: string }) {
  return (
    <article className="rounded-2xl border border-slate-200 bg-white p-5">
      <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">{label}</p>
      <p className="mt-2 text-3xl font-black text-slate-900">{value}</p>
      {hint ? <p className="mt-1 text-xs text-slate-500">{hint}</p> : null}
    </article>
  );
}

function formatDateTime(value?: string | null): string {
  if (!value) return "n/a";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "n/a";
  return date.toLocaleString();
}

function requestMetaDate(request: MentorshipRequest, key: string): string | null {
  const value = request.meta?.[key];
  return typeof value === "string" && value.trim() ? value : null;
}

function issueBadgeClass(issue: LifecycleTrackingIssue): string {
  if (issue.severity === "critical") return "border-rose-300 bg-rose-50 text-rose-800";
  if (issue.severity === "warning") return "border-amber-300 bg-amber-50 text-amber-800";
  return "border-slate-300 bg-slate-50 text-slate-700";
}

function formatSeriesKindLabel(value?: string | null): string {
  const normalized = String(value || "").trim().toLowerCase();
  if (normalized === "mains") return "Mains";
  if (normalized === "hybrid") return "Hybrid";
  return "Prelims";
}

export default function DashboardPage() {
  const { loading: authLoading, isAuthenticated, showLoginModal, user } = useAuth();
  const kind = useMemo(() => resolveDashboardKind(user), [user]);
  const currentUserId = String(user?.id || "").trim();

  const [loadingData, setLoadingData] = useState(false);
  const [error, setError] = useState("");

  const [analytics, setAnalytics] = useState<DashboardAnalyticsPayload | null>(null);
  const [mentorData, setMentorData] = useState<MentorDashboardData | null>(null);
  const [quizMasterData, setQuizMasterData] = useState<QuizMasterDashboardData | null>(null);
  const [moderatorData, setModeratorData] = useState<ModeratorDashboardData | null>(null);
  const latestMentorBookingSignatureRef = useRef<string | null>(null);

  useEffect(() => {
    if (authLoading) return;
    if (!isAuthenticated) {
      setLoadingData(false);
      setError("");
      return;
    }

    let active = true;
    setLoadingData(true);
    setError("");

    const run = async () => {
      try {
        if (kind === "learner") {
          const response = await premiumApi.get<DashboardAnalyticsPayload>("/user/dashboard-analytics");
          if (!active) return;
          setAnalytics(response.data);
          setMentorData(null);
          setQuizMasterData(null);
          setModeratorData(null);
          return;
        }

        if (kind === "mains_mentor") {
          const [tracking, requests, slots, sessions, series] = await Promise.all([
            premiumApi.get<LifecycleTrackingPayload>("/lifecycle/tracking", {
              params: { scope: "provider", limit_cycles: 300, limit_users: 250 },
            }),
            premiumApi.get<MentorshipRequest[]>("/mentorship/requests", { params: { scope: "provider" } }),
            premiumApi.get<MentorshipSlot[]>("/mentorship/slots", { params: { include_past: true } }),
            premiumApi.get<MentorshipSession[]>("/mentorship/sessions", { params: { scope: "provider" } }),
            premiumApi.get<TestSeries[]>("/test-series", {
              params: { mine_only: true, include_tests: true, include_inactive: true },
            }),
          ]);
          if (!active) return;
          const allSeries = Array.isArray(series.data) ? series.data : [];
          setMentorData({
            tracking: tracking.data || emptyLifecycleTracking,
            requests: Array.isArray(requests.data) ? requests.data : [],
            slots: Array.isArray(slots.data) ? slots.data : [],
            sessions: Array.isArray(sessions.data) ? sessions.data : [],
            mainsSeries: allSeries.filter((row) => String(row.series_kind || "").toLowerCase() !== "quiz"),
          });
          setAnalytics(null);
          setQuizMasterData(null);
          setModeratorData(null);
          return;
        }

        if (kind === "quiz_master") {
          const [summary, series, trackingPayload, profileDetail] = await Promise.all([
            premiumApi.get<ProviderDashboardSummary>("/provider/dashboard-summary"),
            premiumApi.get<TestSeries[]>("/test-series", { params: { mine_only: true, include_tests: true, include_inactive: true } }),
            premiumApi
              .get<LifecycleTrackingPayload>("/lifecycle/tracking", {
                params: { scope: "provider", limit_cycles: 220, limit_users: 220 },
              })
              .then((response) => response.data || emptyLifecycleTracking)
              .catch(() => emptyLifecycleTracking),
            currentUserId
              ? premiumApi
                .get<ProfessionalPublicProfileDetail>(`/profiles/${currentUserId}/detail`, {
                  params: { reviews_limit: 10 },
                })
                .then((response) => response.data || null)
                .catch(() => null)
              : Promise.resolve(null),
          ]);
          if (!active) return;
          const allSeries = Array.isArray(series.data) ? series.data : [];
          const prelimsSeries = allSeries.filter((row) => String(row.series_kind || "").toLowerCase() !== "mains");
          const enrollmentInsights = await Promise.all(
            prelimsSeries.slice(0, 24).map(async (seriesRow): Promise<QuizMasterSeriesInsight> => {
              try {
                const enrollmentResponse = await premiumApi.get<TestSeriesEnrollment[]>(
                  `/test-series/${seriesRow.id}/enrollments`,
                );
                const enrollmentRows = Array.isArray(enrollmentResponse.data) ? enrollmentResponse.data : [];
                return {
                  series: seriesRow,
                  totalEnrollments: enrollmentRows.length,
                  activeEnrollments: enrollmentRows.filter((row) => row.status === "active").length,
                };
              } catch {
                return {
                  series: seriesRow,
                  totalEnrollments: 0,
                  activeEnrollments: 0,
                };
              }
            }),
          );
          if (!active) return;
          setQuizMasterData({
            summary: summary.data || emptyProviderSummary,
            series: allSeries,
            seriesInsights: enrollmentInsights,
            tracking: trackingPayload,
            profileDetail,
          });
          setAnalytics(null);
          setMentorData(null);
          setModeratorData(null);
          return;
        }

        const [summary, onboarding, tracking] = await Promise.all([
          premiumApi.get<ModerationActivitySummary>("/moderation/activity-summary"),
          premiumApi.get<ProfessionalOnboardingApplication[]>("/admin/onboarding/applications", { params: { status: "pending", limit: 100 } }),
          premiumApi.get<LifecycleTrackingPayload>("/lifecycle/tracking", {
            params: { scope: "all", limit_cycles: 400, limit_users: 300 },
          }),
        ]);
        if (!active) return;
        setModeratorData({
          summary: summary.data || emptyModerationSummary,
          pendingOnboarding: Array.isArray(onboarding.data) ? onboarding.data : [],
          tracking: tracking.data || emptyLifecycleTracking,
        });
        setAnalytics(null);
        setMentorData(null);
        setQuizMasterData(null);
      } catch (err: unknown) {
        if (!active) return;
        const fallback: Record<DashboardKind, string> = {
          learner: "Failed to load learner dashboard.",
          mains_mentor: "Failed to load mains mentor dashboard.",
          quiz_master: "Failed to load quiz master dashboard.",
          moderator: "Failed to load moderator dashboard.",
        };
        setError(toError(err, fallback[kind]));
        setAnalytics(null);
        setMentorData(null);
        setQuizMasterData(null);
        setModeratorData(null);
      } finally {
        if (active) setLoadingData(false);
      }
    };

    void run();
    return () => {
      active = false;
    };
  }, [authLoading, isAuthenticated, kind, currentUserId]);

  const loading = authLoading || (isAuthenticated && loadingData);
  const copy = dashboardCopy[kind];

  const mentorScheduled =
    mentorData?.tracking.mentorship_cycles.filter((row) => row.request_status === "scheduled").length ?? 0;
  const mentorCompleted =
    mentorData?.tracking.mentorship_cycles.filter((row) => row.request_status === "completed").length ?? 0;
  const mentorDelayed = mentorData?.tracking.summary.delayed_items ?? 0;
  const mentorCreatedSlots = mentorData?.slots.length ?? 0;
  const mentorCreatedSessions = mentorData?.sessions.length ?? 0;
  const mentorCompletedSessions =
    mentorData?.sessions.filter((session) => session.status === "completed").length ?? 0;
  const mentorRecentBookings = useMemo(
    () =>
      (mentorData?.requests ?? [])
        .filter((request) => request.status === "scheduled" && Boolean(requestMetaDate(request, "booked_by_user_at")))
        .sort((left, right) => {
          const leftTime = new Date(requestMetaDate(left, "booked_by_user_at") || left.requested_at).getTime();
          const rightTime = new Date(requestMetaDate(right, "booked_by_user_at") || right.requested_at).getTime();
          return rightTime - leftTime;
        }),
    [mentorData?.requests],
  );
  const mentorNewBookings = mentorRecentBookings.length;
  const mentorLatestBookingSignature = useMemo(() => {
    const latestBooking = mentorRecentBookings[0];
    if (!latestBooking) return null;
    return `${latestBooking.id}:${requestMetaDate(latestBooking, "booked_by_user_at") || latestBooking.updated_at || latestBooking.requested_at}`;
  }, [mentorRecentBookings]);

  useEffect(() => {
    if (kind !== "mains_mentor") {
      latestMentorBookingSignatureRef.current = mentorLatestBookingSignature;
      return;
    }
    if (!mentorLatestBookingSignature) {
      latestMentorBookingSignatureRef.current = null;
      return;
    }

    if (
      latestMentorBookingSignatureRef.current &&
      latestMentorBookingSignatureRef.current !== mentorLatestBookingSignature
    ) {
      const latestBooking = mentorRecentBookings[0];
      const scheduledFor = latestBooking ? requestMetaDate(latestBooking, "scheduled_slot_starts_at") : null;
      toast.success("New learner booking received", {
        description: scheduledFor
          ? `Scheduled for ${formatDateTime(scheduledFor)}.`
          : "A learner booked one of your 20-minute mentorship slots.",
      });
    }

    latestMentorBookingSignatureRef.current = mentorLatestBookingSignature;
  }, [kind, mentorLatestBookingSignature, mentorRecentBookings]);

  const quizMasterSeries =
    quizMasterData?.series.filter((series) => String(series.series_kind || "").toLowerCase() !== "mains") ?? [];
  const quizMasterTestCount = quizMasterSeries.reduce((sum, series) => sum + Number(series.test_count || 0), 0);
  const quizMasterReviewSummary = quizMasterData?.profileDetail?.review_summary ?? null;
  const quizMasterIssueRows =
    quizMasterData?.tracking.user_rows.filter(
      (row) => row.technical_issue_count > 0 || row.delay_count > 0 || row.issues.length > 0,
    ) ?? [];

  const learnerPurchaseOverview = analytics?.purchase_overview;
  const learnerActiveSeries = learnerPurchaseOverview?.active_series ?? [];

  const learnerWeakestSection = useMemo(() => {
    if (!analytics) return null;
    const rows = (["gk", "maths", "passage"] as const)
      .map((type) => {
        const section = analytics.sections[type];
        return {
          type,
          label: section.label,
          accuracy: Number(section.accuracy || 0),
          questionCount: Number(section.question_count || 0),
        };
      })
      .filter((row) => row.questionCount > 0);
    if (rows.length === 0) return null;
    rows.sort((a, b) => a.accuracy - b.accuracy);
    return rows[0];
  }, [analytics]);

  const learnerPageHighlights = useMemo<LearnerHighlightCard[]>(() => {
    if (!analytics) return [];

    const activeEnrollments = Number(learnerPurchaseOverview?.active_enrollments || 0);
    const activePrelims = Number(learnerPurchaseOverview?.active_prelims_enrollments || 0);
    const activeMains = Number(learnerPurchaseOverview?.active_mains_enrollments || 0);
    const latestActivity = analytics.recent_activity[0] || null;

    const highlights: LearnerHighlightCard[] = [
      {
        key: "results",
        title: "My Results",
        metric: `${analytics.summary.total_quiz_attempts} quiz attempts | ${analytics.summary.total_mains_evaluations} mains`,
        detail: `Overall quiz accuracy ${analytics.summary.overall_quiz_accuracy.toFixed(1)}%`,
        href: "/my-results",
        actionLabel: "Open Results",
      },
      {
        key: "purchases",
        title: "My Purchases",
        metric: `${activeEnrollments} active series access`,
        detail: `${activePrelims} prelims | ${activeMains} mains`,
        href: "/my-purchases",
        actionLabel: "Open Purchases",
      },
      {
        key: "prelims-series",
        title: "Prelims Test Series",
        metric: `${activePrelims} active prelims purchases`,
        detail: activePrelims > 0 ? "Continue your prelims roadmap." : "No active prelims series yet.",
        href: "/test-series/prelims",
        actionLabel: "Browse Prelims",
      },
      {
        key: "mains-series",
        title: "Mains Test Series",
        metric: `${activeMains} active mains purchases`,
        detail: activeMains > 0 ? "Continue answer-writing practice." : "No active mains series yet.",
        href: "/test-series/mains",
        actionLabel: "Browse Mains",
      },
    ];

    if (learnerWeakestSection) {
      highlights.push({
        key: "weakest-section",
        title: "Focus Section",
        metric: `${learnerWeakestSection.label} at ${learnerWeakestSection.accuracy.toFixed(1)}%`,
        detail: "Open section detail and target weak topics.",
        href: `/dashboard/${learnerWeakestSection.type}`,
        actionLabel: "Open Detail",
      });
    } else if (latestActivity) {
      highlights.push({
        key: "latest-activity",
        title: "Latest Activity",
        metric: latestActivity.title,
        detail: `${latestActivity.type.toUpperCase()} | ${latestActivity.score_text}`,
        href: "/my-results",
        actionLabel: "View Activity",
      });
    }

    return highlights;
  }, [analytics, learnerPurchaseOverview, learnerWeakestSection]);

  const learnerQuizSectionRows = useMemo(() => {
    if (!analytics) return [];
    return (["gk", "maths", "passage"] as const)
      .map((type) => {
        const section = analytics.sections[type];
        return {
          type,
          label: section.label,
          attempts: Number(section.activity_count || 0),
          questions: Number(section.question_count || 0),
          accuracy: Number(section.accuracy || 0),
        };
      })
      .filter((row) => row.attempts > 0 || row.questions > 0);
  }, [analytics]);

  const learnerQuizRecommendations = useMemo(() => {
    if (!analytics) return [];
    const lines: string[] = [];
    if (learnerWeakestSection) {
      const weakest = analytics.sections[learnerWeakestSection.type];
      lines.push(...(weakest.recommendations || []).slice(0, 2));
    }
    const globalQuizLines = analytics.recommendations.filter((line) => !String(line).toLowerCase().includes("mains"));
    lines.push(...globalQuizLines.slice(0, 2));
    return Array.from(new Set(lines.filter((line) => String(line).trim()))).slice(0, 4);
  }, [analytics, learnerWeakestSection]);

  const learnerMainsRecommendations = useMemo(() => {
    if (!analytics) return [];
    const mainsLines = analytics.sections.mains.recommendations || [];
    if (mainsLines.length > 0) return mainsLines.slice(0, 4);
    const globalMainsLines = analytics.recommendations.filter((line) => String(line).toLowerCase().includes("mains"));
    return globalMainsLines.slice(0, 4);
  }, [analytics]);

  return (
    <AppLayout>
      <div className="space-y-8">
        <header className="space-y-2">
          <h1 className="text-3xl font-black tracking-tight text-slate-900">{copy.title}</h1>
          <p className="text-slate-600">{copy.subtitle}</p>
        </header>

        {loading ? (
          <div className="rounded-2xl border border-slate-200 bg-white p-8 text-slate-600 flex items-center gap-3">
            <Loader2 className="h-5 w-5 animate-spin text-indigo-600" />
            Loading dashboard...
          </div>
        ) : null}

        {!loading && !isAuthenticated ? (
          <div className="rounded-2xl border border-slate-200 bg-white p-8 space-y-4">
            <p className="text-slate-700">Login is required to view your dashboard.</p>
            <button type="button" onClick={showLoginModal} className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-semibold text-white">
              Login
            </button>
          </div>
        ) : null}

        {!loading && isAuthenticated && error ? (
          <div className="rounded-2xl border border-rose-200 bg-rose-50 p-6 text-rose-700 flex items-start gap-3">
            <AlertCircle className="h-5 w-5 mt-0.5" />
            <p>{error}</p>
          </div>
        ) : null}

        {!loading && isAuthenticated && !error && kind === "learner" && analytics ? (
          <>
            <section className="grid grid-cols-1 gap-4 xl:grid-cols-2">
              <section className="rounded-2xl border border-slate-200 bg-white p-6">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <h2 className="text-lg font-bold text-slate-900">Quiz Highlights + Recommendations</h2>
                  <Link href="/my-results" className="rounded border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700">
                    Open Results
                  </Link>
                </div>
                <div className="mt-4 grid grid-cols-2 gap-3 md:grid-cols-3">
                  <article className="rounded-xl border border-slate-200 bg-slate-50 p-3">
                    <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Quiz Attempts</p>
                    <p className="mt-1 text-2xl font-black text-slate-900">{analytics.summary.total_quiz_attempts}</p>
                  </article>
                  <article className="rounded-xl border border-slate-200 bg-slate-50 p-3">
                    <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Overall Accuracy</p>
                    <p className="mt-1 text-2xl font-black text-slate-900">{analytics.summary.overall_quiz_accuracy.toFixed(1)}%</p>
                  </article>
                  <article className="rounded-xl border border-slate-200 bg-slate-50 p-3">
                    <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Total Questions</p>
                    <p className="mt-1 text-2xl font-black text-slate-900">{analytics.summary.overall_quiz_questions}</p>
                  </article>
                  <article className="rounded-xl border border-slate-200 bg-slate-50 p-3">
                    <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Correct</p>
                    <p className="mt-1 text-2xl font-black text-emerald-700">{analytics.summary.overall_quiz_correct}</p>
                  </article>
                  <article className="rounded-xl border border-slate-200 bg-slate-50 p-3">
                    <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Incorrect</p>
                    <p className="mt-1 text-2xl font-black text-rose-700">{analytics.summary.overall_quiz_incorrect}</p>
                  </article>
                  <article className="rounded-xl border border-slate-200 bg-slate-50 p-3">
                    <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Unanswered</p>
                    <p className="mt-1 text-2xl font-black text-amber-700">{analytics.summary.overall_quiz_unanswered}</p>
                  </article>
                </div>

                <div className="mt-4 rounded-xl border border-slate-200 bg-slate-50 p-4">
                  <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Section Accuracy</p>
                  <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-3">
                    {learnerQuizSectionRows.map((row) => (
                      <div key={row.type} className="rounded-lg border border-slate-200 bg-white px-3 py-2">
                        <p className="text-sm font-semibold text-slate-800">{row.label}</p>
                        <p className="text-xs text-slate-600">
                          Attempts {row.attempts} | Questions {row.questions}
                        </p>
                        <p className="text-sm font-bold text-slate-900">{row.accuracy.toFixed(1)}%</p>
                      </div>
                    ))}
                  </div>
                </div>

                <div className="mt-4">
                  <h3 className="text-sm font-semibold text-slate-900">Quiz Recommendations</h3>
                  <div className="mt-2 space-y-2 text-sm text-slate-700">
                    {learnerQuizRecommendations.map((line, idx) => (
                      <p key={`quiz-rec-${idx}`}>{idx + 1}. {line}</p>
                    ))}
                    {learnerQuizRecommendations.length === 0 ? <p>No quiz recommendation available yet.</p> : null}
                  </div>
                  <div className="mt-3 flex flex-wrap gap-2">
                    <Link href="/dashboard/gk" className="rounded border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700">GK Detail</Link>
                    <Link href="/dashboard/maths" className="rounded border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700">Maths Detail</Link>
                    <Link href="/dashboard/passage" className="rounded border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700">Passage Detail</Link>
                  </div>
                </div>
              </section>

              <section className="rounded-2xl border border-slate-200 bg-white p-6">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <h2 className="text-lg font-bold text-slate-900">Mains Highlights + Recommendations</h2>
                  <Link href="/dashboard/mains" className="rounded border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700">
                    Open Mains Detail
                  </Link>
                </div>
                <div className="mt-4 grid grid-cols-2 gap-3">
                  <article className="rounded-xl border border-slate-200 bg-slate-50 p-3">
                    <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Mains Evaluations</p>
                    <p className="mt-1 text-2xl font-black text-slate-900">{analytics.summary.total_mains_evaluations}</p>
                  </article>
                  <article className="rounded-xl border border-slate-200 bg-slate-50 p-3">
                    <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Average Score</p>
                    <p className="mt-1 text-2xl font-black text-slate-900">{analytics.summary.overall_mains_average_score.toFixed(2)}/10</p>
                  </article>
                  <article className="rounded-xl border border-slate-200 bg-slate-50 p-3">
                    <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Total Marks</p>
                    <p className="mt-1 text-2xl font-black text-slate-900">
                      {analytics.sections.mains.total_score.toFixed(1)}/{analytics.sections.mains.max_total_score.toFixed(1)}
                    </p>
                  </article>
                  <article className="rounded-xl border border-slate-200 bg-slate-50 p-3">
                    <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Score Percent</p>
                    <p className="mt-1 text-2xl font-black text-slate-900">{analytics.sections.mains.score_percent.toFixed(1)}%</p>
                  </article>
                </div>

                <div className="mt-4 rounded-xl border border-slate-200 bg-slate-50 p-4">
                  <h3 className="text-sm font-semibold text-slate-900">Mains Weak Areas</h3>
                  <div className="mt-2 space-y-2 text-sm text-slate-700">
                    {(analytics.sections.mains.weak_areas || []).slice(0, 4).map((area, idx) => (
                      <p key={`mains-weak-${idx}`}>{idx + 1}. {area.name} ({area.count})</p>
                    ))}
                    {(analytics.sections.mains.weak_areas || []).length === 0 ? <p>No recurring weak mains area yet.</p> : null}
                  </div>
                </div>

                <div className="mt-4">
                  <h3 className="text-sm font-semibold text-slate-900">Mains Recommendations</h3>
                  <div className="mt-2 space-y-2 text-sm text-slate-700">
                    {learnerMainsRecommendations.map((line, idx) => (
                      <p key={`mains-rec-${idx}`}>{idx + 1}. {line}</p>
                    ))}
                    {learnerMainsRecommendations.length === 0 ? <p>No mains recommendation available yet.</p> : null}
                  </div>
                </div>
              </section>
            </section>

            <section className="rounded-2xl border border-slate-200 bg-white p-6">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h2 className="text-lg font-bold text-slate-900">Major Highlights Across Pages</h2>
                <div className="flex flex-wrap gap-2">
                  <Link href="/my-results" className="rounded border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700">My Results</Link>
                  <Link href="/my-purchases" className="rounded border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700">My Purchases</Link>
                </div>
              </div>
              <div className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
                {learnerPageHighlights.map((item) => (
                  <article key={item.key} className="rounded-xl border border-slate-200 bg-slate-50 p-4">
                    <p className="text-sm font-bold text-slate-900">{item.title}</p>
                    <p className="mt-2 text-sm font-semibold text-slate-800">{item.metric}</p>
                    <p className="mt-1 text-xs text-slate-600">{item.detail}</p>
                    <Link href={item.href} className="mt-3 inline-flex items-center rounded border border-slate-300 bg-white px-2.5 py-1 text-xs font-semibold text-slate-700">
                      {item.actionLabel}
                    </Link>
                  </article>
                ))}
              </div>
            </section>

            <section className="rounded-2xl border border-slate-200 bg-white p-6">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h2 className="text-lg font-bold text-slate-900">Purchase Overview</h2>
                <Link href="/my-purchases" className="rounded border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700">
                  Open Full Purchases
                </Link>
              </div>
              <div className="mt-3 grid grid-cols-2 gap-3 md:grid-cols-4">
                <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
                  <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Total Purchases</p>
                  <p className="mt-1 text-xl font-black text-slate-900">{Number(learnerPurchaseOverview?.total_enrollments || 0)}</p>
                </div>
                <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
                  <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Active</p>
                  <p className="mt-1 text-xl font-black text-slate-900">{Number(learnerPurchaseOverview?.active_enrollments || 0)}</p>
                </div>
                <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
                  <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Prelims</p>
                  <p className="mt-1 text-xl font-black text-slate-900">{Number(learnerPurchaseOverview?.active_prelims_enrollments || 0)}</p>
                </div>
                <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
                  <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Mains</p>
                  <p className="mt-1 text-xl font-black text-slate-900">{Number(learnerPurchaseOverview?.active_mains_enrollments || 0)}</p>
                </div>
              </div>
              <div className="mt-4 space-y-2">
                {learnerActiveSeries.slice(0, 8).map((series) => (
                  <article key={`${series.enrollment_id}-${series.series_id}`} className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <p className="font-semibold text-slate-800">{series.title}</p>
                      <span className="text-xs text-slate-500">{formatSeriesKindLabel(series.series_kind)} Series</span>
                    </div>
                    <p className="text-xs text-slate-600">
                      {String(series.access_type || "subscription").toUpperCase()} | Provider {series.provider_display_name || series.provider_user_id || "n/a"}
                    </p>
                    <p className="text-xs text-slate-600">
                      Source: {series.access_source} | Price: {Number(series.price || 0) > 0 ? `Rs. ${Number(series.price || 0).toFixed(2)}` : "Included"}
                    </p>
                    <p className="text-xs text-slate-600">
                      Valid Until: {series.subscribed_until ? formatDateTime(series.subscribed_until) : "n/a"}
                    </p>
                    <div className="mt-2 flex flex-wrap gap-2">
                      <Link href={`/test-series/${series.series_id}`} className="rounded border border-slate-300 bg-white px-2.5 py-1 text-xs font-semibold text-slate-700">
                        Open Series
                      </Link>
                      <Link href={String(series.series_kind || "").toLowerCase() === "mains" ? "/test-series/mains" : "/test-series/prelims"} className="rounded border border-slate-300 bg-white px-2.5 py-1 text-xs font-semibold text-slate-700">
                        Browse Similar
                      </Link>
                    </div>
                  </article>
                ))}
                {learnerActiveSeries.length === 0 ? <p className="text-sm text-slate-500">No active test series purchases yet.</p> : null}
              </div>
              <div className="mt-4 flex flex-wrap gap-2">
                <Link href="/test-series/prelims" className="rounded border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700">Browse Prelims Series</Link>
                <Link href="/test-series/mains" className="rounded border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700">Browse Mains Series</Link>
              </div>
            </section>
          </>
        ) : null}

        {!loading && isAuthenticated && !error && kind === "mains_mentor" && mentorData ? (
          <>
            <section className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-6">
              <StatCard label="New Bookings" value={mentorNewBookings} hint="Direct learner bookings" />
              <StatCard label="Scheduled Requests" value={mentorScheduled} />
              <StatCard label="Completed Requests" value={mentorCompleted} />
              <StatCard label="Slots Created" value={mentorCreatedSlots} />
              <StatCard label="Sessions Created" value={mentorCreatedSessions} />
              <StatCard label="Sessions Completed" value={mentorCompletedSessions} hint={`Delayed ${mentorDelayed}`} />
            </section>

            <section className="rounded-2xl border border-slate-200 bg-white p-6">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h2 className="text-lg font-bold text-slate-900">Mentor Actions</h2>
                <div className="flex flex-wrap gap-2">
                  <Link href="/test-series/create" className="inline-flex items-center rounded-md bg-slate-900 px-3 py-1.5 text-xs font-semibold text-white">
                    Create Mains Series
                  </Link>
                  <Link href="/mains-mentor/ai-mains" className="inline-flex items-center rounded-md border border-indigo-300 bg-indigo-50 px-3 py-1.5 text-xs font-semibold text-indigo-700">
                    AI Mains Parse + Create
                  </Link>
                  <Link href="/mentorship/manage" className="inline-flex items-center rounded-md border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700">
                    Create Slot / Manage Sessions
                  </Link>
                  <Link href="/profile/professional" className="inline-flex items-center rounded-md border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700">
                    Professional Profile
                  </Link>
                </div>
              </div>
            </section>

            <section className="rounded-2xl border border-emerald-200 bg-emerald-50 p-6">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h2 className="text-lg font-bold text-emerald-900">New Learner Bookings</h2>
                <Link href="/mentorship/manage" className="inline-flex items-center rounded-md border border-emerald-300 bg-white px-3 py-1.5 text-xs font-semibold text-emerald-700">
                  Open Mentor Desk
                </Link>
              </div>
              <div className="mt-3 space-y-2">
                {mentorRecentBookings.slice(0, 8).map((request) => (
                  <article key={`mentor-booking-${request.id}`} className="rounded-lg border border-emerald-200 bg-white px-3 py-2 text-sm">
                    <p className="font-semibold text-slate-800">Request #{request.id} | Learner {request.user_id}</p>
                    <p className="text-xs text-slate-600">
                      Booked at: {formatDateTime(requestMetaDate(request, "booked_by_user_at"))} | Scheduled for:{" "}
                      {formatDateTime(requestMetaDate(request, "scheduled_slot_starts_at"))}
                    </p>
                    {request.note ? <p className="text-xs text-slate-600">Note: {request.note}</p> : null}
                  </article>
                ))}
                {mentorRecentBookings.length === 0 ? <p className="text-sm text-slate-500">No new learner bookings yet.</p> : null}
              </div>
            </section>

            <section className="rounded-2xl border border-slate-200 bg-white p-6">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h2 className="text-lg font-bold text-slate-900">Created Mains Series</h2>
                <Link href="/test-series" className="inline-flex items-center rounded-md border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700">
                  Manage Test Series
                </Link>
              </div>
              <div className="mt-3 space-y-2">
                {mentorData.mainsSeries.slice(0, 10).map((series) => (
                  <article key={series.id} className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <p className="font-semibold text-slate-800">{series.title}</p>
                      <span className="text-xs text-slate-500">{series.test_count} tests</span>
                    </div>
                    <p className="text-xs text-slate-600">
                      {series.series_kind} | {series.access_type} | {series.is_public ? "public" : "private"} | {series.is_active ? "active" : "archived"}
                    </p>
                    <div className="mt-2 flex flex-wrap gap-2">
                      <Link href={`/test-series/${series.id}/manage`} className="inline-flex items-center rounded border border-slate-300 bg-white px-2.5 py-1 text-xs font-semibold text-slate-700">
                        Manage
                      </Link>
                      <Link href={`/test-series/${series.id}`} className="inline-flex items-center rounded border border-slate-300 bg-white px-2.5 py-1 text-xs font-semibold text-slate-700">
                        Open
                      </Link>
                    </div>
                  </article>
                ))}
                {mentorData.mainsSeries.length === 0 ? <p className="text-sm text-slate-500">No mains series created yet.</p> : null}
              </div>
            </section>

            <section className="rounded-2xl border border-slate-200 bg-white p-6">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h2 className="text-lg font-bold text-slate-900">Created / Completed Sessions</h2>
                <Link href="/mentorship/manage" className="inline-flex items-center rounded-md border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700">
                  Open Mentorship Queue
                </Link>
              </div>
              <div className="mt-3 space-y-2">
                {mentorData.sessions.slice(0, 12).map((session) => (
                  <article key={session.id} className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm">
                    <p className="font-semibold text-slate-800">
                      Session #{session.id} | Request #{session.request_id} | {session.status}
                    </p>
                    <p className="text-xs text-slate-600">
                      User {session.user_id} | {formatDateTime(session.starts_at)} - {formatDateTime(session.ends_at)}
                    </p>
                  </article>
                ))}
                {mentorData.sessions.length === 0 ? <p className="text-sm text-slate-500">No sessions created yet.</p> : null}
              </div>
            </section>

            <section className="rounded-2xl border border-slate-200 bg-white p-6">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h2 className="text-lg font-bold text-slate-900">Mentorship Lifecycle Tracking</h2>
                <Link href="/mentorship/manage" className="inline-flex items-center rounded-md bg-slate-900 px-3 py-1.5 text-xs font-semibold text-white">
                  Open Management
                  <ArrowRight className="ml-1 h-3.5 w-3.5" />
                </Link>
              </div>
              <div className="mt-3 space-y-2">
                {mentorData.tracking.mentorship_cycles.slice(0, 14).map((cycle) => (
                  <article key={cycle.request_id} className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm">
                    <p className="font-semibold text-slate-800">
                      Request #{cycle.request_id} | {cycle.request_status} | User {cycle.user_id}
                    </p>
                    <p className="text-xs text-slate-600">
                      Mentor: {cycle.provider_user_id} | Series: {cycle.series_title || cycle.series_id || "n/a"} | Test: {cycle.test_title || cycle.test_collection_id || "n/a"}
                    </p>
                    <p className="text-xs text-slate-600">
                      Requested: {formatDateTime(cycle.requested_at)} | Accepted: {formatDateTime(cycle.accepted_at)} | Scheduled: {formatDateTime(cycle.scheduled_for)} | Completed: {formatDateTime(cycle.completed_at)}
                    </p>
                    {cycle.issues.length > 0 ? (
                      <div className="mt-2 flex flex-wrap gap-1">
                        {cycle.issues.slice(0, 3).map((issue, index) => (
                          <span key={`${cycle.request_id}-${issue.code}-${index}`} className={`rounded border px-2 py-0.5 text-[10px] font-semibold ${issueBadgeClass(issue)}`}>
                            {issue.label}
                          </span>
                        ))}
                      </div>
                    ) : null}
                    {cycle.timeline.length > 0 ? (
                      <p className="mt-2 text-[11px] text-slate-500">
                        {cycle.timeline
                          .map((item) => `${item.label}${item.at ? ` (${formatDateTime(item.at)})` : ""}`)
                          .join(" -> ")}
                      </p>
                    ) : null}
                  </article>
                ))}
                {mentorData.tracking.mentorship_cycles.length === 0 ? <p className="text-sm text-slate-500">No mentorship lifecycle data yet.</p> : null}
              </div>
            </section>
          </>
        ) : null}

        {!loading && isAuthenticated && !error && kind === "quiz_master" && quizMasterData ? (
          <>
            <section className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-6">
              <StatCard label="Prelims Series" value={quizMasterSeries.length} />
              <StatCard label="Prelims Tests" value={quizMasterTestCount} />
              <StatCard label="Active Enrollments" value={quizMasterData.summary.active_enrollments} />
              <StatCard label="Pending Copy Checks" value={quizMasterData.summary.pending_copy_checks} hint="Mains checks need mentor role" />
              <StatCard label="Reviews" value={quizMasterReviewSummary?.total_reviews ?? 0} />
              <StatCard
                label="Avg Rating"
                value={quizMasterReviewSummary ? quizMasterReviewSummary.average_rating.toFixed(1) : "0.0"}
              />
            </section>

            <section className="rounded-2xl border border-slate-200 bg-white p-6">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h2 className="text-lg font-bold text-slate-900">Quiz Master Actions</h2>
                <div className="flex flex-wrap gap-2">
                  <Link href="/test-series/create" className="inline-flex items-center rounded-md bg-slate-900 px-3 py-1.5 text-xs font-semibold text-white">
                    Create Prelims Series
                  </Link>
                  <Link href="/quiz-master/ai-quiz/gk" className="inline-flex items-center rounded-md border border-indigo-300 bg-indigo-50 px-3 py-1.5 text-xs font-semibold text-indigo-700">
                    AI Quiz Parser + Creator
                  </Link>
                  <Link href="/test-series/prelims" className="inline-flex items-center rounded-md border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700">
                    Browse Prelims
                  </Link>
                  <Link href="/profile/professional" className="inline-flex items-center rounded-md border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700">
                    Professional Profile
                  </Link>
                  {currentUserId ? (
                    <Link href={`/profiles/${currentUserId}`} className="inline-flex items-center rounded-md border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700">
                      Public Profile + Reviews
                    </Link>
                  ) : null}
                </div>
              </div>
            </section>

            <section className="rounded-2xl border border-slate-200 bg-white p-6">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h2 className="text-lg font-bold text-slate-900">Created Prelims Series + Enrollments</h2>
                <Link href="/test-series" className="inline-flex items-center rounded-md border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700">Manage Test Series</Link>
              </div>
              <div className="mt-3 space-y-2">
                {quizMasterData.seriesInsights.slice(0, 12).map((insight) => (
                  <article key={insight.series.id} className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <p className="font-semibold text-slate-800">{insight.series.title}</p>
                      <span className="text-xs text-slate-500">{insight.series.test_count} tests</span>
                    </div>
                    <p className="text-xs text-slate-600">
                      {insight.series.series_kind} | {insight.series.access_type} | {insight.series.is_public ? "public" : "private"} | {insight.series.is_active ? "active" : "archived"}
                    </p>
                    <p className="mt-1 text-xs text-slate-600">
                      Enrollments: {insight.totalEnrollments} total | {insight.activeEnrollments} active
                    </p>
                    <div className="mt-2 flex flex-wrap gap-2">
                      <Link href={`/test-series/${insight.series.id}/manage`} className="inline-flex items-center rounded border border-slate-300 bg-white px-2.5 py-1 text-xs font-semibold text-slate-700">Manage</Link>
                      <Link href={`/test-series/${insight.series.id}`} className="inline-flex items-center rounded border border-slate-300 bg-white px-2.5 py-1 text-xs font-semibold text-slate-700">Open</Link>
                    </div>
                  </article>
                ))}
                {quizMasterData.seriesInsights.length === 0 ? <p className="text-sm text-slate-500">No prelims series created yet.</p> : null}
              </div>
            </section>

            <section className="rounded-2xl border border-slate-200 bg-white p-6">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h2 className="text-lg font-bold text-slate-900">Issues Raised By Enrolled Students</h2>
                <Link href="/test-series" className="inline-flex items-center rounded-md border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700">
                  Open Series Workspace
                </Link>
              </div>
              <div className="mt-3 space-y-2">
                {quizMasterIssueRows.slice(0, 14).map((row) => (
                  <article key={row.user_id} className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm">
                    <p className="font-semibold text-slate-800">
                      User {row.user_id} | Enrollments {row.enrolled_series_count} | Attempts {row.attempted_tests}
                    </p>
                    <p className="text-xs text-slate-600">
                      Technical issues: {row.technical_issue_count} | Delays: {row.delay_count} | Pending checks: {row.pending_copy_checks} | Last activity: {formatDateTime(row.last_activity_at)}
                    </p>
                    {row.issues.length > 0 ? (
                      <div className="mt-2 flex flex-wrap gap-1">
                        {row.issues.slice(0, 4).map((issue, idx) => (
                          <span key={`${row.user_id}-${issue.code}-${idx}`} className={`rounded border px-2 py-0.5 text-[10px] font-semibold ${issueBadgeClass(issue)}`}>
                            {issue.label}
                          </span>
                        ))}
                      </div>
                    ) : null}
                  </article>
                ))}
                {quizMasterIssueRows.length === 0 ? <p className="text-sm text-slate-500">No student issues raised yet.</p> : null}
              </div>
            </section>
          </>
        ) : null}

        {!loading && isAuthenticated && !error && kind === "moderator" && moderatorData ? (
          <>
            <section className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-6">
              <StatCard label="Series" value={moderatorData.summary.series_count} hint={`Active ${moderatorData.summary.active_series_count}`} />
              <StatCard label="Tests" value={moderatorData.summary.test_count} hint={`Active ${moderatorData.summary.active_test_count}`} />
              <StatCard label="Pending Copy Checks" value={moderatorData.summary.pending_copy_checks} hint={`Total ${moderatorData.summary.copy_submissions_total}`} />
              <StatCard label="Mentorship Pending" value={moderatorData.summary.mentorship_pending_requests} hint={`Total ${moderatorData.summary.mentorship_requests_total}`} />
              <StatCard label="Delayed Items" value={moderatorData.tracking.summary.delayed_items} hint={`Users ${moderatorData.tracking.summary.users}`} />
              <StatCard label="Technical Issues" value={moderatorData.tracking.summary.technical_issues} hint={`Cycles ${moderatorData.tracking.summary.mentorship_cycles}`} />
            </section>

            <section className="rounded-2xl border border-slate-200 bg-white p-6">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h2 className="text-lg font-bold text-slate-900">User Lifecycle Tracking</h2>
                <Link href="/test-series" className="inline-flex items-center rounded-md border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700">Open Test Series Console</Link>
              </div>
              <div className="mt-3 space-y-2">
                {moderatorData.tracking.user_rows.slice(0, 14).map((row) => (
                  <article key={row.user_id} className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm">
                    <p className="font-semibold text-slate-800">
                      {row.user_id} | Enrollment {row.enrolled_series_count} | Attempts {row.attempted_tests} | Copy {row.copy_checked}/{row.copy_submissions} | Mentorship {row.mentorship_completed}/{row.mentorship_requests}
                    </p>
                    <p className="text-xs text-slate-600">
                      Pending mentorship: {row.pending_mentorship} | Pending copy checks: {row.pending_copy_checks} | Delays: {row.delay_count} | Technical: {row.technical_issue_count} | Last activity: {formatDateTime(row.last_activity_at)}
                    </p>
                    {row.issues.length > 0 ? (
                      <div className="mt-2 flex flex-wrap gap-1">
                        {row.issues.slice(0, 3).map((issue, idx) => (
                          <span key={`${row.user_id}-${issue.code}-${idx}`} className={`rounded border px-2 py-0.5 text-[10px] font-semibold ${issueBadgeClass(issue)}`}>
                            {issue.label}
                          </span>
                        ))}
                      </div>
                    ) : null}
                  </article>
                ))}
                {moderatorData.tracking.user_rows.length === 0 ? <p className="text-sm text-slate-500">No lifecycle rows yet.</p> : null}
              </div>
            </section>

            <section className="rounded-2xl border border-slate-200 bg-white p-6">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h2 className="text-lg font-bold text-slate-900">Mentorship Full-Cycle Tracking</h2>
                <Link href="/mentorship/manage" className="inline-flex items-center rounded-md bg-slate-900 px-3 py-1.5 text-xs font-semibold text-white">Open Mentorship Queue</Link>
              </div>
              <div className="mt-3 space-y-2">
                {moderatorData.tracking.mentorship_cycles.slice(0, 14).map((cycle) => (
                  <article key={cycle.request_id} className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm">
                    <p className="font-semibold text-slate-800">
                      Request #{cycle.request_id} | {cycle.user_id} -&gt; {cycle.provider_user_id} | {cycle.request_status}
                    </p>
                    <p className="text-xs text-slate-600">
                      Series: {cycle.series_title || cycle.series_id || "n/a"} | Test: {cycle.test_title || cycle.test_collection_id || "n/a"}
                    </p>
                    <p className="text-xs text-slate-600">
                      Requested: {formatDateTime(cycle.requested_at)} | Accepted: {formatDateTime(cycle.accepted_at)} | Scheduled: {formatDateTime(cycle.scheduled_for)} | Completed: {formatDateTime(cycle.completed_at)}
                    </p>
                    {cycle.issues.length > 0 ? (
                      <div className="mt-2 flex flex-wrap gap-1">
                        {cycle.issues.slice(0, 4).map((issue, idx) => (
                          <span key={`${cycle.request_id}-${issue.code}-${idx}`} className={`rounded border px-2 py-0.5 text-[10px] font-semibold ${issueBadgeClass(issue)}`}>
                            {issue.label}
                          </span>
                        ))}
                      </div>
                    ) : null}
                  </article>
                ))}
                {moderatorData.tracking.mentorship_cycles.length === 0 ? <p className="text-sm text-slate-500">No mentorship cycles yet.</p> : null}
              </div>
            </section>

            <section className="rounded-2xl border border-slate-200 bg-white p-6">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h2 className="text-lg font-bold text-slate-900 inline-flex items-center gap-2">
                  <ShieldCheck className="h-5 w-5" />
                  Pending Onboarding Queue
                </h2>
                <div className="flex gap-2">
                  <Link href="/onboarding/review" className="inline-flex items-center rounded-md bg-slate-900 px-3 py-1.5 text-xs font-semibold text-white">Open Queue</Link>
                  <Link href="/admin/user-roles" className="inline-flex items-center rounded-md border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700">User Roles</Link>
                </div>
              </div>
              <div className="mt-3 space-y-2">
                {moderatorData.pendingOnboarding.slice(0, 10).map((row) => (
                  <article key={row.id} className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm">
                    <p className="font-semibold text-slate-800">Request #{row.id} | {row.desired_role} | {row.full_name}</p>
                    <p className="text-xs text-slate-600">{row.city || "City n/a"} | Experience: {row.years_experience ?? "n/a"}</p>
                  </article>
                ))}
                {moderatorData.pendingOnboarding.length === 0 ? <p className="text-sm text-slate-500">No pending onboarding requests.</p> : null}
              </div>
            </section>
          </>
        ) : null}
      </div>
    </AppLayout>
  );
}
