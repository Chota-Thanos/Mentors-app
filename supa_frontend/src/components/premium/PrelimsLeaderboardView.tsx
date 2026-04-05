"use client";

import axios from "axios";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import {
  BarChart3,
  FileQuestion,
  Loader2,
  Medal,
  RefreshCcw,
  Trophy,
} from "lucide-react";
import { toast } from "sonner";

import HistoryBackButton from "@/components/ui/HistoryBackButton";
import RoleWorkspaceSidebar from "@/components/layouts/RoleWorkspaceSidebar";
import { getQuizMasterWorkspaceSections } from "@/components/layouts/roleWorkspaceLinks";
import { useAuth } from "@/context/AuthContext";
import { isAdminLike, isProviderLike, isModeratorLike } from "@/lib/accessControl";
import { premiumApi } from "@/lib/premiumApi";
import type { TestSeries, TestSeriesEnrollment, TestSeriesTest } from "@/types/premium";

function toError(error: unknown): string {
  if (!axios.isAxiosError(error)) return "Unknown error";
  const detail = error.response?.data?.detail;
  return typeof detail === "string" && detail.trim() ? detail : error.message;
}

function maskUserId(userId: string): string {
  if (!userId || userId.length < 8) return userId || "—";
  return `${userId.slice(0, 6)}••••${userId.slice(-4)}`;
}

function formatDate(value?: string | null): string {
  if (!value) return "—";
  const d = new Date(value);
  if (isNaN(d.getTime())) return "—";
  return d.toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
}

// Shape returned per-test from /tests/{id}/quiz-attempts-summary (or similar)
interface AttemptLeaderboardEntry {
  user_id: string;
  best_score: number;
  best_accuracy: number;
  correct_answers: number;
  incorrect_answers: number;
  unanswered: number;
  total_questions: number;
  attempts: number;
  last_attempted_at?: string | null;
}

interface LeaderboardPayload {
  test_id: number;
  entries: AttemptLeaderboardEntry[];
}

function rankMedal(rank: number) {
  if (rank === 1)
    return <span className="text-xl">🥇</span>;
  if (rank === 2)
    return <span className="text-xl">🥈</span>;
  if (rank === 3)
    return <span className="text-xl">🥉</span>;
  return (
    <span className="flex h-7 w-7 items-center justify-center rounded-full border border-slate-200 bg-slate-100 text-xs font-black text-slate-600">
      {rank}
    </span>
  );
}

function AccuracyBar({ accuracy }: { accuracy: number }) {
  const pct = Math.min(100, Math.max(0, Math.round(accuracy)));
  const color =
    pct >= 70 ? "bg-emerald-500" : pct >= 50 ? "bg-amber-400" : "bg-rose-400";
  return (
    <div className="flex items-center gap-2">
      <div className="h-1.5 w-16 overflow-hidden rounded-full bg-slate-100">
        <div className={`h-full rounded-full ${color}`} style={{ width: `${pct}%` }} />
      </div>
      <span className="min-w-[36px] text-xs font-bold text-slate-700">{pct}%</span>
    </div>
  );
}

function EmptyLeaderboard({ testTitle }: { testTitle: string }) {
  return (
    <div className="flex flex-col items-center gap-4 py-16 text-center">
      <div className="flex h-16 w-16 items-center justify-center rounded-full bg-slate-100 text-slate-400">
        <BarChart3 className="h-8 w-8" />
      </div>
      <p className="text-lg font-bold text-slate-800">No attempts yet</p>
      <p className="max-w-sm text-sm text-slate-500">
        No learners have attempted <strong>{testTitle}</strong> yet. Rankings will appear here once
        atleast one submission is recorded.
      </p>
    </div>
  );
}

