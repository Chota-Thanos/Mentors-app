import { notFound } from "next/navigation";

import LearnerPerformanceCategoryDetail from "@/components/dashboard/LearnerPerformanceCategoryDetail";
import AppLayout from "@/components/layouts/AppLayout";
import { isDashboardContentType } from "@/lib/dashboardSections";
import type { PerformanceAuditSourceKind } from "@/types/premium";

interface PageProps {
  params: Promise<{
    contentType: string;
    sourceKind: string;
    categoryId: string;
  }>;
}

function isPerformanceSourceKind(value: string): value is PerformanceAuditSourceKind {
  return value === "ai" || value === "program";
}

export default async function PerformanceCategoryDetailPage({ params }: PageProps) {
  const { contentType, sourceKind, categoryId } = await params;
  const parsedCategoryId = Number(categoryId);

  if (!isDashboardContentType(contentType)) return notFound();
  if (!isPerformanceSourceKind(sourceKind)) return notFound();
  if (!Number.isFinite(parsedCategoryId) || parsedCategoryId <= 0) return notFound();

  return (
    <AppLayout>
      <LearnerPerformanceCategoryDetail
        contentType={contentType}
        sourceKind={sourceKind}
        categoryId={parsedCategoryId}
      />
    </AppLayout>
  );
}
