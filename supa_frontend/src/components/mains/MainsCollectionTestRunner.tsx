"use client";

import Link from "next/link";
import { Loader2 } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";

import { useAuth } from "@/context/AuthContext";
import { isAdminLike, isMentorLike, isModeratorLike } from "@/lib/accessControl";
import { premiumApi } from "@/lib/premiumApi";
import type { MainsCollectionTestPayload } from "@/types/premium";

import MainsLearnerSubmissionDesk from "./MainsLearnerSubmissionDesk";
import MainsMentorReviewDesk from "./MainsMentorReviewDesk";

interface MainsCollectionTestRunnerProps {
  collectionId: string;
  embedded?: boolean;
  initialPayload?: MainsCollectionTestPayload | null;
}

const toError = (error: unknown): string => {
  if (typeof error === "object" && error !== null && "response" in error) {
    const response = (error as { response?: { data?: { detail?: string } } }).response;
    if (response?.data?.detail) return response.data.detail;
  }
  if (error instanceof Error) return error.message;
  return "Unknown error";
};

export default function MainsCollectionTestRunner({
  collectionId,
  embedded = false,
  initialPayload = null,
}: MainsCollectionTestRunnerProps) {
  const { user, loading, isAuthenticated } = useAuth();
  const canReview = useMemo(
    () => isAdminLike(user) || isModeratorLike(user) || isMentorLike(user),
    [user],
  );
  const [isLoading, setIsLoading] = useState(!initialPayload);
  const [payload, setPayload] = useState<MainsCollectionTestPayload | null>(initialPayload);

  useEffect(() => {
    if (initialPayload) {
      setPayload(initialPayload);
      setIsLoading(false);
      return;
    }
    if (loading) return;
    let active = true;
    const load = async () => {
      setIsLoading(true);
      try {
        const response = await premiumApi.get<MainsCollectionTestPayload>(`/collections/${collectionId}/mains-test`);
        if (!active) return;
        setPayload(response.data);
      } catch (error: unknown) {
        if (!active) return;
        toast.error("Failed to load mains paper", { description: toError(error) });
        setPayload(null);
      } finally {
        if (active) setIsLoading(false);
      }
    };
    void load();
    return () => {
      active = false;
    };
  }, [collectionId, initialPayload, isAuthenticated, loading]);

  const totalMarks = useMemo(
    () => payload?.questions.reduce((sum, question) => sum + Number(question.max_marks || 0), 0) || 0,
    [payload],
  );

  if (isLoading) {
    return (
      <div className="flex items-center justify-center rounded-xl border border-slate-200 bg-white p-16">
        <Loader2 className="h-6 w-6 animate-spin text-slate-500" />
      </div>
    );
  }

  if (!payload || payload.questions.length === 0) {
    return (
      <div className="rounded-xl border border-slate-200 bg-white p-10 text-center text-sm text-slate-500">
        No mains questions found in this paper.
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <section className="rounded-2xl border border-slate-200 bg-white p-6">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="space-y-2">
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
              {embedded ? "Mains Paper Flow" : "Mains Writing Desk"}
            </p>
            <h2 className="text-2xl font-bold text-slate-900">{payload.collection_title}</h2>
            <p className="max-w-3xl text-sm text-slate-600">
              {embedded
                ? "This test page now carries the full learner flow. Read the complete paper, submit one combined PDF or question-wise answer photos, then track evaluation and mentorship here."
                : "Read the complete paper here, then submit one combined PDF or question-wise answer photos. Learners do not see answer approaches or model answers on this desk."}
            </p>
            <div className="flex flex-wrap items-center gap-3 text-xs">
              {payload.series_id ? (
                <Link href={`/test-series/${payload.series_id}`} className="inline-flex items-center gap-1 font-semibold text-indigo-700 hover:text-indigo-900">
                  Open linked series
                </Link>
              ) : (
                <p className="text-amber-700">This paper is not linked to a test series yet, so learner submissions are disabled.</p>
              )}
            </div>
          </div>
          <div className="grid min-w-[240px] gap-2 text-xs text-slate-600 sm:grid-cols-2">
            <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2">
              <p className="text-[11px] uppercase text-slate-500">Questions</p>
              <p className="mt-1 text-lg font-bold text-slate-900">{payload.total_questions}</p>
            </div>
            <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2">
              <p className="text-[11px] uppercase text-slate-500">Total Marks</p>
              <p className="mt-1 text-lg font-bold text-slate-900">{totalMarks}</p>
            </div>
          </div>
        </div>
      </section>

      {canReview ? (
        <>
          <section className="space-y-3 rounded-2xl border border-slate-200 bg-white p-6">
            <div>
              <h3 className="text-lg font-semibold text-slate-900">Question Paper</h3>
              <p className="text-sm text-slate-500">All questions, marks, and word limits are visible in one place.</p>
            </div>
            <div className="space-y-4">
              {payload.questions.map((question) => (
                <article key={`${question.content_item_id}:${question.question_number}`} className="rounded-xl border border-slate-200 bg-slate-50 p-4">
                  <div className="flex flex-wrap items-center gap-2 text-[11px]">
                    <span className="rounded-full bg-white px-2 py-0.5 font-semibold text-slate-700">Q{question.question_number}</span>
                    <span className="rounded-full bg-emerald-100 px-2 py-0.5 font-semibold text-emerald-700">{question.max_marks} marks</span>
                    <span className="rounded-full bg-sky-100 px-2 py-0.5 font-semibold text-sky-700">{question.word_limit} words</span>
                  </div>
                  <p className="mt-3 whitespace-pre-wrap text-sm leading-7 text-slate-800">{question.question_text}</p>
                </article>
              ))}
            </div>
          </section>
          <MainsMentorReviewDesk collectionId={collectionId} payload={payload} totalMarks={totalMarks} />
        </>
      ) : (
        <MainsLearnerSubmissionDesk collectionId={collectionId} payload={payload} />
      )}
    </div>
  );
}
