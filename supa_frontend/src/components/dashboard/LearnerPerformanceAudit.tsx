"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { AlertCircle, ArrowRight, Loader2 } from "lucide-react";

import { useAuth } from "@/context/AuthContext";
import { useExamContext } from "@/context/ExamContext";
import {
  DASHBOARD_CONTENT_TYPES,
  DASHBOARD_SECTION_META,
  type DashboardContentType,
} from "@/lib/dashboardSections";
import { premiumApi } from "@/lib/premiumApi";
import type {
  PerformanceAuditMainsCategory,
  PerformanceAuditMainsMetrics,
  PerformanceAuditMainsSection,
  PerformanceAuditOverviewPayload,
  PerformanceAuditQuizCategory,
  PerformanceAuditQuizMetrics,
  PerformanceAuditQuizSection,
  PerformanceAuditSourceKind,
  TestSeriesDiscoverySeries,
} from "@/types/premium";

const sourceLabels: Record<PerformanceAuditSourceKind, string> = {
  ai: "AI Based",
  program: "Program Based",
};

function matchesExamIds(examIds: number[] | undefined | null, examId: number | null): boolean {
  if (!examId) return true;
  return Array.isArray(examIds) && examIds.includes(examId);
}

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

function resolveDefaultSourceKind(
  aiMetrics: { total_questions: number },
  programMetrics: { total_questions: number },
): PerformanceAuditSourceKind {
  if (programMetrics.total_questions > 0 && aiMetrics.total_questions === 0) return "program";
  return "ai";
}

type SuggestedProgramCard = {
  id: number;
  title: string;
  description: string;
  href: string;
  meta: string;
};

type SuggestionBundle = {
  focusAreas: string[];
  programs: SuggestedProgramCard[];
  fallbackHref: string;
  fallbackLabel: string;
};

function normalizeProgramText(...parts: Array<string | null | undefined>): string {
  return parts
    .map((part) => String(part || "").trim().toLowerCase())
    .filter(Boolean)
    .join(" ");
}

function buildProgramMeta(row: TestSeriesDiscoverySeries): string {
  const accessLabel = row.series.access_type === "free" || Number(row.series.price || 0) <= 0
    ? "Free"
    : `${String(row.series.access_type || "").toLowerCase()}`;
  const categoryLabel = row.category_labels.filter(Boolean).slice(0, 2).join(", ");
  return categoryLabel ? `${accessLabel} | ${categoryLabel}` : accessLabel;
}

function selectProgramsForFocusAreas(
  focusAreas: string[],
  rows: TestSeriesDiscoverySeries[],
  fallbackHref: string,
): SuggestedProgramCard[] {
  const scored = rows
    .map((row) => {
      const haystack = normalizeProgramText(row.series.title, row.series.description, ...row.category_labels);
      let score = 0;
      for (const focusArea of focusAreas) {
        const normalizedFocus = String(focusArea || "").trim().toLowerCase();
        if (!normalizedFocus) continue;
        if (haystack.includes(normalizedFocus)) score += 4;
        const tokens = normalizedFocus.split(/\s+/).filter((token) => token.length > 3);
        score += tokens.filter((token) => haystack.includes(token)).length;
      }
      return { row, score };
    })
    .sort((left, right) => right.score - left.score || left.row.series.title.localeCompare(right.row.series.title));

  const selected = (scored.some((entry) => entry.score > 0) ? scored.filter((entry) => entry.score > 0) : scored)
    .slice(0, 3)
    .map(({ row }) => ({
      id: row.series.id,
      title: row.series.title,
      description: String(row.series.description || "Structured program aligned to the current focus areas.").trim(),
      href: `/programs/${row.series.id}`,
      meta: buildProgramMeta(row),
    }));

  if (selected.length > 0) return selected;

  return [
    {
      id: 0,
      title: "Browse available programs",
      description: "No direct category match was found, so open the full catalog for the closest fit.",
      href: fallbackHref,
      meta: "Catalog",
    },
  ];
}

