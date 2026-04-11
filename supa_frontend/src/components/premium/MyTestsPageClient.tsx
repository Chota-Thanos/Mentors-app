"use client";

import Link from "next/link";
import axios from "axios";
import { useState, useTransition } from "react";
import { toast } from "sonner";

import { premiumApi } from "@/lib/premiumApi";
import type { ChallengeLinkResponse } from "@/types/premium";

export interface MyTestsCardItem {
  id: number;
  title: string;
  test_kind: "prelims" | "mains";
  question_count: number;
  is_finalized: boolean;
  is_public: boolean;
  is_premium: boolean;
  updated_at?: string | null;
  created_at: string;
}

interface CollectionUpdateResponse {
  id: number;
  title: string;
  is_finalized: boolean;
  is_public: boolean;
  is_premium: boolean;
  updated_at?: string | null;
}

interface MyTestsPageClientProps {
  initialTests: MyTestsCardItem[];
  canCreateMains: boolean;
}

function toError(error: unknown): string {
  if (axios.isAxiosError(error)) {
    const detail = error.response?.data?.detail;
    if (typeof detail === "string" && detail.trim()) return detail;
    return error.message;
  }
  return "Something went wrong.";
}

function formatDate(value?: string | null): string {
  if (!value) return "No updates yet";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return "No updates yet";
  return parsed.toLocaleDateString();
}

function statLabel(count: number): string {
  return count === 1 ? "1 question" : `${count} questions`;
}

function resolveChallengeUrl(link: ChallengeLinkResponse): string {
  if (link.share_url) return link.share_url;
  if (link.share_path && typeof window !== "undefined") {
    return `${window.location.origin}${link.share_path}`;
  }
  return "";
}

