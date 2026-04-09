"use client";

import axios from "axios";
import Link from "next/link";
import { useEffect, useState } from "react";
import { toast } from "sonner";

import { useAuth } from "@/context/AuthContext";
import { premiumApi } from "@/lib/premiumApi";
import type {
  PremiumCollection,
  TestSeries,
  TestSeriesEnrollment,
  UserMainsPerformanceReport,
} from "@/types/premium";

const PRELIMS_COLLECTION_MODES = new Set([
  "prelims",
  "prelims_quiz",
  "quiz",
  "quiz_collection",
  "quiz_test",
]);

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

function toError(error: unknown): string {
  if (!axios.isAxiosError(error)) return "Unknown error";
  const detail = error.response?.data?.detail;
  return typeof detail === "string" && detail.trim() ? detail : error.message;
}

function toPositiveInt(value: unknown): number {
  const num = Number(value);
  if (!Number.isFinite(num)) return 0;
  if (num <= 0) return 0;
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
  return date.toLocaleString();
}

function shortText(value: string | null | undefined, maxChars: number): string {
  const text = String(value || "").trim();
  if (!text) return "";
  if (text.length <= maxChars) return text;
  return `${text.slice(0, Math.max(0, maxChars - 3)).trimEnd()}...`;
}

function StatCard({ label, value }: { label: string; value: string }) {
  return (
    <article className="rounded-xl border border-slate-200 bg-white p-4">
      <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">{label}</p>
      <p className="mt-2 text-2xl font-black text-slate-900">{value}</p>
    </article>
  );
}

