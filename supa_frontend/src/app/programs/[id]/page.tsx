import { notFound } from "next/navigation";

import AppLayout from "@/components/layouts/AppLayout";
import TestSeriesDetailView from "@/components/premium/TestSeriesDetailView";

interface PageProps {
  params: Promise<{ id: string }>;
}

export default async function TestSeriesDetailPage({ params }: PageProps) {
  const { id } = await params;
  const seriesId = Number(id);
  if (!Number.isFinite(seriesId) || seriesId <= 0) return notFound();

  return (
    <AppLayout>
      <div className="mx-auto max-w-6xl space-y-4 p-4 md:p-6">
        <TestSeriesDetailView seriesId={seriesId} />
      </div>
    </AppLayout>
  );
}
