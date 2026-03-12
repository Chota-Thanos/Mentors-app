import { notFound } from "next/navigation";

import DashboardSectionDetailClient from "@/components/dashboard/DashboardSectionDetailClient";
import AppLayout from "@/components/layouts/AppLayout";
import { isDashboardContentType } from "@/lib/dashboardSections";

interface PageProps {
  params: Promise<{ contentType: string }>;
}

export default async function DashboardSectionPage({ params }: PageProps) {
  const { contentType } = await params;
  if (!isDashboardContentType(contentType)) return notFound();

  return (
    <AppLayout>
      <DashboardSectionDetailClient contentType={contentType} />
    </AppLayout>
  );
}