export default function MyResultsView() {
  const { isAuthenticated, loading, showLoginModal, user } = useAuth();
  const currentUserId = String(user?.id || "").trim();
  const [busy, setBusy] = useState(true);
  const [mainsReport, setMainsReport] = useState<UserMainsPerformanceReport | null>(null);
  const [enrollments, setEnrollments] = useState<TestSeriesEnrollment[]>([]);
  const [seriesAttempts, setSeriesAttempts] = useState<AttemptWithContext[]>([]);
  const [quizMadeAttempts, setQuizMadeAttempts] = useState<AttemptWithContext[]>([]);
  const [mainsEvaluations, setMainsEvaluations] = useState<UserMainsEvaluationRow[]>([]);
  const [seriesTitleById, setSeriesTitleById] = useState<Record<string, string>>({});

  useEffect(() => {
    if (loading) return;
    if (!isAuthenticated) {
      setBusy(false);
      setMainsReport(null);
      setEnrollments([]);
      setSeriesAttempts([]);
      setQuizMadeAttempts([]);
      setMainsEvaluations([]);
      setSeriesTitleById({});
      return;
    }

    let active = true;
    setBusy(true);

    const run = async () => {
      try {
        const [progressRes, mainsRes, enrollmentsRes] = await Promise.all([
          premiumApi.get<UserProgressPayload>("/user/progress"),
          premiumApi.get<UserMainsPerformanceReport>("/users/me/mains-performance-report"),
          premiumApi.get<TestSeriesEnrollment[]>("/programs/my/enrollments"),
        ]);
        if (!active) return;

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

        const collectionIds = Array.from(
          new Set(
            normalizedAttempts
              .map((row) => toPositiveInt(row.collection_id))
              .filter((id) => id > 0),
          ),
        );

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
            if (collectionId <= 0) continue;
            collectionById[String(collectionId)] = row;
          }
        }

        const nextSeriesAttempts: AttemptWithContext[] = [];
        const nextQuizMadeAttempts: AttemptWithContext[] = [];
        for (const attempt of normalizedAttempts) {
          const collection = collectionById[String(attempt.collection_id)] || null;
          const seriesId = parseSeriesId(collection);
          const row: AttemptWithContext = { attempt, collection, seriesId };
          if (seriesId > 0) {
            nextSeriesAttempts.push(row);
            continue;
          }
          if (isQuizMadeTestCollection(collection, currentUserId)) {
            nextQuizMadeAttempts.push(row);
          }
        }

        const sortByRecent = (a: AttemptWithContext, b: AttemptWithContext) =>
          new Date(b.attempt.created_at).getTime() - new Date(a.attempt.created_at).getTime();
        nextSeriesAttempts.sort(sortByRecent);
        nextQuizMadeAttempts.sort(sortByRecent);

        const uniqueSeriesIds = Array.from(new Set(nextSeriesAttempts.map((row) => row.seriesId).filter((id) => id > 0)));
        const nextSeriesTitleById: Record<string, string> = {};
        if (uniqueSeriesIds.length > 0) {
          const seriesResponses = await Promise.allSettled(
            uniqueSeriesIds.map((seriesId) => premiumApi.get<TestSeries>(`/programs/${seriesId}`)),
          );
          if (!active) return;
          for (const result of seriesResponses) {
            if (result.status !== "fulfilled") continue;
            const series = result.value.data;
            const seriesId = toPositiveInt(series?.id);
            const title = String(series?.title || "").trim();
            if (seriesId > 0 && title) nextSeriesTitleById[String(seriesId)] = title;
          }
        }

        setMainsReport(mainsRes.data || null);
        setEnrollments(Array.isArray(enrollmentsRes.data) ? enrollmentsRes.data : []);
        setSeriesAttempts(nextSeriesAttempts);
        setQuizMadeAttempts(nextQuizMadeAttempts);
        setMainsEvaluations(
          rawMainsEvaluations.map((row) => ({
            id: toPositiveInt(row.id),
            question_text: row.question_text ? String(row.question_text) : null,
            score: row.score == null ? null : Number(row.score),
            max_score: row.max_score == null ? null : Number(row.max_score),
            created_at: String(row.created_at || ""),
          })),
        );
        setSeriesTitleById(nextSeriesTitleById);
      } catch (error: unknown) {
        if (!active) return;
        setMainsReport(null);
        setEnrollments([]);
        setSeriesAttempts([]);
        setQuizMadeAttempts([]);
        setMainsEvaluations([]);
        setSeriesTitleById({});
        toast.error("Failed to load results", { description: toError(error) });
      } finally {
        if (active) setBusy(false);
      }
    };

    void run();
    return () => {
      active = false;
    };
  }, [currentUserId, isAuthenticated, loading]);

  if (loading || busy) {
    return <div className="rounded-xl border border-slate-200 bg-white p-6 text-sm text-slate-500">Loading your results...</div>;
  }

  if (!isAuthenticated) {
    return (
      <div className="rounded-xl border border-amber-200 bg-amber-50 p-6">
        <p className="text-sm text-amber-800">Sign in to view your results.</p>
        <button
          type="button"
          onClick={showLoginModal}
          className="mt-3 rounded-md bg-amber-900 px-4 py-2 text-sm font-semibold text-white"
        >
          Login
        </button>
      </div>
    );
  }

  const filteredAttempts = [...seriesAttempts, ...quizMadeAttempts];
  const filteredQuestionCount = filteredAttempts.reduce((sum, row) => sum + Math.max(0, Number(row.attempt.total_questions || 0)), 0);
  const filteredCorrectCount = filteredAttempts.reduce((sum, row) => sum + Math.max(0, Number(row.attempt.correct_answers || 0)), 0);
  const filteredAccuracy = filteredQuestionCount > 0
    ? `${((filteredCorrectCount / filteredQuestionCount) * 100).toFixed(1)}%`
    : "0.0%";
  const filteredAverageScore = filteredAttempts.length > 0
    ? `${(
        filteredAttempts.reduce((sum, row) => {
          const total = Math.max(0, Number(row.attempt.total_questions || 0));
          const score = Math.max(0, Number(row.attempt.score || 0));
          if (total <= 0) return sum;
          return sum + (score / total) * 100;
        }, 0) / filteredAttempts.length
      ).toFixed(1)}%`
    : "0.0%";
  const mainsEvalAverage = mainsEvaluations.length > 0
    ? `${(
        mainsEvaluations.reduce((sum, row) => {
          const score = Number(row.score || 0);
          const max = Number(row.max_score || 10);
          if (max <= 0) return sum;
          return sum + score / max;
        }, 0) / mainsEvaluations.length * 10
      ).toFixed(2)}/10`
    : "0.00/10";

  return (
    <div className="space-y-5">
      <section className="rounded-2xl border border-slate-200 bg-white p-4">
        <h1 className="text-2xl font-bold text-slate-900">My Results</h1>
        <p className="mt-1 text-sm text-slate-600">
          Showing only programs results and quiz-made test results. Standalone normal quiz attempts are excluded.
        </p>
      </section>

      <section className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-6">
        <StatCard label="Test-Series Results" value={String(seriesAttempts.length)} />
        <StatCard label="Quiz-Made Results" value={String(quizMadeAttempts.length)} />
        <StatCard label="Filtered Quiz Accuracy" value={filteredAccuracy} />
        <StatCard label="Filtered Avg Score" value={filteredAverageScore} />
        <StatCard label="Mains Evaluations" value={String(mainsEvaluations.length)} />
        <StatCard label="Checked Copies" value={String(mainsReport?.checked_submissions ?? 0)} />
      </section>

      <section className="rounded-2xl border border-slate-200 bg-white p-4">
        <h2 className="text-lg font-semibold text-slate-900">Quick Result Views</h2>
        <div className="mt-3 flex flex-wrap gap-2">
          <Link href="/dashboard" className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700">
            Full Performance Evaluation
          </Link>
          <Link href="/dashboard/gk" className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700">
            GK Detail
          </Link>
          <Link href="/dashboard/maths" className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700">
            Maths Detail
          </Link>
          <Link href="/dashboard/passage" className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700">
            Passage Detail
          </Link>
          <Link href="/dashboard/mains" className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700">
            Mains Detail
          </Link>
        </div>
      </section>

      <section className="rounded-2xl border border-slate-200 bg-white p-4">
        <h2 className="text-lg font-semibold text-slate-900">Test-Series Quiz Results</h2>
        <div className="mt-3 space-y-2 text-sm text-slate-700">
          {seriesAttempts.map((row) => {
            const seriesTitle = seriesTitleById[String(row.seriesId)] || `Series #${row.seriesId}`;
            const testTitle = String(row.collection?.title || row.collection?.name || `Collection #${row.attempt.collection_id}`);
            const total = Math.max(0, Number(row.attempt.total_questions || 0));
            const score = Math.max(0, Number(row.attempt.score || 0));
            const accuracy = total > 0 ? ((Math.max(0, Number(row.attempt.correct_answers || 0)) / total) * 100).toFixed(1) : "0.0";
            return (
              <article key={`series-${row.attempt.id}`} className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2">
                <p className="font-semibold text-slate-900">{seriesTitle}</p>
                <p className="text-xs text-slate-600">{testTitle}</p>
                <p>Score: {score}/{total} | Accuracy: {accuracy}%</p>
                <p>Correct {row.attempt.correct_answers} | Incorrect {row.attempt.incorrect_answers} | Unanswered {row.attempt.unanswered}</p>
                <p className="text-xs text-slate-500">Attempted: {formatDateTime(row.attempt.created_at)}</p>
              </article>
            );
          })}
          {seriesAttempts.length === 0 ? <p className="text-sm text-slate-500">No programs quiz results yet.</p> : null}
        </div>
      </section>

      <section className="rounded-2xl border border-slate-200 bg-white p-4">
        <h2 className="text-lg font-semibold text-slate-900">Quiz-Made Test Results</h2>
        <div className="mt-3 space-y-2 text-sm text-slate-700">
          {quizMadeAttempts.map((row) => {
            const testTitle = String(row.collection?.title || row.collection?.name || `Collection #${row.attempt.collection_id}`);
            const total = Math.max(0, Number(row.attempt.total_questions || 0));
            const score = Math.max(0, Number(row.attempt.score || 0));
            const accuracy = total > 0 ? ((Math.max(0, Number(row.attempt.correct_answers || 0)) / total) * 100).toFixed(1) : "0.0";
            return (
              <article key={`quiz-made-${row.attempt.id}`} className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2">
                <p className="font-semibold text-slate-900">{testTitle}</p>
                <p>Score: {score}/{total} | Accuracy: {accuracy}%</p>
                <p>Correct {row.attempt.correct_answers} | Incorrect {row.attempt.incorrect_answers} | Unanswered {row.attempt.unanswered}</p>
                <p className="text-xs text-slate-500">Attempted: {formatDateTime(row.attempt.created_at)}</p>
              </article>
            );
          })}
          {quizMadeAttempts.length === 0 ? <p className="text-sm text-slate-500">No quiz-made test results yet.</p> : null}
        </div>
      </section>

      <section className="rounded-2xl border border-slate-200 bg-white p-4">
        <h2 className="text-lg font-semibold text-slate-900">Mains Attempts (Separate)</h2>
        <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <StatCard label="Mains Evaluations" value={String(mainsEvaluations.length)} />
          <StatCard label="Mains Eval Avg" value={mainsEvalAverage} />
          <StatCard label="Checked Copies" value={String(mainsReport?.checked_submissions ?? 0)} />
          <StatCard label="Provider Marks Avg" value={String(mainsReport?.average_provider_marks ?? 0)} />
        </div>
        <div className="mt-3 space-y-2 text-sm text-slate-700">
          {mainsEvaluations.slice(0, 12).map((row) => {
            const score = Number(row.score || 0);
            const maxScore = Number(row.max_score || 10);
            const pct = maxScore > 0 ? ((score / maxScore) * 100).toFixed(1) : "0.0";
            return (
              <article key={`mains-eval-${row.id}`} className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2">
                <p className="font-semibold text-slate-900">{shortText(row.question_text || "Mains Evaluation", 140)}</p>
                <p>Score: {score.toFixed(1)}/{maxScore.toFixed(1)} | {pct}%</p>
                <p className="text-xs text-slate-500">Evaluated: {formatDateTime(row.created_at)}</p>
              </article>
            );
          })}
          {mainsEvaluations.length === 0 ? <p className="text-sm text-slate-500">No mains evaluations yet.</p> : null}
        </div>
      </section>

      <section className="rounded-2xl border border-slate-200 bg-white p-4">
        <h2 className="text-lg font-semibold text-slate-900">My Active Series Access</h2>
        <div className="mt-3 space-y-2 text-sm text-slate-700">
          {enrollments.map((enrollment) => (
            <div key={enrollment.id} className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2">
              Series #{enrollment.series_id} | {enrollment.status} | Source: {enrollment.access_source}
            </div>
          ))}
          {enrollments.length === 0 ? <p className="text-sm text-slate-500">No active enrollments yet.</p> : null}
        </div>
      </section>
    </div>
  );
}
