"use client";

import axios from "axios";
import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  AlertCircle,
  ArrowRight,
  BookOpenText,
  CalendarDays,
  ClipboardCheck,
  Clock3,
  FileText,
  Loader2,
  MessagesSquare,
  ShieldCheck,
  Users,
} from "lucide-react";
import { toast } from "sonner";

import LearnerPerformanceAudit from "@/components/dashboard/LearnerPerformanceAudit";
import AppLayout from "@/components/layouts/AppLayout";
import RoleWorkspaceSidebar from "@/components/layouts/RoleWorkspaceSidebar";
import {
  getMainsMentorWorkspaceSections,
  getQuizMasterWorkspaceSections,
} from "@/components/layouts/roleWorkspaceLinks";
import { useAuth } from "@/context/AuthContext";
import { getUserRole, isMentorLike, isModeratorLike, isProviderLike } from "@/lib/accessControl";
import { premiumApi } from "@/lib/premiumApi";
import { createClient as createSupabaseClient } from "@/lib/supabase/client";
import type {
  LifecycleTrackingIssue,
  LifecycleTrackingPayload,
  MentorshipRequest,
  MentorshipSession,
  MentorshipSlot,
  MentorshipTrackingCycle,
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

interface MentorLearnerDirectoryEntry {
  name: string;
  email: string;
}

interface MentorLearnerRequestCard {
  userId: string;
  name: string;
  email: string;
  initials: string;
  latestRequest: MentorshipRequest;
  requestCount: number;
  unreadCount: number;
  seriesTitle: string;
  testTitle: string;
  serviceLabel: string;
  note: string;
}

const QUIZ_MASTER_ROLES = new Set(["provider", "institute", "creator", "quiz_master", "quizmaster"]);

const dashboardCopy: Record<DashboardKind, { title: string; subtitle: string }> = {
  learner: {
    title: "Performance Evaluation",
    subtitle: "Marks-focused performance across AI content and program content, with category-wise drill-down.",
  },
  mains_mentor: {
    title: "Mains Mentor Dashboard",
    subtitle: "Request review, payment follow-through, evaluation delivery, and live session management.",
  },
  quiz_master: {
    title: "Quiz Master Dashboard",
    subtitle: "Prelims-focused programs operations and learner activity.",
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
    <article className="rounded-2xl border border-[#dce3fb] dark:border-[#1e2a4a] bg-white dark:bg-[#0b1120] p-5">
      <p className="text-xs font-semibold uppercase tracking-wide text-[#6c7590] dark:text-[#94a3b8]">{label}</p>
      <p className="mt-2 text-3xl font-black text-[#141b2d] dark:text-white">{value}</p>
      {hint ? <p className="mt-1 text-xs text-[#6c7590] dark:text-[#94a3b8]">{hint}</p> : null}
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

function plainTextExcerpt(value?: string | null, fallback = "No problem statement attached."): string {
  const normalized = String(value || "")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!normalized) return fallback;
  return normalized.length > 140 ? `${normalized.slice(0, 137)}...` : normalized;
}

function issueBadgeClass(issue: LifecycleTrackingIssue): string {
  if (issue.severity === "critical") return "border-rose-300 bg-rose-50 text-rose-800";
  if (issue.severity === "warning") return "border-amber-300 bg-amber-50 text-amber-800";
  return "border-slate-300 bg-[#f8faff] dark:bg-[#0f172a] text-[#334155] dark:text-gray-200";
}

function formatSeriesKindLabel(value?: string | null): string {
  const normalized = String(value || "").trim().toLowerCase();
  if (normalized === "mains") return "Mains";
  if (normalized === "hybrid") return "Hybrid";
  return "Prelims";
}

function titleCaseLabel(value?: string | null, fallback = "n/a"): string {
  const normalized = String(value || "")
    .trim()
    .replaceAll("_", " ");
  if (!normalized) return fallback;
  return normalized.replace(/\b\w/g, (match) => match.toUpperCase());
}

function mentorshipServiceLabel(value?: string | null): string {
  if (String(value || "").trim().toLowerCase() === "copy_evaluation_and_mentorship") {
    return "Evaluation + Mentorship";
  }
  return "Mentorship Only";
}

function initialsFromLabel(label?: string | null): string {
  const parts = String(label || "")
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  if (parts.length === 0) return "LR";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return `${parts[0][0] || ""}${parts[1][0] || ""}`.toUpperCase();
}

function emailHandleToLabel(email?: string | null): string {
  const handle = String(email || "").split("@")[0]?.trim();
  if (!handle) return "";
  return handle
    .replace(/[._-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/\b\w/g, (match) => match.toUpperCase());
}

function learnerNameFromRequest(request: MentorshipRequest): string {
  const learnerName = typeof request.meta?.learner_name === "string" ? request.meta.learner_name.trim() : "";
  if (learnerName) return learnerName;
  const learnerEmail = typeof request.meta?.learner_email === "string" ? request.meta.learner_email.trim() : "";
  return emailHandleToLabel(learnerEmail) || "Learner";
}

function learnerEmailFromRequest(request: MentorshipRequest): string {
  return typeof request.meta?.learner_email === "string" ? request.meta.learner_email.trim() : "";
}

function requestUnreadCount(request: MentorshipRequest): number {
  const raw = Number(request.meta?.viewer_unread_message_count || 0);
  return Number.isFinite(raw) && raw > 0 ? raw : 0;
}

function buildRealtimeRequestFilter(requestIds: number[]): string | null {
  const ids = Array.from(new Set(requestIds.filter((value) => Number.isFinite(value) && value > 0)));
  if (!ids.length) return null;
  if (ids.length === 1) return `request_id=eq.${ids[0]}`;
  return `request_id=in.(${ids.join(",")})`;
}

function requestStatusBadgeClass(status?: string | null): string {
  const normalized = String(status || "").trim().toLowerCase();
  if (normalized === "requested") return "border-amber-300 bg-amber-50 text-amber-800";
  if (normalized === "accepted" || normalized === "scheduled" || normalized === "completed") {
    return "border-emerald-300 bg-emerald-50 text-emerald-800";
  }
  if (normalized === "rejected" || normalized === "cancelled" || normalized === "expired") {
    return "border-rose-300 bg-rose-50 text-rose-800";
  }
  return "border-slate-300 bg-[#f8faff] dark:bg-[#0f172a] text-[#334155] dark:text-gray-200";
}

function paymentStatusBadgeClass(status?: string | null): string {
  const normalized = String(status || "").trim().toLowerCase();
  if (normalized === "paid") return "border-emerald-300 bg-emerald-50 text-emerald-800";
  if (normalized === "pending") return "border-amber-300 bg-amber-50 text-amber-800";
  if (normalized === "failed" || normalized === "refunded") return "border-rose-300 bg-rose-50 text-rose-800";
  return "border-slate-300 bg-[#f8faff] dark:bg-[#0f172a] text-[#334155] dark:text-gray-200";
}

function sessionDurationMinutes(session: MentorshipSession): number | null {
  const start = new Date(session.starts_at).getTime();
  const end = new Date(session.ends_at).getTime();
  if (Number.isNaN(start) || Number.isNaN(end) || end <= start) return null;
  return Math.round((end - start) / 60000);
}

function sameCalendarDay(value?: string | null): boolean {
  if (!value) return false;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return false;
  const now = new Date();
  return date.toDateString() === now.toDateString();
}

function buildMentorLearnerRequestCards(
  requests: MentorshipRequest[],
  cycleByRequestId: Map<number, MentorshipTrackingCycle>,
  seriesById: Map<number, TestSeries>,
  learnerDirectory: Map<string, MentorLearnerDirectoryEntry>,
): MentorLearnerRequestCard[] {
  const grouped = new Map<string, MentorshipRequest[]>();
  for (const request of requests) {
    const bucket = grouped.get(request.user_id) || [];
    bucket.push(request);
    grouped.set(request.user_id, bucket);
  }

  return Array.from(grouped.entries())
    .map(([userId, learnerRequests]) => {
      const rows = [...learnerRequests].sort(
        (left, right) => new Date(right.requested_at).getTime() - new Date(left.requested_at).getTime(),
      );
      const latestRequest = rows[0];
      const cycle = cycleByRequestId.get(latestRequest.id);
      const series = latestRequest.series_id ? seriesById.get(latestRequest.series_id) : null;
      const learner = learnerDirectory.get(userId);
      const name = learner?.name || learnerNameFromRequest(latestRequest);
      const email = learner?.email || learnerEmailFromRequest(latestRequest);
      return {
        userId,
        name,
        email,
        initials: initialsFromLabel(name || email),
        latestRequest,
        requestCount: rows.length,
        unreadCount: rows.reduce((total, request) => total + requestUnreadCount(request), 0),
        seriesTitle: cycle?.series_title || series?.title || "Direct mentorship request",
        testTitle: cycle?.test_title || "",
        serviceLabel: mentorshipServiceLabel(latestRequest.service_type),
        note: plainTextExcerpt(latestRequest.note),
      };
    })
    .sort(
      (left, right) =>
        new Date(right.latestRequest.requested_at).getTime() - new Date(left.latestRequest.requested_at).getTime(),
    );
}

export default function DashboardPage() {
  const { loading: authLoading, isAuthenticated, showLoginModal, user } = useAuth();
  const kind = useMemo(() => resolveDashboardKind(user), [user]);
  const currentUserId = String(user?.id || "").trim();
  const quizMasterWorkspaceSections = useMemo(
    () => getQuizMasterWorkspaceSections(currentUserId || undefined),
    [currentUserId],
  );
  const mainsMentorWorkspaceSections = useMemo(
    () => getMainsMentorWorkspaceSections(currentUserId || undefined),
    [currentUserId],
  );

  const [loadingData, setLoadingData] = useState(false);
  const [error, setError] = useState("");

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
          if (!active) return;
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
            premiumApi.get<TestSeries[]>("/programs", {
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
          setQuizMasterData(null);
          setModeratorData(null);
          return;
        }

        if (kind === "quiz_master") {
          const [summary, series, trackingPayload, profileDetail] = await Promise.all([
            premiumApi.get<ProviderDashboardSummary>("/provider/dashboard-summary"),
            premiumApi.get<TestSeries[]>("/programs", { params: { mine_only: true, include_tests: true, include_inactive: true } }),
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
                  `/programs/${seriesRow.id}/enrollments`,
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

  const mentorAwaitingPayment =
    mentorData?.requests.filter((request) => request.status === "accepted" && request.payment_status !== "paid").length ?? 0;
  const mentorEvaluationQueue =
    mentorData?.requests.filter(
      (request) => request.submission_id && request.payment_status === "paid" && !request.feedback_ready_at && request.status !== "completed",
    ).length ?? 0;
  const mentorUpcomingSessions =
    mentorData?.sessions.filter((session) => session.status === "scheduled" || session.status === "live").length ?? 0;
  const mentorDelayed = mentorData?.tracking.summary.delayed_items ?? 0;
  const mentorCompletedSessions =
    mentorData?.sessions.filter((session) => session.status === "completed").length ?? 0;
  const mentorPendingRequests = useMemo(
    () =>
      (mentorData?.requests ?? [])
        .filter((request) => request.status === "requested")
        .sort((left, right) => new Date(right.requested_at).getTime() - new Date(left.requested_at).getTime()),
    [mentorData?.requests],
  );
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
  const mentorLatestBookingSignature = useMemo(() => {
    const latestBooking = mentorRecentBookings[0];
    if (!latestBooking) return null;
    return `${latestBooking.id}:${requestMetaDate(latestBooking, "booked_by_user_at") || latestBooking.updated_at || latestBooking.requested_at}`;
  }, [mentorRecentBookings]);
  const mentorRequestById = useMemo(() => {
    const map = new Map<number, MentorshipRequest>();
    for (const request of mentorData?.requests ?? []) map.set(request.id, request);
    return map;
  }, [mentorData?.requests]);
  const mentorCycleByRequestId = useMemo(() => {
    const map = new Map<number, MentorshipTrackingCycle>();
    for (const cycle of mentorData?.tracking.mentorship_cycles ?? []) map.set(cycle.request_id, cycle);
    return map;
  }, [mentorData?.tracking.mentorship_cycles]);
  const mentorSeriesById = useMemo(() => {
    const map = new Map<number, TestSeries>();
    for (const series of mentorData?.mainsSeries ?? []) map.set(series.id, series);
    return map;
  }, [mentorData?.mainsSeries]);
  const mentorLearnerDirectory = useMemo(() => {
    const map = new Map<string, MentorLearnerDirectoryEntry>();
    for (const request of mentorData?.requests ?? []) {
      const existing = map.get(request.user_id);
      const nextName = learnerNameFromRequest(request);
      const nextEmail = learnerEmailFromRequest(request);
      map.set(request.user_id, {
        name: existing?.name || nextName,
        email: existing?.email || nextEmail,
      });
    }
    return map;
  }, [mentorData?.requests]);
  const mentorPendingLearnerCards = useMemo(
    () =>
      buildMentorLearnerRequestCards(
        mentorPendingRequests,
        mentorCycleByRequestId,
        mentorSeriesById,
        mentorLearnerDirectory,
      ),
    [mentorPendingRequests, mentorCycleByRequestId, mentorSeriesById, mentorLearnerDirectory],
  );
  const mentorPendingLearnerCount = mentorPendingLearnerCards.length;
  const mentorConsultationsToday = useMemo(
    () =>
      (mentorData?.sessions ?? []).filter(
        (session) => (session.status === "scheduled" || session.status === "live") && sameCalendarDay(session.starts_at),
      ).length,
    [mentorData?.sessions],
  );
  const mentorUpcomingSessionCards = useMemo(
    () =>
      (mentorData?.sessions ?? [])
        .filter((session) => session.status === "scheduled" || session.status === "live")
        .sort((left, right) => new Date(left.starts_at).getTime() - new Date(right.starts_at).getTime())
        .map((session) => {
          const request = mentorRequestById.get(session.request_id);
          const learner = mentorLearnerDirectory.get(session.user_id);
          const cycle = mentorCycleByRequestId.get(session.request_id);
          const series = request?.series_id ? mentorSeriesById.get(request.series_id) : null;
          const name = learner?.name || (request ? learnerNameFromRequest(request) : "Learner");
          const email = learner?.email || (request ? learnerEmailFromRequest(request) : "");
          return {
            session,
            name,
            email,
            initials: initialsFromLabel(name || email),
            seriesTitle: cycle?.series_title || series?.title || "Direct mentorship session",
            serviceLabel: request ? mentorshipServiceLabel(request.service_type) : "Mentorship Session",
            durationMinutes: sessionDurationMinutes(session),
          };
        })
        .slice(0, 4),
    [mentorData?.sessions, mentorRequestById, mentorLearnerDirectory, mentorCycleByRequestId, mentorSeriesById],
  );
  const mentorRecentSessionCards = useMemo(
    () =>
      (mentorData?.sessions ?? [])
        .filter((session) => session.status === "completed")
        .sort(
          (left, right) =>
            new Date(right.live_ended_at || right.ends_at || right.updated_at || right.created_at).getTime() -
            new Date(left.live_ended_at || left.ends_at || left.updated_at || left.created_at).getTime(),
        )
        .map((session) => {
          const request = mentorRequestById.get(session.request_id);
          const learner = mentorLearnerDirectory.get(session.user_id);
          const cycle = mentorCycleByRequestId.get(session.request_id);
          const series = request?.series_id ? mentorSeriesById.get(request.series_id) : null;
          const name = learner?.name || (request ? learnerNameFromRequest(request) : "Learner");
          const email = learner?.email || (request ? learnerEmailFromRequest(request) : "");
          return {
            session,
            name,
            email,
            initials: initialsFromLabel(name || email),
            seriesTitle: cycle?.series_title || series?.title || "Completed mentorship session",
            serviceLabel: request ? mentorshipServiceLabel(request.service_type) : "Mentorship Session",
            durationMinutes: sessionDurationMinutes(session),
          };
        })
        .slice(0, 4),
    [mentorData?.sessions, mentorRequestById, mentorLearnerDirectory, mentorCycleByRequestId, mentorSeriesById],
  );
  const mentorSessionCards =
    mentorUpcomingSessionCards.length > 0 ? mentorUpcomingSessionCards : mentorRecentSessionCards;
  const mentorSessionSectionTitle =
    mentorUpcomingSessionCards.length > 0 ? "Upcoming Consultations" : "Recent Sessions";
  const mentorEvaluationQueueCards = useMemo(
    () =>
      buildMentorLearnerRequestCards(
        (mentorData?.requests ?? []).filter(
          (request) =>
            Boolean(request.submission_id) &&
            request.payment_status === "paid" &&
            !request.feedback_ready_at &&
            request.status !== "completed",
        ),
        mentorCycleByRequestId,
        mentorSeriesById,
        mentorLearnerDirectory,
      ).slice(0, 4),
    [mentorData?.requests, mentorCycleByRequestId, mentorSeriesById, mentorLearnerDirectory],
  );
  const mentorRecentEvaluationCards = useMemo(
    () =>
      buildMentorLearnerRequestCards(
        (mentorData?.requests ?? [])
          .filter((request) => Boolean(request.submission_id) && Boolean(request.feedback_ready_at || request.updated_at))
          .sort(
            (left, right) =>
              new Date(right.feedback_ready_at || right.updated_at || right.requested_at).getTime() -
              new Date(left.feedback_ready_at || left.updated_at || left.requested_at).getTime(),
          ),
        mentorCycleByRequestId,
        mentorSeriesById,
        mentorLearnerDirectory,
      ).slice(0, 4),
    [mentorData?.requests, mentorCycleByRequestId, mentorSeriesById, mentorLearnerDirectory],
  );
  const mentorEvaluationCards =
    mentorEvaluationQueueCards.length > 0 ? mentorEvaluationQueueCards : mentorRecentEvaluationCards;
  const mentorEvaluationSectionTitle =
    mentorEvaluationQueueCards.length > 0 ? "Evaluation Queue" : "Recent Evaluations";
  const mentorFeaturedSeries = useMemo(
    () =>
      [...(mentorData?.mainsSeries ?? [])]
        .sort(
          (left, right) =>
            new Date(right.updated_at || right.created_at).getTime() -
            new Date(left.updated_at || left.created_at).getTime(),
        )
        .slice(0, 4),
    [mentorData?.mainsSeries],
  );
  const mentorActiveSeriesCount = useMemo(
    () => (mentorData?.mainsSeries ?? []).filter((series) => series.is_active).length,
    [mentorData?.mainsSeries],
  );

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

  useEffect(() => {
    if (kind !== "mains_mentor") return;
    const requestIds = (mentorData?.requests ?? []).map((request) => request.id);
    const filter = buildRealtimeRequestFilter(requestIds);
    if (!filter || !currentUserId) return;
    const supabase = createSupabaseClient();
    const channel = supabase
      .channel(`mentor-dashboard-requests-${requestIds.join("-")}`)
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "mentorship_messages", filter },
        (payload) => {
          const row = payload.new as { request_id?: number; sender_user_id?: string } | undefined;
          const requestId = Number(row?.request_id || 0);
          if (requestId <= 0 || row?.sender_user_id === currentUserId || row?.sender_user_id === "system") return;
          setMentorData((current) =>
            current
              ? {
                  ...current,
                  requests: current.requests.map((request) =>
                    request.id === requestId
                      ? {
                          ...request,
                          meta: {
                            ...(request.meta || {}),
                            viewer_unread_message_count: requestUnreadCount(request) + 1,
                            viewer_has_unread_messages: true,
                          },
                        }
                      : request,
                  ),
                }
              : current,
          );
        },
      )
      .subscribe();
    return () => {
      void supabase.removeChannel(channel);
    };
  }, [currentUserId, kind, mentorData?.requests]);

  const quizMasterSeries =
    quizMasterData?.series.filter((series) => String(series.series_kind || "").toLowerCase() !== "mains") ?? [];
  const quizMasterTestCount = quizMasterSeries.reduce((sum, series) => sum + Number(series.test_count || 0), 0);
  const quizMasterReviewSummary = quizMasterData?.profileDetail?.review_summary ?? null;
  const quizMasterIssueRows =
    quizMasterData?.tracking.user_rows.filter(
      (row) => row.technical_issue_count > 0 || row.delay_count > 0 || row.issues.length > 0,
    ) ?? [];

  const roleWorkspaceSidebar =
    kind === "quiz_master" ? (
      <RoleWorkspaceSidebar
        title="Quiz Master"
        subtitle="Prelims series control, quiz authoring, and provider profile management."
        sections={quizMasterWorkspaceSections}
      />
    ) : kind === "mains_mentor" ? (
      <RoleWorkspaceSidebar
        title="Mains Mentor"
        subtitle="Series delivery, AI mains tooling, mentorship desk, and provider profile management."
        sections={mainsMentorWorkspaceSections}
      />
    ) : null;

  return (
    <AppLayout>
      <div className={roleWorkspaceSidebar ? "space-y-6 lg:grid lg:grid-cols-[18rem_minmax(0,1fr)] lg:items-start lg:gap-6 lg:space-y-0" : ""}>
        {roleWorkspaceSidebar}
        <div className="min-w-0 space-y-8">
        <header className="space-y-2">
          <h1 className="text-3xl font-black tracking-tight text-[#141b2d] dark:text-white">{copy.title}</h1>
          <p className="text-[#636b86] dark:text-gray-300">{copy.subtitle}</p>
        </header>

        {loading ? (
          <div className="rounded-2xl border border-[#dce3fb] dark:border-[#1e2a4a] bg-white dark:bg-[#0b1120] p-8 text-[#636b86] dark:text-gray-300 flex items-center gap-3">
            <Loader2 className="h-5 w-5 animate-spin text-indigo-600" />
            Loading workspace...
          </div>
        ) : null}

        {!loading && !isAuthenticated ? (
          <div className="rounded-2xl border border-[#dce3fb] dark:border-[#1e2a4a] bg-white dark:bg-[#0b1120] p-8 space-y-4">
            <p className="text-[#334155] dark:text-gray-200">Login is required to view your performance evaluation and workspace.</p>
            <button type="button" onClick={showLoginModal} className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-semibold text-white">
              Login
            </button>
          </div>
        ) : null}

        {!loading && isAuthenticated && error && kind !== "learner" ? (
          <div className="rounded-2xl border border-rose-200 bg-rose-50 p-6 text-rose-700 flex items-start gap-3">
            <AlertCircle className="h-5 w-5 mt-0.5" />
            <p>{error}</p>
          </div>
        ) : null}

        {!loading && isAuthenticated && kind === "learner" ? (
          <LearnerPerformanceAudit />
        ) : null}

        {!loading && isAuthenticated && !error && kind === "mains_mentor" && mentorData ? (
          <>
            <section className="overflow-hidden rounded-[30px] border border-[#d8def4] bg-[radial-gradient(circle_at_top_left,_rgba(226,232,255,0.95),_rgba(255,255,255,1)_45%,_rgba(239,246,255,0.95)_100%)] p-6 shadow-sm">
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div className="max-w-3xl space-y-3">
                  <p className="text-xs font-black uppercase tracking-[0.32em] text-[#1d3b8b]">Mains Mentor Workspace</p>
                  <h2 className="text-3xl font-black tracking-tight text-[#091a4a]">Mains Mentor Workspace</h2>
                  <p className="text-sm text-[#636b86] dark:text-gray-300">Track pending reviews, learner requests, and today’s consultations from one clean workspace.</p>
                </div>
                <div className="flex flex-wrap gap-2">
                  <Link href="/programs/create" className="inline-flex items-center rounded-full bg-[#091a4a] px-4 py-2 text-xs font-semibold text-white shadow-sm shadow-[#091a4a]/20">
                    Create Mains Series
                  </Link>
                  <Link href="/mains-mentor/ai-mains" className="inline-flex items-center rounded-full border border-indigo-300 bg-indigo-50 px-4 py-2 text-xs font-semibold text-indigo-700">
                    AI Mains Parse + Create
                  </Link>
                  <Link href="/mentorship/manage" className="inline-flex items-center rounded-full border border-slate-300 bg-white dark:bg-[#0b1120] px-4 py-2 text-xs font-semibold text-[#334155] dark:text-gray-200">
                    Open Mentorship Desk
                  </Link>
                  <Link href="/profile/professional" className="inline-flex items-center rounded-full border border-slate-300 bg-white dark:bg-[#0b1120] px-4 py-2 text-xs font-semibold text-[#334155] dark:text-gray-200">
                    Professional Profile
                  </Link>
                </div>
              </div>

              <div className="mt-6 grid gap-4 xl:grid-cols-[1.15fr_0.85fr]">
                <article className="rounded-[28px] bg-[#0b1c5a] p-6 text-white shadow-lg shadow-[#0b1c5a]/15">
                  <div className="flex items-start justify-between gap-4">
                    <div>
                      <p className="text-xs font-semibold uppercase tracking-[0.28em] text-slate-300">Evaluations Pending</p>
                      <p className="mt-3 text-5xl font-black tracking-tight">{mentorEvaluationQueue}</p>
                    </div>
                    <div className="rounded-[22px] bg-white dark:bg-[#0b1120]/10 p-4 text-white">
                      <ClipboardCheck className="h-8 w-8" />
                    </div>
                  </div>
                  <div className="mt-6 grid gap-3 sm:grid-cols-3">
                    <div className="rounded-2xl border border-white/10 bg-white dark:bg-[#0b1120]/5 p-3">
                      <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-slate-300">Upcoming Sessions</p>
                      <p className="mt-2 text-2xl font-black">{mentorUpcomingSessions}</p>
                    </div>
                    <div className="rounded-2xl border border-white/10 bg-white dark:bg-[#0b1120]/5 p-3">
                      <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-slate-300">Completed Sessions</p>
                      <p className="mt-2 text-2xl font-black">{mentorCompletedSessions}</p>
                    </div>
                    <div className="rounded-2xl border border-white/10 bg-white dark:bg-[#0b1120]/5 p-3">
                      <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-slate-300">Delayed Items</p>
                      <p className="mt-2 text-2xl font-black">{mentorDelayed}</p>
                    </div>
                  </div>
                </article>

                <div className="grid gap-4 sm:grid-cols-2">
                  <article className="rounded-[24px] border border-sky-200 bg-sky-100/70 p-5">
                    <div className="flex items-center justify-between gap-3">
                      <div className="rounded-2xl bg-white dark:bg-[#0b1120]/70 p-3 text-sky-700">
                        <MessagesSquare className="h-6 w-6" />
                      </div>
                      <p className="text-4xl font-black tracking-tight text-[#091a4a]">{mentorPendingLearnerCount}</p>
                    </div>
                    <p className="mt-4 text-xs font-semibold uppercase tracking-[0.22em] text-sky-900">Learners Awaiting Review</p>
                  </article>

                  <article className="rounded-[24px] border border-[#dce3fb] dark:border-[#1e2a4a] bg-white dark:bg-[#0b1120] p-5">
                    <div className="flex items-center justify-between gap-3">
                      <div className="rounded-2xl bg-[#eef4ff] dark:bg-[#16213e] p-3 text-[#091a4a]">
                        <CalendarDays className="h-6 w-6" />
                      </div>
                      <p className="text-4xl font-black tracking-tight text-[#091a4a]">{mentorConsultationsToday}</p>
                    </div>
                    <p className="mt-4 text-xs font-semibold uppercase tracking-[0.22em] text-[#6c7590] dark:text-[#94a3b8]">Consultations Today</p>
                  </article>

                  <article className="rounded-[24px] border border-[#dce3fb] dark:border-[#1e2a4a] bg-white dark:bg-[#0b1120] p-5">
                    <div className="flex items-center justify-between gap-3">
                      <div className="rounded-2xl bg-[#eef4ff] dark:bg-[#16213e] p-3 text-[#091a4a]">
                        <Users className="h-6 w-6" />
                      </div>
                      <p className="text-4xl font-black tracking-tight text-[#091a4a]">{mentorAwaitingPayment}</p>
                    </div>
                    <p className="mt-4 text-xs font-semibold uppercase tracking-[0.22em] text-[#6c7590] dark:text-[#94a3b8]">Awaiting Payment</p>
                  </article>

                  <article className="rounded-[24px] border border-[#dce3fb] dark:border-[#1e2a4a] bg-white dark:bg-[#0b1120] p-5">
                    <div className="flex items-center justify-between gap-3">
                      <div className="rounded-2xl bg-[#eef4ff] dark:bg-[#16213e] p-3 text-[#091a4a]">
                        <BookOpenText className="h-6 w-6" />
                      </div>
                      <p className="text-4xl font-black tracking-tight text-[#091a4a]">{mentorActiveSeriesCount}</p>
                    </div>
                    <p className="mt-4 text-xs font-semibold uppercase tracking-[0.22em] text-[#6c7590] dark:text-[#94a3b8]">Active Mains Programs</p>
                  </article>
                </div>
              </div>
            </section>

            <section className="rounded-[28px] border border-[#dce3fb] dark:border-[#1e2a4a] bg-white dark:bg-[#0b1120] p-6 shadow-sm">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <h2 className="text-2xl font-black tracking-tight text-[#141b2d] dark:text-white">Mentorship Requests Snapshot</h2>
                  <p className="mt-1 text-sm text-[#6c7590] dark:text-[#94a3b8]">Open the latest learner cards here, then jump into the full desk for chat, payment, and scheduling.</p>
                </div>
                <Link href="/mentorship/manage" className="inline-flex items-center rounded-full bg-[#091a4a] px-4 py-2 text-xs font-semibold text-white">
                  Open Mentor Desk
                  <ArrowRight className="ml-1.5 h-3.5 w-3.5" />
                </Link>
              </div>
              <div className="mt-5 space-y-4">
                {mentorPendingLearnerCards.slice(0, 4).map((card) => (
                  <article key={`mentor-pending-${card.userId}`} className="rounded-[24px] border border-[#dce3fb] dark:border-[#1e2a4a] bg-[#f8faff] dark:bg-[#0f172a]/80 p-4">
                    <div className="flex items-start gap-4">
                      <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-sky-100 text-sm font-black text-[#091a4a]">
                        {card.initials}
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-start justify-between gap-3">
                          <div className="min-w-0">
                            <p className="truncate text-lg font-black tracking-tight text-[#141b2d] dark:text-white">{card.name}</p>
                            <p className="truncate text-sm text-[#6c7590] dark:text-[#94a3b8]">{card.email || "Mentorship request in queue"}</p>
                          </div>
                          <div className="flex flex-wrap gap-2">
                            {card.unreadCount > 0 ? (
                              <span className="rounded-full border border-emerald-300 bg-emerald-50 px-2.5 py-1 text-[11px] font-semibold text-emerald-800">
                                {card.unreadCount === 1 ? "1 new reply" : `${card.unreadCount} new replies`}
                              </span>
                            ) : null}
                            <span className={`rounded-full border px-2.5 py-1 text-[11px] font-semibold ${requestStatusBadgeClass(card.latestRequest.status)}`}>
                              {titleCaseLabel(card.latestRequest.status)}
                            </span>
                            <span className={`rounded-full border px-2.5 py-1 text-[11px] font-semibold ${paymentStatusBadgeClass(card.latestRequest.payment_status)}`}>
                              {titleCaseLabel(card.latestRequest.payment_status)}
                            </span>
                          </div>
                        </div>

                        <div className="mt-4 grid gap-3 sm:grid-cols-2">
                          <div className="rounded-2xl border border-[#dce3fb] dark:border-[#1e2a4a] bg-white dark:bg-[#0b1120] p-3">
                            <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-slate-400 dark:text-slate-500">Program Context</p>
                            <p className="mt-1 font-semibold text-[#141b2d] dark:text-gray-100">{card.seriesTitle}</p>
                            {card.testTitle ? <p className="mt-1 text-xs text-[#6c7590] dark:text-[#94a3b8]">{card.testTitle}</p> : null}
                          </div>
                          <div className="rounded-2xl border border-[#dce3fb] dark:border-[#1e2a4a] bg-white dark:bg-[#0b1120] p-3">
                            <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-slate-400 dark:text-slate-500">Request Focus</p>
                            <p className="mt-1 font-semibold text-[#141b2d] dark:text-gray-100">{card.serviceLabel}</p>
                            <p className="mt-1 text-xs text-[#6c7590] dark:text-[#94a3b8]">
                              Preferred mode: {titleCaseLabel(card.latestRequest.preferred_mode)}
                              {card.requestCount > 1 ? ` | ${card.requestCount} open requests` : ""}
                            </p>
                          </div>
                        </div>

                        <p className="mt-4 text-sm leading-6 text-[#636b86] dark:text-gray-300">{card.note}</p>

                        <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
                          <p className="text-xs text-[#6c7590] dark:text-[#94a3b8]">Submitted {formatDateTime(card.latestRequest.requested_at)}</p>
                          <Link href="/mentorship/manage" className="inline-flex items-center rounded-full border border-slate-300 bg-white dark:bg-[#0b1120] px-3.5 py-1.5 text-xs font-semibold text-[#334155] dark:text-gray-200">
                            Review in Desk
                          </Link>
                        </div>
                      </div>
                    </div>
                  </article>
                ))}
                {mentorPendingLearnerCards.length === 0 ? (
                  <p className="rounded-2xl border border-dashed border-slate-300 bg-[#f8faff] dark:bg-[#0f172a] px-4 py-6 text-sm text-[#6c7590] dark:text-[#94a3b8]">
                    No new learners are waiting for mentorship review right now.
                  </p>
                ) : null}
              </div>
            </section>

            <section className="rounded-[28px] border border-[#dce3fb] dark:border-[#1e2a4a] bg-white dark:bg-[#0b1120] p-6 shadow-sm">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <h2 className="text-2xl font-black tracking-tight text-[#141b2d] dark:text-white">{mentorSessionSectionTitle}</h2>
                  <p className="mt-1 text-sm text-[#6c7590] dark:text-[#94a3b8]">Keep the next live or scheduled consultations visible without opening the full calendar.</p>
                </div>
                <Link href="/mentorship/manage" className="inline-flex items-center rounded-full border border-slate-300 bg-white dark:bg-[#0b1120] px-4 py-2 text-xs font-semibold text-[#334155] dark:text-gray-200">
                  Open Schedule
                </Link>
              </div>
              <div className="mt-5 space-y-4">
                {mentorSessionCards.map((card) => (
                  <article key={`mentor-session-${card.session.id}`} className="rounded-[24px] border border-[#dce3fb] dark:border-[#1e2a4a] bg-[#f8faff] dark:bg-[#0f172a]/80 p-4">
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex items-center gap-3">
                        <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-[#dff7ff] text-sm font-black text-[#086f8c]">
                          {card.initials}
                        </div>
                        <div className="min-w-0">
                          <p className="truncate text-lg font-black tracking-tight text-[#141b2d] dark:text-white">{card.name}</p>
                          <p className="truncate text-sm text-[#6c7590] dark:text-[#94a3b8]">{card.seriesTitle}</p>
                        </div>
                      </div>
                      <span className={`rounded-full border px-2.5 py-1 text-[11px] font-semibold ${requestStatusBadgeClass(card.session.status)}`}>
                        {titleCaseLabel(card.session.status)}
                      </span>
                    </div>

                    <div className="mt-4 flex flex-wrap gap-3 text-sm text-[#636b86] dark:text-gray-300">
                      <span className="inline-flex items-center gap-1.5 rounded-full border border-[#dce3fb] dark:border-[#1e2a4a] bg-white dark:bg-[#0b1120] px-3 py-1.5">
                        <CalendarDays className="h-4 w-4 text-[#6c7590] dark:text-[#94a3b8]" />
                        {formatDateTime(card.session.starts_at)}
                      </span>
                      {card.durationMinutes ? (
                        <span className="inline-flex items-center gap-1.5 rounded-full border border-[#dce3fb] dark:border-[#1e2a4a] bg-white dark:bg-[#0b1120] px-3 py-1.5">
                          <Clock3 className="h-4 w-4 text-[#6c7590] dark:text-[#94a3b8]" />
                          {card.durationMinutes} mins
                        </span>
                      ) : null}
                      <span className="inline-flex items-center gap-1.5 rounded-full border border-[#dce3fb] dark:border-[#1e2a4a] bg-white dark:bg-[#0b1120] px-3 py-1.5">
                        <MessagesSquare className="h-4 w-4 text-[#6c7590] dark:text-[#94a3b8]" />
                        {card.serviceLabel}
                      </span>
                    </div>

                    <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
                      <p className="text-xs text-[#6c7590] dark:text-[#94a3b8]">{card.email || "Mentorship session ready"}</p>
                      <Link href={`/mentorship/session/${card.session.id}?autojoin=1`} className="inline-flex items-center rounded-full border border-slate-300 bg-white dark:bg-[#0b1120] px-3.5 py-1.5 text-xs font-semibold text-[#334155] dark:text-gray-200">
                        {card.session.status === "live" ? "Join Call" : "Open Call"}
                      </Link>
                    </div>
                  </article>
                ))}
                {mentorSessionCards.length === 0 ? (
                  <p className="rounded-2xl border border-dashed border-slate-300 bg-[#f8faff] dark:bg-[#0f172a] px-4 py-6 text-sm text-[#6c7590] dark:text-[#94a3b8]">
                    No consultations have been scheduled yet.
                  </p>
                ) : null}
              </div>
            </section>

            <section className="rounded-[28px] border border-[#dce3fb] dark:border-[#1e2a4a] bg-white dark:bg-[#0b1120] p-6 shadow-sm">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div><h2 className="text-2xl font-black tracking-tight text-[#141b2d] dark:text-white">{mentorEvaluationSectionTitle}</h2></div>
                <Link href="/mentorship/manage" className="inline-flex items-center rounded-full border border-slate-300 bg-white dark:bg-[#0b1120] px-4 py-2 text-xs font-semibold text-[#334155] dark:text-gray-200">
                  Open Evaluation Desk
                </Link>
              </div>
              <div className="mt-5 space-y-4">
                {mentorEvaluationCards.map((card) => (
                  <article key={`mentor-eval-${card.userId}-${card.latestRequest.id}`} className="rounded-[24px] border border-[#dce3fb] dark:border-[#1e2a4a] bg-[#f8faff] dark:bg-[#0f172a]/80 p-4">
                    <div className="flex items-start gap-4">
                      <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-[#eef2ff] text-[#091a4a]">
                        <FileText className="h-5 w-5" />
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-start justify-between gap-3">
                          <div className="min-w-0">
                            <p className="truncate text-lg font-black tracking-tight text-[#141b2d] dark:text-white">{card.name}</p>
                            <p className="truncate text-sm text-[#6c7590] dark:text-[#94a3b8]">{card.email || card.seriesTitle}</p>
                          </div>
                          <span className={`rounded-full border px-2.5 py-1 text-[11px] font-semibold ${card.latestRequest.feedback_ready_at ? "border-emerald-300 bg-emerald-50 text-emerald-800" : "border-amber-300 bg-amber-50 text-amber-800"}`}>
                            {card.latestRequest.feedback_ready_at ? "Feedback Ready" : "Needs Review"}
                          </span>
                        </div>

                        <div className="mt-4 rounded-2xl border border-[#dce3fb] dark:border-[#1e2a4a] bg-white dark:bg-[#0b1120] p-3">
                          <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-slate-400 dark:text-slate-500">Evaluation Context</p>
                          <p className="mt-1 font-semibold text-[#141b2d] dark:text-gray-100">{card.seriesTitle}</p>
                          <p className="mt-1 text-xs text-[#6c7590] dark:text-[#94a3b8]">{card.testTitle || card.serviceLabel}</p>
                        </div>

                        <p className="mt-4 text-sm leading-6 text-[#636b86] dark:text-gray-300">{card.note}</p>

                        <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
                          <p className="text-xs text-[#6c7590] dark:text-[#94a3b8]">
                            {card.latestRequest.feedback_ready_at ? "Updated" : "Submitted"} {formatDateTime(card.latestRequest.feedback_ready_at || card.latestRequest.updated_at || card.latestRequest.requested_at)}
                          </p>
                          <Link href="/mentorship/manage" className="inline-flex items-center rounded-full border border-slate-300 bg-white dark:bg-[#0b1120] px-3.5 py-1.5 text-xs font-semibold text-[#334155] dark:text-gray-200">
                            Review Work
                          </Link>
                        </div>
                      </div>
                    </div>
                  </article>
                ))}
                {mentorEvaluationCards.length === 0 ? (
                  <p className="rounded-2xl border border-dashed border-slate-300 bg-[#f8faff] dark:bg-[#0f172a] px-4 py-6 text-sm text-[#6c7590] dark:text-[#94a3b8]">
                    No evaluation work is pending right now.
                  </p>
                ) : null}
              </div>
            </section>

            <section className="rounded-[28px] border border-[#dce3fb] dark:border-[#1e2a4a] bg-white dark:bg-[#0b1120] p-6 shadow-sm">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div><h2 className="text-2xl font-black tracking-tight text-[#141b2d] dark:text-white">Mains Program Workspace</h2></div>
                <Link href="/programs" className="inline-flex items-center rounded-full bg-[#091a4a] px-4 py-2 text-xs font-semibold text-white">
                  Manage Programs
                  <ArrowRight className="ml-1.5 h-3.5 w-3.5" />
                </Link>
              </div>
              <div className="mt-5 grid gap-4 md:grid-cols-2">
                {mentorFeaturedSeries.map((series) => (
                  <article key={series.id} className="overflow-hidden rounded-[24px] border border-[#dce3fb] dark:border-[#1e2a4a] bg-white dark:bg-[#0b1120]">
                    <div
                      className={`relative h-44 ${series.cover_image_url ? "bg-cover bg-center" : "bg-[linear-gradient(135deg,#091a4a_0%,#18378d_55%,#8be1f0_100%)]"}`}
                      style={series.cover_image_url ? { backgroundImage: `linear-gradient(180deg, rgba(9,26,74,0.05), rgba(9,26,74,0.82)), url(${series.cover_image_url})` } : undefined}
                    >
                      {!series.cover_image_url ? (
                        <div className="absolute inset-0 flex items-end justify-between p-4 text-white">
                          <div className="rounded-2xl bg-white dark:bg-[#0b1120]/10 px-3 py-2 text-xs font-semibold uppercase tracking-[0.22em]">
                            {formatSeriesKindLabel(series.series_kind)}
                          </div>
                          <FileText className="h-7 w-7 text-white/80" />
                        </div>
                      ) : null}
                      <div className="absolute inset-x-0 bottom-0 p-4 text-white">
                        <div className="flex flex-wrap items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.2em]">
                          <span className="rounded-full bg-white dark:bg-[#0b1120]/15 px-2.5 py-1">{titleCaseLabel(series.access_type)}</span>
                          <span className="rounded-full bg-white dark:bg-[#0b1120]/15 px-2.5 py-1">{series.is_public ? "Public" : "Private"}</span>
                          <span className="rounded-full bg-white dark:bg-[#0b1120]/15 px-2.5 py-1">{series.is_active ? "Active" : "Archived"}</span>
                        </div>
                        <h3 className="mt-3 text-2xl font-black tracking-tight">{series.title}</h3>
                      </div>
                    </div>
                    <div className="p-5">
                      <p className="text-sm leading-6 text-[#636b86] dark:text-gray-300">
                        {plainTextExcerpt(series.description, "No description added.")}
                      </p>
                      <div className="mt-4 flex flex-wrap gap-2">
                        <span className="rounded-full border border-[#dce3fb] dark:border-[#1e2a4a] bg-[#f8faff] dark:bg-[#0f172a] px-3 py-1 text-xs font-semibold text-[#636b86] dark:text-gray-300">
                          {series.test_count} tests
                        </span>
                        <span className="rounded-full border border-[#dce3fb] dark:border-[#1e2a4a] bg-[#f8faff] dark:bg-[#0f172a] px-3 py-1 text-xs font-semibold text-[#636b86] dark:text-gray-300">
                          Updated {formatDateTime(series.updated_at || series.created_at)}
                        </span>
                      </div>
                      <div className="mt-5 flex flex-wrap gap-2">
                        <Link href={`/programs/${series.id}/manage`} className="inline-flex items-center rounded-full bg-[#091a4a] px-4 py-2 text-xs font-semibold text-white">
                          Manage
                        </Link>
                        <Link href={`/programs/${series.id}`} className="inline-flex items-center rounded-full border border-slate-300 bg-white dark:bg-[#0b1120] px-4 py-2 text-xs font-semibold text-[#334155] dark:text-gray-200">
                          Open Series
                        </Link>
                      </div>
                    </div>
                  </article>
                ))}
                {mentorFeaturedSeries.length === 0 ? (
                  <p className="col-span-full rounded-2xl border border-dashed border-slate-300 bg-[#f8faff] dark:bg-[#0f172a] px-4 py-6 text-sm text-[#6c7590] dark:text-[#94a3b8]">
                    No mains series created yet. Create your first program to populate this workspace preview.
                  </p>
                ) : null}
              </div>
            </section>
          </>
        ) : null}

        {!loading && isAuthenticated && !error && kind === "quiz_master" && quizMasterData ? (
          <>
            <section className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-5">
              <StatCard label="Prelims Series" value={quizMasterSeries.length} />
              <StatCard label="Prelims Tests" value={quizMasterTestCount} />
              <StatCard label="Active Enrollments" value={quizMasterData.summary.active_enrollments} />
              <StatCard label="Reviews" value={quizMasterReviewSummary?.total_reviews ?? 0} />
              <StatCard
                label="Avg Rating"
                value={quizMasterReviewSummary ? quizMasterReviewSummary.average_rating.toFixed(1) : "0.0"}
              />
            </section>

            <section className="rounded-2xl border border-[#dce3fb] dark:border-[#1e2a4a] bg-white dark:bg-[#0b1120] p-6">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h2 className="text-lg font-bold text-[#141b2d] dark:text-white">Quiz Master Actions</h2>
                <div className="flex flex-wrap gap-2">
                  <Link href="/programs/create" className="inline-flex items-center rounded-md bg-slate-900 px-3 py-1.5 text-xs font-semibold text-white">
                    Create Prelims Series
                  </Link>
                  <Link href="/quiz-master/ai-quiz/gk" className="inline-flex items-center rounded-md border border-indigo-300 bg-indigo-50 px-3 py-1.5 text-xs font-semibold text-indigo-700">
                    AI Quiz Parser + Creator
                  </Link>
                  <Link href="/quiz-master/complaints" className="inline-flex items-center rounded-md border border-amber-300 bg-amber-50 px-3 py-1.5 text-xs font-semibold text-amber-800">
                    Question Complaints
                  </Link>
                  <Link href="/programs/prelims" className="inline-flex items-center rounded-md border border-slate-300 bg-white dark:bg-[#0b1120] px-3 py-1.5 text-xs font-semibold text-[#334155] dark:text-gray-200">
                    Browse Prelims
                  </Link>
                  <Link href="/profile/professional" className="inline-flex items-center rounded-md border border-slate-300 bg-white dark:bg-[#0b1120] px-3 py-1.5 text-xs font-semibold text-[#334155] dark:text-gray-200">
                    Professional Profile
                  </Link>
                  {currentUserId ? (
                    <Link href={`/profiles/${currentUserId}`} className="inline-flex items-center rounded-md border border-slate-300 bg-white dark:bg-[#0b1120] px-3 py-1.5 text-xs font-semibold text-[#334155] dark:text-gray-200">
                      Public Profile + Reviews
                    </Link>
                  ) : null}
                </div>
              </div>
            </section>

            <section className="rounded-2xl border border-[#dce3fb] dark:border-[#1e2a4a] bg-white dark:bg-[#0b1120] p-6">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h2 className="text-lg font-bold text-[#141b2d] dark:text-white">Created Prelims Series + Enrollments</h2>
                <Link href="/programs" className="inline-flex items-center rounded-md border border-slate-300 bg-white dark:bg-[#0b1120] px-3 py-1.5 text-xs font-semibold text-[#334155] dark:text-gray-200">Manage Programs</Link>
              </div>
              <div className="mt-3 space-y-2">
                {quizMasterData.seriesInsights.slice(0, 12).map((insight) => (
                  <article key={insight.series.id} className="rounded-lg border border-[#dce3fb] dark:border-[#1e2a4a] bg-[#f8faff] dark:bg-[#0f172a] px-3 py-2 text-sm">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <p className="font-semibold text-[#141b2d] dark:text-gray-100">{insight.series.title}</p>
                      <span className="text-xs text-[#6c7590] dark:text-[#94a3b8]">{insight.series.test_count} tests</span>
                    </div>
                    <p className="text-xs text-[#636b86] dark:text-gray-300">
                      {insight.series.series_kind} | {insight.series.access_type} | {insight.series.is_public ? "public" : "private"} | {insight.series.is_active ? "active" : "archived"}
                    </p>
                    <p className="mt-1 text-xs text-[#636b86] dark:text-gray-300">
                      Enrollments: {insight.totalEnrollments} total | {insight.activeEnrollments} active
                    </p>
                    <div className="mt-2 flex flex-wrap gap-2">
                      <Link href={`/programs/${insight.series.id}/manage`} className="inline-flex items-center rounded border border-slate-300 bg-white dark:bg-[#0b1120] px-2.5 py-1 text-xs font-semibold text-[#334155] dark:text-gray-200">Manage</Link>
                      <Link href={`/programs/${insight.series.id}`} className="inline-flex items-center rounded border border-slate-300 bg-white dark:bg-[#0b1120] px-2.5 py-1 text-xs font-semibold text-[#334155] dark:text-gray-200">Open</Link>
                    </div>
                  </article>
                ))}
                {quizMasterData.seriesInsights.length === 0 ? <p className="text-sm text-[#6c7590] dark:text-[#94a3b8]">No prelims series created yet.</p> : null}
              </div>
            </section>

            <section className="rounded-2xl border border-[#dce3fb] dark:border-[#1e2a4a] bg-white dark:bg-[#0b1120] p-6">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h2 className="text-lg font-bold text-[#141b2d] dark:text-white">Issues Raised By Enrolled Students</h2>
                <Link href="/programs" className="inline-flex items-center rounded-md border border-slate-300 bg-white dark:bg-[#0b1120] px-3 py-1.5 text-xs font-semibold text-[#334155] dark:text-gray-200">
                  Open Series Workspace
                </Link>
              </div>
              <div className="mt-3 space-y-2">
                {quizMasterIssueRows.slice(0, 14).map((row) => (
                  <article key={row.user_id} className="rounded-lg border border-[#dce3fb] dark:border-[#1e2a4a] bg-[#f8faff] dark:bg-[#0f172a] px-3 py-2 text-sm">
                    <p className="font-semibold text-[#141b2d] dark:text-gray-100">
                      User {row.user_id} | Enrollments {row.enrolled_series_count} | Attempts {row.attempted_tests}
                    </p>
                    <p className="text-xs text-[#636b86] dark:text-gray-300">
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
                {quizMasterIssueRows.length === 0 ? <p className="text-sm text-[#6c7590] dark:text-[#94a3b8]">No student issues raised yet.</p> : null}
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

            <section className="rounded-2xl border border-[#dce3fb] dark:border-[#1e2a4a] bg-white dark:bg-[#0b1120] p-6">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h2 className="text-lg font-bold text-[#141b2d] dark:text-white">User Lifecycle Tracking</h2>
                <Link href="/programs" className="inline-flex items-center rounded-md border border-slate-300 bg-white dark:bg-[#0b1120] px-3 py-1.5 text-xs font-semibold text-[#334155] dark:text-gray-200">Open Programs Console</Link>
              </div>
              <div className="mt-3 space-y-2">
                {moderatorData.tracking.user_rows.slice(0, 14).map((row) => (
                  <article key={row.user_id} className="rounded-lg border border-[#dce3fb] dark:border-[#1e2a4a] bg-[#f8faff] dark:bg-[#0f172a] px-3 py-2 text-sm">
                    <p className="font-semibold text-[#141b2d] dark:text-gray-100">
                      {row.user_id} | Enrollment {row.enrolled_series_count} | Attempts {row.attempted_tests} | Copy {row.copy_checked}/{row.copy_submissions} | Mentorship {row.mentorship_completed}/{row.mentorship_requests}
                    </p>
                    <p className="text-xs text-[#636b86] dark:text-gray-300">
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
                {moderatorData.tracking.user_rows.length === 0 ? <p className="text-sm text-[#6c7590] dark:text-[#94a3b8]">No lifecycle rows yet.</p> : null}
              </div>
            </section>

            <section className="rounded-2xl border border-[#dce3fb] dark:border-[#1e2a4a] bg-white dark:bg-[#0b1120] p-6">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h2 className="text-lg font-bold text-[#141b2d] dark:text-white">Mentorship Full-Cycle Tracking</h2>
                <Link href="/mentorship/manage" className="inline-flex items-center rounded-md bg-slate-900 px-3 py-1.5 text-xs font-semibold text-white">Open Mentorship Queue</Link>
              </div>
              <div className="mt-3 space-y-2">
                {moderatorData.tracking.mentorship_cycles.slice(0, 14).map((cycle) => (
                  <article key={cycle.request_id} className="rounded-lg border border-[#dce3fb] dark:border-[#1e2a4a] bg-[#f8faff] dark:bg-[#0f172a] px-3 py-2 text-sm">
                    <p className="font-semibold text-[#141b2d] dark:text-gray-100">
                      Request #{cycle.request_id} | {cycle.user_id} -&gt; {cycle.provider_user_id} | {cycle.request_status}
                    </p>
                    <p className="text-xs text-[#636b86] dark:text-gray-300">
                      Series: {cycle.series_title || cycle.series_id || "n/a"} | Test: {cycle.test_title || cycle.test_collection_id || "n/a"}
                    </p>
                    <p className="text-xs text-[#636b86] dark:text-gray-300">
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
                {moderatorData.tracking.mentorship_cycles.length === 0 ? <p className="text-sm text-[#6c7590] dark:text-[#94a3b8]">No mentorship cycles yet.</p> : null}
              </div>
            </section>

            <section className="rounded-2xl border border-[#dce3fb] dark:border-[#1e2a4a] bg-white dark:bg-[#0b1120] p-6">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h2 className="text-lg font-bold text-[#141b2d] dark:text-white inline-flex items-center gap-2">
                  <ShieldCheck className="h-5 w-5" />
                  Pending Onboarding Queue
                </h2>
                <div className="flex gap-2">
                  <Link href="/onboarding/review" className="inline-flex items-center rounded-md bg-slate-900 px-3 py-1.5 text-xs font-semibold text-white">Open Queue</Link>
                  <Link href="/admin/user-roles" className="inline-flex items-center rounded-md border border-slate-300 bg-white dark:bg-[#0b1120] px-3 py-1.5 text-xs font-semibold text-[#334155] dark:text-gray-200">User Roles</Link>
                </div>
              </div>
              <div className="mt-3 space-y-2">
                {moderatorData.pendingOnboarding.slice(0, 10).map((row) => (
                  <article key={row.id} className="rounded-lg border border-[#dce3fb] dark:border-[#1e2a4a] bg-[#f8faff] dark:bg-[#0f172a] px-3 py-2 text-sm">
                    <p className="font-semibold text-[#141b2d] dark:text-gray-100">Request #{row.id} | {row.desired_role} | {row.full_name}</p>
                    <p className="text-xs text-[#636b86] dark:text-gray-300">{row.city || "City n/a"} | Experience: {row.years_experience ?? "n/a"}</p>
                  </article>
                ))}
                {moderatorData.pendingOnboarding.length === 0 ? <p className="text-sm text-[#6c7590] dark:text-[#94a3b8]">No pending onboarding requests.</p> : null}
              </div>
            </section>
          </>
        ) : null}
        </div>
      </div>
    </AppLayout>
  );
}