export default function PrelimsLeaderboardView({ seriesId }: { seriesId: number }) {
  const { user, loading: authLoading, isAuthenticated } = useAuth();
  const adminLike = useMemo(() => isAdminLike(user), [user]);
  const providerLike = useMemo(() => isProviderLike(user), [user]);
  const moderatorLike = useMemo(() => isModeratorLike(user), [user]);
  const currentUserId = String(user?.id || "").trim();

  const workspaceSections = useMemo(
    () => getQuizMasterWorkspaceSections(currentUserId || undefined),
    [currentUserId],
  );

  const [busy, setBusy] = useState(true);
  const [series, setSeries] = useState<TestSeries | null>(null);
  const [tests, setTests] = useState<TestSeriesTest[]>([]);
  const [enrollments, setEnrollments] = useState<TestSeriesEnrollment[]>([]);
  const [leaderboardByTest, setLeaderboardByTest] = useState<Record<number, AttemptLeaderboardEntry[]>>({});
  const [selectedTestId, setSelectedTestId] = useState<number | null>(null);
  const [leaderboardLoading, setLeaderboardLoading] = useState(false);

  const canAccess = useMemo(() => {
    if (!series) return false;
    if (adminLike || moderatorLike) return true;
    if (!currentUserId) return false;
    return providerLike && series.provider_user_id === currentUserId;
  }, [series, adminLike, moderatorLike, providerLike, currentUserId]);

  const loadLeaderboardForTest = async (testId: number) => {
    if (leaderboardByTest[testId] !== undefined) return; // already loaded
    setLeaderboardLoading(true);
    try {
      // Try to fetch the per-test quiz leaderboard  
      const res = await premiumApi.get<LeaderboardPayload>(
        `/programs/${seriesId}/tests/${testId}/leaderboard`,
      );
      const entries = Array.isArray(res.data?.entries) ? res.data.entries : [];
      setLeaderboardByTest((prev) => ({ ...prev, [testId]: entries }));
    } catch {
      // If no leaderboard endpoint exists, fall back to empty
      setLeaderboardByTest((prev) => ({ ...prev, [testId]: [] }));
    } finally {
      setLeaderboardLoading(false);
    }
  };

  const loadData = async () => {
    setBusy(true);
    try {
      const [seriesRes, testsRes, enrollmentsRes] = await Promise.all([
        premiumApi.get<TestSeries>(`/programs/${seriesId}`),
        premiumApi.get<TestSeriesTest[]>(`/programs/${seriesId}/tests`, {
          params: { include_inactive: true },
        }),
        premiumApi.get<TestSeriesEnrollment[]>(`/programs/${seriesId}/enrollments`),
      ]);
      setSeries(seriesRes.data);
      const nextTests = Array.isArray(testsRes.data)
        ? testsRes.data.filter((t) => t.test_kind === "prelims")
        : [];
      setTests(nextTests);
      setEnrollments(Array.isArray(enrollmentsRes.data) ? enrollmentsRes.data : []);
      setLeaderboardByTest({});

      const firstTestId = nextTests[0]?.id ?? null;
      setSelectedTestId(firstTestId);
    } catch (error: unknown) {
      toast.error("Failed to load leaderboard", { description: toError(error) });
      setSeries(null);
      setTests([]);
      setEnrollments([]);
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => {
    if (authLoading) return;
    if (!isAuthenticated) {
      setBusy(false);
      return;
    }
    void loadData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [seriesId, authLoading, isAuthenticated]);

  // Load leaderboard whenever selected test changes
  useEffect(() => {
    if (selectedTestId && canAccess) {
      void loadLeaderboardForTest(selectedTestId);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedTestId, canAccess]);

  const orderedTests = useMemo(
    () =>
      [...tests].sort((a, b) => {
        const ao = Number.isFinite(a.series_order) ? Number(a.series_order) : 9999;
        const bo = Number.isFinite(b.series_order) ? Number(b.series_order) : 9999;
        return ao - bo || a.id - b.id;
      }),
    [tests],
  );

  const selectedTest = useMemo(
    () => orderedTests.find((t) => t.id === selectedTestId) ?? null,
    [orderedTests, selectedTestId],
  );

  const activeEntries = useMemo(
    () =>
      selectedTestId !== null
        ? (leaderboardByTest[selectedTestId] ?? []).slice().sort((a, b) => b.best_score - a.best_score)
        : [],
    [leaderboardByTest, selectedTestId],
  );

  const totalEnrolled = useMemo(
    () => enrollments.filter((e) => e.status === "active").length,
    [enrollments],
  );

  if (authLoading || busy) {
    return (
      <div className="flex items-center justify-center rounded-[32px] border border-slate-200 bg-white p-16">
        <Loader2 className="h-7 w-7 animate-spin text-indigo-500" />
      </div>
    );
  }

  if (!isAuthenticated) {
    return (
      <div className="rounded-[28px] border border-amber-200 bg-amber-50 p-6 text-sm text-amber-800">
        Sign in to view leaderboard data.
      </div>
    );
  }

  if (!series) {
    return (
      <div className="rounded-[28px] border border-rose-200 bg-rose-50 p-6 text-sm text-rose-700">
        Series not found or inaccessible.
      </div>
    );
  }

  if (!canAccess) {
    return (
      <div className="rounded-[28px] border border-amber-200 bg-amber-50 p-6 text-sm text-amber-800">
        You do not have access to this series&apos; leaderboard.
      </div>
    );
  }

  return (
    <div className="mx-auto flex max-w-7xl flex-col gap-6 lg:flex-row">
      <RoleWorkspaceSidebar
        title="Prelims Expert Workspace"
        subtitle="Program control, quiz authoring, and learner analytics."
        sections={workspaceSections}
        className="lg:self-start"
      />

      <div className="min-w-0 flex-1 space-y-6">
        {/* Hero */}
        <section className="relative overflow-hidden rounded-[34px] border border-slate-200 bg-white p-6 shadow-sm sm:p-8">
          <div className="pointer-events-none absolute right-0 top-0 h-full w-full opacity-40 bg-[radial-gradient(circle_at_top_right,_rgba(99,102,241,0.18),_transparent_50%)]" />
          <div className="relative">
            <HistoryBackButton
              fallbackHref={`/programs/${seriesId}/manage`}
              label="Back to workspace"
              className="inline-flex items-center gap-1.5 rounded-full bg-slate-50 px-3 py-1.5 text-xs font-semibold text-slate-600 transition-colors hover:bg-slate-100 hover:text-slate-900"
              iconClassName="h-3 w-3"
            />
            <p className="mt-6 text-xs font-semibold uppercase tracking-[0.28em] text-indigo-600">
              Rankings & Scores
            </p>
            <h1 className="mt-3 text-4xl font-black tracking-tight text-slate-950 sm:text-5xl text-balance">
              {series.title}
            </h1>
            <p className="mt-4 max-w-xl text-base leading-relaxed text-slate-600">
              Per-test leaderboard for this prelims program. Select a test below to see how learners
              ranked based on their best score.
            </p>

            {/* Quick stats */}
            <div className="mt-6 flex flex-wrap gap-4">
              <div className="flex items-center gap-3 rounded-2xl border border-slate-100 bg-slate-50 px-4 py-3">
                <Medal className="h-5 w-5 text-indigo-500" />
                <div>
                  <p className="text-xl font-black text-slate-950 leading-none">
                    {orderedTests.length}
                  </p>
                  <p className="text-[10px] font-bold uppercase tracking-wider text-slate-600 mt-0.5">
                    Prelims Tests
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-3 rounded-2xl border border-slate-100 bg-slate-50 px-4 py-3">
                <Trophy className="h-5 w-5 text-amber-500" />
                <div>
                  <p className="text-xl font-black text-slate-950 leading-none">{totalEnrolled}</p>
                  <p className="text-[10px] font-bold uppercase tracking-wider text-slate-600 mt-0.5">
                    Active Learners
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => void loadData()}
                className="inline-flex items-center gap-2 rounded-2xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-semibold text-slate-700 shadow-sm transition hover:bg-slate-50"
              >
                <RefreshCcw className="h-4 w-4" />
                Refresh
              </button>
            </div>
          </div>
        </section>

        {/* Test selector */}
        {orderedTests.length === 0 ? (
          <section className="rounded-[28px] border border-slate-200 bg-white p-8 text-center shadow-sm">
            <FileQuestion className="mx-auto h-10 w-10 text-slate-300" />
            <p className="mt-4 font-bold text-slate-800">No prelims tests in this program</p>
            <p className="mt-2 text-sm text-slate-500">
              Add at least one prelims test to see rankings here.
            </p>
            <Link
              href={`/programs/${seriesId}/manage`}
              className="mt-6 inline-flex items-center gap-2 rounded-2xl bg-indigo-600 px-5 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-indigo-500 transition"
            >
              Go to Builder
            </Link>
          </section>
        ) : (
          <>
            {/* Test tabs */}
            <section className="rounded-[28px] border border-slate-200 bg-white p-5 shadow-sm">
              <p className="mb-4 text-xs font-bold uppercase tracking-[0.2em] text-slate-500">
                Select Test
              </p>
              <div className="flex flex-wrap gap-2">
                {orderedTests.map((test) => {
                  const active = selectedTestId === test.id;
                  return (
                    <button
                      key={test.id}
                      type="button"
                      onClick={() => setSelectedTestId(test.id)}
                      className={`rounded-2xl border px-4 py-2.5 text-sm font-semibold transition-all ${
                        active
                          ? "border-indigo-950 bg-indigo-950 text-white shadow-sm"
                          : "border-slate-200 bg-slate-50 text-slate-700 hover:border-indigo-300 hover:bg-indigo-50 hover:text-indigo-900"
                      }`}
                    >
                      {test.title}
                      {test.question_count > 0 && (
                        <span className={`ml-2 text-[10px] font-bold ${active ? "text-indigo-300" : "text-slate-400"}`}>
                          {test.question_count}Q
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>
            </section>

            {/* Leaderboard table */}
            <section className="rounded-[28px] border border-slate-200 bg-white shadow-sm">
              <div className="border-b border-slate-100 px-6 py-5">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <p className="text-xs font-bold uppercase tracking-[0.2em] text-slate-500">Ranking</p>
                    <p className="mt-0.5 text-xl font-black tracking-tight text-slate-950">
                      {selectedTest?.title ?? "Select a test"}
                    </p>
                    {selectedTest ? (
                      <p className="mt-1 text-xs text-slate-500">
                        {selectedTest.question_count} questions ·{" "}
                        {activeEntries.length} ranked learner{activeEntries.length !== 1 ? "s" : ""}
                      </p>
                    ) : null}
                  </div>
                  {selectedTest && (
                    <Link
                      href={`/collections/${selectedTest.id}/question-methods`}
                      className="inline-flex items-center gap-1.5 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-100 transition"
                    >
                      Manage Questions
                    </Link>
                  )}
                </div>
              </div>

              {leaderboardLoading ? (
                <div className="flex items-center justify-center py-16">
                  <Loader2 className="h-6 w-6 animate-spin text-indigo-400" />
                </div>
              ) : activeEntries.length === 0 ? (
                <EmptyLeaderboard testTitle={selectedTest?.title ?? "this test"} />
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-slate-100 bg-slate-50/60">
                        <th className="px-6 py-4 text-left text-[11px] font-bold uppercase tracking-[0.18em] text-slate-500 w-16">
                          Rank
                        </th>
                        <th className="px-4 py-4 text-left text-[11px] font-bold uppercase tracking-[0.18em] text-slate-500">
                          Learner
                        </th>
                        <th className="px-4 py-4 text-right text-[11px] font-bold uppercase tracking-[0.18em] text-slate-500">
                          Score
                        </th>
                        <th className="px-4 py-4 text-left text-[11px] font-bold uppercase tracking-[0.18em] text-slate-500">
                          Accuracy
                        </th>
                        <th className="hidden px-4 py-4 text-right text-[11px] font-bold uppercase tracking-[0.18em] text-slate-500 sm:table-cell">
                          ✓ Correct
                        </th>
                        <th className="hidden px-4 py-4 text-right text-[11px] font-bold uppercase tracking-[0.18em] text-slate-500 sm:table-cell">
                          ✗ Wrong
                        </th>
                        <th className="hidden px-4 py-4 text-left text-[11px] font-bold uppercase tracking-[0.18em] text-slate-500 md:table-cell">
                          Attempts
                        </th>
                        <th className="hidden px-4 py-4 text-left text-[11px] font-bold uppercase tracking-[0.18em] text-slate-500 lg:table-cell">
                          Last Attempt
                        </th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {activeEntries.map((entry, idx) => {
                        const rank = idx + 1;
                        const isTop3 = rank <= 3;
                        return (
                          <tr
                            key={entry.user_id}
                            className={`transition hover:bg-slate-50/60 ${isTop3 ? "bg-gradient-to-r from-amber-50/30 to-transparent" : ""}`}
                          >
                            <td className="px-6 py-4">
                              <div className="flex items-center justify-center">{rankMedal(rank)}</div>
                            </td>
                            <td className="px-4 py-4">
                              <p className="font-mono text-xs font-semibold text-slate-700">
                                {maskUserId(entry.user_id)}
                              </p>
                            </td>
                            <td className="px-4 py-4 text-right">
                              <span className={`text-base font-black ${isTop3 ? "text-indigo-800" : "text-slate-800"}`}>
                                {entry.best_score}
                              </span>
                              <span className="ml-1 text-xs text-slate-400">
                                / {entry.total_questions}
                              </span>
                            </td>
                            <td className="px-4 py-4">
                              <AccuracyBar accuracy={entry.best_accuracy} />
                            </td>
                            <td className="hidden px-4 py-4 text-right text-sm font-semibold text-emerald-700 sm:table-cell">
                              {entry.correct_answers}
                            </td>
                            <td className="hidden px-4 py-4 text-right text-sm font-semibold text-rose-600 sm:table-cell">
                              {entry.incorrect_answers}
                            </td>
                            <td className="hidden px-4 py-4 text-sm text-slate-600 md:table-cell">
                              {entry.attempts}×
                            </td>
                            <td className="hidden px-4 py-4 text-xs text-slate-500 lg:table-cell">
                              {formatDate(entry.last_attempted_at)}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </section>
          </>
        )}
      </div>
    </div>
  );
}
