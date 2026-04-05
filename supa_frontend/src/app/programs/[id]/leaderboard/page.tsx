import { notFound } from "next/navigation";

import AppLayout from "@/components/layouts/AppLayout";
import PrelimsLeaderboardView from "@/components/premium/PrelimsLeaderboardView";

interface PageProps {
  params: Promise<{ id: string }>;
}

export const metadata = {
  title: "Program Leaderboard – Prelims Workspace",
  description: "Per-test rankings and learner scores for this prelims programs.",
};

export default async function TestSeriesLeaderboardPage({ params }: PageProps) {
  const { id } = await params;
  const seriesId = Number(id);
  if (!Number.isFinite(seriesId) || seriesId <= 0) return notFound();

  return (
    <AppLayout>
      <div className="mx-auto max-w-7xl space-y-6 p-4 md:p-6 pb-24">
        <PrelimsLeaderboardView seriesId={seriesId} />
      </div>
    </AppLayout>
  );
}
