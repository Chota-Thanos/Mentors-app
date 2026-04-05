import { notFound } from "next/navigation";

import AppLayout from "@/components/layouts/AppLayout";
import PrelimsSeriesPurchasesView from "@/components/premium/PrelimsSeriesPurchasesView";

interface PageProps {
  params: Promise<{ id: string }>;
}

export const metadata = {
  title: "Series Purchases – Prelims Program Workspace",
  description: "View all learner purchases and enrollments for this prelims programs.",
};

export default async function TestSeriesPurchasesPage({ params }: PageProps) {
  const { id } = await params;
  const seriesId = Number(id);
  if (!Number.isFinite(seriesId) || seriesId <= 0) return notFound();

  return (
    <AppLayout>
      <div className="mx-auto max-w-6xl space-y-6 p-4 md:p-6 pb-24">
        <PrelimsSeriesPurchasesView seriesId={seriesId} />
      </div>
    </AppLayout>
  );
}
