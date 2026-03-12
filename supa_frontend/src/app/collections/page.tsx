import { redirect } from "next/navigation";
import Link from "next/link";
import Image from "next/image";

import AppLayout from "@/components/layouts/AppLayout";
import { canAccessMainsAuthoring, canAccessManualQuizBuilder } from "@/lib/accessControl";
import { getCollectionTestKind } from "@/lib/collectionKind";
import { richTextToPlainText } from "@/lib/richText";
import { createClient } from "@/lib/supabase/server";

interface CollectionRow {
  id: number;
  title: string;
  description: string | null;
  is_premium: boolean;
  price: number | null;
  thumbnail_url: string | null;
  created_at: string;
  test_kind?: "prelims" | "mains";
  collection_mode?: string;
  meta?: Record<string, unknown> | null;
}

const testBadgeClass = (kind: "prelims" | "mains"): string =>
  kind === "mains"
    ? "bg-indigo-100 text-indigo-800"
    : "bg-blue-100 text-blue-800";

const testLabel = (kind: "prelims" | "mains"): string =>
  kind === "mains" ? "Mains Test" : "Prelims Test";

function TestGrid({ tests }: { tests: CollectionRow[] }) {
  return (
    <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
      {tests.map((collection) => {
        const kind = getCollectionTestKind(collection);
        return (
          <Link key={collection.id} href={`/collections/${collection.id}`} className="group relative block h-full">
            <div className="relative flex h-full flex-col overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm transition-all hover:-translate-y-1 hover:shadow-lg">
              <div className="relative aspect-[16/9] w-full overflow-hidden bg-slate-100">
                {collection.thumbnail_url ? (
                  <Image
                    src={collection.thumbnail_url}
                    alt={collection.title}
                    fill
                    unoptimized
                    sizes="(max-width: 768px) 100vw, (max-width: 1200px) 50vw, 33vw"
                    className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-105"
                  />
                ) : (
                  <div className="flex h-full items-center justify-center bg-slate-50 text-slate-300">
                    <svg className="h-12 w-12" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={1}
                        d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z"
                      />
                    </svg>
                  </div>
                )}
                <div className="absolute left-3 top-3 flex items-center gap-2">
                  <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold shadow-sm ${testBadgeClass(kind)}`}>
                    {testLabel(kind)}
                  </span>
                </div>
                <div className="absolute right-3 top-3">
                  <span
                    className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold shadow-sm ${
                      collection.is_premium ? "bg-amber-100 text-amber-800" : "bg-green-100 text-green-800"
                    }`}
                  >
                    {collection.is_premium ? "Premium" : "Free"}
                  </span>
                </div>
              </div>
              <div className="flex flex-1 flex-col p-5">
                <h3 className="text-lg font-bold text-slate-900 transition-colors group-hover:text-blue-600">
                  {collection.title}
                </h3>
                <p className="mt-2 line-clamp-2 text-sm leading-relaxed text-slate-600">
                  {richTextToPlainText(collection.description || "") || "No description provided."}
                </p>
                <div className="mt-auto flex items-center justify-between border-t border-slate-50 pt-6">
                  <span className="text-xs font-medium uppercase tracking-wider text-slate-400">
                    {new Date(collection.created_at).toLocaleDateString()}
                  </span>
                  {collection.price && collection.price > 0 ? (
                    <span className="text-lg font-bold text-slate-900">INR {collection.price}</span>
                  ) : (
                    <span className="rounded-full bg-green-50 px-3 py-1 text-sm font-semibold text-green-600">
                      Free Access
                    </span>
                  )}
                </div>
              </div>
            </div>
          </Link>
        );
      })}
    </div>
  );
}

