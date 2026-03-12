import AppLayout from "@/components/layouts/AppLayout";
import MentorshipOrderDetailClient from "@/components/account/MentorshipOrderDetailClient";

interface PageProps {
  params: Promise<{ requestId: string }>;
}

export default async function MentorshipOrderDetailPage({ params }: PageProps) {
  const { requestId } = await params;
  const normalizedRequestId = Number(requestId || "");

  return (
    <AppLayout>
      <div className="mx-auto w-full max-w-7xl p-4 md:p-6">
        <MentorshipOrderDetailClient requestId={Number.isFinite(normalizedRequestId) ? normalizedRequestId : 0} />
      </div>
    </AppLayout>
  );
}
