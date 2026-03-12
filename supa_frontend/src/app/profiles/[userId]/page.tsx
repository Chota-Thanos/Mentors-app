import { notFound } from "next/navigation";

import AppLayout from "@/components/layouts/AppLayout";
import ProfessionalPublicProfileView from "@/components/premium/ProfessionalPublicProfileView";

interface PageProps {
  params: Promise<{ userId: string }>;
  searchParams: Promise<{ seriesId?: string }>;
}

export default async function ProfessionalPublicProfilePage({ params, searchParams }: PageProps) {
  const { userId } = await params;
  const query = await searchParams;
  const normalized = String(userId || "").trim();
  const rawSeriesId = Number(query?.seriesId || "");
  const seriesId = Number.isFinite(rawSeriesId) && rawSeriesId > 0 ? rawSeriesId : null;
  if (!normalized) return notFound();

  return (
    <AppLayout>
      <div className="mx-auto w-full max-w-6xl p-4 md:p-6">
        <ProfessionalPublicProfileView userId={normalized} seriesId={seriesId} />
      </div>
    </AppLayout>
  );
}