export default async function CollectionsPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    redirect("/login");
  }
  const canCreateManualQuiz = canAccessManualQuizBuilder(user);
  const canCreateMains = canAccessMainsAuthoring(user);

  const { data: collections } = await supabase
    .from("collections")
    .select("*")
    .eq("meta->>author_id", user.id)
    .order("created_at", { ascending: false });

  const rows = (collections || []) as CollectionRow[];
  const prelimsTests = rows.filter((row) => getCollectionTestKind(row) === "prelims");
  const mainsTests = rows.filter((row) => getCollectionTestKind(row) === "mains");

  return (
    <AppLayout>
      <div className="mb-8 flex flex-col justify-between gap-4 md:flex-row md:items-center">
        <div>
          <h2 className="text-3xl font-bold tracking-tight text-slate-900">My Tests</h2>
          <p className="mt-2 text-slate-500">Manage your quiz-based Prelims Tests and descriptive Mains Tests.</p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          {canCreateManualQuiz ? (
            <Link
              href="/quiz/create"
              className="inline-flex items-center rounded-md border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-50"
            >
              + Create Quiz
            </Link>
          ) : null}
          <Link
            href="/collections/create?test_kind=prelims"
            className="inline-flex items-center rounded-md border border-transparent bg-slate-900 px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-slate-800 focus:outline-none focus:ring-2 focus:ring-slate-900 focus:ring-offset-2"
          >
            + Create Prelims Test
          </Link>
          {canCreateMains ? (
            <Link
              href="/mains/evaluate"
              className="inline-flex items-center rounded-md border border-indigo-300 bg-indigo-50 px-4 py-2 text-sm font-medium text-indigo-700 transition-colors hover:bg-indigo-100"
            >
              + Create Mains Test
            </Link>
          ) : null}
        </div>
      </div>

      <div className="mb-8">
        <div className="relative">
          <input
            type="text"
            placeholder="Search tests..."
            className="w-full rounded-xl border-slate-200 py-3 pl-10 focus:border-indigo-500 focus:ring-indigo-500"
          />
          <div className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400">
            <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
            </svg>
          </div>
        </div>
      </div>

      {!rows || rows.length === 0 ? (
        <div className="rounded-xl border-2 border-dashed border-slate-200 py-20 text-center">
          <div className="mx-auto mb-4 h-12 w-12 text-slate-400">
            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 9.776c.112-.017.227-.026.344-.026h15.812c.117 0 .232.009.344.026m-16.5 0a2.25 2.25 0 0 0-1.883 2.542l.857 6a2.25 2.25 0 0 0 2.227 1.932H19.05a2.25 2.25 0 0 0 2.227-1.932l.857-6a2.25 2.25 0 0 0-1.883-2.542m-16.5 0V6A2.25 2.25 0 0 1 6 3.75h3.879a1.5 1.5 0 0 1 1.06.44l2.122 2.12a1.5 1.5 0 0 0 1.06.44H18A2.25 2.25 0 0 1 20.25 9v.776" />
            </svg>
          </div>
          <h3 className="text-lg font-medium text-slate-900">No tests yet</h3>
          <p className="text-slate-500">Create your first Prelims Test or Mains Test to start practice.</p>
        </div>
      ) : (
        <div className="space-y-10">
          <section className="space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="text-2xl font-bold text-slate-900">Prelims Tests</h3>
              <span className="text-sm text-slate-500">{prelimsTests.length} items</span>
            </div>
            {prelimsTests.length === 0 ? (
              <div className="rounded-xl border border-dashed border-slate-200 bg-slate-50 p-8 text-sm text-slate-500">
                No Prelims Tests yet.
              </div>
            ) : (
              <TestGrid tests={prelimsTests} />
            )}
          </section>

          <section className="space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="text-2xl font-bold text-slate-900">Mains Tests</h3>
              <span className="text-sm text-slate-500">{mainsTests.length} items</span>
            </div>
            {mainsTests.length === 0 ? (
              <div className="rounded-xl border border-dashed border-slate-200 bg-slate-50 p-8 text-sm text-slate-500">
                No Mains Tests yet.
              </div>
            ) : (
              <TestGrid tests={mainsTests} />
            )}
          </section>
        </div>
      )}
    </AppLayout>
  );
}
