import Link from "next/link";

import AppLayout from "@/components/layouts/AppLayout";
import { backendRoot } from "@/lib/backendUrl";
import type { PublicChallengeListItem } from "@/types/premium";

async function fetchPublicChallenges(): Promise<PublicChallengeListItem[]> {
  try {
    const response = await fetch(`${backendRoot}/api/v1/premium/challenges/public`, {
      cache: "no-store",
    });
    if (!response.ok) {
      return [];
    }
    const payload = (await response.json()) as PublicChallengeListItem[];
    return Array.isArray(payload) ? payload : [];
  } catch {
    return [];
  }
}

function formatExpiry(value?: string | null): string {
  if (!value) return "No expiry";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return "No expiry";
  return `Ends ${parsed.toLocaleDateString()}`;
}

export default async function PublicChallengesPage() {
  const challenges = await fetchPublicChallenges();

  return (
    <AppLayout hideAdminLinks>
      <div className="mx-auto max-w-6xl space-y-8">
        <section className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm sm:p-8">
          <h1 className="text-3xl font-bold tracking-tight text-slate-900 sm:text-4xl">Public Challenges</h1>
          <p className="mt-2 max-w-2xl text-sm text-slate-600 sm:text-base">
            Open a live challenge and start the test directly.
          </p>
        </section>

        {challenges.length === 0 ? (
          <section className="rounded-3xl border border-dashed border-slate-300 bg-white px-6 py-16 text-center text-sm text-slate-500">
            No public challenges are live right now.
          </section>
        ) : (
          <section className="grid gap-4 lg:grid-cols-2">
            {challenges.map((challenge) => (
              <article key={challenge.challenge_id} className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
                <div className="space-y-2">
                  <p className="text-xs font-semibold uppercase tracking-[0.2em] text-sky-700">Challenge</p>
                  <h2 className="text-2xl font-semibold text-slate-900">{challenge.challenge_title}</h2>
                  <p className="text-sm text-slate-500">{challenge.collection_title}</p>
                </div>

                {challenge.challenge_description ? (
                  <p className="mt-3 text-sm leading-6 text-slate-600">{challenge.challenge_description}</p>
                ) : null}

                <div className="mt-5 grid gap-3 sm:grid-cols-3">
                  <div className="rounded-2xl bg-slate-50 px-4 py-3">
                    <p className="text-xs font-medium uppercase tracking-wide text-slate-500">Questions</p>
                    <p className="mt-1 text-sm font-semibold text-slate-900">{challenge.question_count}</p>
                  </div>
                  <div className="rounded-2xl bg-slate-50 px-4 py-3">
                    <p className="text-xs font-medium uppercase tracking-wide text-slate-500">Attempts</p>
                    <p className="mt-1 text-sm font-semibold text-slate-900">{challenge.total_attempts}</p>
                  </div>
                  <div className="rounded-2xl bg-slate-50 px-4 py-3">
                    <p className="text-xs font-medium uppercase tracking-wide text-slate-500">Type</p>
                    <p className="mt-1 text-sm font-semibold text-slate-900">
                      {challenge.test_kind === "mains" ? "Mains" : "Prelims"}
                    </p>
                  </div>
                </div>

                <div className="mt-5 flex flex-wrap items-center justify-between gap-3">
                  <span className="text-xs font-medium text-slate-500">{formatExpiry(challenge.expires_at)}</span>
                  <Link
                    href={challenge.share_path}
                    className="inline-flex items-center rounded-full bg-indigo-600 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-indigo-500"
                  >
                    Open Challenge
                  </Link>
                </div>
              </article>
            ))}
          </section>
        )}
      </div>
    </AppLayout>
  );
}
