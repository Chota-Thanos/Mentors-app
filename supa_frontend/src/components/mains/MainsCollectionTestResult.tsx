"use client";

import { Loader2 } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";

import { mainsCollectionTestResultStorageKey } from "@/lib/mainsCollectionTestResultStorage";
import type { MainsCollectionScorePayload, MainsCollectionTestPayload } from "@/types/premium";

interface MainsCollectionTestResultProps {
  collectionId: string;
}

interface StoredMainsCollectionResult {
  test: MainsCollectionTestPayload;
  score: MainsCollectionScorePayload;
  answers?: Record<number, string>;
  submitted_at?: string;
}

export default function MainsCollectionTestResult({ collectionId }: MainsCollectionTestResultProps) {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [snapshot, setSnapshot] = useState<StoredMainsCollectionResult | null>(null);

  useEffect(() => {
    const key = mainsCollectionTestResultStorageKey(collectionId);
    try {
      const raw = sessionStorage.getItem(key);
      if (!raw) {
        setSnapshot(null);
      } else {
        setSnapshot(JSON.parse(raw) as StoredMainsCollectionResult);
      }
    } catch {
      setSnapshot(null);
    } finally {
      setLoading(false);
    }
  }, [collectionId]);

  const detailMap = useMemo(() => {
    const map = new Map<number, MainsCollectionScorePayload["details"][number]>();
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
          This mains flow now stores submissions and mentor review on the main test page. Open the test to see your latest submission status.
        </p>
        <div className="flex gap-2">
          <button
            onClick={() => router.push(`/collections/${collectionId}`)}
            className="rounded bg-amber-700 px-4 py-2 text-sm font-semibold text-white"
          >
            Open Test
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
          Legacy AI Result Snapshot
        </h2>
        <div className="mt-3 grid gap-3 sm:grid-cols-4">
          <div className="rounded-lg border border-slate-200 bg-white p-3">
            <p className="text-xs uppercase text-slate-600">Questions</p>
            <p className="text-xl font-bold text-slate-900">{score.total_questions}</p>
          </div>
          <div className="rounded-lg border border-indigo-200 bg-indigo-50 p-3">
            <p className="text-xs uppercase text-indigo-700">Attempted</p>
            <p className="text-xl font-bold text-indigo-900">{score.attempted}</p>
          </div>
          <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-3">
            <p className="text-xs uppercase text-emerald-700">Evaluated</p>
            <p className="text-xl font-bold text-emerald-900">{score.evaluated}</p>
          </div>
          <div className="rounded-lg border border-cyan-200 bg-cyan-50 p-3">
            <p className="text-xs uppercase text-cyan-700">Total</p>
            <p className="text-xl font-bold text-cyan-900">{score.total_score}/{score.max_total_score}</p>
          </div>
        </div>
      </section>

      <section className="space-y-3">
        <h3 className="text-lg font-bold text-slate-900">Question-wise Review</h3>
        {test.questions.map((question, idx) => {
          const detail = detailMap.get(question.item_id);
          return (
            <article key={question.item_id} className="rounded-lg border border-slate-200 bg-white p-5">
              <p className="text-sm font-semibold text-slate-900">
                {idx + 1}. {question.question_text}
              </p>
              <p className="mt-2 text-xs text-slate-600">
                Score: {detail?.score ?? 0}/{detail?.max_score ?? 10}
              </p>
              <div className="mt-3 space-y-3">
                <div>
                  <p className="text-[11px] font-semibold uppercase text-slate-500">Your Answer</p>
                  <p className="mt-1 whitespace-pre-wrap rounded border border-slate-200 bg-slate-50 p-3 text-sm text-slate-700">
                    {detail?.answer_text || "Not submitted"}
                  </p>
                </div>
                <div>
                  <p className="text-[11px] font-semibold uppercase text-slate-500">Evaluation Feedback</p>
                  <p className="mt-1 whitespace-pre-wrap rounded border border-indigo-100 bg-indigo-50 p-3 text-sm text-slate-700">
                    {detail?.feedback || "No feedback available"}
                  </p>
                </div>
                {detail?.reference_model_answer ? (
                  <div>
                    <p className="text-[11px] font-semibold uppercase text-slate-500">Reference Model Answer</p>
                    <div
                      className="prose prose-sm mt-1 max-w-none rounded border border-emerald-100 bg-emerald-50 p-3 text-slate-800"
                      dangerouslySetInnerHTML={{ __html: detail.reference_model_answer }}
                    />
                  </div>
                ) : null}
              </div>
            </article>
          );
        })}
      </section>

      <div className="flex gap-2">
        <button
          onClick={() => router.push(`/collections/${collectionId}`)}
          className="rounded bg-slate-900 px-4 py-2 text-sm font-semibold text-white"
        >
          Open Test
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
