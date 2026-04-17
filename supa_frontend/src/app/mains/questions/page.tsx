import Link from "next/link";
import { redirect } from "next/navigation";

import AppLayout from "@/components/layouts/AppLayout";
import MainsQuestionRepositoryStudio from "@/components/mains/MainsQuestionRepositoryStudio";
import { canAccessMainsAuthoring } from "@/lib/accessControl";
import { getCurrentProfile } from "@/lib/backendServer";
import { createClient } from "@/lib/supabase/server";

export default async function MainsQuestionRepositoryPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    redirect("/login");
  }

  const profile = await getCurrentProfile<{ role: string }>();

  const canAccess = canAccessMainsAuthoring({ role: profile?.role });

  return (
    <AppLayout>
      <div className="mx-auto max-w-7xl space-y-4 p-4 md:p-6">
        {canAccess ? (
          <>
            <div>
              <h1 className="text-3xl font-bold text-slate-900">Mains Question Repository</h1>
              <p className="mt-1 text-sm text-slate-600">
                Manual mains question creation with AI parsing, category tagging, repository management, and direct add-to-test flow.
              </p>
            </div>
            <MainsQuestionRepositoryStudio />
          </>
        ) : (
          <div className="rounded-xl border border-amber-200 bg-amber-50 p-6">
            <h1 className="text-xl font-bold text-amber-900">Mains repository is restricted</h1>
            <p className="mt-2 text-sm text-amber-800">
              User role can use AI pages, but manual mains question repository is limited to Mains Mentor and admin workflows.
            </p>
            <div className="mt-4 flex flex-wrap gap-2">
              <Link href="/mains/evaluate" className="rounded-md border border-slate-300 bg-white px-3 py-2 text-sm font-semibold text-slate-700">
                Open Mains AI
              </Link>
              <Link href="/collections/create" className="rounded-md border border-slate-300 bg-white px-3 py-2 text-sm font-semibold text-slate-700">
                Create a Mains Test
              </Link>
            </div>
          </div>
        )}
      </div>
    </AppLayout>
  );
}
