"use client";

import { Loader2 } from "lucide-react";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import axios from "axios";
import { toast } from "sonner";

import { premiumApi } from "@/lib/premiumApi";
import type { ChallengeLeaderboardPayload, ChallengeScorePayload } from "@/types/premium";

interface ChallengeTestResultProps {
  token: string;
  attemptId: string;
}

function toError(error: unknown): string {
  if (axios.isAxiosError(error)) {
    const detail = error.response?.data?.detail;
    if (typeof detail === "string" && detail.trim()) return detail;
    return error.message;
  }
  return "Unknown error";
}

export default function ChallengeTestResult({ token, attemptId }: ChallengeTestResultProps) {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [result, setResult] = useState<ChallengeScorePayload | null>(null);
  const [leaderboard, setLeaderboard] = useState<ChallengeLeaderboardPayload | null>(null);

  useEffect(() => {
    const load = async () => {
      setLoading(true);
      try {
        const [resultRes, boardRes] = await Promise.all([
          premiumApi.get<ChallengeScorePayload>(`/challenge/${token}/attempts/${attemptId}`),
          premiumApi.get<ChallengeLeaderboardPayload>(`/challenge/${token}/leaderboard`, { params: { limit: 10 } }),
        ]);
        setResult(resultRes.data);
        setLeaderboard(boardRes.data);
      } catch (error: unknown) {
        toast.error("Failed to load challenge result", { description: toError(error) });
        setResult(null);
      } finally {
        setLoading(false);
      }
    };
    load();
  }, [token, attemptId]);

  if (loading) {
    return (
      <div className="flex items-center justify-center rounded-xl border border-slate-200 bg-white p-16">
        <Loader2 className="h-6 w-6 animate-spin text-slate-500" />
      </div>
    );
  }

  if (!result) {
    return (
      <div className="space-y-4 rounded-xl border border-amber-200 bg-amber-50 p-6">
        <h2 className="text-lg font-bold text-amber-900">Result not found</h2>
        <p className="text-sm text-amber-800">This challenge result could not be loaded.</p>
        <button
          onClick={() => router.push(`/challenge/${token}`)}
          className="rounded bg-amber-700 px-4 py-2 text-sm font-semibold text-white"
        >
          Back to Challenge
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <section className="rounded-2xl border border-indigo-200 bg-gradient-to-r from-indigo-50 via-white to-cyan-50 p-6">
        <p className="text-xs font-semibold uppercase tracking-wide text-indigo-700">Challenge Attempted</p>
        <h1 className="mt-1 text-2xl font-bold text-slate-900">{result.challenge_title}</h1>
        <p className="mt-1 text-sm text-slate-600">Participant: {result.participant_name}</p>
        <h2 className="mt-3 text-2xl font-bold text-slate-900">Score {result.score}/{result.total_questions}</h2>
        <div className="mt-3 grid gap-3 sm:grid-cols-3">
          <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-3">
            <p className="text-xs uppercase text-emerald-700">Correct</p>
            <p className="text-xl font-bold text-emerald-900">{result.correct_answers}</p>
          </div>
          <div className="rounded-lg border border-rose-200 bg-rose-50 p-3">
            <p className="text-xs uppercase text-rose-700">Incorrect</p>
            <p className="text-xl font-bold text-rose-900">{result.incorrect_answers}</p>
          </div>
          <div className="rounded-lg border border-amber-200 bg-amber-50 p-3">
            <p className="text-xs uppercase text-amber-700">Rank</p>
            <p className="text-xl font-bold text-amber-900">#{result.rank}</p>
            <p className="text-xs text-amber-800">Top {Math.max(0, 100 - result.percentile).toFixed(2)}%</p>
          </div>
        </div>
        <p className="mt-3 text-sm font-medium text-slate-700">
          Percentile: {result.percentile.toFixed(2)} | Participants: {result.total_participants}
        </p>
      </section>

      {leaderboard && leaderboard.top_entries.length > 0 ? (
        <section className="space-y-3 rounded-xl border border-slate-200 bg-white p-5">
          <h3 className="text-lg font-bold text-slate-900">Leaderboard</h3>
          <div className="space-y-2">
            {leaderboard.top_entries.map((entry) => {
              const highlight = entry.rank === result.rank && entry.participant_name === result.participant_name;
              return (
                <div
                  key={`${entry.rank}-${entry.participant_name}-${entry.submitted_at}`}
                  className={`flex items-center justify-between rounded border px-3 py-2 text-sm ${
                    highlight ? "border-indigo-300 bg-indigo-50" : "border-slate-200 bg-slate-50"
                  }`}
                >
                  <p className="font-medium text-slate-800">#{entry.rank} {entry.participant_name}</p>
                  <p className="font-semibold text-slate-900">{entry.score}/{entry.total_questions}</p>
                </div>
              );
            })}
          </div>
        </section>
      ) : null}

      <section className="space-y-3 rounded-xl border border-slate-200 bg-white p-5">
        <h3 className="text-lg font-bold text-slate-900">Category-wise Results</h3>
        {result.category_wise_results && result.category_wise_results.length > 0 ? (
          <div className="grid gap-3 md:grid-cols-2">
            {result.category_wise_results.map((category) => (
              <div key={category.category_id} className="rounded-lg border border-slate-200 bg-slate-50 p-4">
                <div className="flex items-center justify-between">
                  <p className="text-sm font-semibold text-slate-900">{category.category_name}</p>
                  <p className="text-xs font-semibold text-slate-600">{category.accuracy.toFixed(2)}%</p>
                </div>
                <div className="mt-2 h-2 rounded-full bg-slate-200">
                  <div
                    className="h-2 rounded-full bg-indigo-500"
                    style={{ width: `${Math.max(0, Math.min(100, category.accuracy))}%` }}
                  />
                </div>
                <p className="mt-2 text-xs text-slate-600">
                  Total: {category.total} | Correct: {category.correct} | Incorrect: {category.incorrect} | Unanswered: {category.unanswered}
                </p>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-sm text-slate-500">No category mapping found for this challenge run.</p>
        )}
      </section>

      <section className="space-y-3">
        <h3 className="text-lg font-bold text-slate-900">Question Review</h3>
        {result.details.map((detail, idx) => {
          const statusClass = !detail.selected_option
            ? "border-amber-200 bg-amber-50"
            : detail.is_correct
              ? "border-emerald-200 bg-emerald-50"
              : "border-rose-200 bg-rose-50";
          return (
            <article key={detail.item_id} className={`rounded-lg border p-4 ${statusClass}`}>
              <p className="text-sm font-semibold text-slate-900">Question {idx + 1}</p>
              <p className="mt-2 text-xs font-semibold text-slate-700">
                Selected: {detail.selected_option || "None"} | Correct: {detail.correct_answer}
              </p>
              {detail.explanation_text ? <p className="mt-2 text-sm text-slate-700">{detail.explanation_text}</p> : null}
            </article>
          );
        })}
      </section>

      <div className="flex gap-2">
        <button
          onClick={() => router.push(`/challenge/${token}`)}
          className="rounded bg-slate-900 px-4 py-2 text-sm font-semibold text-white"
        >
          Attempt Again
        </button>
      </div>
    </div>
  );
}
