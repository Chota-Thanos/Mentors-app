"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import {
  AlertCircle,
  ArrowRight,
  BookOpen,
  BriefcaseBusiness,
  ClipboardCheck,
  FileCheck2,
  GraduationCap,
  Layers3,
  LucideIcon,
  MessageSquareMore,
  ShieldCheck,
  Sparkles,
  WandSparkles,
} from "lucide-react";
import axios from "axios";

import AppLayout from "@/components/layouts/AppLayout";
import PublicLandingPage from "@/components/home/PublicLandingPage";
import { useAuth } from "@/context/AuthContext";
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
  MentorshipRequest,
  PremiumCollection,
  TestSeries,
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

function LearnerHome({ user }: { user: unknown }) {
  const [analytics, setAnalytics] = useState<DashboardAnalyticsPayload | null>(null);
  const [orders, setOrders] = useState<LearnerMentorshipOrdersData | null>(null);
  const [prelimsResults, setPrelimsResults] = useState<AttemptWithContext[]>([]);
  const [mainsResults, setMainsResults] = useState<UserMainsEvaluationRow[]>([]);
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
        const [analyticsRes, ordersRes, progressRes] = await Promise.all([
          premiumApi.get<DashboardAnalyticsPayload>("/user/dashboard-analytics"),
          loadLearnerMentorshipOrders(),
          premiumApi.get<UserProgressPayload>("/user/progress"),
        ]);
        if (!active) return;
        setAnalytics(analyticsRes.data || null);
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
  }, [currentUserId]);

  const firstName = useMemo(() => userFirstName(user), [user]);
  const activeSeries = analytics?.purchase_overview?.active_series || [];
  const featuredSeries = activeSeries[0] || null;
  const recentRequests = useMemo(
    () =>
      [...(orders?.requests || [])]
        .sort((left, right) => new Date(right.requested_at).getTime() - new Date(left.requested_at).getTime())
        .slice(0, 2),
    [orders],
  );
  const requestSummary = useMemo(
    () => ({
      pending: (orders?.requests || []).filter((request) => request.status === "requested").length,
      evaluation: (orders?.requests || []).filter((request) => String(request.service_type || "").toLowerCase() === "copy_evaluation_and_mentorship").length,
    }),
    [orders],
  );

  const toolkitLinks = [
    { href: "/ai-quiz-generator/gk", label: "Practice with AI", note: "Adaptive question engine", icon: Sparkles },
    { href: "/programs/prelims", label: "Explore Programs", note: "New curation for 2026", icon: Layers3 },
    { href: "/mentors", label: "Find Mentors", note: "Guided sessions and feedback", icon: GraduationCap },
    { href: "/mains/evaluate", label: "Write Mains Answer", note: "Structured editorial practice", icon: ClipboardCheck },
  ];

  return (
    <div className="space-y-6 pb-6">
      <section className="space-y-1">
        <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">Your Momentum</p>
        <h1 className="text-4xl font-black tracking-tight text-[#111827]">Welcome back, {firstName}.</h1>
      </section>

      {error ? (
        <section className="flex items-start gap-3 rounded-2xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-800">
          <AlertCircle className="mt-0.5 h-4 w-4" />
          <p>{error}</p>
        </section>
      ) : null}

      <section className="rounded-[30px] border border-slate-200 bg-white p-5 shadow-[0_18px_40px_rgba(15,23,42,0.06)] sm:p-6">
        <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_220px] lg:items-center">
          <div>
            <div className="inline-flex items-center gap-2 rounded-full bg-[#eaf8ec] px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.16em] text-[#25824d]">
              Up Next
              <span className="text-slate-500">{featuredSeries ? formatRelativeDate(featuredSeries.updated_at || featuredSeries.created_at) : "Today"}</span>
            </div>
            <h2 className="mt-4 max-w-2xl text-3xl font-black leading-tight tracking-tight text-[#1b44b8]">
              {featuredSeries?.title || "Continue your next high-value prep session."}
            </h2>
            <p className="mt-3 max-w-xl text-sm leading-6 text-slate-600">
              {featuredSeries
                ? `Resume your ${String(featuredSeries.series_kind || "program").toLowerCase()} track and continue from the latest active material.`
                : "Open your performance evaluation, continue a program, or return to your latest mentor workflow."}
            </p>
            <div className="mt-5 flex flex-wrap gap-3">
              <Link href={featuredSeries ? `/programs/${featuredSeries.series_id}` : "/dashboard"} className="inline-flex items-center rounded-xl bg-[#1b44b8] px-4 py-3 text-sm font-bold text-white shadow-[0_12px_30px_rgba(27,68,184,0.28)]">
                Resume Session
              </Link>
              <Link href="/my-purchases" className="inline-flex items-center rounded-xl border border-slate-300 bg-slate-100 px-4 py-3 text-sm font-bold text-slate-700">
                View Schedule
              </Link>
            </div>
          </div>

          <div className="relative mx-auto h-[190px] w-full max-w-[190px] overflow-hidden rounded-[24px] bg-[linear-gradient(180deg,#f0f0f0_0%,#d9d9d9_100%)]">
            <div className="absolute inset-x-8 bottom-0 top-10 rounded-t-[90px] bg-[linear-gradient(180deg,rgba(255,255,255,0.95)_0%,rgba(220,220,220,0.9)_100%)]" />
            <div className="absolute left-1/2 top-9 h-12 w-12 -translate-x-1/2 rounded-full bg-[#ececec]" />
            <div className="absolute left-1/2 top-[4.4rem] h-20 w-[86px] -translate-x-1/2 rounded-[28px_28px_18px_18px] bg-[#ededed]" />
            <div className="absolute left-[1.8rem] top-[6.1rem] h-16 w-5 rotate-[18deg] rounded-full bg-[#efefef]" />
            <div className="absolute right-[1.8rem] top-[6.1rem] h-16 w-5 -rotate-[18deg] rounded-full bg-[#efefef]" />
            <div className="absolute bottom-0 left-0 right-0 h-14 bg-[linear-gradient(180deg,rgba(18,18,18,0)_0%,rgba(18,18,18,0.22)_100%)]" />
          </div>
        </div>
      </section>

      <section>
        <p className="mb-3 text-sm font-semibold text-slate-700">Learning Toolkit</p>
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          {toolkitLinks.map((item) => (
            <Link key={item.href} href={item.href} className="rounded-[22px] border border-slate-200 bg-white p-4 shadow-[0_12px_28px_rgba(15,23,42,0.04)] transition hover:-translate-y-0.5 hover:shadow-[0_18px_36px_rgba(15,23,42,0.08)]">
              <div className="inline-flex rounded-xl bg-[#eef3ff] p-2.5 text-[#1b44b8]">
                <item.icon className="h-4 w-4" />
              </div>
              <p className="mt-4 text-sm font-bold text-slate-900">{item.label}</p>
              <p className="mt-1 text-xs text-slate-500">{item.note}</p>
            </Link>
          ))}
        </div>
      </section>

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
      <section className="relative overflow-hidden rounded-[30px] border border-[#d7def4] bg-[linear-gradient(135deg,#ffffff_0%,#f7f9ff_58%,#eef9f6_100%)] px-6 py-7 shadow-[0_22px_55px_rgba(9,26,74,0.08)]">
        <div className="absolute right-[-7rem] top-[-6rem] h-56 w-56 rounded-full bg-[#d9e4ff]/60 blur-3xl" />
        <div className="absolute bottom-[-8rem] left-[-5rem] h-56 w-56 rounded-full bg-[#d7f5ef]/65 blur-3xl" />
        <div className="relative grid gap-5 lg:grid-cols-[minmax(0,1fr)_360px]">
          <div className="space-y-4">
            <div className="inline-flex items-center gap-2 rounded-full border border-[#c9d6fb] bg-white/85 px-3 py-1.5 text-xs font-semibold uppercase tracking-[0.16em] text-[#304a92]">
              <Sparkles className="h-4 w-4" />
              {copy.badge}
            </div>
            <div>
              <h1 className="max-w-3xl text-4xl font-black tracking-tight text-[#091a4a]">{copy.title}</h1>
              <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-600">{copy.subtitle}</p>
            </div>
            <div className="flex flex-wrap gap-3">
              <Link href={copy.primaryHref} className="inline-flex items-center gap-2 rounded-2xl bg-[#091a4a] px-5 py-3 text-sm font-bold text-white">
                {copy.primaryLabel}
                <ArrowRight className="h-4 w-4" />
              </Link>
              <Link href={copy.secondaryHref} className="inline-flex items-center gap-2 rounded-2xl border border-[#c9d6fb] bg-white px-5 py-3 text-sm font-bold text-[#091a4a]">
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
          <div className="flex items-center justify-between gap-3">
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
                  <article key={request.id} className="flex items-center justify-between gap-3 rounded-[22px] border border-slate-200 bg-slate-50/80 px-4 py-3">
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
                  <article key={series.id} className="flex items-center justify-between gap-3 rounded-[22px] border border-slate-200 bg-slate-50/80 px-4 py-3">
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
                <Link key={action.href} href={action.href} className="group flex items-center justify-between rounded-[22px] border border-slate-200 bg-white px-4 py-3 transition hover:border-slate-300 hover:bg-slate-50">
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
