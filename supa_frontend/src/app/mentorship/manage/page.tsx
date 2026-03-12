import AppLayout from "@/components/layouts/AppLayout";
import MentorshipManagementView from "@/components/premium/MentorshipManagementView";
import { redirect } from "next/navigation";

interface PageProps {
  searchParams: Promise<{ seriesId?: string; mentor?: string }>;
}

export default async function MentorshipManagementPage({ searchParams }: PageProps) {
  const params = await searchParams;
  const rawSeriesId = Number(params?.seriesId || "");
  const seriesId = Number.isFinite(rawSeriesId) && rawSeriesId > 0 ? rawSeriesId : null;
  const prefillMentorUserId = String(params?.mentor || "").trim() || null;

  if (prefillMentorUserId) {
    const seriesQuery = seriesId ? `?seriesId=${seriesId}` : "";
    redirect(`/profiles/${encodeURIComponent(prefillMentorUserId)}${seriesQuery}`);
  }

  return (
    <AppLayout>
      <div className="mx-auto max-w-7xl space-y-4 p-4 md:p-6">
        <MentorshipManagementView seriesId={seriesId} prefillMentorUserId={prefillMentorUserId} />
      </div>
    </AppLayout>
  );
}
