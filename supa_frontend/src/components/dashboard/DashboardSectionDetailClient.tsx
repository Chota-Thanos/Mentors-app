"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import {
  AlertCircle,
  ArrowLeft,
  Brain,
  ListChecks,
  Loader2,
  Target,
  TrendingDown,
  TriangleAlert,
} from "lucide-react";

import MiniTrendChart from "@/components/dashboard/MiniTrendChart";
import { useAuth } from "@/context/AuthContext";
import { DASHBOARD_CONTENT_TYPES, DASHBOARD_SECTION_META, type DashboardContentType } from "@/lib/dashboardSections";
import { premiumApi } from "@/lib/premiumApi";
import type {
  DashboardAnalyticsPayload,
  DashboardMainsAreaPerformance,
  DashboardMainsSection,
  DashboardPerformanceBand,
  DashboardQuizCategoryPerformance,
  DashboardQuizSection,
} from "@/types/premium";

const formatDateTime = (value: string): string => {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return "Unknown time";
  return parsed.toLocaleString("en-IN", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
};

const bandToneMap: Record<DashboardPerformanceBand, string> = {
  best: "border-emerald-200 bg-emerald-50 text-emerald-800",
  average: "border-amber-200 bg-amber-50 text-amber-800",
  bad: "border-rose-200 bg-rose-50 text-rose-800",
};

const bandLabelMap: Record<DashboardPerformanceBand, string> = {
  best: "Best",
  average: "Average",
  bad: "Needs Work",
};

const emptyGroups = {
  best: [],
  average: [],
  bad: [],
};

export default function DashboardSectionDetailClient({ contentType }: { contentType: DashboardContentType }) {
  const { loading: authLoading, isAuthenticated, showLoginModal } = useAuth();
  const [error, setError] = useState("");
  const [analytics, setAnalytics] = useState<DashboardAnalyticsPayload | null>(null);

  useEffect(() => {
    if (authLoading || !isAuthenticated) return;
    let active = true;
    premiumApi
      .get<DashboardAnalyticsPayload>("/user/dashboard-analytics")
      .then((response) => {
        if (!active) return;
        setAnalytics(response.data);
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
            : "Failed to load detailed analytics.";
        setError(detail);
        setAnalytics(null);
      });

    return () => {
      active = false;
    };
  }, [authLoading, isAuthenticated]);

  const loading = authLoading || (isAuthenticated && !analytics && !error);
  const section = analytics?.sections[contentType] ?? null;
  const isQuiz = contentType !== "mains";
  const quizSection = isQuiz ? (section as DashboardQuizSection | null) : null;
  const mainsSection = !isQuiz ? (section as DashboardMainsSection | null) : null;
  const meta = DASHBOARD_SECTION_META[contentType];
  const SectionIcon = meta.icon;

  const filteredRecentActivity = useMemo(() => {
    if (!analytics) return [];
    return analytics.recent_activity.filter((item) => {
      if (item.type === contentType) return true;
      if (isQuiz && item.type === "mixed_quiz") return true;
      return false;
    });
  }, [analytics, contentType, isQuiz]);

  const quizGroups = quizSection?.performance_groups ?? emptyGroups;
  const mainsGroups = mainsSection?.performance_groups ?? emptyGroups;
  const quizRows = quizSection?.category_performance ?? [];
  const mainsRows = mainsSection?.area_performance ?? mainsSection?.category_performance ?? [];

  return (
    <div className="mx-auto max-w-7xl space-y-6 p-4 md:p-6">
      <header className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="space-y-1">
            <Link href="/dashboard" className="inline-flex items-center gap-1 text-sm font-semibold text-slate-600 hover:text-slate-900">
              <ArrowLeft className="h-4 w-4" />
              Back to Dashboard Summary
            </Link>
            <h1 className="text-3xl font-black tracking-tight text-slate-900">{meta.label} Detailed Analytics</h1>
            <p className="text-sm text-slate-600">
              Category-wise and trend-wise view with clear best, average, and weak performance clusters.
            </p>
          </div>
          {analytics?.generated_at ? <p className="text-xs text-slate-500">Updated {formatDateTime(analytics.generated_at)}</p> : null}
        </div>
        <nav className="grid grid-cols-2 gap-2 md:grid-cols-4">
          {DASHBOARD_CONTENT_TYPES.map((type) => {
            const tabMeta = DASHBOARD_SECTION_META[type];
            const TabIcon = tabMeta.icon;
            const isActive = type === contentType;
            return (
              <Link
                key={type}
                href={`/dashboard/${type}`}
                className={`rounded-xl border px-3 py-2 text-sm font-semibold transition ${
                  isActive ? "border-slate-900 bg-slate-900 text-white" : "border-slate-200 bg-white text-slate-700 hover:border-slate-300"
                }`}
              >
                <span className="inline-flex items-center gap-2">
                  <TabIcon className="h-4 w-4" />
                  {tabMeta.label}
                </span>
              </Link>
            );
          })}
        </nav>
      </header>

      {loading ? (
        <div className="rounded-2xl border border-slate-200 bg-white p-8 text-slate-600 flex items-center gap-3">
          <Loader2 className="h-5 w-5 animate-spin text-indigo-600" />
          Loading detailed analytics...
        </div>
      ) : null}

      {!loading && !isAuthenticated ? (
        <div className="rounded-2xl border border-slate-200 bg-white p-8 space-y-4">
          <p className="text-slate-700">Login is required to view personalized analytics.</p>
          <button
            type="button"
            onClick={showLoginModal}
            className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-semibold text-white"
          >
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

      {!loading && isAuthenticated && analytics && section ? (
        <>
          <section className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
            <div className="rounded-2xl border border-slate-200 bg-white p-5">
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Activities</p>
              <p className="mt-2 text-3xl font-black text-slate-900">{section.activity_count}</p>
            </div>
            <div className="rounded-2xl border border-slate-200 bg-white p-5">
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Questions</p>
              <p className="mt-2 text-3xl font-black text-slate-900">{section.question_count}</p>
            </div>
            {quizSection ? (
              <>
                <div className="rounded-2xl border border-slate-200 bg-white p-5">
                  <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Accuracy</p>
                  <p className="mt-2 text-3xl font-black text-slate-900">{quizSection.accuracy.toFixed(1)}%</p>
                </div>
                <div className="rounded-2xl border border-slate-200 bg-white p-5">
                  <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Correct / Incorrect</p>
                  <p className="mt-2 text-2xl font-black text-slate-900">
                    {quizSection.correct_count} / {quizSection.incorrect_count}
                  </p>
                  <p className="mt-1 text-xs text-slate-500">Unanswered: {quizSection.unanswered_count}</p>
                </div>
              </>
            ) : (
              <>
                <div className="rounded-2xl border border-slate-200 bg-white p-5">
                  <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Average Score</p>
                  <p className="mt-2 text-3xl font-black text-slate-900">{mainsSection?.average_score.toFixed(2)}/10</p>
                </div>
                <div className="rounded-2xl border border-slate-200 bg-white p-5">
                  <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Score %</p>
                  <p className="mt-2 text-3xl font-black text-slate-900">{mainsSection?.score_percent.toFixed(1)}%</p>
                  <p className="mt-1 text-xs text-slate-500">
                    Total {mainsSection?.total_score.toFixed(1)} / {mainsSection?.max_total_score.toFixed(1)}
                  </p>
                </div>
              </>
            )}
          </section>

          <section className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            <MiniTrendChart
              title="7 Day Trend"
              points={section.trend_7d}
              yMax={isQuiz ? 100 : 10}
              stroke={meta.chartStroke}
              formatValue={(value) => (isQuiz ? `${value.toFixed(1)}%` : `${value.toFixed(2)}/10`)}
            />
            <MiniTrendChart
              title="30 Day Trend"
              points={section.trend_30d}
              yMax={isQuiz ? 100 : 10}
              stroke={meta.chartStroke}
              formatValue={(value) => (isQuiz ? `${value.toFixed(1)}%` : `${value.toFixed(2)}/10`)}
            />
          </section>

          {quizSection ? (
            <section className="rounded-2xl border border-slate-200 bg-white p-6 space-y-4">
              <h2 className="text-lg font-bold text-slate-900 flex items-center gap-2">
                <SectionIcon className="h-5 w-5 text-slate-700" />
                Category Performance Bands
              </h2>
              <div className="grid grid-cols-1 gap-3 lg:grid-cols-3">
                <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-4">
                  <p className="text-xs font-semibold uppercase tracking-wide text-emerald-700">Best Performing</p>
                  {quizGroups.best.length === 0 ? (
                    <p className="mt-2 text-sm text-emerald-900/80">No high-performing category yet.</p>
                  ) : (
                    <div className="mt-3 space-y-2">
                      {quizGroups.best.slice(0, 6).map((row: DashboardQuizCategoryPerformance) => (
                        <div key={`best-${row.name}`} className="rounded-lg border border-emerald-200 bg-white/80 px-3 py-2">
                          <p className="text-sm font-semibold text-emerald-900">{row.name}</p>
                          <p className="text-xs text-emerald-800">{row.accuracy.toFixed(1)}% accuracy on {row.total} questions</p>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
                <div className="rounded-xl border border-amber-200 bg-amber-50 p-4">
                  <p className="text-xs font-semibold uppercase tracking-wide text-amber-700">Average Performing</p>
                  {quizGroups.average.length === 0 ? (
                    <p className="mt-2 text-sm text-amber-900/80">No mid-band category right now.</p>
                  ) : (
                    <div className="mt-3 space-y-2">
                      {quizGroups.average.slice(0, 6).map((row: DashboardQuizCategoryPerformance) => (
                        <div key={`avg-${row.name}`} className="rounded-lg border border-amber-200 bg-white/80 px-3 py-2">
                          <p className="text-sm font-semibold text-amber-900">{row.name}</p>
                          <p className="text-xs text-amber-800">{row.accuracy.toFixed(1)}% accuracy on {row.total} questions</p>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
                <div className="rounded-xl border border-rose-200 bg-rose-50 p-4">
                  <p className="text-xs font-semibold uppercase tracking-wide text-rose-700">Bad Performance Areas</p>
                  {quizGroups.bad.length === 0 ? (
                    <p className="mt-2 text-sm text-rose-900/80">No critical weak category currently.</p>
                  ) : (
                    <div className="mt-3 space-y-2">
                      {quizGroups.bad.slice(0, 6).map((row: DashboardQuizCategoryPerformance) => (
                        <div key={`bad-${row.name}`} className="rounded-lg border border-rose-200 bg-white/80 px-3 py-2">
                          <p className="text-sm font-semibold text-rose-900">{row.name}</p>
                          <p className="text-xs text-rose-800">{row.accuracy.toFixed(1)}% accuracy on {row.total} questions</p>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            </section>
          ) : (
            <section className="rounded-2xl border border-slate-200 bg-white p-6 space-y-4">
              <h2 className="text-lg font-bold text-slate-900 flex items-center gap-2">
                <Brain className="h-5 w-5 text-slate-700" />
                Answer-Writing Area Bands
              </h2>
              <div className="grid grid-cols-1 gap-3 lg:grid-cols-3">
                <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-4">
                  <p className="text-xs font-semibold uppercase tracking-wide text-emerald-700">Best Performing</p>
                  {mainsGroups.best.length === 0 ? (
                    <p className="mt-2 text-sm text-emerald-900/80">No strong recurring area yet.</p>
                  ) : (
                    <div className="mt-3 space-y-2">
                      {mainsGroups.best.slice(0, 6).map((row: DashboardMainsAreaPerformance) => (
                        <div key={`best-${row.name}`} className="rounded-lg border border-emerald-200 bg-white/80 px-3 py-2">
                          <p className="text-sm font-semibold text-emerald-900">{row.name}</p>
                          <p className="text-xs text-emerald-800">{row.strength_ratio.toFixed(1)}% positive mentions ({row.total_mentions})</p>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
                <div className="rounded-xl border border-amber-200 bg-amber-50 p-4">
                  <p className="text-xs font-semibold uppercase tracking-wide text-amber-700">Average Performing</p>
                  {mainsGroups.average.length === 0 ? (
                    <p className="mt-2 text-sm text-amber-900/80">No stable mid-band area currently.</p>
                  ) : (
                    <div className="mt-3 space-y-2">
                      {mainsGroups.average.slice(0, 6).map((row: DashboardMainsAreaPerformance) => (
                        <div key={`avg-${row.name}`} className="rounded-lg border border-amber-200 bg-white/80 px-3 py-2">
                          <p className="text-sm font-semibold text-amber-900">{row.name}</p>
                          <p className="text-xs text-amber-800">{row.strength_ratio.toFixed(1)}% positive mentions ({row.total_mentions})</p>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
                <div className="rounded-xl border border-rose-200 bg-rose-50 p-4">
                  <p className="text-xs font-semibold uppercase tracking-wide text-rose-700">Bad Performance Areas</p>
                  {mainsGroups.bad.length === 0 ? (
                    <p className="mt-2 text-sm text-rose-900/80">No recurring weak area cluster yet.</p>
                  ) : (
                    <div className="mt-3 space-y-2">
                      {mainsGroups.bad.slice(0, 6).map((row: DashboardMainsAreaPerformance) => (
                        <div key={`bad-${row.name}`} className="rounded-lg border border-rose-200 bg-white/80 px-3 py-2">
                          <p className="text-sm font-semibold text-rose-900">{row.name}</p>
                          <p className="text-xs text-rose-800">{row.strength_ratio.toFixed(1)}% positive mentions ({row.total_mentions})</p>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            </section>
          )}

          <section className="rounded-2xl border border-slate-200 bg-white p-6 space-y-4">
            <h2 className="text-lg font-bold text-slate-900 flex items-center gap-2">
              <ListChecks className="h-5 w-5 text-slate-700" />
              Comprehensive Breakdown
            </h2>
            {quizSection ? (
              quizRows.length === 0 ? (
                <p className="text-sm text-slate-500">No category-level quiz data available yet.</p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="min-w-full border-separate border-spacing-0 text-sm">
                    <thead>
                      <tr className="text-left">
                        <th className="border-b border-slate-200 px-3 py-2 font-semibold text-slate-600">Category</th>
                        <th className="border-b border-slate-200 px-3 py-2 font-semibold text-slate-600">Total</th>
                        <th className="border-b border-slate-200 px-3 py-2 font-semibold text-slate-600">Correct</th>
                        <th className="border-b border-slate-200 px-3 py-2 font-semibold text-slate-600">Incorrect</th>
                        <th className="border-b border-slate-200 px-3 py-2 font-semibold text-slate-600">Unanswered</th>
                        <th className="border-b border-slate-200 px-3 py-2 font-semibold text-slate-600">Accuracy</th>
                        <th className="border-b border-slate-200 px-3 py-2 font-semibold text-slate-600">Band</th>
                      </tr>
                    </thead>
                    <tbody>
                      {quizRows.map((row) => (
                        <tr key={`quiz-row-${row.name}`} className="hover:bg-slate-50">
                          <td className="border-b border-slate-100 px-3 py-2 font-medium text-slate-800">{row.name}</td>
                          <td className="border-b border-slate-100 px-3 py-2 text-slate-700">{row.total}</td>
                          <td className="border-b border-slate-100 px-3 py-2 text-emerald-700">{row.correct}</td>
                          <td className="border-b border-slate-100 px-3 py-2 text-rose-700">{row.incorrect}</td>
                          <td className="border-b border-slate-100 px-3 py-2 text-amber-700">{row.unanswered}</td>
                          <td className="border-b border-slate-100 px-3 py-2 text-slate-800">{row.accuracy.toFixed(1)}%</td>
                          <td className="border-b border-slate-100 px-3 py-2">
                            <span className={`rounded-full border px-2 py-1 text-xs font-semibold ${bandToneMap[row.band]}`}>
                              {bandLabelMap[row.band]}
                            </span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )
            ) : mainsRows.length === 0 ? (
              <p className="text-sm text-slate-500">No area-level mains analytics available yet.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="min-w-full border-separate border-spacing-0 text-sm">
                  <thead>
                    <tr className="text-left">
                      <th className="border-b border-slate-200 px-3 py-2 font-semibold text-slate-600">Answer Area</th>
                      <th className="border-b border-slate-200 px-3 py-2 font-semibold text-slate-600">Strength Mentions</th>
                      <th className="border-b border-slate-200 px-3 py-2 font-semibold text-slate-600">Weakness Mentions</th>
                      <th className="border-b border-slate-200 px-3 py-2 font-semibold text-slate-600">Total Mentions</th>
                      <th className="border-b border-slate-200 px-3 py-2 font-semibold text-slate-600">Positive Ratio</th>
                      <th className="border-b border-slate-200 px-3 py-2 font-semibold text-slate-600">Band</th>
                    </tr>
                  </thead>
                  <tbody>
                    {mainsRows.map((row) => (
                      <tr key={`mains-row-${row.name}`} className="hover:bg-slate-50">
                        <td className="border-b border-slate-100 px-3 py-2 font-medium text-slate-800">{row.name}</td>
                        <td className="border-b border-slate-100 px-3 py-2 text-emerald-700">{row.strength_count}</td>
                        <td className="border-b border-slate-100 px-3 py-2 text-rose-700">{row.weakness_count}</td>
                        <td className="border-b border-slate-100 px-3 py-2 text-slate-700">{row.total_mentions}</td>
                        <td className="border-b border-slate-100 px-3 py-2 text-slate-800">{row.strength_ratio.toFixed(1)}%</td>
                        <td className="border-b border-slate-100 px-3 py-2">
                          <span className={`rounded-full border px-2 py-1 text-xs font-semibold ${bandToneMap[row.band]}`}>
                            {bandLabelMap[row.band]}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          <section className="grid grid-cols-1 gap-4 xl:grid-cols-3">
            <div className="rounded-2xl border border-slate-200 bg-white p-5">
              <h3 className="text-sm font-semibold text-slate-900 flex items-center gap-2">
                <TrendingDown className="h-4 w-4 text-rose-600" />
                Weak Areas
              </h3>
              {section.weak_areas.length === 0 ? (
                <p className="mt-3 text-sm text-slate-500">No dominant weak areas detected yet.</p>
              ) : (
                <div className="mt-3 space-y-2">
                  {section.weak_areas.map((area, index) => (
                    <p key={`weak-${area.name}-${index}`} className="text-sm text-slate-700">
                      {index + 1}. {area.name} <span className="text-slate-500">({area.count})</span>
                    </p>
                  ))}
                </div>
              )}
            </div>
            <div className="rounded-2xl border border-slate-200 bg-white p-5">
              <h3 className="text-sm font-semibold text-slate-900 flex items-center gap-2">
                <TriangleAlert className="h-4 w-4 text-amber-600" />
                Recurring Errors
              </h3>
              {section.recurring_errors.length === 0 ? (
                <p className="mt-3 text-sm text-slate-500">No repeated error pattern detected yet.</p>
              ) : (
                <div className="mt-3 space-y-2">
                  {section.recurring_errors.map((item, index) => (
                    <p key={`rec-${item.name}-${index}`} className="text-sm text-slate-700">
                      {index + 1}. {item.name} <span className="text-slate-500">x{item.count}</span>
                    </p>
                  ))}
                </div>
              )}
            </div>
            <div className="rounded-2xl border border-slate-200 bg-white p-5">
              <h3 className="text-sm font-semibold text-slate-900 flex items-center gap-2">
                <Target className="h-4 w-4 text-indigo-600" />
                Recommended Plan
              </h3>
              {section.recommendations.length === 0 ? (
                <p className="mt-3 text-sm text-slate-500">No recommendation generated yet.</p>
              ) : (
                <div className="mt-3 space-y-2">
                  {section.recommendations.map((line, index) => (
                    <p key={`tip-${line}-${index}`} className="text-sm text-slate-700">
                      {index + 1}. {line}
                    </p>
                  ))}
                </div>
              )}
            </div>
          </section>

          <section className="rounded-2xl border border-slate-200 bg-white p-6">
            <h2 className="text-lg font-bold text-slate-900 mb-4">Recent Activity for {meta.label}</h2>
            {filteredRecentActivity.length === 0 ? (
              <p className="text-sm text-slate-500">No recent activity in this area.</p>
            ) : (
              <div className="space-y-2">
                {filteredRecentActivity.slice(0, 15).map((entry, index) => (
                  <div key={`${entry.created_at}-${entry.title}-${index}`} className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <p className="font-semibold text-slate-800">{entry.title}</p>
                      <span className="text-xs text-slate-500">{formatDateTime(entry.created_at)}</span>
                    </div>
                    <div className="mt-1 flex flex-wrap items-center gap-3 text-xs text-slate-600">
                      <span className="uppercase font-semibold">{entry.type}</span>
                      <span>Score: {entry.score_text}</span>
                      <span>Accuracy: {entry.accuracy.toFixed(1)}%</span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </section>
        </>
      ) : null}
    </div>
  );
}
