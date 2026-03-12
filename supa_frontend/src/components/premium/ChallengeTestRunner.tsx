"use client";

import { Loader2 } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import axios from "axios";
import { toast } from "sonner";

import { premiumApi } from "@/lib/premiumApi";
import type {
  ChallengeLeaderboardPayload,
  ChallengeScorePayload,
  ChallengeTestPayload,
} from "@/types/premium";

interface ChallengeTestRunnerProps {
  token: string;
}

function toError(error: unknown): string {
  if (axios.isAxiosError(error)) {
    const detail = error.response?.data?.detail;
    if (typeof detail === "string" && detail.trim()) return detail;
    return error.message;
  }
  return "Unknown error";
}

function participantStorageKey(token: string): string {
  return `challenge-participant-key:${token}`;
}

function ensureParticipantKey(token: string): string {
  const key = participantStorageKey(token);
  const existing = localStorage.getItem(key);
  if (existing && existing.trim()) return existing;
  const generated =
    typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  localStorage.setItem(key, generated);
  return generated;
}

export default function ChallengeTestRunner({ token }: ChallengeTestRunnerProps) {
  const router = useRouter();
  const [isLoading, setIsLoading] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [payload, setPayload] = useState<ChallengeTestPayload | null>(null);
  const [leaderboard, setLeaderboard] = useState<ChallengeLeaderboardPayload | null>(null);
  const [index, setIndex] = useState(0);
  const [participantName, setParticipantName] = useState("");
  const [answers, setAnswers] = useState<Record<number, string>>({});

  useEffect(() => {
    const load = async () => {
      setIsLoading(true);
      try {
        const [testRes, boardRes] = await Promise.all([
          premiumApi.get<ChallengeTestPayload>(`/challenge/${token}`),
          premiumApi.get<ChallengeLeaderboardPayload>(`/challenge/${token}/leaderboard`, { params: { limit: 5 } }),
        ]);
        setPayload(testRes.data);
        setLeaderboard(boardRes.data);
      } catch (error: unknown) {
        toast.error("Failed to load challenge", { description: toError(error) });
      } finally {
        setIsLoading(false);
      }
    };
    load();
  }, [token]);

  const currentQuestion = useMemo(() => payload?.questions[index], [payload, index]);
  const answeredCount = useMemo(() => Object.values(answers).filter(Boolean).length, [answers]);

  const setAnswer = (label: string) => {
    if (!currentQuestion) return;
    setAnswers((prev) => ({ ...prev, [currentQuestion.item_id]: label }));
  };

  const submitChallenge = async () => {
    if (!payload) return;
    setIsSubmitting(true);
    try {
      const participantKey = ensureParticipantKey(token);
      const response = await premiumApi.post<ChallengeScorePayload>(`/challenge/${token}/submit`, {
        answers: payload.questions.map((question) => ({
          item_id: question.item_id,
          selected_option: answers[question.item_id] || null,
        })),
        participant_name: participantName.trim() || undefined,
        participant_key: participantKey,
      });
      toast.success("Challenge submitted");
      const destination = response.data.result_view_path || `/challenge/${token}/result/${response.data.attempt_id}`;
      router.push(destination);
    } catch (error: unknown) {
      toast.error("Failed to submit challenge", { description: toError(error) });
    } finally {
      setIsSubmitting(false);
    }
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center rounded-md border bg-white p-16">
        <Loader2 className="h-6 w-6 animate-spin text-slate-500" />
      </div>
    );
  }

  if (!payload || payload.questions.length === 0) {
    return (
      <div className="rounded-md border bg-white p-10 text-center text-sm text-slate-500">
        This challenge has no questions.
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <section className="rounded-xl border border-indigo-200 bg-gradient-to-r from-indigo-50 via-white to-cyan-50 p-5">
        <p className="text-xs font-semibold uppercase tracking-wide text-indigo-700">Live Challenge</p>
        <h2 className="mt-1 text-xl font-bold text-slate-900">{payload.challenge_title}</h2>
        {payload.challenge_description ? <p className="mt-1 text-sm text-slate-600">{payload.challenge_description}</p> : null}
        <p className="mt-2 text-xs text-slate-600">
          {payload.collection_title} | {payload.total_questions} questions | {payload.total_attempts} attempts so far
        </p>
      </section>

      <section className="rounded-xl border border-slate-200 bg-white p-6">
        <label className="text-sm font-medium text-slate-700">
          Display Name (shown on leaderboard)
          <input
            value={participantName}
            onChange={(event) => setParticipantName(event.target.value)}
            className="mt-1 w-full rounded border border-slate-300 px-3 py-2 text-sm"
            placeholder="e.g. Ananya Singh"
          />
        </label>
      </section>

      <div className="rounded-xl border border-slate-200 bg-white p-6">
        <div className="flex items-center justify-between">
          <p className="text-xs font-medium uppercase text-slate-500">
            Question {index + 1} of {payload.total_questions}
          </p>
          <p className="text-xs text-slate-500">Attempted: {answeredCount}/{payload.total_questions}</p>
        </div>

        <h3 className="mt-2 text-lg font-bold text-slate-900">{currentQuestion?.question_statement}</h3>
        {currentQuestion?.supplementary_statement ? (
          <p className="mt-1 text-sm text-slate-700">{currentQuestion.supplementary_statement}</p>
        ) : null}
        {Array.isArray(currentQuestion?.statements_facts) && currentQuestion.statements_facts.length > 0 ? (
          <ul className="mt-3 list-disc space-y-1 pl-5 text-sm text-slate-700">
            {currentQuestion.statements_facts.map((fact, factIndex) => (
              <li key={factIndex}>{fact}</li>
            ))}
          </ul>
        ) : null}
        {currentQuestion?.question_prompt ? (
          <p className="mt-3 rounded border border-slate-100 bg-slate-50 p-3 text-sm italic text-slate-700">
            {currentQuestion.question_prompt}
          </p>
        ) : null}
        {currentQuestion?.passage_text ? (
          <div className="mt-3 rounded border border-slate-100 bg-slate-50 p-3 text-sm text-slate-700">
            {currentQuestion.passage_text}
          </div>
        ) : null}

        <div className="mt-4 space-y-2">
          {currentQuestion?.options.map((option) => (
            <button
              key={option.label}
              onClick={() => setAnswer(option.label)}
              className={`block w-full rounded border px-3 py-2 text-left text-sm ${
                answers[currentQuestion.item_id] === option.label ? "border-indigo-500 bg-indigo-50" : "border-slate-200"
              }`}
            >
              {option.label}. {option.text}
            </button>
          ))}
        </div>
      </div>

      {leaderboard && leaderboard.top_entries.length > 0 ? (
        <section className="rounded-xl border border-slate-200 bg-white p-5">
          <h4 className="text-sm font-semibold uppercase tracking-wide text-slate-600">Top Challengers</h4>
          <div className="mt-3 space-y-2 text-sm">
            {leaderboard.top_entries.slice(0, 3).map((entry) => (
              <div key={`${entry.rank}-${entry.participant_name}-${entry.submitted_at}`} className="flex items-center justify-between rounded border border-slate-200 bg-slate-50 px-3 py-2">
                <p className="font-medium text-slate-800">#{entry.rank} {entry.participant_name}</p>
                <p className="font-semibold text-slate-900">{entry.score}/{entry.total_questions}</p>
              </div>
            ))}
          </div>
        </section>
      ) : null}

      <div className="flex items-center justify-between">
        <button
          onClick={() => setIndex((prev) => Math.max(prev - 1, 0))}
          disabled={index === 0}
          className="rounded border border-slate-300 px-4 py-2 text-sm disabled:opacity-50"
        >
          Previous
        </button>
        <button
          onClick={() => setIndex((prev) => Math.min(prev + 1, payload.questions.length - 1))}
          disabled={index >= payload.questions.length - 1}
          className="rounded border border-slate-300 px-4 py-2 text-sm disabled:opacity-50"
        >
          Next
        </button>
      </div>

      <div className="flex justify-end">
        <button
          onClick={submitChallenge}
          disabled={isSubmitting}
          className="inline-flex items-center rounded bg-slate-900 px-4 py-2 text-sm font-semibold text-white disabled:opacity-60"
        >
          {isSubmitting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
          Submit Challenge
        </button>
      </div>
    </div>
  );
}
