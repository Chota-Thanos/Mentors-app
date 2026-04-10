"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import {
  AlertCircle,
  ArrowRight,
  BookOpen,
  Calculator,
  CheckCircle2,
  BriefcaseBusiness,
  ClipboardCheck,
  FileCheck2,
  GraduationCap,
  Layers3,
  LucideIcon,
  MessageSquareMore,
  ScrollText,
  ShieldCheck,
  Sparkles,
  WandSparkles,
} from "lucide-react";
import axios from "axios";

import AppLayout from "@/components/layouts/AppLayout";
import { FeaturedMixedRail } from "@/components/home/FeaturedContentRail";
import PublicLandingPage from "@/components/home/PublicLandingPage";
import { useAuth } from "@/context/AuthContext";
import { useExamContext } from "@/context/ExamContext";
import {
  isAdminLike,
  isMainsMentorLike,
  isModeratorLike,
  isQuizMasterLike,
} from "@/lib/accessControl";
import { premiumApi } from "@/lib/premiumApi";
import { loadLearnerMentorshipOrders, type LearnerMentorshipOrdersData } from "@/lib/learnerMentorshipOrders";
import type {
  DashboardAnalyticsPayload,
  DashboardRecommendationPlug,
  MentorshipRequest,
  PremiumCollection,
  TestSeries,
  YearlyAttemptSummaryPayload,
} from "@/types/premium";

type HomeKind = "learner" | "quiz_master" | "mains_mentor" | "operations";

type HomeAction = {
  href: string;
  label: string;
  description: string;
  accent: string;
  icon: LucideIcon;
  tag: string;
};

type CreatorSnapshot = {
  series: TestSeries[];
  requests: MentorshipRequest[];
  activeEnrollments: number;
};

interface UserQuizAttemptRow {
  id: number;
  collection_id: number;
  score: number;
  total_questions: number;
  correct_answers: number;
  incorrect_answers: number;
  unanswered: number;
  created_at: string;
}

interface UserMainsEvaluationRow {
  id: number;
  question_text?: string | null;
  score?: number | null;
  max_score?: number | null;
  created_at: string;
}

interface UserProgressPayload {
  quiz_attempts: UserQuizAttemptRow[];
  mains_evaluations: UserMainsEvaluationRow[];
}

interface AttemptWithContext {
  attempt: UserQuizAttemptRow;
  collection: PremiumCollection | null;
  seriesId: number;
}

const homeCopy: Record<HomeKind, { badge: string; title: string; subtitle: string; primaryHref: string; primaryLabel: string; secondaryHref: string; secondaryLabel: string }> = {
  learner: {
    badge: "Learner Workspace",
    title: "Everything important for your prep, in one place.",
    subtitle: "Open evaluation, programs, AI practice, and mentor support without digging through menus.",
    primaryHref: "/dashboard",
    primaryLabel: "Open Performance Evaluation",
    secondaryHref: "/programs/prelims",
    secondaryLabel: "Browse Programs",
  },
  quiz_master: {
    badge: "Quiz Master Workspace",
    title: "Creation, material management, and reporting from one desk.",
    subtitle: "Move quickly between creator tools, published material, and learner issue handling.",
    primaryHref: "/programs",
    primaryLabel: "Open Programs Console",
    secondaryHref: "/programs/create",
    secondaryLabel: "Create Program",
  },
  mains_mentor: {
    badge: "Mains Mentor Workspace",
    title: "Evaluation, mentorship, and delivery in one focused workspace.",
    subtitle: "Jump into mains evaluation, mentorship handling, repositories, and active programs.",
    primaryHref: "/dashboard",
    primaryLabel: "Open Mentor Dashboard",
    secondaryHref: "/mentorship/manage",
    secondaryLabel: "Open Mentorship Desk",
  },
  operations: {
    badge: "Operations Workspace",
    title: "Platform supervision and workflow control from one layer.",
    subtitle: "Jump into moderation queues, approvals, admin workspace, and operational program flows.",
    primaryHref: "/dashboard",
    primaryLabel: "Open Operations Dashboard",
    secondaryHref: "/onboarding/review",
    secondaryLabel: "Open Onboarding Queue",
  },
};

const quickActionsByKind: Record<HomeKind, HomeAction[]> = {
  learner: [
    {
      href: "/dashboard",
      label: "Performance Evaluation",
      description: "Track progress and weak areas.",
      accent: "from-[#091a4a] via-[#18357f] to-[#3156b8]",
      icon: ClipboardCheck,
      tag: "Review",
    },
    {
      href: "/programs/prelims",
      label: "Programs",
      description: "Continue structured prep.",
      accent: "from-[#0f766e] via-[#129c90] to-[#4fd1c5]",
      icon: Layers3,
      tag: "Study",
    },
    {
      href: "/ai-quiz-generator/gk",
      label: "AI Practice",
      description: "Generate fresh practice fast.",
      accent: "from-[#7c2d12] via-[#c2410c] to-[#fb923c]",
      icon: Sparkles,
      tag: "Practice",
    },
    {
      href: "/mentors",
      label: "Mentor Support",
      description: "Get human support when needed.",
      accent: "from-[#14532d] via-[#1d7a43] to-[#4ade80]",
      icon: GraduationCap,
      tag: "Support",
    },
  ],
  quiz_master: [
    {
      href: "/programs/create",
      label: "Create Program",
      description: "Launch a new prelims program.",
      accent: "from-[#091a4a] via-[#18357f] to-[#3156b8]",
      icon: Layers3,
      tag: "Build",
    },
    {
      href: "/quiz-master/ai-quiz/gk",
      label: "AI Quiz Workspace",
      description: "Generate and refine questions.",
      accent: "from-[#4c1d95] via-[#6d28d9] to-[#a78bfa]",
      icon: WandSparkles,
      tag: "Create",
    },
    {
      href: "/collections",
      label: "Built Tests",
      description: "Open created tests and material.",
      accent: "from-[#0f766e] via-[#129c90] to-[#4fd1c5]",
      icon: FileCheck2,
      tag: "Manage",
    },
    {
      href: "/quiz-master/complaints",
      label: "Reporting",
      description: "Resolve learner complaints.",
      accent: "from-[#9a3412] via-[#ea580c] to-[#fdba74]",
      icon: ShieldCheck,
      tag: "Report",
    },
  ],
  mains_mentor: [
    {
      href: "/mains/evaluate?mode=mains_mentor",
      label: "AI Mains Workspace",
      description: "Generate and evaluate mains work.",
      accent: "from-[#091a4a] via-[#18357f] to-[#3156b8]",
      icon: ClipboardCheck,
      tag: "Evaluate",
    },
    {
      href: "/mentorship/manage",
      label: "Mentorship Desk",
      description: "Handle requests and sessions.",
      accent: "from-[#14532d] via-[#1d7a43] to-[#4ade80]",
      icon: MessageSquareMore,
      tag: "Mentor",
    },
    {
      href: "/mains/questions",
      label: "Mains Repository",
      description: "Manage your question bank.",
      accent: "from-[#7c2d12] via-[#c2410c] to-[#fb923c]",
      icon: BookOpen,
      tag: "Store",
    },
    {
      href: "/programs",
      label: "Programs",
      description: "Open active delivery flows.",
      accent: "from-[#0f766e] via-[#129c90] to-[#4fd1c5]",
      icon: Layers3,
      tag: "Deliver",
    },
  ],
  operations: [
    {
      href: "/admin",
      label: "Admin Panel",
      description: "Core administration controls.",
      accent: "from-[#111827] via-[#1f2937] to-[#4b5563]",
      icon: ShieldCheck,
      tag: "Admin",
    },
    {
      href: "/onboarding/review",
      label: "Onboarding Queue",
      description: "Review pending approvals.",
      accent: "from-[#7c2d12] via-[#c2410c] to-[#fb923c]",
      icon: ClipboardCheck,
      tag: "Approve",
    },
    {
      href: "/programs",
      label: "Programs Console",
      description: "Monitor active program flows.",
      accent: "from-[#091a4a] via-[#18357f] to-[#3156b8]",
      icon: Layers3,
      tag: "Monitor",
    },
    {
      href: "/mentorship/manage",
      label: "Mentorship Queue",
      description: "Track service-side movement.",
      accent: "from-[#14532d] via-[#1d7a43] to-[#4ade80]",
      icon: BriefcaseBusiness,
      tag: "Queue",
    },
  ],
};

