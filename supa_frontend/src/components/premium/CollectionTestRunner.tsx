"use client";

import { Loader2 } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import axios from "axios";

import { premiumApi } from "@/lib/premiumApi";
import { collectionTestResultStorageKey } from "@/lib/collectionTestResultStorage";
import type { CollectionScorePayload, CollectionTestPayload } from "@/types/premium";

interface CollectionTestRunnerProps {
  collectionId: string;
}

export default function CollectionTestRunner({ collectionId }: CollectionTestRunnerProps) {
  const router = useRouter();
  const [isLoading, setIsLoading] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [payload, setPayload] = useState<CollectionTestPayload | null>(null);
  const [index, setIndex] = useState(0);
  const [answers, setAnswers] = useState<Record<number, string>>({});

  useEffect(() => {
    const load = async () => {
      setIsLoading(true);
      try {
        const response = await premiumApi.get<CollectionTestPayload>(`/collections/${collectionId}/test`);
        setPayload(response.data);
      } catch (error: unknown) {
        const description = axios.isAxiosError(error)
          ? (typeof error.response?.data?.detail === "string" ? error.response.data.detail : error.message)
          : "Unknown error";
        toast.error("Failed to load Prelims Test", { description });
      } finally {
        setIsLoading(false);
      }
    };
    load();
  }, [collectionId]);

  const currentQuestion = useMemo(() => payload?.questions[index], [payload, index]);
  const answeredCount = useMemo(() => Object.values(answers).filter(Boolean).length, [answers]);
  const currentQuestionAny = (currentQuestion as unknown as Record<string, unknown> | undefined) || undefined;
  const questionText = String(currentQuestion?.question_statement || currentQuestionAny?.question || "").trim();
  const supplementaryText = String(
    currentQuestion?.supplementary_statement
      || currentQuestionAny?.supp_question_statement
      || currentQuestionAny?.supplementary
      || ""
  ).trim();
  const statements = Array.isArray(currentQuestion?.statements_facts)
    ? currentQuestion.statements_facts
    : Array.isArray(currentQuestionAny?.statement_facts)
      ? (currentQuestionAny?.statement_facts as string[])
      : [];
  const promptText = String(currentQuestion?.question_prompt || currentQuestionAny?.prompt || "").trim();

  const setAnswer = (label: string) => {
    if (!currentQuestion) return;
    setAnswers((prev) => ({ ...prev, [currentQuestion.item_id]: label }));
  };

  const submitTest = async () => {
    if (!payload) return;
    setIsSubmitting(true);
    try {
      const response = await premiumApi.post<CollectionScorePayload>(`/collections/${collectionId}/test/score`, {
        answers: payload.questions.map((question) => ({
          item_id: question.item_id,
          selected_option: answers[question.item_id] || null,
        })),
      });
      const storageKey = collectionTestResultStorageKey(collectionId);
      const snapshot = {
        test: payload,
        score: response.data,
        answers,
        submitted_at: new Date().toISOString(),
      };
      sessionStorage.setItem(storageKey, JSON.stringify(snapshot));
      toast.success("Prelims Test submitted");
      router.push(`/collections/${collectionId}/test/result`);
    } catch (error: unknown) {
      const description = axios.isAxiosError(error)
        ? (typeof error.response?.data?.detail === "string" ? error.response.data.detail : error.message)
        : "Unknown error";
      toast.error("Failed to submit test", { description });
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
        No questions found in this Prelims Test.
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-slate-200 bg-white p-6">
        <div className="flex items-center justify-between">
          <p className="text-xs font-medium uppercase text-slate-500">
            {payload.collection_title} - Question {index + 1} of {payload.total_questions}
          </p>
          <p className="text-xs text-slate-500">
            Attempted: {answeredCount}/{payload.total_questions}
          </p>
        </div>
        <h2 className="mt-2 text-lg font-bold text-slate-900">{questionText}</h2>
        {supplementaryText ? (
          <p className="mt-1 text-sm text-slate-700">{supplementaryText}</p>
        ) : null}
        {statements.length > 0 ? (
          <ul className="mt-3 list-disc space-y-1 pl-5 text-sm text-slate-700">
            {statements.map((fact, factIndex) => (
              <li key={factIndex}>{fact}</li>
            ))}
          </ul>
        ) : null}
        {promptText ? (
          <p className="mt-3 rounded border border-slate-100 bg-slate-50 p-3 text-sm italic text-slate-700">
            {promptText}
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
          onClick={submitTest}
          disabled={isSubmitting}
          className="inline-flex items-center rounded bg-slate-900 px-4 py-2 text-sm font-semibold text-white disabled:opacity-60"
        >
          {isSubmitting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
          Submit Prelims Test
        </button>
      </div>
    </div>
  );
}