export default function MyTestsPageClient({ initialTests, canCreateMains }: MyTestsPageClientProps) {
  const [tests, setTests] = useState(initialTests);
  const [workingId, setWorkingId] = useState<number | null>(null);
  const [challengingId, setChallengingId] = useState<number | null>(null);
  const [, startTransition] = useTransition();

  const finalizeTest = async (testId: number) => {
    setWorkingId(testId);
    try {
      const response = await premiumApi.put<CollectionUpdateResponse>(`/collections/${testId}`, {
        is_finalized: true,
      });
      startTransition(() => {
        setTests((current) =>
          current.map((test) =>
            test.id === testId
              ? {
                  ...test,
                  title: response.data.title || test.title,
                  is_finalized: Boolean(response.data.is_finalized),
                  is_public: Boolean(response.data.is_public),
                  is_premium: Boolean(response.data.is_premium),
                  updated_at: response.data.updated_at || test.updated_at,
                }
              : test,
          ),
        );
      });
      toast.success("Test finalized");
    } catch (error: unknown) {
      toast.error("Failed to finalize test", { description: toError(error) });
    } finally {
      setWorkingId(null);
    }
  };

  const createPublicChallenge = async (test: MyTestsCardItem) => {
    if (test.test_kind !== "prelims") {
      toast.error("Only prelims tests can be turned into a challenge");
      return;
    }

    setChallengingId(test.id);
    try {
      if (!test.is_finalized || !test.is_public) {
        const updateResponse = await premiumApi.put<CollectionUpdateResponse>(`/collections/${test.id}`, {
          is_finalized: true,
          is_public: true,
        });
        startTransition(() => {
          setTests((current) =>
            current.map((row) =>
              row.id === test.id
                ? {
                    ...row,
                    title: updateResponse.data.title || row.title,
                    is_finalized: Boolean(updateResponse.data.is_finalized),
                    is_public: Boolean(updateResponse.data.is_public),
                    is_premium: Boolean(updateResponse.data.is_premium),
                    updated_at: updateResponse.data.updated_at || row.updated_at,
                  }
                : row,
            ),
          );
        });
      }

      const response = await premiumApi.post<ChallengeLinkResponse>(`/collections/${test.id}/challenges`, {
        title: `${test.title} Challenge`,
        description: "Shared from My Tests",
        expires_in_hours: 72,
        allow_anonymous: true,
        require_login: false,
        max_attempts_per_participant: 3,
      });
      const shareUrl = resolveChallengeUrl(response.data);
      if (shareUrl && typeof window !== "undefined") {
        window.open(shareUrl, "_blank", "noopener,noreferrer");
      }
      toast.success("Challenge created", {
        description: shareUrl || "The public challenge link is ready.",
      });
    } catch (error: unknown) {
      toast.error("Failed to create public challenge", { description: toError(error) });
    } finally {
      setChallengingId(null);
    }
  };

  return (
    <div className="space-y-8">
      <section className="rounded-3xl border border-[#dce3fb] dark:border-[#1e2a4a] bg-white dark:bg-[#0b1120] p-6 shadow-sm sm:p-8">
        <h1 className="text-3xl font-bold tracking-tight text-[#141b2d] dark:text-white sm:text-4xl">My Tests</h1>
        <p className="mt-2 max-w-2xl text-sm text-[#636b86] dark:text-gray-300 sm:text-base">
          Create a test, finalize it, and start it from here.
        </p>
        <div className="mt-5 flex flex-wrap gap-3">
          <Link
            href="/collections/create?test_kind=prelims"
            className="inline-flex items-center rounded-full bg-slate-900 px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-slate-800"
          >
            Create Prelims Test
          </Link>
          {canCreateMains ? (
            <Link
              href="/mains/evaluate"
              className="inline-flex items-center rounded-full border border-indigo-300 bg-indigo-50 px-5 py-2.5 text-sm font-semibold text-indigo-700 transition hover:bg-indigo-100"
            >
              Create Mains Test
            </Link>
          ) : null}
          <Link
            href="/challenges"
            className="inline-flex items-center rounded-full border border-[#c9d6fb] dark:border-[#2a3c6b] bg-white dark:bg-[#0b1120] px-5 py-2.5 text-sm font-semibold text-[#334155] dark:text-gray-300 transition hover:bg-[#f8faff] dark:hover:bg-[#0f172a]"
          >
            Public Challenges
          </Link>
        </div>
      </section>

      {tests.length === 0 ? (
        <section className="rounded-3xl border border-dashed border-[#dce3fb] dark:border-[#1e2a4a] bg-white dark:bg-[#0b1120] px-6 py-16 text-center text-sm text-[#6c7590] dark:text-[#94a3b8]">
          No tests yet.
        </section>
      ) : (
        <section className="space-y-4">
          <div>
            <h2 className="text-xl font-semibold text-[#141b2d] dark:text-white">Existing Tests</h2>
          </div>

          <div className="grid gap-4 lg:grid-cols-2">
            {tests.map((test) => {
              const editHref = `/collections/${test.id}/question-methods`;
              const startHref = test.test_kind === "mains" ? `/collections/${test.id}` : `/collections/${test.id}/test`;
              const detailHref = `/collections/${test.id}`;
              const isWorking = workingId === test.id;
              const isChallenging = challengingId === test.id;
              const challengeLabel = test.is_finalized && test.is_public ? "Challenge" : "Public Challenge";

              return (
                <article key={test.id} className="rounded-3xl border border-[#dce3fb] dark:border-[#1e2a4a] bg-white dark:bg-[#0b1120] p-5 shadow-sm">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="space-y-2">
                      <Link href={detailHref} className="text-xl font-semibold text-[#141b2d] dark:text-white transition hover:text-indigo-700 dark:hover:text-indigo-400">
                        {test.title}
                      </Link>
                      <div className="flex flex-wrap gap-2 text-xs font-semibold">
                        <span className="rounded-full bg-[#eef4ff] dark:bg-[#16213e] px-3 py-1 text-[#334155] dark:text-gray-300">
                          {test.test_kind === "mains" ? "Mains" : "Prelims"}
                        </span>
                        <span
                          className={`rounded-full px-3 py-1 ${
                            test.is_finalized ? "bg-emerald-100 text-emerald-700" : "bg-amber-100 text-amber-700"
                          }`}
                        >
                          {test.is_finalized ? "Finalized" : "Draft"}
                        </span>
                        <span className={`rounded-full px-3 py-1 ${test.is_public ? "bg-sky-100 text-sky-700" : "bg-[#eef4ff] dark:bg-[#16213e] text-[#636b86] dark:text-gray-400"}`}>
                          {test.is_public ? "Public" : "Private"}
                        </span>
                      </div>
                    </div>
                    <span className="rounded-full bg-[#eef4ff] dark:bg-[#16213e] px-3 py-1 text-xs font-medium text-[#636b86] dark:text-[#94a3b8]">
                      Updated {formatDate(test.updated_at || test.created_at)}
                    </span>
                  </div>

                  <div className="mt-5 grid gap-3 sm:grid-cols-3">
                    <div className="rounded-2xl bg-[#f8faff] dark:bg-[#0f172a] px-4 py-3">
                      <p className="text-xs font-medium uppercase tracking-wide text-[#6c7590] dark:text-[#94a3b8]">Questions</p>
                      <p className="mt-1 text-sm font-semibold text-[#141b2d] dark:text-white">{statLabel(test.question_count)}</p>
                    </div>
                    <div className="rounded-2xl bg-[#f8faff] dark:bg-[#0f172a] px-4 py-3">
                      <p className="text-xs font-medium uppercase tracking-wide text-[#6c7590] dark:text-[#94a3b8]">Access</p>
                      <p className="mt-1 text-sm font-semibold text-[#141b2d] dark:text-white">{test.is_premium ? "Premium" : "Free"}</p>
                    </div>
                    <div className="rounded-2xl bg-[#f8faff] dark:bg-[#0f172a] px-4 py-3">
                      <p className="text-xs font-medium uppercase tracking-wide text-[#6c7590] dark:text-[#94a3b8]">Status</p>
                      <p className="mt-1 text-sm font-semibold text-[#141b2d] dark:text-white">{test.is_finalized ? "Ready to start" : "Needs finalizing"}</p>
                    </div>
                  </div>

                  <div className="mt-5 flex flex-wrap gap-3">
                    {test.is_finalized ? (
                      <Link
                        href={startHref}
                        className="inline-flex items-center rounded-full bg-indigo-600 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-indigo-500"
                      >
                        Start Test
                      </Link>
                    ) : (
                      <button
                        type="button"
                        onClick={() => finalizeTest(test.id)}
                        disabled={isWorking}
                        className="inline-flex items-center rounded-full bg-indigo-600 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-indigo-500 disabled:cursor-not-allowed disabled:opacity-60"
                      >
                        {isWorking ? "Finalizing..." : "Finalize"}
                      </button>
                    )}

                    <Link
                      href={editHref}
                      className="inline-flex items-center rounded-full border border-[#c9d6fb] dark:border-[#2a3c6b] bg-white dark:bg-[#0b1120] px-4 py-2.5 text-sm font-semibold text-[#334155] dark:text-gray-300 transition hover:bg-[#f8faff] dark:hover:bg-[#0f172a]"
                    >
                      Edit
                    </Link>

                    {test.test_kind === "prelims" ? (
                      <button
                        type="button"
                        onClick={() => void createPublicChallenge(test)}
                        disabled={isChallenging}
                        className="inline-flex items-center rounded-full border border-sky-300 bg-sky-50 px-4 py-2.5 text-sm font-semibold text-sky-700 transition hover:bg-sky-100 disabled:cursor-not-allowed disabled:opacity-60"
                      >
                        {isChallenging ? "Creating..." : challengeLabel}
                      </button>
                    ) : null}
                  </div>
                </article>
              );
            })}
          </div>
        </section>
      )}
    </div>
  );
}
