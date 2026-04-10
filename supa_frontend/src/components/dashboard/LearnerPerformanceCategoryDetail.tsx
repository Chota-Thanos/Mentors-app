"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { AlertCircle, ArrowLeft, Loader2 } from "lucide-react";

import { useAuth } from "@/context/AuthContext";
import { useExamContext } from "@/context/ExamContext";
import { DASHBOARD_SECTION_META, type DashboardContentType } from "@/lib/dashboardSections";
import { premiumApi } from "@/lib/premiumApi";
import type {
  PerformanceAuditDetailPayload,
  PerformanceAuditMainsMetrics,
  PerformanceAuditMainsSubcategory,
  PerformanceAuditSourceKind,
  PerformanceAuditQuizMetrics,
  PerformanceAuditQuizSubcategory,
} from "@/types/premium";

function formatPercentage(value: number): string {
  return `${value.toFixed(1)}%`;
}

function formatMarks(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(1);
}

function formatTimestamp(value?: string): string {
  if (!value) return "n/a";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "n/a";
  return date.toLocaleString("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function QuizMetricGrid({
  metrics,
  compact = false,
}: {
  metrics: PerformanceAuditQuizMetrics;
  compact?: boolean;
}) {
  const cardClass = compact
    ? "rounded-[18px] border border-[#dce3fb] bg-white p-3 shadow-[inset_0_1px_0_rgba(255,255,255,0.6)]"
    : "rounded-[18px] border border-[#dce3fb] bg-white p-4 shadow-[inset_0_1px_0_rgba(255,255,255,0.6)]";
  return (
    <div className={`grid gap-3 ${compact ? "grid-cols-2 xl:grid-cols-3" : "grid-cols-2 xl:grid-cols-5"}`}>
      <article className={cardClass}>
        <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-[#5f7aa9]">Attempted</p>
        <p className="mt-2 text-[18px] font-semibold tracking-[-0.03em] text-[#182033]">{metrics.attempted_questions}</p>
      </article>
      <article className={cardClass}>
        <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-[#5f7aa9]">Correct</p>
        <p className="mt-2 text-[18px] font-semibold tracking-[-0.03em] text-[#15803d]">{metrics.correct_count}</p>
      </article>
      <article className={cardClass}>
        <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-[#5f7aa9]">Incorrect</p>
        <p className="mt-2 text-[18px] font-semibold tracking-[-0.03em] text-[#b45309]">{metrics.incorrect_count}</p>
      </article>
      <article className={cardClass}>
        <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-[#5f7aa9]">Not Attempted</p>
        <p className="mt-2 text-[18px] font-semibold tracking-[-0.03em] text-[#c26a00]">{metrics.unanswered_count}</p>
      </article>
      <article className={cardClass}>
        <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-[#5f7aa9]">Percentage</p>
        <p className="mt-2 text-[18px] font-semibold tracking-[-0.03em] text-[#1235ae]">{formatPercentage(metrics.percentage)}</p>
      </article>
    </div>
  );
}

function MainsMetricGrid({
  metrics,
  compact = false,
}: {
  metrics: PerformanceAuditMainsMetrics;
  compact?: boolean;
}) {
  const cardClass = compact
    ? "rounded-[18px] border border-[#dce3fb] bg-white p-3 shadow-[inset_0_1px_0_rgba(255,255,255,0.6)]"
    : "rounded-[18px] border border-[#dce3fb] bg-white p-4 shadow-[inset_0_1px_0_rgba(255,255,255,0.6)]";
  return (
    <div className={`grid gap-3 ${compact ? "grid-cols-2 xl:grid-cols-3" : "grid-cols-2 xl:grid-cols-4"}`}>
      <article className={cardClass}>
        <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-[#5f7aa9]">Questions</p>
        <p className="mt-2 text-[18px] font-semibold tracking-[-0.03em] text-[#182033]">{metrics.total_questions}</p>
      </article>
      <article className={cardClass}>
        <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-[#5f7aa9]">Marks</p>
        <p className="mt-2 text-[18px] font-semibold tracking-[-0.03em] text-[#182033]">
          {formatMarks(metrics.total_score)} / {formatMarks(metrics.max_total_score)}
        </p>
      </article>
      <article className={cardClass}>
        <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-[#5f7aa9]">Percentage</p>
        <p className="mt-2 text-[18px] font-semibold tracking-[-0.03em] text-[#1235ae]">{formatPercentage(metrics.percentage)}</p>
      </article>
    </div>
  );
}

function QuizSubcategoryCard({ row }: { row: PerformanceAuditQuizSubcategory }) {
  return (
    <article className="rounded-[24px] border border-[#dce3fb] bg-white p-5 shadow-[0_18px_40px_rgba(80,103,170,0.08)]">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-[18px] font-semibold tracking-[-0.03em] text-[#182033]">{row.name}</p>
          <p className="mt-1 text-[11px] font-semibold uppercase tracking-[0.22em] text-[#5f7aa9]">
            {row.proficiency_label}
          </p>
        </div>
        <p className="text-[28px] font-semibold tracking-[-0.04em] text-[#1235ae]">{formatPercentage(row.percentage)}</p>
      </div>
      <div className="mt-4">
        <QuizMetricGrid metrics={row} compact />
      </div>
    </article>
  );
}

function MainsSubcategoryCard({ row }: { row: PerformanceAuditMainsSubcategory }) {
  return (
    <article className="rounded-[24px] border border-[#dce3fb] bg-white p-5 shadow-[0_18px_40px_rgba(80,103,170,0.08)]">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-[18px] font-semibold tracking-[-0.03em] text-[#182033]">{row.name}</p>
          <p className="mt-1 text-[11px] font-semibold uppercase tracking-[0.22em] text-[#5f7aa9]">
            {row.proficiency_label}
          </p>
        </div>
        <p className="text-[28px] font-semibold tracking-[-0.04em] text-[#1235ae]">{formatPercentage(row.percentage)}</p>
      </div>
      <div className="mt-4">
        <MainsMetricGrid metrics={row} compact />
      </div>
    </article>
  );
}

export default function LearnerPerformanceCategoryDetail({
  contentType,
  sourceKind,
  categoryId,
}: {
  contentType: DashboardContentType;
  sourceKind: PerformanceAuditSourceKind;
  categoryId: number;
}) {
  const { loading: authLoading, isAuthenticated, showLoginModal } = useAuth();
  const { globalExamId } = useExamContext();
  const [payload, setPayload] = useState<PerformanceAuditDetailPayload | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    if (authLoading || !isAuthenticated) return;
    let active = true;

    premiumApi
      .get<PerformanceAuditDetailPayload>(
        `/user/performance-audit/${contentType}/sources/${sourceKind}/categories/${categoryId}`,
        { params: { exam_id: globalExamId || undefined } },
      )
      .then((response) => {
        if (!active) return;
        setPayload(response.data);
        setError("");
      })
      .catch((err: unknown) => {
        if (!active) return;
        const detail =
          typeof err === "object" &&
          err !== null &&
          "response" in err &&
          (err as { response?: { data?: { detail?: string } } }).response?.data?.detail
            ? String((err as { response?: { data?: { detail?: string } } }).response?.data?.detail)
            : "Failed to load category detail.";
        setError(detail);
        setPayload(null);
      });

    return () => {
      active = false;
    };
  }, [authLoading, categoryId, contentType, globalExamId, isAuthenticated, sourceKind]);

  const loading = authLoading || (isAuthenticated && !payload && !error);
  const sectionMeta = DASHBOARD_SECTION_META[contentType];
  const SectionIcon = sectionMeta.icon;

  return (
    <div className="mx-auto max-w-7xl space-y-6">
      <header className="rounded-[30px] border border-[#dbe3fb] bg-[radial-gradient(circle_at_top_left,_rgba(223,232,255,0.95),_rgba(255,255,255,1)_42%,_rgba(241,245,255,0.98)_100%)] p-6 shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="space-y-3">
            <Link href="/dashboard" className="inline-flex items-center gap-1 text-sm font-semibold text-slate-600 hover:text-slate-900">
              <ArrowLeft className="h-4 w-4" />
              Back to Performance Audit
            </Link>
            <div className="flex items-center gap-3">
              <div className={`inline-flex h-11 w-11 items-center justify-center rounded-2xl border ${sectionMeta.tone}`}>
                <SectionIcon className="h-5 w-5" />
              </div>
              <div>
                <p className="text-xs font-black uppercase tracking-[0.28em] text-[#1d3b8b]">
                  {sourceKind === "ai" ? "AI Based" : "Program Based"}
                </p>
                <h1 className="text-3xl font-black tracking-tight text-[#091a4a]">
                  {payload?.category.name || "Category"}: second-level performance
                </h1>
              </div>
            </div>
            <p className="max-w-3xl text-sm leading-6 text-slate-600">
              Review subcategory-wise marks and percentage, then use the AI analysis to decide the next correction area.
            </p>
          </div>
          <div className="rounded-2xl border border-[#d5dcf2] bg-white px-4 py-3 text-sm text-slate-600 shadow-sm">
            Updated {formatTimestamp(payload?.generated_at)}
          </div>
        </div>
      </header>

      {loading ? (
        <div className="flex items-center gap-3 rounded-2xl border border-slate-200 bg-white p-8 text-slate-600">
          <Loader2 className="h-5 w-5 animate-spin text-[#0f2e87]" />
          Loading category detail...
        </div>
      ) : null}

      {!loading && !isAuthenticated ? (
        <div className="rounded-2xl border border-slate-200 bg-white p-8">
          <p className="text-slate-700">Login is required to view category-level performance.</p>
          <button
            type="button"
            onClick={showLoginModal}
            className="mt-4 rounded-xl bg-slate-900 px-4 py-2 text-sm font-semibold text-white"
          >
            Login
          </button>
        </div>
      ) : null}

      {!loading && isAuthenticated && error ? (
        <div className="flex items-start gap-3 rounded-2xl border border-rose-200 bg-rose-50 p-6 text-rose-700">
          <AlertCircle className="mt-0.5 h-5 w-5" />
          <p>{error}</p>
        </div>
      ) : null}

      {!loading && isAuthenticated && payload ? (
        <>
          <section className="grid gap-4 lg:grid-cols-[minmax(0,1.2fr)_minmax(0,0.8fr)]">
            <article className="rounded-[28px] border border-slate-200 bg-white p-6 shadow-sm">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <p className="text-xs font-black uppercase tracking-[0.24em] text-slate-500">
                    {payload.label} · {payload.source_kind === "ai" ? "AI Based" : "Program Based"}
                  </p>
                  <h2 className="mt-2 text-2xl font-black tracking-tight text-slate-900">
                    {payload.category.name} summary
                  </h2>
                </div>
                <div className={`rounded-full border px-3 py-1 text-xs font-semibold ${sectionMeta.tone}`}>
                  {formatPercentage(payload.summary.percentage)}
                </div>
              </div>
              <div className="mt-5">
                {payload.content_type === "mains" ? (
                  <MainsMetricGrid metrics={payload.summary} />
                ) : (
                  <QuizMetricGrid metrics={payload.summary} />
                )}
              </div>
            </article>

            <article className="rounded-[28px] border border-slate-200 bg-white p-6 shadow-sm">
              <p className="text-xs font-black uppercase tracking-[0.24em] text-slate-500">Source overall performance</p>
              <h2 className="mt-2 text-2xl font-black tracking-tight text-slate-900">
                {payload.source_kind === "ai" ? "AI Based" : "Program Based"} {payload.label}
              </h2>
              <div className="mt-5">
                {payload.content_type === "mains" ? (
                  <MainsMetricGrid metrics={payload.source_summary} compact />
                ) : (
                  <QuizMetricGrid metrics={payload.source_summary} compact />
                )}
              </div>
            </article>
          </section>

          <section className="rounded-[28px] border border-slate-200 bg-white p-6 shadow-sm">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <p className="text-xs font-black uppercase tracking-[0.24em] text-slate-500">Second-Level Categories</p>
                <h2 className="mt-2 text-2xl font-black tracking-tight text-slate-900">
                  Subcategory-wise marks and percentage
                </h2>
              </div>
              <p className="text-sm text-slate-500">{payload.subcategories.length} subcategories</p>
            </div>
            <div className="mt-5 grid gap-4 xl:grid-cols-2">
              {payload.content_type === "mains"
                ? payload.subcategories.map((row) => (
                    <MainsSubcategoryCard key={row.id ?? row.name} row={row} />
                  ))
                : payload.subcategories.map((row) => (
                    <QuizSubcategoryCard key={row.id ?? row.name} row={row} />
                  ))}
            </div>
            {payload.subcategories.length === 0 ? (
              <p className="rounded-2xl border border-dashed border-slate-300 bg-slate-50 px-4 py-5 text-sm text-slate-500">
                No second-level category performance recorded yet.
              </p>
            ) : null}
          </section>

          <section className="rounded-[28px] border border-[#dbe3fb] bg-[linear-gradient(180deg,#eef3ff_0%,#ffffff_100%)] p-6 shadow-sm">
            <p className="text-xs font-black uppercase tracking-[0.24em] text-[#1d3b8b]">AI Analysis</p>
            <h2 className="mt-2 text-2xl font-black tracking-tight text-[#091a4a]">{payload.analysis.title}</h2>
            <p className="mt-3 max-w-4xl text-sm leading-6 text-slate-700">{payload.analysis.summary}</p>
            <div className="mt-5 grid gap-3 md:grid-cols-3">
              {payload.analysis.points.map((point, index) => (
                <article
                  key={`${payload.category.id ?? payload.category.name}-point-${index}`}
                  className="rounded-2xl border border-[#d5dcf2] bg-white p-4 text-sm leading-6 text-slate-700"
                >
                  {point}
                </article>
              ))}
            </div>
          </section>
        </>
      ) : null}
    </div>
  );
}
