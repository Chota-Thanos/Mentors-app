import { notFound } from "next/navigation";

import AppLayout from "@/components/layouts/AppLayout";

interface PageProps {
  params: Promise<{ userId: string }>;
}

export default async function PublicProfilePage({ params }: PageProps) {
  const { userId } = await params;
  if (!userId) return notFound();

  return (
    <AppLayout>
      <div className="mx-auto max-w-4xl space-y-6 p-4 md:p-6 pb-24">
        <div className="rounded-[32px] border border-slate-200 bg-white p-8 sm:p-12 text-center shadow-sm">
            <h1 className="text-3xl font-black tracking-tight text-slate-900">Public Profile</h1>
            <p className="mt-4 text-base text-slate-600">
                The public profile component for user {userId} is under construction...
            </p>
        </div>
      </div>
    </AppLayout>
  );
}
