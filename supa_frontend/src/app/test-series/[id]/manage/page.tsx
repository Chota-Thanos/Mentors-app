import { notFound } from "next/navigation";

import AppLayout from "@/components/layouts/AppLayout";
import TestSeriesManageView from "@/components/premium/TestSeriesManageView";

interface PageProps {
  params: Promise<{ id: string }>;
}

export default async function TestSeriesManagePage({ params }: PageProps) {
  const { id } = await params;
  const seriesId = Number(id);
  if (!Number.isFinite(seriesId) || seriesId <= 0) return notFound();

  return (
    <AppLayout>
      <div className="mx-auto max-w-7xl space-y-4 p-4 md:p-6">
        <TestSeriesManageView seriesId={seriesId} />
      </div>
    </AppLayout>
  );
}