function resolveHomeKind(user: unknown): HomeKind {
  if (isAdminLike(user) || isModeratorLike(user)) return "operations";
  if (isQuizMasterLike(user)) return "quiz_master";
  if (isMainsMentorLike(user)) return "mains_mentor";
  return "learner";
}

function toError(error: unknown): string {
  if (!axios.isAxiosError(error)) return "Unknown error";
  const detail = error.response?.data?.detail;
  return typeof detail === "string" && detail.trim() ? detail : error.message;
}

function learnerNameFromRequest(request: MentorshipRequest): string {
  const learnerName = typeof request.meta?.learner_name === "string" ? request.meta.learner_name.trim() : "";
  if (learnerName) return learnerName;
  const learnerEmail = typeof request.meta?.learner_email === "string" ? request.meta.learner_email.trim() : "";
  const handle = learnerEmail.split("@")[0]?.trim() || "";
  if (!handle) return "Learner";
  return handle
    .replace(/[._-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/\b\w/g, (match) => match.toUpperCase());
}

function formatRelativeDate(value?: string | null): string {
  if (!value) return "n/a";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "n/a";
  return date.toLocaleDateString(undefined, { day: "numeric", month: "short" });
}

function requestStatusTone(status?: string | null): string {
  const normalized = String(status || "").trim().toLowerCase();
  if (normalized === "requested") return "bg-amber-50 text-amber-800 border-amber-200";
  if (normalized === "accepted" || normalized === "scheduled") return "bg-emerald-50 text-emerald-800 border-emerald-200";
  if (normalized === "completed") return "bg-slate-100 text-slate-700 border-slate-200";
  return "bg-rose-50 text-rose-700 border-rose-200";
}

function toPositiveInt(value: unknown): number {
  const num = Number(value);
  if (!Number.isFinite(num) || num <= 0) return 0;
  return Math.floor(num);
}

function normalizeLower(value: unknown): string {
  return String(value || "").trim().toLowerCase();
}

function parseSeriesId(collection: PremiumCollection | null): number {
  if (!collection) return 0;
  const directSeriesId = toPositiveInt((collection as { series_id?: unknown }).series_id);
  if (directSeriesId > 0) return directSeriesId;
  const meta = collection.meta && typeof collection.meta === "object" ? collection.meta : {};
  return toPositiveInt((meta as Record<string, unknown>).series_id);
}

function matchesExamIds(examIds: number[] | undefined | null, examId: number | null): boolean {
  if (!examId) return true;
  return Array.isArray(examIds) && examIds.includes(examId);
}

const PRELIMS_COLLECTION_MODES = new Set([
  "prelims",
  "prelims_quiz",
  "quiz",
  "quiz_collection",
  "quiz_test",
]);

function isQuizMadeTestCollection(collection: PremiumCollection | null, userId: string): boolean {
  if (!collection || !userId) return false;
  const meta = collection.meta && typeof collection.meta === "object" ? collection.meta : {};
  const authorId = String((meta as Record<string, unknown>).author_id || "").trim();
  if (!authorId || authorId !== userId) return false;

  const testKind = normalizeLower(collection.test_kind || (meta as Record<string, unknown>).test_kind);
  const mode = normalizeLower(collection.collection_mode || (meta as Record<string, unknown>).collection_mode);
  if (testKind === "mains") return false;
  if (testKind === "prelims") return true;
  return PRELIMS_COLLECTION_MODES.has(mode);
}

function formatDateTime(value?: string | null): string {
  if (!value) return "n/a";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "n/a";
  return date.toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
}

function shortText(value: string | null | undefined, maxChars: number): string {
  const text = String(value || "").trim();
  if (!text) return "";
  if (text.length <= maxChars) return text;
  return `${text.slice(0, Math.max(0, maxChars - 3)).trimEnd()}...`;
}

function userFirstName(user: unknown): string {
  const record = user && typeof user === "object" ? (user as Record<string, unknown>) : {};
  const meta = record.user_metadata && typeof record.user_metadata === "object" ? (record.user_metadata as Record<string, unknown>) : {};
  const candidate =
    String(meta.full_name || meta.name || meta.display_name || record.email || "")
      .trim();
  const first = candidate.split(/\s+/).filter(Boolean)[0];
  return first || "Scholar";
}

function requestTypeLabel(request: MentorshipRequest): string {
  const normalized = String(request.service_type || "").trim().toLowerCase();
  if (normalized === "copy_evaluation_and_mentorship") return "Mains Evaluation";
  return "Mentor Call";
}

function requestMetaLabel(request: MentorshipRequest, mentorMap: Record<string, string>): string {
  const mentor = mentorMap[request.provider_user_id] || "Mentor";
  const status = String(request.status || "").replaceAll("_", " ");
  return `${mentor} · ${status}`;
}

function dashboardRecommendationHref(plug: DashboardRecommendationPlug): string {
  const payload = plug.payload && typeof plug.payload === "object" ? (plug.payload as Record<string, unknown>) : {};
  const directHref = typeof payload.href === "string" ? payload.href.trim() : "";
  if (directHref) return directHref;

  const section = String(payload.content_type || plug.section || "").trim().toLowerCase();
  if (section.includes("mains")) return "/programs/mains";
  if (plug.plug_type === "mentorship_support") return "/dashboard/requests";
  return "/programs/prelims";
}

function LearnerHome({ user }: { user: unknown }) {
  const { globalExamId } = useExamContext();
  const [analytics, setAnalytics] = useState<DashboardAnalyticsPayload | null>(null);
  const [yearlySummary, setYearlySummary] = useState<YearlyAttemptSummaryPayload | null>(null);
  const [orders, setOrders] = useState<LearnerMentorshipOrdersData | null>(null);
  const [prelimsResults, setPrelimsResults] = useState<AttemptWithContext[]>([]);
  const [mainsResults, setMainsResults] = useState<UserMainsEvaluationRow[]>([]);
  const [activeSeriesExamIdsById, setActiveSeriesExamIdsById] = useState<Record<string, number[]>>({});
  const [resultTab, setResultTab] = useState<"prelims" | "mains">("prelims");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const currentUserId =
    user && typeof user === "object" && "id" in (user as Record<string, unknown>)
      ? String((user as Record<string, unknown>).id || "").trim()
      : "";

  useEffect(() => {
    let active = true;

    void (async () => {
      setLoading(true);
      setError("");
      try {
        const [analyticsRes, yearlySummaryRes, ordersRes, progressRes] = await Promise.all([
          premiumApi.get<DashboardAnalyticsPayload>("/user/dashboard-analytics", {
            params: { exam_id: globalExamId || undefined },
          }),
          premiumApi.get<YearlyAttemptSummaryPayload>("/user/yearly-attempt-summary", {
            params: { exam_id: globalExamId || undefined },
          }),
          loadLearnerMentorshipOrders(),
          premiumApi.get<UserProgressPayload>("/user/progress", {
            params: { exam_id: globalExamId || undefined },
          }),
        ]);
        if (!active) return;
        setAnalytics(analyticsRes.data || null);
        setYearlySummary(yearlySummaryRes.data || null);
        setOrders(ordersRes);

        const progressData = progressRes.data || { quiz_attempts: [], mains_evaluations: [] };
        const rawAttempts = Array.isArray(progressData.quiz_attempts) ? progressData.quiz_attempts : [];
        const rawMainsEvaluations = Array.isArray(progressData.mains_evaluations) ? progressData.mains_evaluations : [];
        const normalizedAttempts: UserQuizAttemptRow[] = rawAttempts
          .map((row) => ({
            id: toPositiveInt(row.id),
            collection_id: toPositiveInt(row.collection_id),
            score: Number(row.score || 0),
            total_questions: Number(row.total_questions || 0),
            correct_answers: Number(row.correct_answers || 0),
            incorrect_answers: Number(row.incorrect_answers || 0),
            unanswered: Number(row.unanswered || 0),
            created_at: String(row.created_at || ""),
          }))
          .filter((row) => row.id > 0 && row.collection_id > 0);

        const collectionIds = Array.from(new Set(normalizedAttempts.map((row) => row.collection_id).filter((id) => id > 0)));
        const collectionById: Record<string, PremiumCollection> = {};
        if (collectionIds.length > 0) {
          const collectionResponses = await Promise.allSettled(
            collectionIds.map((collectionId) =>
              premiumApi.get<PremiumCollection>(`/collections/${collectionId}`, {
                params: { include_items: false },
              }),
            ),
          );
          if (!active) return;
          for (const result of collectionResponses) {
            if (result.status !== "fulfilled") continue;
            const row = result.value.data;
            const collectionId = toPositiveInt(row?.id);
            if (collectionId > 0) {
              collectionById[String(collectionId)] = row;
            }
          }
        }

        const nextPrelimsResults: AttemptWithContext[] = [];
        for (const attempt of normalizedAttempts) {
          const collection = collectionById[String(attempt.collection_id)] || null;
          if (!matchesExamIds(collection?.exam_ids, globalExamId)) continue;
          const seriesId = parseSeriesId(collection);
          if (seriesId > 0 || isQuizMadeTestCollection(collection, currentUserId)) {
            nextPrelimsResults.push({ attempt, collection, seriesId });
          }
        }
        nextPrelimsResults.sort(
          (left, right) => new Date(right.attempt.created_at).getTime() - new Date(left.attempt.created_at).getTime(),
        );

        const nextMainsResults = rawMainsEvaluations
          .map((row) => ({
            id: toPositiveInt(row.id),
            question_text: row.question_text ? String(row.question_text) : null,
            score: row.score == null ? null : Number(row.score),
            max_score: row.max_score == null ? null : Number(row.max_score),
            created_at: String(row.created_at || ""),
          }))
          .filter((row) => row.id > 0)
          .sort((left, right) => new Date(right.created_at).getTime() - new Date(left.created_at).getTime());

        setPrelimsResults(nextPrelimsResults);
        setMainsResults(nextMainsResults);
      } catch (loadError: unknown) {
        if (!active) return;
        setError(toError(loadError));
      } finally {
        if (active) setLoading(false);
      }
    })();

    return () => {
      active = false;
    };
  }, [currentUserId, globalExamId]);

  useEffect(() => {
    let active = true;
    const activeSeriesRows = analytics?.purchase_overview?.active_series || [];
    if (!globalExamId || activeSeriesRows.length === 0) {
      setActiveSeriesExamIdsById({});
      return () => {
        active = false;
      };
    }

    void Promise.allSettled(
      Array.from(new Set(activeSeriesRows.map((series) => Number(series.series_id || 0)).filter((id) => id > 0))).map((seriesId) =>
        premiumApi.get<TestSeries>(`/programs/${seriesId}`),
      ),
    ).then((results) => {
      if (!active) return;
      const nextMap: Record<string, number[]> = {};
      for (const result of results) {
        if (result.status !== "fulfilled") continue;
        const row = result.value.data;
        if (!row?.id) continue;
        nextMap[String(row.id)] = Array.isArray(row.exam_ids) ? row.exam_ids : [];
      }
      setActiveSeriesExamIdsById(nextMap);
    });

    return () => {
      active = false;
    };
  }, [analytics, globalExamId]);

  const firstName = useMemo(() => userFirstName(user), [user]);
  const activeSeries = useMemo(() => {
    const rows = analytics?.purchase_overview?.active_series || [];
    if (!globalExamId) return rows;
    return rows.filter((series) => matchesExamIds(activeSeriesExamIdsById[String(series.series_id)], globalExamId));
  }, [activeSeriesExamIdsById, analytics, globalExamId]);
  const featuredSeries = activeSeries[0] || null;
  const recentRequests = useMemo(
    () =>
      [...(orders?.requests || [])]
        .sort((left, right) => new Date(right.requested_at).getTime() - new Date(left.requested_at).getTime())
        .slice(0, 3),
    [orders],
  );
  const requestSummary = useMemo(
    () => ({
      pending: (orders?.requests || []).filter((request) => request.status === "requested").length,
      evaluation: (orders?.requests || []).filter((request) => String(request.service_type || "").toLowerCase() === "copy_evaluation_and_mentorship").length,
    }),
    [orders],
  );
  const overviewItems = useMemo(
    () => [
      ...recentRequests.map((request) => ({
        key: `request-${request.id}`,
        title: requestTypeLabel(request),
        meta: requestMetaLabel(request, orders?.mentorNameByUserId || {}),
        status: String(request.status || "").replaceAll("_", " "),
        statusClass: requestStatusTone(request.status),
        href: `/my-purchases/mentorship/${request.id}`,
      })),
      ...activeSeries.slice(0, 3).map((series) => ({
        key: `series-${series.enrollment_id}`,
        title: series.title,
        meta: `${String(series.series_kind || "").toUpperCase()} · ${String(series.access_type || "").toLowerCase()}`,
        status: "Continue",
        statusClass: "border-[#cfe0ff] bg-[#eef4ff] text-[#1739ac]",
        href: `/programs/${series.series_id}`,
      })),
    ].slice(0, 4),
    [activeSeries, orders?.mentorNameByUserId, recentRequests],
  );

  const quickLinks = [
    { href: "/dashboard/requests", label: "New Mentorship Request", note: "Book support or review workflows", icon: GraduationCap },
    { href: "/programs/mains", label: "Mains Programs", note: "Structured answer-writing tracks", icon: ClipboardCheck },
    { href: "/programs/prelims", label: "Prelims Programs", note: "Objective practice programs", icon: Layers3 },
    { href: "/dashboard", label: "Performance Evaluation", note: "Track weak areas and category marks", icon: FileCheck2 },
  ];

  const aiSystems = [
    { href: "/ai-quiz-generator/gk", label: "GK Quiz Generator", note: "Fresh current-affairs and static GK drills", icon: BookOpen, status: "Continue" },
    { href: "/ai-quiz-generator/maths", label: "Maths Quiz Generator", note: "Quant-focused practice sessions", icon: Calculator, status: "Continue" },
    { href: "/ai-quiz-generator/passage", label: "Passage Quiz Generator", note: "Comprehension and reasoning passages", icon: ScrollText, status: "Continue" },
    { href: "/mains/evaluate", label: "Mains Answer Generator", note: "Create structured answer-writing prompts", icon: WandSparkles, status: "Generate" },
    { href: "/mains/evaluate", label: "Mains Evaluation", note: "AI review for marks, structure, and feedback", icon: Sparkles, status: "Evaluate" },
  ];

  const yearlyRows = useMemo(
    () =>
      yearlySummary
        ? [yearlySummary.rows.gk, yearlySummary.rows.maths, yearlySummary.rows.passage, yearlySummary.rows.mains]
        : [],
    [yearlySummary],
  );

  const suggestedPrograms = useMemo(
    () =>
      (analytics?.recommendation_plugs || [])
        .filter((plug) => ["practice_weak_area", "course_enrollment", "mentorship_support"].includes(String(plug.plug_type || "")))
        .slice(0, 4),
    [analytics],
  );

  const latestAttempts = useMemo(() => {
    const quizRows = prelimsResults.map((row) => {
      const title = String(row.collection?.title || row.collection?.name || `Collection #${row.attempt.collection_id}`);
      const total = Math.max(0, Number(row.attempt.total_questions || 0));
      const score = Math.max(0, Number(row.attempt.score || 0));
      const accuracy = total > 0 ? ((Math.max(0, Number(row.attempt.correct_answers || 0)) / total) * 100).toFixed(1) : "0.0";
      return {
        key: `quiz-${row.attempt.id}`,
        title,
        subtitle: `Prelims quiz | ${formatDateTime(row.attempt.created_at)}`,
        scoreText: `${score}/${total} | ${accuracy}%`,
        href: row.seriesId > 0 ? `/programs/${row.seriesId}` : "/dashboard",
        createdAt: row.attempt.created_at,
      };
    });

    const mainsRows = mainsResults.map((row) => {
      const score = Number(row.score || 0);
      const maxScore = Number(row.max_score || 10);
      const pct = maxScore > 0 ? ((score / maxScore) * 100).toFixed(1) : "0.0";
      return {
        key: `mains-${row.id}`,
        title: shortText(row.question_text || "Mains Evaluation", 72) || "Mains Evaluation",
        subtitle: `Mains evaluation | ${formatDateTime(row.created_at)}`,
        scoreText: `${score.toFixed(1)}/${maxScore.toFixed(1)} | ${pct}%`,
        href: "/dashboard",
        createdAt: row.created_at,
      };
    });

    return [...quizRows, ...mainsRows]
      .sort((left, right) => new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime())
      .slice(0, 5);
  }, [mainsResults, prelimsResults]);

  const fallbackSuggestions = [
    {
      title: "Strengthen weak prelims areas",
      description: "Move into curated prelims programs to improve category-wise accuracy and completion.",
      href: "/programs/prelims",
      cta: "Explore prelims programs",
    },
    {
      title: "Push mains marks higher",
      description: "Use structured mains programs and answer-writing tracks for higher marks consistency.",
      href: "/programs/mains",
      cta: "Explore mains programs",
    },
    {
      title: "Request mentorship support",
      description: "Open a mentorship request when you want guided correction on your weaker areas.",
      href: "/dashboard/requests",
      cta: "Open mentorship request",
    },
  ];

  return (
    <div className="space-y-8 pb-8">
      <section className="relative overflow-hidden rounded-[28px] border border-[#d7def4] bg-[linear-gradient(135deg,#ffffff_0%,#f6f8ff_54%,#edf8f5_100%)] px-5 py-6 shadow-[0_22px_55px_rgba(9,26,74,0.08)] sm:px-8 sm:py-8 lg:rounded-[34px]">
        <div className="absolute right-[-7rem] top-[-6rem] h-56 w-56 rounded-full bg-[#dce7ff]/70 blur-3xl" />
        <div className="absolute bottom-[-8rem] left-[-4rem] h-56 w-56 rounded-full bg-[#d8f3ec]/75 blur-3xl" />
        <div className="relative grid gap-6 xl:grid-cols-[minmax(0,1fr)_360px]">
          <div className="space-y-5">
            <div className="inline-flex items-center gap-2 rounded-full border border-[#c9d6fb] bg-white/85 px-3 py-1.5 text-xs font-semibold uppercase tracking-[0.16em] text-[#304a92]">
              <Sparkles className="h-4 w-4" />
              Learner Workspace
            </div>
            <div>
              <h1 className="max-w-3xl text-[30px] font-black tracking-tight text-[#091a4a] sm:text-[38px] lg:text-[46px]">
                Welcome back, {firstName}.
              </h1>
              <p className="mt-3 max-w-2xl text-[14px] leading-6 text-slate-600 sm:text-[15px] sm:leading-7">
                Track your ongoing programs, continue active attempts, open AI practice systems, and move straight into the next study action without hunting across pages.
              </p>
            </div>
            <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap">
              <Link href={featuredSeries ? `/programs/${featuredSeries.series_id}` : "/dashboard"} className="inline-flex items-center justify-center gap-2 rounded-2xl bg-[#091a4a] px-5 py-3 text-sm font-bold text-white">
                {featuredSeries ? "Continue active program" : "Open performance evaluation"}
                <ArrowRight className="h-4 w-4" />
              </Link>
              <Link href="/my-purchases" className="inline-flex items-center justify-center gap-2 rounded-2xl border border-[#c9d6fb] bg-white px-5 py-3 text-sm font-bold text-[#091a4a]">
                View purchases
              </Link>
            </div>
            <div className="grid gap-3 sm:grid-cols-3">
              <div className="rounded-[22px] border border-white/70 bg-white/80 p-4 backdrop-blur">
                <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-500">Active Programs</p>
                <p className="mt-2 text-3xl font-black tracking-tight text-[#091a4a]">{activeSeries.length}</p>
              </div>
              <div className="rounded-[22px] border border-white/70 bg-white/80 p-4 backdrop-blur">
                <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-500">Pending Requests</p>
                <p className="mt-2 text-3xl font-black tracking-tight text-[#091a4a]">{requestSummary.pending}</p>
              </div>
              <div className="rounded-[22px] border border-white/70 bg-white/80 p-4 backdrop-blur">
                <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-500">Questions This Year</p>
                <p className="mt-2 text-3xl font-black tracking-tight text-[#091a4a]">
                  {yearlyRows.reduce((sum, row) => sum + row.total_questions, 0)}
                </p>
              </div>
            </div>
          </div>

          <div className="rounded-[28px] border border-white/70 bg-white/80 p-5 backdrop-blur">
            <div className="flex flex-col items-start gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-500">Current Overview</p>
                <h2 className="mt-1 text-2xl font-black tracking-tight text-[#091a4a]">Ongoing mentorship and programs</h2>
              </div>
              <div className="rounded-full bg-[#edf4ff] px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.14em] text-[#1739ac]">
                Live
              </div>
            </div>

            <div className="mt-4 space-y-3">
              {overviewItems.map((item) => (
                <Link
                  key={item.key}
                  href={item.href}
                  className="flex flex-col items-start gap-3 rounded-[22px] border border-[#dce3fb] bg-white px-4 py-4 shadow-[0_10px_24px_rgba(15,23,42,0.04)] transition hover:-translate-y-0.5 hover:shadow-[0_16px_32px_rgba(15,23,42,0.08)] sm:flex-row sm:items-start sm:justify-between"
                >
                  <div className="min-w-0">
                    <p className="truncate text-[15px] font-semibold tracking-[-0.02em] text-[#182033]">{item.title}</p>
                    <p className="mt-1 text-[12px] leading-6 text-[#6c7590]">{item.meta}</p>
                  </div>
                  <span className={`shrink-0 rounded-full border px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.14em] ${item.statusClass}`}>
                    {item.status}
                  </span>
                </Link>
              ))}

              {!loading && overviewItems.length === 0 ? (
                <div className="rounded-[22px] border border-dashed border-[#cdd8f4] bg-[#f8faff] px-4 py-10 text-center text-sm text-[#6d7690]">
                  No active mentorship or program flow yet.
                </div>
              ) : null}
            </div>
          </div>
        </div>
      </section>

      {error ? (
        <section className="flex items-start gap-3 rounded-2xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-800">
          <AlertCircle className="mt-0.5 h-4 w-4" />
          <p>{error}</p>
        </section>
      ) : null}

      <section className="grid gap-6 xl:grid-cols-[320px_minmax(0,1fr)]">
        <div className="rounded-[30px] border border-[#dce3fb] bg-white p-5 shadow-[0_16px_36px_rgba(15,23,42,0.05)]">
          <div className="flex flex-col items-start gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-500">Quick Links</p>
              <h2 className="mt-1 text-[24px] font-black tracking-tight text-[#091a4a] sm:text-[28px]">Daily actions</h2>
            </div>
            <div className="rounded-full bg-[#eef4ff] px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.14em] text-[#1739ac]">
              Jump fast
            </div>
          </div>
          <div className="mt-5 space-y-3">
            {quickLinks.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                className="flex items-start gap-3 rounded-[22px] border border-[#dce3fb] bg-[linear-gradient(180deg,#ffffff_0%,#f8faff_100%)] px-4 py-4 transition hover:border-[#bdd1ff]"
              >
                <div className="inline-flex rounded-[14px] bg-[#eef4ff] p-3 text-[#1739ac]">
                  <item.icon className="h-4 w-4" />
                </div>
                <div className="min-w-0">
                  <p className="text-[15px] font-semibold tracking-[-0.02em] text-[#182033]">{item.label}</p>
                  <p className="mt-1 text-[12px] leading-6 text-[#6c7590]">{item.note}</p>
                </div>
              </Link>
            ))}
          </div>
        </div>

        <div className="overflow-hidden rounded-[30px] bg-[linear-gradient(140deg,#0a1a54_0%,#163fa4_62%,#1f56cf_100%)] p-5 text-white shadow-[0_22px_46px_rgba(9,26,74,0.18)]">
          <div className="relative overflow-hidden rounded-[26px] border border-white/10 bg-white/6 px-5 py-5">
            <div className="absolute right-[-2rem] top-[-2rem] h-28 w-28 rounded-full bg-white/10" />
            <div className="absolute bottom-[-3rem] left-[-2rem] h-28 w-28 rounded-full bg-white/10" />
            <div className="relative flex flex-col items-start gap-4 sm:flex-row sm:flex-wrap sm:items-start sm:justify-between">
              <div className="max-w-xl">
                <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-white/70">AI Workspace</p>
                <h2 className="mt-2 text-[24px] font-black tracking-tight sm:text-[30px]">Generation and evaluation systems</h2>
                <p className="mt-2 text-[13px] leading-6 text-white/80">
                  Move between GK, Maths, Passage, and Mains AI tools from one surface and continue wherever you left off.
                </p>
              </div>
              <div className="inline-flex items-center gap-2 rounded-full bg-white/12 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.14em] text-white/80">
                <Sparkles className="h-3.5 w-3.5" />
                Active AI Systems
              </div>
            </div>
            <div className="relative mt-5 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
              {aiSystems.map((system) => (
                <Link
                  key={system.href + system.label}
                  href={system.href}
                  className="rounded-[22px] border border-white/12 bg-white/8 px-4 py-4 transition hover:bg-white/12"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="inline-flex rounded-[14px] bg-white/12 p-3 text-white">
                      <system.icon className="h-4 w-4" />
                    </div>
                    <span className="rounded-full border border-white/15 bg-white/10 px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.16em] text-white/85">
                      {system.status}
                    </span>
                  </div>
                  <p className="mt-4 text-[15px] font-semibold tracking-[-0.02em] text-white">{system.label}</p>
                  <p className="mt-1 text-[12px] leading-6 text-white/72">{system.note}</p>
                </Link>
              ))}
            </div>
          </div>
        </div>
      </section>

      <FeaturedMixedRail
        title="Featured Programs and Mentors"
        subtitle="One row with current prelims tracks, mains tracks, and mentors chosen from the featured catalog."
      />

      <section>
        <div className="flex flex-col items-start gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-500">Programs</p>
            <h2 className="mt-1 text-[24px] font-black tracking-tight text-[#091a4a] sm:text-[30px]">Resume Active Programs</h2>
          </div>
          <Link href="/my-purchases" className="text-sm font-bold text-[#2b4dac]">
            Open purchases
          </Link>
        </div>
        <div className="mt-4 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {activeSeries.slice(0, 3).map((series) => (
            <Link
              key={series.enrollment_id}
              href={`/programs/${series.series_id}`}
              className="rounded-[26px] border border-[#dce3fb] bg-white p-5 shadow-[0_16px_36px_rgba(15,23,42,0.05)] transition hover:-translate-y-0.5 hover:shadow-[0_22px_44px_rgba(15,23,42,0.08)]"
            >
              <div className={`h-1.5 w-24 rounded-full ${String(series.series_kind || "").toLowerCase() === "mains" ? "bg-[#1f9c57]" : "bg-[#f59e0b]"}`} />
              <p className="mt-5 text-[22px] font-black tracking-[-0.04em] text-[#091a4a] sm:text-[26px]">{series.title}</p>
              <p className="mt-2 text-[13px] leading-6 text-[#6c7590]">
                {String(series.series_kind || "").toUpperCase()} | {String(series.access_type || "").toLowerCase()}
              </p>
              <div className="mt-6 inline-flex items-center gap-2 rounded-full bg-[#eef4ff] px-4 py-2 text-[12px] font-semibold text-[#1739ac]">
                <ArrowRight className="h-3.5 w-3.5" />
                Continue
              </div>
            </Link>
          ))}
          {!loading && activeSeries.length === 0 ? (
            <div className="rounded-[26px] border border-dashed border-[#cdd8f4] bg-[#f8faff] px-5 py-12 text-center text-sm text-[#6d7690]">
              No active programs yet.
            </div>
          ) : null}
        </div>
      </section>

      <section className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_420px]">
        <div className="rounded-[30px] border border-[#dce3fb] bg-white p-5 shadow-[0_16px_36px_rgba(15,23,42,0.05)]">
          <div className="flex flex-col items-start gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-500">Attempts</p>
              <h2 className="mt-1 text-[24px] font-black tracking-tight text-[#091a4a] sm:text-[30px]">Ongoing and recent attempts</h2>
            </div>
            <Link href="/dashboard" className="text-sm font-bold text-[#2b4dac]">
              Open performance evaluation
            </Link>
          </div>
          <div className="mt-5 space-y-3">
            {latestAttempts.map((item) => (
              <Link
                key={item.key}
                href={item.href}
                className="flex flex-col items-start gap-3 rounded-[22px] border border-[#dce3fb] bg-[linear-gradient(180deg,#ffffff_0%,#f8faff_100%)] px-4 py-4 transition hover:border-[#bdd1ff] sm:flex-row sm:items-center sm:justify-between"
              >
                <div className="min-w-0">
                  <p className="truncate text-[15px] font-semibold tracking-[-0.02em] text-[#182033]">{item.title}</p>
                  <p className="mt-1 text-[12px] leading-6 text-[#6c7590]">{item.subtitle}</p>
                </div>
                <div className="shrink-0 text-right">
                  <p className="text-[14px] font-semibold text-[#1739ac]">{item.scoreText}</p>
                </div>
              </Link>
            ))}
            {!loading && latestAttempts.length === 0 ? (
              <div className="rounded-[22px] border border-dashed border-[#cdd8f4] bg-[#f8faff] px-4 py-12 text-center text-sm text-[#6d7690]">
                No attempts recorded yet.
              </div>
            ) : null}
          </div>
        </div>

        <div className="rounded-[30px] border border-[#dce3fb] bg-[linear-gradient(180deg,#f3f6ff_0%,#eef3ff_100%)] p-5 shadow-[0_16px_36px_rgba(15,23,42,0.05)]">
          <div className="flex flex-col items-start gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-500">Yearly Overview</p>
              <h2 className="mt-1 text-[24px] font-black tracking-tight text-[#091a4a] sm:text-[30px]">Questions and marks this year</h2>
            </div>
            <div className="rounded-full bg-white px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.14em] text-[#1739ac]">
              {yearlySummary?.year || new Date().getFullYear()}
            </div>
          </div>
          <div className="mt-5 overflow-x-auto rounded-[24px] border border-[#d8e1fb] bg-white">
            <div className="min-w-[640px]">
              <div className="grid grid-cols-[1.1fr_0.9fr_0.8fr_1fr] gap-3 border-b border-[#e5ebfb] px-4 py-3 text-[11px] font-semibold uppercase tracking-[0.16em] text-[#5f7aa9]">
                <span>Content</span>
                <span>Total Questions</span>
                <span>Total Marks</span>
                <span>Marks Obtained</span>
              </div>
              <div className="divide-y divide-[#e5ebfb]">
                {yearlyRows.map((row) => (
                  <div key={row.content_type} className="grid grid-cols-[1.1fr_0.9fr_0.8fr_1fr] gap-3 px-4 py-4 text-[14px] text-[#182033]">
                    <span className="font-semibold">{row.label}</span>
                    <span>{row.total_questions}</span>
                    <span>{row.total_marks}</span>
                    <span className="font-semibold text-[#1739ac]">{row.marks_obtained}</span>
                  </div>
                ))}
                {!loading && yearlyRows.length === 0 ? (
                  <div className="px-4 py-12 text-center text-sm text-[#6d7690]">No yearly summary available yet.</div>
                ) : null}
              </div>
            </div>
          </div>
        </div>
      </section>

      <section className="rounded-[30px] border border-[#dce3fb] bg-white p-5 shadow-[0_16px_36px_rgba(15,23,42,0.05)]">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-500">Suggested Next Step</p>
            <h2 className="mt-1 text-[24px] font-black tracking-tight text-[#091a4a] sm:text-[30px]">Programs based on your current prep</h2>
            <p className="mt-2 max-w-2xl text-[13px] leading-6 text-[#6c7590]">
              These suggestions are positioned for your ongoing programs, recent attempts, and visible weak areas.
            </p>
          </div>
          <Link href="/dashboard" className="inline-flex items-center gap-2 rounded-full bg-[#eef4ff] px-4 py-2 text-[12px] font-semibold text-[#1739ac]">
            View detailed evaluation
            <ArrowRight className="h-3.5 w-3.5" />
          </Link>
        </div>

        <div className="mt-5 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {(suggestedPrograms.length > 0 ? suggestedPrograms : fallbackSuggestions).map((item, index) => {
            const href = "href" in item ? item.href : dashboardRecommendationHref(item);
            const title = item.title;
            const description = item.description || "Targeted suggestion based on your current progress.";
            const cta = "cta" in item ? item.cta : "Open suggestion";
            return (
              <Link
                key={`${title}-${index}`}
                href={href}
                className="rounded-[24px] border border-[#dce3fb] bg-[linear-gradient(180deg,#ffffff_0%,#f7f9ff_100%)] p-5 transition hover:-translate-y-0.5 hover:border-[#bdd1ff] hover:shadow-[0_16px_30px_rgba(15,23,42,0.06)]"
              >
                <div className="inline-flex items-center gap-2 rounded-full bg-[#eef4ff] px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.14em] text-[#1739ac]">
                  <CheckCircle2 className="h-3.5 w-3.5" />
                  Recommended
                </div>
                <p className="mt-4 text-[20px] font-black tracking-[-0.03em] text-[#091a4a]">{title}</p>
                <p className="mt-2 text-[13px] leading-6 text-[#6c7590]">{description}</p>
                <div className="mt-5 inline-flex items-center gap-2 text-[13px] font-semibold text-[#1739ac]">
                  {cta}
                  <ArrowRight className="h-3.5 w-3.5" />
                </div>
              </Link>
            );
          })}
        </div>
      </section>

      {false ? (
        <>

      <section className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_280px]">
        <div className="rounded-[26px] border border-slate-200 bg-white p-5 shadow-[0_12px_30px_rgba(15,23,42,0.05)]">
          <div className="flex items-center justify-between gap-3">
            <h2 className="text-lg font-black tracking-tight text-slate-900">Recent Results</h2>
            <Link href="/dashboard" className="text-xs font-bold text-[#1b44b8]">View Analytics</Link>
          </div>
          <div className="mt-4 flex gap-2">
            <button
              type="button"
              onClick={() => setResultTab("prelims")}
              className={`rounded-xl px-3 py-2 text-xs font-bold ${resultTab === "prelims" ? "bg-[#1b44b8] text-white" : "bg-slate-100 text-slate-700"}`}
            >
              Prelims
            </button>
            <button
              type="button"
              onClick={() => setResultTab("mains")}
              className={`rounded-xl px-3 py-2 text-xs font-bold ${resultTab === "mains" ? "bg-[#1b44b8] text-white" : "bg-slate-100 text-slate-700"}`}
            >
              Mains
            </button>
          </div>
          <div className="mt-4 space-y-3">
            {resultTab === "prelims"
              ? prelimsResults.slice(0, 4).map((row) => {
                  const testTitle = String(row.collection?.title || row.collection?.name || `Collection #${row.attempt.collection_id}`);
                  const total = Math.max(0, Number(row.attempt.total_questions || 0));
                  const score = Math.max(0, Number(row.attempt.score || 0));
                  const accuracy = total > 0 ? ((Math.max(0, Number(row.attempt.correct_answers || 0)) / total) * 100).toFixed(1) : "0.0";
                  return (
                    <article key={`prelims-${row.attempt.id}`} className="flex items-center justify-between gap-3 rounded-[20px] bg-slate-50 px-4 py-3">
                      <div className="min-w-0">
                        <p className="truncate text-sm font-bold text-slate-900">{testTitle}</p>
                        <p className="mt-1 text-xs text-slate-500">{formatDateTime(row.attempt.created_at)}</p>
                      </div>
                      <p className="shrink-0 text-sm font-bold text-slate-900">{score}/{total} · {accuracy}%</p>
                    </article>
                  );
                })
              : mainsResults.slice(0, 4).map((row) => {
                  const score = Number(row.score || 0);
                  const maxScore = Number(row.max_score || 10);
                  const pct = maxScore > 0 ? ((score / maxScore) * 100).toFixed(1) : "0.0";
                  return (
                    <article key={`mains-${row.id}`} className="flex items-center justify-between gap-3 rounded-[20px] bg-slate-50 px-4 py-3">
                      <div className="min-w-0">
                        <p className="truncate text-sm font-bold text-slate-900">{shortText(row.question_text || "Mains Evaluation", 74)}</p>
                        <p className="mt-1 text-xs text-slate-500">{formatDateTime(row.created_at)}</p>
                      </div>
                      <p className="shrink-0 text-sm font-bold text-slate-900">{score.toFixed(1)}/{maxScore.toFixed(1)} · {pct}%</p>
                    </article>
                  );
                })}
            {!loading && resultTab === "prelims" && prelimsResults.length === 0 ? (
              <div className="rounded-[20px] border border-dashed border-slate-300 bg-slate-50 px-4 py-10 text-center text-sm text-slate-500">
                No recent prelims results yet.
              </div>
            ) : null}
            {!loading && resultTab === "mains" && mainsResults.length === 0 ? (
              <div className="rounded-[20px] border border-dashed border-slate-300 bg-slate-50 px-4 py-10 text-center text-sm text-slate-500">
                No recent mains evaluations yet.
              </div>
            ) : null}
          </div>
        </div>

        <div className="space-y-4">
          <div className="rounded-[26px] bg-[#0f1f4a] p-5 text-white shadow-[0_18px_40px_rgba(15,31,74,0.18)]">
            <div className="flex items-center justify-between gap-2">
              <h2 className="text-lg font-black">Track Requests</h2>
              <Link href="/dashboard/requests" className="inline-flex h-8 w-8 items-center justify-center rounded-full bg-[#2457ff] text-lg leading-none">+</Link>
            </div>
            <p className="mt-2 text-xs text-slate-300">Status of your pending evaluations and mentorship calls.</p>
            <div className="mt-4 space-y-3">
              {recentRequests.map((request) => (
                <Link key={request.id} href={`/my-purchases/mentorship/${request.id}`} className="block rounded-[18px] border border-white/10 bg-white/5 px-3 py-3">
                  <div className="flex items-center justify-between gap-3">
                    <p className="text-sm font-semibold">{requestTypeLabel(request)}</p>
                    <span className="h-2.5 w-2.5 rounded-full bg-[#56d488]" />
                  </div>
                  <p className="mt-1 text-[11px] text-slate-300">{requestMetaLabel(request, orders?.mentorNameByUserId || {})}</p>
                </Link>
              ))}
              {!loading && recentRequests.length === 0 ? (
                <div className="rounded-[18px] border border-white/10 bg-white/5 px-3 py-6 text-center text-xs text-slate-300">
                  No active requests yet.
                </div>
              ) : null}
            </div>
          </div>

          <div className="rounded-[26px] border border-slate-200 bg-white p-5 shadow-[0_12px_30px_rgba(15,23,42,0.05)]">
            <p className="text-sm italic leading-6 text-slate-700">&ldquo;The mind is not a vessel to be filled, but a fire to be kindled.&rdquo;</p>
            <p className="mt-3 text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">Plutarch</p>
            <div className="mt-5 rounded-[18px] bg-slate-50 p-4">
              <p className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">Prep Snapshot</p>
              <div className="mt-3 space-y-2 text-sm">
                <div className="flex items-center justify-between"><span className="text-slate-600">Quiz Attempts</span><span className="font-bold text-slate-900">{analytics?.summary.total_quiz_attempts || 0}</span></div>
                <div className="flex items-center justify-between"><span className="text-slate-600">Pending Requests</span><span className="font-bold text-slate-900">{requestSummary.pending}</span></div>
                <div className="flex items-center justify-between"><span className="text-slate-600">Mains Requests</span><span className="font-bold text-slate-900">{requestSummary.evaluation}</span></div>
              </div>
            </div>
          </div>
        </div>
      </section>

      <section>
        <div className="flex items-center justify-between gap-3">
          <h2 className="text-lg font-black tracking-tight text-slate-900">Resume Active Programs</h2>
          <Link href="/my-purchases" className="text-xs font-bold text-[#1b44b8]">Open Purchases</Link>
        </div>
        <div className="mt-3 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {activeSeries.slice(0, 3).map((series) => (
            <Link key={series.enrollment_id} href={`/programs/${series.series_id}`} className="rounded-[22px] border border-slate-200 bg-white p-4 shadow-[0_12px_28px_rgba(15,23,42,0.04)]">
              <div className={`h-1.5 w-20 rounded-full ${String(series.series_kind || "").toLowerCase() === "mains" ? "bg-[#159947]" : "bg-[#f59e0b]"}`} />
              <p className="mt-4 truncate text-sm font-bold text-slate-900">{series.title}</p>
              <p className="mt-1 text-xs text-slate-500">{String(series.series_kind || "").toUpperCase()} · {String(series.access_type || "").toLowerCase()}</p>
              <div className="mt-4 inline-flex rounded-xl bg-slate-100 px-3 py-2 text-xs font-semibold text-slate-700">Continue</div>
            </Link>
          ))}
          {!loading && activeSeries.length === 0 ? (
            <div className="rounded-[22px] border border-dashed border-slate-300 bg-slate-50 px-4 py-10 text-center text-sm text-slate-500">
              No active programs yet.
            </div>
          ) : null}
        </div>
      </section>
        </>
      ) : null}
    </div>
  );
}