function buildQuizSuggestions(
  categories: PerformanceAuditQuizCategory[],
  programRows: TestSeriesDiscoverySeries[],
): SuggestionBundle {
  const weakestCategories = [...categories]
    .filter((category) => category.total_questions > 0)
    .sort((left, right) => left.percentage - right.percentage)
    .slice(0, 3);
  const focusAreas = weakestCategories.map((category) => `${category.name} ${formatPercentage(category.percentage)}`);
  return {
    focusAreas: focusAreas.length > 0 ? focusAreas : ["Coverage building", "Accuracy improvement"],
    programs: selectProgramsForFocusAreas(
      weakestCategories.map((category) => category.name),
      programRows,
      "/programs/prelims",
    ),
    fallbackHref: "/programs/prelims",
    fallbackLabel: "Open prelims programs",
  };
}

function buildMainsSuggestions(
  categories: PerformanceAuditMainsCategory[],
  programRows: TestSeriesDiscoverySeries[],
): SuggestionBundle {
  const weakestCategories = [...categories]
    .filter((category) => category.total_questions > 0)
    .sort((left, right) => left.percentage - right.percentage)
    .slice(0, 3);
  const focusAreas = weakestCategories.map((category) => `${category.name} ${formatPercentage(category.percentage)}`);
  return {
    focusAreas: focusAreas.length > 0 ? focusAreas : ["Answer structure", "Marks consistency"],
    programs: selectProgramsForFocusAreas(
      weakestCategories.map((category) => category.name),
      programRows,
      "/programs/mains",
    ),
    fallbackHref: "/programs/mains",
    fallbackLabel: "Open mains programs",
  };
}

