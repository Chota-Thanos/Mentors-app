"use client";

import { Loader2 } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";

import { collectionTestResultStorageKey } from "@/lib/collectionTestResultStorage";
import type { CollectionScorePayload, CollectionTestPayload } from "@/types/premium";

interface CollectionTestResultProps {
  collectionId: string;
}

interface StoredCollectionResult {
  test: CollectionTestPayload;
  score: CollectionScorePayload;
  submitted_at?: string;
}

export default function CollectionTestResult({ collectionId }: CollectionTestResultProps) {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [snapshot, setSnapshot] = useState<StoredCollectionResult | null>(null);

  useEffect(() => {
    const key = collectionTestResultStorageKey(collectionId);
    try {
      const raw = sessionStorage.getItem(key);
      if (!raw) {
        setSnapshot(null);
      } else {
        setSnapshot(JSON.parse(raw) as StoredCollectionResult);
      }
    } catch {
      setSnapshot(null);
    } finally {
      setLoading(false);
    }
  }, [collectionId]);

  const detailMap = useMemo(() => {
    const map = new Map<number, CollectionScorePayload["details"][number]>();
    if (!snapshot?.score?.details) return map;
    for (const detail of snapshot.score.details) {
      map.set(detail.item_id, detail);
    }
    return map;
  }, [snapshot]);

  if (loading) {
    return (
      <div className="flex items-center justify-center rounded-xl border border-slate-200 bg-white p-16">
        <Loader2 className="h-6 w-6 animate-spin text-slate-500" />
      </div>
    );
  }

  if (!snapshot) {
    return (
      <div className="space-y-4 rounded-xl border border-amber-200 bg-amber-50 p-6">
        <h2 className="text-lg font-bold text-amber-900">Result not found</h2>
        <p className="text-sm text-amber-800">
          No recent result snapshot is available for this Prelims Test. Attempt the test and submit once to view category-wise analysis.
        </p>
        <div className="flex gap-2">
          <button
            onClick={() => router.push(`/collections/${collectionId}/test`)}
            className="rounded bg-amber-700 px-4 py-2 text-sm font-semibold text-white"
          >
            Start Prelims Test
          </button>
          <button
            onClick={() => router.push(`/collections/${collectionId}`)}
            className="rounded border border-amber-300 bg-white px-4 py-2 text-sm font-semibold text-amber-900"
          >
            Back to Test
          </button>
        </div>
      </div>
    );
  }

  const { test, score } = snapshot;

  return (
    <div className="space-y-6">
      <section className="rounded-2xl border border-indigo-200 bg-gradient-to-r from-indigo-50 via-white to-cyan-50 p-6">
        <p className="text-xs font-semibold uppercase tracking-wide text-indigo-700">{test.collection_title}</p>
        <h2 className="mt-2 text-2xl font-bold text-slate-900">
          Score {score.score}/{score.total_questions}
        </h2>
        <div className="mt-3 grid gap-3 sm:grid-cols-3">
          <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-3">
            <p className="text-xs uppercase text-emerald-700">Correct</p>
            <p className="text-xl font-bold text-emerald-900">{score.correct_answers}</p>
          </div>
          <div className="rounded-lg border border-rose-200 bg-rose-50 p-3">
            <p className="text-xs uppercase text-rose-700">Incorrect</p>
            <p className="text-xl font-bold text-rose-900">{score.incorrect_answers}</p>
          </div>
          <div className="rounded-lg border border-amber-200 bg-amber-50 p-3">
            <p className="text-xs uppercase text-amber-700">Unanswered</p>
            <p className="text-xl font-bold text-amber-900">{score.unanswered}</p>
          </div>
        </div>
      </section>

      <section className="space-y-3 rounded-xl border border-slate-200 bg-white p-5">
        <h3 className="text-lg font-bold text-slate-900">Category-wise Results</h3>
        {score.category_wise_results && score.category_wise_results.length > 0 ? (
          <div className="grid gap-3 md:grid-cols-2">
            {score.category_wise_results.map((category) => (
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
          <p className="text-sm text-slate-500">No category mapping found for this Prelims Test run.</p>
        )}
      </section>

      <section className="space-y-3">
        <h3 className="text-lg font-bold text-slate-900">Question Review</h3>
        {test.questions.map((question, idx) => {
          const detail = detailMap.get(question.item_id);
          const questionAny = (question as unknown as Record<string, unknown>) || {};
          const questionText = String(question.question_statement || questionAny.question || "").trim();
          const supplementaryText = String(
            question.supplementary_statement
              || questionAny.supp_question_statement
              || questionAny.supplementary
              || ""
          ).trim();
          const statements = Array.isArray(question.statements_facts)
            ? question.statements_facts
            : Array.isArray(questionAny.statement_facts)
              ? (questionAny.statement_facts as string[])
              : [];
          const promptText = String(question.question_prompt || questionAny.prompt || "").trim();
          const statusClass = !detail?.selected_option
            ? "border-amber-200 bg-amber-50"
            : detail.is_correct
              ? "border-emerald-200 bg-emerald-50"
              : "border-rose-200 bg-rose-50";
          return (
            <article key={question.item_id} className={`rounded-lg border p-4 ${statusClass}`}>
              <p className="text-sm font-semibold text-slate-900">
                {idx + 1}. {questionText}
              </p>
              {supplementaryText ? (
                <p className="mt-1 text-sm text-slate-700">{supplementaryText}</p>
              ) : null}
              {statements.length > 0 ? (
                <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-slate-700">
                  {statements.map((fact, factIndex) => (
                    <li key={factIndex}>{fact}</li>
                  ))}
                </ul>
              ) : null}
              {promptText ? (
                <p className="mt-2 rounded border border-slate-200 bg-white p-2 text-sm italic text-slate-700">
                  {promptText}
                </p>
              ) : null}
              <p className="mt-2 text-xs font-semibold text-slate-700">
                Selected: {detail?.selected_option || "None"} | Correct: {detail?.correct_answer || question.correct_answer}
              </p>
              {detail?.explanation_text ? <p className="mt-2 text-sm text-slate-700">{detail.explanation_text}</p> : null}
            </article>
          );
        })}
      </section>

      <div className="flex gap-2">
        <button
          onClick={() => router.push(`/collections/${collectionId}/test`)}
          className="rounded bg-slate-900 px-4 py-2 text-sm font-semibold text-white"
        >
          Retake Prelims Test
        </button>
        <button
          onClick={() => router.push(`/collections/${collectionId}`)}
          className="rounded border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700"
        >
          Back to Test
        </button>
      </div>
    </div>
  );
}