function MinimalCreatorHome({
  kind,
  copy,
  actions,
}: {
  kind: HomeKind;
  copy: (typeof homeCopy)[HomeKind];
  actions: HomeAction[];
}) {
  const { isAuthenticated } = useAuth();
  const [snapshot, setSnapshot] = useState<CreatorSnapshot>({ series: [], requests: [], activeEnrollments: 0 });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!isAuthenticated || (kind !== "quiz_master" && kind !== "mains_mentor")) return;
    let cancelled = false;

    const load = async () => {
      setLoading(true);
      setError("");
      try {
        const [seriesRes, summaryRes, requestsRes] = await Promise.all([
          premiumApi.get<TestSeries[]>("/programs", {
            params: { mine_only: true, include_tests: true, include_inactive: true },
          }),
          // Preserve the response shape so Promise.all does not widen `data` to `{}`.
          premiumApi.get<{ active_enrollments?: number }>("/provider/dashboard-summary").catch(() => ({
            data: { active_enrollments: 0 } as { active_enrollments?: number },
          })),
          kind === "mains_mentor"
            ? premiumApi.get<MentorshipRequest[]>("/mentorship/requests", {
                params: { scope: "provider" },
              })
            : Promise.resolve({ data: [] as MentorshipRequest[] }),
        ]);

        if (cancelled) return;
        setSnapshot({
          series: Array.isArray(seriesRes.data) ? seriesRes.data : [],
          requests: Array.isArray(requestsRes.data) ? requestsRes.data : [],
          activeEnrollments: Number(summaryRes.data?.active_enrollments || 0),
        });
      } catch (loadError: unknown) {
        if (cancelled) return;
        setError(toError(loadError));
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    void load();
    return () => {
      cancelled = true;
    };
  }, [isAuthenticated, kind]);

  const orderedRequests = useMemo(
    () =>
      [...snapshot.requests].sort(
        (left, right) => new Date(right.requested_at).getTime() - new Date(left.requested_at).getTime(),
      ),
    [snapshot.requests],
  );

  const totalTests = useMemo(
    () => snapshot.series.reduce((sum, series) => sum + Number(series.test_count || 0), 0),
    [snapshot.series],
  );
  const activeSeries = useMemo(
    () => snapshot.series.filter((series) => Boolean(series.is_active)).length,
    [snapshot.series],
  );
  const pendingRequests = useMemo(
    () => orderedRequests.filter((request) => request.status === "requested").length,
    [orderedRequests],
  );
  const newRequests = orderedRequests.slice(0, 4);

  const stats = [
    { label: "Series", value: snapshot.series.length },
    { label: "Active", value: activeSeries },
    { label: "Tests", value: totalTests },
    { label: kind === "mains_mentor" ? "New Requests" : "Enrollments", value: kind === "mains_mentor" ? pendingRequests : snapshot.activeEnrollments },
  ];

  return (
    <div className="space-y-6">
      <section className="relative overflow-hidden rounded-[26px] border border-[#d7def4] bg-[linear-gradient(135deg,#ffffff_0%,#f7f9ff_58%,#eef9f6_100%)] px-5 py-6 shadow-[0_22px_55px_rgba(9,26,74,0.08)] sm:px-6 sm:py-7 lg:rounded-[30px]">
        <div className="absolute right-[-7rem] top-[-6rem] h-56 w-56 rounded-full bg-[#d9e4ff]/60 blur-3xl" />
        <div className="absolute bottom-[-8rem] left-[-5rem] h-56 w-56 rounded-full bg-[#d7f5ef]/65 blur-3xl" />
        <div className="relative grid gap-5 lg:grid-cols-[minmax(0,1fr)_360px]">
          <div className="space-y-4">
            <div className="inline-flex items-center gap-2 rounded-full border border-[#c9d6fb] bg-white/85 px-3 py-1.5 text-xs font-semibold uppercase tracking-[0.16em] text-[#304a92]">
              <Sparkles className="h-4 w-4" />
              {copy.badge}
            </div>
            <div>
              <h1 className="max-w-3xl text-[30px] font-black tracking-tight text-[#091a4a] sm:text-4xl">{copy.title}</h1>
              <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-600">{copy.subtitle}</p>
            </div>
            <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap">
              <Link href={copy.primaryHref} className="inline-flex items-center justify-center gap-2 rounded-2xl bg-[#091a4a] px-5 py-3 text-sm font-bold text-white">
                {copy.primaryLabel}
                <ArrowRight className="h-4 w-4" />
              </Link>
              <Link href={copy.secondaryHref} className="inline-flex items-center justify-center gap-2 rounded-2xl border border-[#c9d6fb] bg-white px-5 py-3 text-sm font-bold text-[#091a4a]">
                {copy.secondaryLabel}
              </Link>
            </div>
          </div>

          <div className="rounded-[26px] border border-white/70 bg-white/75 p-4 backdrop-blur">
            <div className="grid grid-cols-2 gap-3">
              {stats.map((stat) => (
                <div key={stat.label} className="rounded-[20px] border border-slate-200 bg-white/95 p-4">
                  <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500">{stat.label}</p>
                  <p className="mt-2 text-3xl font-black tracking-tight text-[#091a4a]">{loading ? "..." : stat.value}</p>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      {error ? (
        <section className="flex items-start gap-3 rounded-2xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-800">
          <AlertCircle className="mt-0.5 h-4 w-4" />
          <p>{error}</p>
        </section>
      ) : null}

      <section className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_360px]">
        <div className="rounded-[28px] border border-slate-200 bg-white p-5 shadow-[0_16px_36px_rgba(15,23,42,0.05)]">
          <div className="flex flex-col items-start gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">Latest Requests</p>
              <h2 className="mt-1 text-xl font-black tracking-tight text-[#091a4a]">
                {kind === "mains_mentor" ? "New learner activity" : "Recent programs"}
              </h2>
            </div>
            <Link href={kind === "mains_mentor" ? "/mentorship/manage" : "/programs"} className="text-sm font-bold text-[#2b4dac]">
              {kind === "mains_mentor" ? "Open desk" : "Open programs"}
            </Link>
          </div>
          <div className="mt-4 space-y-3">
            {kind === "mains_mentor"
              ? newRequests.map((request) => (
                  <article key={request.id} className="flex flex-col items-start gap-3 rounded-[22px] border border-slate-200 bg-slate-50/80 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-bold text-slate-900">{learnerNameFromRequest(request)}</p>
                      <p className="mt-1 text-xs text-slate-500">
                        {formatRelativeDate(request.requested_at)} · {String(request.service_type || "").replaceAll("_", " ")}
                      </p>
                    </div>
                    <span className={`shrink-0 rounded-full border px-2.5 py-1 text-[11px] font-semibold ${requestStatusTone(request.status)}`}>
                      {String(request.status || "").replaceAll("_", " ")}
                    </span>
                  </article>
                ))
              : snapshot.series.slice(0, 4).map((series) => (
                  <article key={series.id} className="flex flex-col items-start gap-3 rounded-[22px] border border-slate-200 bg-slate-50/80 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-bold text-slate-900">{series.title}</p>
                      <p className="mt-1 text-xs text-slate-500">
                        {Number(series.test_count || 0)} tests · {series.is_active ? "active" : "archived"}
                      </p>
                    </div>
                    <span className="shrink-0 rounded-full border border-slate-200 bg-white px-2.5 py-1 text-[11px] font-semibold text-slate-600">
                      {String(series.series_kind || "quiz")}
                    </span>
                  </article>
                ))}
            {!loading && kind === "mains_mentor" && newRequests.length === 0 ? (
              <div className="rounded-[22px] border border-dashed border-slate-300 bg-slate-50 px-4 py-8 text-center text-sm text-slate-500">
                No recent requests.
              </div>
            ) : null}
            {!loading && kind === "quiz_master" && snapshot.series.length === 0 ? (
              <div className="rounded-[22px] border border-dashed border-slate-300 bg-slate-50 px-4 py-8 text-center text-sm text-slate-500">
                No recent programs.
              </div>
            ) : null}
          </div>
        </div>

        <div className="space-y-4">
          <div className="rounded-[28px] border border-slate-200 bg-white p-5 shadow-[0_16px_36px_rgba(15,23,42,0.05)]">
            <p className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">Quick Actions</p>
            <div className="mt-4 grid gap-3">
              {actions.slice(0, 3).map((action) => (
                <Link key={action.href} href={action.href} className="group flex flex-col items-start gap-3 rounded-[22px] border border-slate-200 bg-white px-4 py-3 transition hover:border-slate-300 hover:bg-slate-50 sm:flex-row sm:items-center sm:justify-between">
                  <div className="flex items-center gap-3">
                    <div className={`inline-flex rounded-2xl bg-gradient-to-r ${action.accent} p-2.5 text-white`}>
                      <action.icon className="h-4 w-4" />
                    </div>
                    <div>
                      <p className="text-sm font-bold text-[#091a4a]">{action.label}</p>
                      <p className="text-xs text-slate-500">{action.description}</p>
                    </div>
                  </div>
                  <ArrowRight className="h-4 w-4 text-slate-400 transition group-hover:translate-x-1" />
                </Link>
              ))}
            </div>
          </div>

          <div className="rounded-[28px] border border-slate-200 bg-white p-5 shadow-[0_16px_36px_rgba(15,23,42,0.05)]">
            <p className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">Programs</p>
            <div className="mt-4 space-y-3">
              {snapshot.series.slice(0, 3).map((series) => (
                <Link key={series.id} href={`/programs/${series.id}/manage`} className="block rounded-[22px] border border-slate-200 bg-slate-50/80 px-4 py-3 transition hover:border-slate-300 hover:bg-slate-50">
                  <p className="truncate text-sm font-bold text-slate-900">{series.title}</p>
                  <p className="mt-1 text-xs text-slate-500">
                    {Number(series.test_count || 0)} tests · {series.is_active ? "active" : "archived"}
                  </p>
                </Link>
              ))}
              {!loading && snapshot.series.length === 0 ? (
                <div className="rounded-[22px] border border-dashed border-slate-300 bg-slate-50 px-4 py-8 text-center text-sm text-slate-500">
                  No programs yet.
                </div>
              ) : null}
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}

export default function Home() {
  const { user, isAuthenticated } = useAuth();
  const kind = useMemo(() => resolveHomeKind(user), [user]);
  const copy = homeCopy[kind];
  const quickActions = quickActionsByKind[kind];

  if (!isAuthenticated) {
    return <PublicLandingPage />;
  }

  if (kind !== "learner") {
    return (
      <AppLayout>
        <MinimalCreatorHome kind={kind} copy={copy} actions={quickActions} />
      </AppLayout>
    );
  }

  if (kind === "learner" && isAuthenticated) {
    return (
      <AppLayout>
        <LearnerHome user={user} />
      </AppLayout>
    );
  }
}
