import { notFound } from "next/navigation";

import AppLayout from "@/components/layouts/AppLayout";
import ProfessionalPublicProfileView from "@/components/premium/ProfessionalPublicProfileView";

interface PageProps {
  params: Promise<{ userId: string }>;
}

export default async function PublicProfilePage({ params }: PageProps) {
  const { userId } = await params;
  if (!userId) return notFound();

  return (
    <AppLayout>
      <div className="mx-auto max-w-7xl space-y-6 p-4 md:p-6 pb-24">
        <ProfessionalPublicProfileView userId={userId} />
      </div>
    </AppLayout>
  );
}
