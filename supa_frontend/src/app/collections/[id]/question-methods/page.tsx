import { notFound, redirect } from "next/navigation";
import Link from "next/link";

import AppLayout from "@/components/layouts/AppLayout";
import MainsQuestionRepositoryStudio from "@/components/mains/MainsQuestionRepositoryStudio";
import QuestionCreationMethodsView from "@/components/premium/QuestionCreationMethodsView";
import { canAccessMainsAuthoring, canAccessManualQuizBuilder } from "@/lib/accessControl";
import { backendRoot } from "@/lib/backendUrl";
import { createClient } from "@/lib/supabase/server";

interface PageProps {
  params: Promise<{ id: string }>;
}

export default async function QuestionMethodsPage({ params }: PageProps) {
  const { id } = await params;
  const collectionId = Number(id);
  if (!Number.isFinite(collectionId) || collectionId <= 0) return notFound();

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return redirect("/login");

  const { data: collection } = await supabase
    .from("collections")
    .select("id,title,test_kind,meta")
    .eq("id", collectionId)
    .single();

  let resolvedTitle = String(collection?.title || "").trim();
  let resolvedTestKind = String(collection?.test_kind || "").trim().toLowerCase();
  const meta = collection?.meta && typeof collection.meta === "object" ? (collection.meta as Record<string, unknown>) : {};
  if (!resolvedTestKind) {
    resolvedTestKind = String(meta.test_kind || "").trim().toLowerCase();
  }
  if (!resolvedTestKind && String(meta.collection_mode || "").toLowerCase().includes("mains")) {
    resolvedTestKind = "mains";
  }

  if (!resolvedTitle) {
    const {
      data: { session },
    } = await supabase.auth.getSession();
    const token = session?.access_token;
    if (token) {
      const response = await fetch(`${backendRoot}/api/v1/premium/tests/${collectionId}`, {
        headers: { Authorization: `Bearer ${token}` },
        cache: "no-store",
      });
      if (response.ok) {
        const payload = await response.json();
        resolvedTitle = String(payload?.title || "").trim();
        resolvedTestKind = String(payload?.test_kind || resolvedTestKind || "").trim().toLowerCase();
      }
    }
  }

  if (!resolvedTitle) {
    resolvedTitle = `Test #${collectionId}`;
  }

  if (resolvedTestKind === "mains" && !canAccessMainsAuthoring(user)) {
    return redirect(`/collections/${collectionId}`);
  }
  if (resolvedTestKind !== "mains" && !canAccessManualQuizBuilder(user)) {
    return redirect(`/collections/${collectionId}`);
  }

  return (
    <AppLayout>
      {resolvedTestKind === "mains" ? (
        <div className="mx-auto max-w-7xl space-y-6 p-4 md:p-6">
          <section className="rounded-xl border border-slate-200 bg-white p-4 md:p-6">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <h1 className="text-2xl font-bold text-slate-900">Mains Question Builder: {resolvedTitle}</h1>
                <p className="mt-1 text-sm text-slate-600">
                  Manual mains drafting, AI parsing, repository management, and direct add-to-test flow.
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                <Link
                  href={`/collections/${collectionId}`}
                  className="rounded border border-slate-300 bg-white px-3 py-2 text-sm font-semibold text-slate-700"
                >
                  View Questions
                </Link>
                <Link
                  href={`/mains-mentor/ai-mains?collection_id=${collectionId}&bind_test=1&mode=mains_mentor`}
                  className="rounded border border-violet-300 bg-white px-3 py-2 text-sm font-semibold text-violet-700"
                >
                  Full AI Mains Studio
                </Link>
              </div>
            </div>
            <p className="mt-3 rounded bg-slate-50 px-3 py-2 text-xs text-slate-600">
              This page follows the same add/manage workflow used from the test-series manage screen, but is bound to the current mains test.
            </p>
          </section>

          <MainsQuestionRepositoryStudio
            boundCollectionId={collectionId}
            boundCollectionTitle={resolvedTitle}
          />
        </div>
      ) : (
        <div className="mx-auto max-w-6xl p-4 md:p-6">
          <QuestionCreationMethodsView collectionId={collectionId} collectionTitle={resolvedTitle} />
        </div>
      )}
    </AppLayout>
  );
}
