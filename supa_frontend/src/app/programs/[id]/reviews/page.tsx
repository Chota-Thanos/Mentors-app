import { notFound } from "next/navigation";

import AppLayout from "@/components/layouts/AppLayout";
import PrelimsSeriesReviewsView from "@/components/premium/PrelimsSeriesReviewsView";

interface PageProps {
  params: Promise<{ id: string }>;
}

export const metadata = {
  title: "Series Reviews – Prelims Program Workspace",
  description: "View learner reviews and star ratings for this prelims programs creator.",
};

export default async function TestSeriesReviewsPage({ params }: PageProps) {
  const { id } = await params;
  const seriesId = Number(id);
  if (!Number.isFinite(seriesId) || seriesId <= 0) return notFound();

  return (
    <AppLayout>
      <div className="mx-auto max-w-6xl space-y-6 p-4 md:p-6 pb-24">
        <PrelimsSeriesReviewsView seriesId={seriesId} />
      </div>
    </AppLayout>
  );
}