function ProgramSuggestionPanel({
  suggestionBundle,
  sourceKind,
}: {
  suggestionBundle: SuggestionBundle;
  sourceKind: PerformanceAuditSourceKind;
}) {
  return (
    <div className="mt-6 rounded-[22px] border border-[#dce3fb] bg-[linear-gradient(180deg,#f7f9ff_0%,#ffffff_100%)] p-4 shadow-[0_12px_24px_rgba(80,103,170,0.06)]">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h4 className="text-[12px] font-semibold uppercase tracking-[0.28em] text-[#5f7aa9]">Program Suggestions</h4>
          <p className="mt-1 text-[12px] leading-6 text-[#6c7590]">
            Suggestions based on the weaker first-level categories in {sourceLabels[sourceKind].toLowerCase()}.
          </p>
        </div>
      </div>

      <div className="mt-4">
        <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-[#5f7aa9]">Focus Areas</p>
        <div className="mt-3 flex flex-wrap gap-2">
          {suggestionBundle.focusAreas.map((focusArea) => (
            <span
              key={focusArea}
              className="rounded-full border border-[#cfe0ff] bg-[#eef4ff] px-3 py-1.5 text-[12px] font-semibold text-[#1739ac]"
            >
              {focusArea}
            </span>
          ))}
        </div>
      </div>

      <div className="mt-5 grid gap-3 lg:grid-cols-2">
        {suggestionBundle.programs.map((program) => (
          <Link
            key={`${program.id}-${program.href}`}
            href={program.href}
            className="rounded-[18px] border border-[#dce3fb] bg-white px-4 py-4 transition hover:border-[#bdd1ff]"
          >
            <p className="text-[16px] font-semibold tracking-[-0.03em] text-[#182033]">{program.title}</p>
            <p className="mt-1 text-[11px] font-semibold uppercase tracking-[0.16em] text-[#5f7aa9]">{program.meta}</p>
            <p className="mt-2 text-[12px] leading-6 text-[#6c7590]">{program.description}</p>
            <span className="mt-4 inline-flex items-center gap-1 text-[12px] font-semibold text-[#1739ac]">
              {suggestionBundle.fallbackLabel}
              <ArrowRight className="h-3.5 w-3.5" />
            </span>
          </Link>
        ))}
      </div>
    </div>
  );
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
    <div className={`grid gap-3 ${compact ? "grid-cols-1 sm:grid-cols-2 xl:grid-cols-3" : "grid-cols-1 sm:grid-cols-2 xl:grid-cols-5"}`}>
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
    <div className={`grid gap-3 ${compact ? "grid-cols-1 sm:grid-cols-2 xl:grid-cols-3" : "grid-cols-1 sm:grid-cols-2 xl:grid-cols-4"}`}>
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

function QuizCategoryList({
  contentType,
  sourceKind,
  categories,
}: {
  contentType: DashboardContentType;
  sourceKind: PerformanceAuditSourceKind;
  categories: PerformanceAuditQuizCategory[];
}) {
  if (categories.length === 0) {
    return <p className="rounded-[18px] border border-dashed border-[#d5dcf2] bg-white px-4 py-5 text-[13px] leading-6 text-[#7b86a4]">No first-level category performance recorded yet.</p>;
  }

  return (
    <div className="space-y-3">
      {categories.map((category) => {
        const href =
          category.has_children && category.id
            ? `/dashboard/subject/${contentType}/${sourceKind}/${category.id}`
            : null;

        const content = (
          <div className="flex flex-col gap-3 rounded-[18px] border border-[#dce3fb] bg-white px-4 py-4 shadow-[inset_0_1px_0_rgba(255,255,255,0.6)] transition hover:border-[#bdd1ff]">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-[16px] font-semibold tracking-[-0.03em] text-[#182033]">{category.name}</p>
                <p className="mt-1 text-[12px] leading-6 text-[#6c7590]">
                  Attempted {category.attempted_questions} | Correct {category.correct_count} | Incorrect {category.incorrect_count} | Not Attempted {category.unanswered_count}
                </p>
              </div>
              <div className="text-right">
                <p className="text-[18px] font-semibold tracking-[-0.03em] text-[#1235ae]">{formatPercentage(category.percentage)}</p>
                <p className="text-[12px] leading-6 text-[#6c7590]">{category.total_questions} questions</p>
              </div>
            </div>
            {href ? (
              <span className="inline-flex items-center gap-1 text-[12px] font-semibold text-[#1739ac]">
                Open subcategory analysis
                <ArrowRight className="h-3.5 w-3.5" />
              </span>
            ) : (
              <span className="text-[12px] font-semibold text-[#9aa7c5]">No deeper breakdown yet</span>
            )}
          </div>
        );

        return href ? (
          <Link key={`${sourceKind}-${category.id ?? category.name}`} href={href} className="block">
            {content}
          </Link>
        ) : (
          <div key={`${sourceKind}-${category.id ?? category.name}`}>{content}</div>
        );
      })}
    </div>
  );
}

function MainsCategoryList({
  contentType,
  sourceKind,
  categories,
}: {
  contentType: DashboardContentType;
  sourceKind: PerformanceAuditSourceKind;
  categories: PerformanceAuditMainsCategory[];
}) {
  if (categories.length === 0) {
    return <p className="rounded-[18px] border border-dashed border-[#d5dcf2] bg-white px-4 py-5 text-[13px] leading-6 text-[#7b86a4]">No first-level category performance recorded yet.</p>;
  }

  return (
    <div className="space-y-3">
      {categories.map((category) => {
        const href =
          category.has_children && category.id
            ? `/dashboard/subject/${contentType}/${sourceKind}/${category.id}`
            : null;

        const content = (
          <div className="flex flex-col gap-3 rounded-[18px] border border-[#dce3fb] bg-white px-4 py-4 shadow-[inset_0_1px_0_rgba(255,255,255,0.6)] transition hover:border-[#bdd1ff]">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-[16px] font-semibold tracking-[-0.03em] text-[#182033]">{category.name}</p>
                <p className="mt-1 text-[12px] leading-6 text-[#6c7590]">
                  Questions {category.total_questions} | Marks {formatMarks(category.total_score)} / {formatMarks(category.max_total_score)}
                </p>
              </div>
              <div className="text-right">
                <p className="text-[18px] font-semibold tracking-[-0.03em] text-[#1235ae]">{formatPercentage(category.percentage)}</p>
              </div>
            </div>
            {href ? (
              <span className="inline-flex items-center gap-1 text-[12px] font-semibold text-[#1739ac]">
                Open subcategory analysis
                <ArrowRight className="h-3.5 w-3.5" />
              </span>
            ) : (
              <span className="text-[12px] font-semibold text-[#9aa7c5]">No deeper breakdown yet</span>
            )}
          </div>
        );

        return href ? (
          <Link key={`${sourceKind}-${category.id ?? category.name}`} href={href} className="block">
            {content}
          </Link>
        ) : (
          <div key={`${sourceKind}-${category.id ?? category.name}`}>{content}</div>
        );
      })}
    </div>
  );
}

function QuizSectionCard({
  section,
  programRows,
}: {
  section: PerformanceAuditQuizSection;
  programRows: TestSeriesDiscoverySeries[];
}) {
  const meta = DASHBOARD_SECTION_META[section.content_type];
  const Icon = meta.icon;
  const [activeSource, setActiveSource] = useState<PerformanceAuditSourceKind>(() =>
    resolveDefaultSourceKind(section.sources.ai, section.sources.program),
  );
  const source = section.sources[activeSource];
  const suggestionBundle = buildQuizSuggestions(source.first_level_categories, programRows);

  return (
    <section className="rounded-[28px] bg-[linear-gradient(180deg,#f1f4ff_0%,#edf1ff_100%)] px-5 py-5 sm:px-8 sm:py-8 lg:rounded-[34px]">
      <div className="flex flex-col gap-4 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between">
        <div className="flex items-start gap-3">
          <div className="inline-flex h-11 w-11 items-center justify-center rounded-[14px] border border-[#cfe0ff] bg-white text-[#1739ac] shadow-[0_10px_20px_rgba(19,55,173,0.08)]">
            <Icon className="h-5 w-5" />
          </div>
          <div>
            <h2 className="font-sans text-[24px] font-semibold leading-[1.08] tracking-[-0.04em] text-[#141b2d] sm:text-[34px]">
              {section.label}
            </h2>
            <p className="text-[14px] leading-7 text-[#636b86]">Overall performance and first-level category marks.</p>
          </div>
        </div>
        <div className="inline-flex w-full rounded-full bg-white p-1 shadow-[0_14px_28px_rgba(21,31,76,0.08)] sm:w-auto">
          {(["ai", "program"] as const).map((sourceKind) => {
            const isActive = sourceKind === activeSource;
            return (
              <button
                key={`${section.content_type}-${sourceKind}-tab`}
                type="button"
                onClick={() => setActiveSource(sourceKind)}
                className={`flex-1 rounded-full px-4 py-2 text-[12px] font-semibold transition sm:flex-none ${
                  isActive ? "bg-[#173aa9] text-white shadow-[0_12px_24px_rgba(23,58,169,0.22)]" : "text-[#5f6984]"
                }`}
              >
                {sourceLabels[sourceKind]}
              </button>
            );
          })}
        </div>
      </div>

      <article className="mt-6 rounded-[26px] border border-[#d9e2fb] bg-[linear-gradient(180deg,rgba(255,255,255,0.92)_0%,rgba(255,255,255,1)_100%)] p-5 shadow-[0_18px_40px_rgba(80,103,170,0.08)]">
        <div className="flex flex-col items-start gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="text-[12px] font-semibold uppercase tracking-[0.28em] text-[#5f7aa9]">{sourceLabels[activeSource]}</p>
            <h3 className="mt-2 text-[16px] font-semibold tracking-[-0.03em] text-[#182033]">
              {section.label} Overall Performance
            </h3>
          </div>
          <div className="rounded-full border border-[#b9d5ff] bg-[#eef5ff] px-3 py-1 text-[12px] font-semibold text-[#1739ac]">
            {formatPercentage(source.percentage)}
          </div>
        </div>

        <div className="mt-5">
          <QuizMetricGrid metrics={source} />
        </div>

        <div className="mt-6">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h4 className="text-[12px] font-semibold uppercase tracking-[0.28em] text-[#5f7aa9]">Subject Wise Marks</h4>
            <span className="text-[12px] leading-6 text-[#6c7590]">Click a category to open second-level analysis</span>
          </div>
          <div className="mt-3">
            <QuizCategoryList contentType={section.content_type} sourceKind={activeSource} categories={source.first_level_categories} />
          </div>
        </div>

        <ProgramSuggestionPanel suggestionBundle={suggestionBundle} sourceKind={activeSource} />
      </article>
    </section>
  );
}

function MainsSectionCard({
  section,
  programRows,
}: {
  section: PerformanceAuditMainsSection;
  programRows: TestSeriesDiscoverySeries[];
}) {
  const meta = DASHBOARD_SECTION_META.mains;
  const Icon = meta.icon;
  const [activeSource, setActiveSource] = useState<PerformanceAuditSourceKind>(() =>
    resolveDefaultSourceKind(section.sources.ai, section.sources.program),
  );
  const source = section.sources[activeSource];
  const suggestionBundle = buildMainsSuggestions(source.first_level_categories, programRows);

  return (
    <section className="rounded-[28px] bg-[linear-gradient(180deg,#f1f4ff_0%,#edf1ff_100%)] px-5 py-5 sm:px-8 sm:py-8 lg:rounded-[34px]">
      <div className="flex flex-col gap-4 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between">
        <div className="flex items-start gap-3">
          <div className="inline-flex h-11 w-11 items-center justify-center rounded-[14px] border border-[#cfe0ff] bg-white text-[#1739ac] shadow-[0_10px_20px_rgba(19,55,173,0.08)]">
            <Icon className="h-5 w-5" />
          </div>
          <div>
            <h2 className="font-sans text-[24px] font-semibold leading-[1.08] tracking-[-0.04em] text-[#141b2d] sm:text-[34px]">
              {section.label}
            </h2>
            <p className="text-[14px] leading-7 text-[#636b86]">Question count, marks, percentage, and first-level category breakdown.</p>
          </div>
        </div>
        <div className="inline-flex w-full rounded-full bg-white p-1 shadow-[0_14px_28px_rgba(21,31,76,0.08)] sm:w-auto">
          {(["ai", "program"] as const).map((sourceKind) => {
            const isActive = sourceKind === activeSource;
            return (
              <button
                key={`mains-${sourceKind}-tab`}
                type="button"
                onClick={() => setActiveSource(sourceKind)}
                className={`flex-1 rounded-full px-4 py-2 text-[12px] font-semibold transition sm:flex-none ${
                  isActive ? "bg-[#173aa9] text-white shadow-[0_12px_24px_rgba(23,58,169,0.22)]" : "text-[#5f6984]"
                }`}
              >
                {sourceLabels[sourceKind]}
              </button>
            );
          })}
        </div>
      </div>

      <article className="mt-6 rounded-[26px] border border-[#d9e2fb] bg-[linear-gradient(180deg,rgba(255,255,255,0.92)_0%,rgba(255,255,255,1)_100%)] p-5 shadow-[0_18px_40px_rgba(80,103,170,0.08)]">
        <div className="flex flex-col items-start gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="text-[12px] font-semibold uppercase tracking-[0.28em] text-[#5f7aa9]">{sourceLabels[activeSource]}</p>
            <h3 className="mt-2 text-[16px] font-semibold tracking-[-0.03em] text-[#182033]">Mains Overall Performance</h3>
          </div>
          <div className="rounded-full border border-[#b9d5ff] bg-[#eef5ff] px-3 py-1 text-[12px] font-semibold text-[#1739ac]">
            {formatPercentage(source.percentage)}
          </div>
        </div>

        <div className="mt-5">
          <MainsMetricGrid metrics={source} />
        </div>

        <div className="mt-6">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h4 className="text-[12px] font-semibold uppercase tracking-[0.28em] text-[#5f7aa9]">Subject Wise Marks</h4>
            <span className="text-[12px] leading-6 text-[#6c7590]">Click a category to open second-level analysis</span>
          </div>
          <div className="mt-3">
            <MainsCategoryList contentType="mains" sourceKind={activeSource} categories={source.first_level_categories} />
          </div>
        </div>

        <ProgramSuggestionPanel suggestionBundle={suggestionBundle} sourceKind={activeSource} />
      </article>
    </section>
  );
}

export default function LearnerPerformanceAudit() {
  const { loading: authLoading, isAuthenticated, showLoginModal } = useAuth();
  const { globalExamId, globalExamName } = useExamContext();
  const [payload, setPayload] = useState<PerformanceAuditOverviewPayload | null>(null);
  const [quizProgramRows, setQuizProgramRows] = useState<TestSeriesDiscoverySeries[]>([]);
  const [mainsProgramRows, setMainsProgramRows] = useState<TestSeriesDiscoverySeries[]>([]);
  const [error, setError] = useState("");

  useEffect(() => {
    if (authLoading || !isAuthenticated) return;
    let active = true;

    Promise.allSettled([
      premiumApi.get<PerformanceAuditOverviewPayload>("/user/performance-audit", {
        params: { exam_id: globalExamId || undefined },
      }),
      premiumApi.get<TestSeriesDiscoverySeries[]>("/programs-discovery/series", {
        params: { limit: 120, series_kind: "quiz", exam_id: globalExamId || undefined },
      }),
      premiumApi.get<TestSeriesDiscoverySeries[]>("/programs-discovery/series", {
        params: { limit: 120, series_kind: "mains", exam_id: globalExamId || undefined },
      }),
    ]).then(([auditResult, quizProgramsResult, mainsProgramsResult]) => {
      if (!active) return;

      if (auditResult.status === "fulfilled") {
        setPayload(auditResult.value.data);
        setError("");
      } else {
        const err = auditResult.reason;
        const detail =
          typeof err === "object" &&
          err !== null &&
          "response" in err &&
          (err as { response?: { data?: { detail?: string } } }).response?.data?.detail
            ? String((err as { response?: { data?: { detail?: string } } }).response?.data?.detail)
            : "Failed to load performance audit.";
        setError(detail);
        setPayload(null);
      }

      setQuizProgramRows(
        quizProgramsResult.status === "fulfilled" && Array.isArray(quizProgramsResult.value.data)
          ? quizProgramsResult.value.data.filter((row) => matchesExamIds(row.series.exam_ids, globalExamId))
          : [],
      );
      setMainsProgramRows(
        mainsProgramsResult.status === "fulfilled" && Array.isArray(mainsProgramsResult.value.data)
          ? mainsProgramsResult.value.data.filter((row) => matchesExamIds(row.series.exam_ids, globalExamId))
          : [],
      );
    });

    return () => {
      active = false;
    };
  }, [authLoading, globalExamId, isAuthenticated]);

  const loading = authLoading || (isAuthenticated && !payload && !error);
  const sections = useMemo(() => {
    if (!payload) return [];
    return DASHBOARD_CONTENT_TYPES.map((contentType) => payload.sections[contentType]);
  }, [payload]);

  return (
    <div className="space-y-6 text-[#192133]">
      <section className="rounded-[26px] border border-[#dbe3fb] bg-[radial-gradient(circle_at_top_left,_rgba(223,232,255,0.95),_rgba(255,255,255,1)_42%,_rgba(241,245,255,0.98)_100%)] p-5 shadow-sm sm:p-6 lg:rounded-[30px]">
        <div className="flex flex-col items-start gap-4 sm:flex-row sm:flex-wrap sm:items-start sm:justify-between">
          <div className="max-w-3xl space-y-3">
            <p className="text-xs font-black uppercase tracking-[0.32em] text-[#1d3b8b]">Performance Audit</p>
            <h2 className="font-sans text-[28px] font-semibold leading-[1.1] tracking-[-0.04em] text-[#1737af] sm:text-[40px]">
              Marks-focused evaluation across all content types.
            </h2>
            <p className="text-[14px] leading-7 text-[#6d7690]">
              AI-based content and program-based content are split separately. Each section shows overall marks first, then first-level category performance. Open a category to view second-level breakdown and AI analysis.
            </p>
            {globalExamName ? (
              <p className="text-[12px] font-semibold uppercase tracking-[0.2em] text-[#5f7aa9]">Exam scope: {globalExamName}</p>
            ) : null}
          </div>
          <div className="rounded-[18px] bg-white px-4 py-3 text-[12px] leading-6 text-[#6c7590] shadow-[0_14px_28px_rgba(21,31,76,0.08)]">
            Updated {formatTimestamp(payload?.generated_at)}
          </div>
        </div>
      </section>

      {loading ? (
        <div className="flex items-center gap-3 rounded-2xl border border-slate-200 bg-white p-8 text-slate-600">
          <Loader2 className="h-5 w-5 animate-spin text-[#0f2e87]" />
          Loading performance audit...
        </div>
      ) : null}

      {!loading && !isAuthenticated ? (
        <div className="rounded-2xl border border-slate-200 bg-white p-8">
          <p className="text-slate-700">Login is required to view your marks and category-wise performance.</p>
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
        <div className="space-y-6">
          {sections.map((section) =>
            section.is_quiz ? (
              <QuizSectionCard key={section.content_type} section={section} programRows={quizProgramRows} />
            ) : (
              <MainsSectionCard key={section.content_type} section={section} programRows={mainsProgramRows} />
            ),
          )}
        </div>
      ) : null}
    </div>
  );
}
