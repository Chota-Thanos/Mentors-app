import Link from "next/link";

import AppLayout from "@/components/layouts/AppLayout";
import ChallengeCreatorCard from "@/components/premium/ChallengeCreatorCard";
import HistoryBackButton from "@/components/ui/HistoryBackButton";
import { getCollectionTestKind } from "@/lib/collectionKind";
import { resolveCollectionSeriesId } from "@/lib/collectionNavigation";
import { richTextToPlainText } from "@/lib/richText";
import { createClient } from "@/lib/supabase/server";

interface PageProps {
  params: Promise<{ id: string }>;
}

type ContentRow = {
  id: number;
  title: string | null;
  type: string;
  data?: {
    description?: string;
    is_free?: boolean;
    url?: string;
  } | null;
};

type CollectionItemJoin = {
  content_items: ContentRow | ContentRow[] | null;
};

type ContentCardItem = ContentRow & {
  description?: string;
  is_free?: boolean;
  url?: string;
};

export default async function CollectionDetailPage({ params }: PageProps) {
  const { id } = await params;
  const supabase = await createClient();

  const { data: collection, error: collectionError } = await supabase
    .from("collections")
    .select("*")
    .eq("id", id)
    .single();

  if (collectionError || !collection) {
    console.error("Collection not found:", collectionError);
  }

  let contentItems: ContentCardItem[] = [];
  const { data: itemsData } = await supabase
    .from("collection_items")
    .select(`
      content_items (
        id,
        title,
        type,
        data
      )
    `)
    .eq("collection_id", id);

  if (itemsData) {
    contentItems = (itemsData as CollectionItemJoin[])
      .map((row) => (Array.isArray(row.content_items) ? (row.content_items[0] ?? null) : row.content_items))
      .filter((item): item is ContentRow => Boolean(item))
      .map((item) => ({
        ...item,
        description: item.data?.description,
        is_free: item.data?.is_free,
        url: item.data?.url,
      }));
  }

  const testKind = getCollectionTestKind(collection || null);
  const isMainsTest = testKind === "mains";
  const linkedSeriesId = resolveCollectionSeriesId(collection || null);
  const backFallbackHref = linkedSeriesId > 0 ? `/test-series/${linkedSeriesId}` : "/collections";
  const backLabel = linkedSeriesId > 0 ? "Back to Series" : "Back to Tests";

  return (
    <AppLayout>
      <div className="mb-8">
        <HistoryBackButton
          fallbackHref={backFallbackHref}
          label={backLabel}
          className="mb-4 inline-flex items-center text-sm text-slate-500 hover:text-slate-900"
          iconClassName="mr-1 h-4 w-4"
        />

        <div className="mt-2 flex flex-col items-start gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="space-y-2">
            <h1 className="text-4xl font-extrabold tracking-tight text-slate-900 sm:text-5xl">{collection?.title}</h1>
            <span
              className={`inline-flex items-center rounded-full px-3 py-1 text-xs font-semibold ${
                isMainsTest ? "bg-indigo-100 text-indigo-800" : "bg-blue-100 text-blue-800"
              }`}
            >
              {isMainsTest ? "Mains Test" : "Prelims Test"}
            </span>
          </div>

          <div className="flex items-center gap-2">
            <Link
              href={isMainsTest ? `/collections/${id}/mains-test` : `/collections/${id}/test`}
              className="inline-flex items-center rounded-md border border-indigo-600 bg-indigo-50 px-4 py-2 text-sm font-medium text-indigo-700 shadow-sm transition-colors hover:bg-indigo-100"
            >
              {isMainsTest ? "Open Mains Writing Desk" : "Start Prelims Test"}
            </Link>
            <Link
              href={`/collections/${id}/question-methods`}
              className="inline-flex items-center rounded-md border border-slate-900 bg-white px-4 py-2 text-sm font-medium text-slate-900 shadow-sm transition-colors hover:bg-slate-50"
            >
              {isMainsTest ? "+ Manage Mains Questions" : "+ Manage Quiz Questions"}
            </Link>
          </div>
        </div>

        <p className="mt-4 max-w-3xl text-xl text-slate-500">
          {richTextToPlainText(collection?.description || "") || "No description provided."}
        </p>

        <div className="mt-6 flex flex-wrap items-center gap-4">
          {collection?.is_premium ? (
            <span className="inline-flex items-center rounded-full bg-amber-100 px-3 py-1 text-sm font-medium text-amber-800 ring-1 ring-inset ring-amber-600/20">
              Premium Content
            </span>
          ) : (
            <span className="inline-flex items-center rounded-full bg-green-100 px-3 py-1 text-sm font-medium text-green-800 ring-1 ring-inset ring-green-600/20">
              Free Content
            </span>
          )}
          {collection?.price && collection.price > 0 ? (
            <span className="text-2xl font-bold text-slate-900">INR {collection.price}</span>
          ) : null}
        </div>

        <div className="mt-5 max-w-3xl">
          {isMainsTest ? (
            <p className="rounded-lg border border-indigo-100 bg-indigo-50 px-4 py-3 text-sm text-indigo-700">
              This is a Mains Test. Learners read the full paper, then submit one answer PDF or question-wise answer photos for mentor review and marking.
            </p>
          ) : (
            <ChallengeCreatorCard collectionId={id} collectionTitle={collection?.title || undefined} />
          )}
        </div>
      </div>

      <div className="mt-12 border-t border-slate-200 pt-8">
        <div className="mb-6 flex items-center justify-between">
          <h2 className="text-2xl font-bold">Test Content</h2>
          <span className="text-sm text-slate-500">{contentItems.length} items</span>
        </div>

        <div className="space-y-4">
          {!contentItems || contentItems.length === 0 ? (
            <div className="rounded-xl border-2 border-dashed border-slate-200 bg-slate-50 py-16 text-center">
              <div className="mx-auto mb-4 h-12 w-12 text-slate-300">
                <svg fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={1.5}
                    d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10"
                  />
                </svg>
              </div>
              <p className="font-medium text-slate-500">No content items added to this test yet.</p>
            </div>
          ) : (
            <div className="grid gap-4 md:grid-cols-1">
              {contentItems.map((content) => (
                <div
                  key={content.id}
                  className="group relative flex items-start space-x-4 rounded-xl border border-slate-200 bg-white p-5 transition-all hover:border-slate-300 hover:shadow-md"
                >
                  <div className="mt-1 flex-shrink-0">
                    {content.type === "video" ? (
                      <span className="flex h-10 w-10 items-center justify-center rounded-lg bg-red-50 text-red-600 ring-1 ring-red-100">
                        <svg className="h-5 w-5" fill="currentColor" viewBox="0 0 20 20">
                          <path d="M2 6a2 2 0 012-2h12a2 2 0 012 2v8a2 2 0 01-2 2H4a2 2 0 01-2-2V6zM14.553 7.106A1 1 0 0014 8v4a1 1 0 00.553.894l2 1A1 1 0 0018 13V7a1 1 0 00-1.447-.894l-2 1z" />
                        </svg>
                      </span>
                    ) : content.type === "pdf" ? (
                      <span className="flex h-10 w-10 items-center justify-center rounded-lg bg-blue-50 text-blue-600 ring-1 ring-blue-100">
                        <svg className="h-5 w-5" fill="currentColor" viewBox="0 0 20 20">
                          <path
                            fillRule="evenodd"
                            d="M4 4a2 2 0 012-2h4.586A2 2 0 0112 2.586L15.414 6A2 2 0 0116 7.414V16a2 2 0 01-2 2H6a2 2 0 01-2-2V4zm2 6a1 1 0 011-1h6a1 1 0 110 2H7a1 1 0 01-1-1zm1 3a1 1 0 100 2h6a1 1 0 100-2H7z"
                            clipRule="evenodd"
                          />
                        </svg>
                      </span>
                    ) : (
                      <span className="flex h-10 w-10 items-center justify-center rounded-lg bg-indigo-50 text-indigo-600 ring-1 ring-indigo-100">
                        <svg className="h-5 w-5" fill="currentColor" viewBox="0 0 20 20">
                          <path
                            fillRule="evenodd"
                            d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a1 1 0 000 2v3a1 1 0 001 1h1a1 1 0 100-2v-3a1 1 0 00-1-1H9z"
                            clipRule="evenodd"
                          />
                        </svg>
                      </span>
                    )}
                  </div>

                  <div className="min-w-0 flex-1">
                    <Link
                      href={{
                        pathname: content.type.startsWith("quiz") ? `/quiz/${content.id}` : `/content/${content.id}`,
                        query: { backTo: `/collections/${id}` },
                      }}
                      className="block focus:outline-none"
                    >
                      <span className="absolute inset-0" aria-hidden="true" />
                      <div className="flex items-center justify-between">
                        <p className="text-base font-semibold text-slate-900 transition-colors group-hover:text-blue-600">
                          {content.title}
                        </p>
                        <div className="ml-4 flex-shrink-0">
                          {content.is_free ? (
                            <span className="inline-flex items-center rounded-full bg-green-50 px-2.5 py-0.5 text-xs font-medium text-green-700 ring-1 ring-inset ring-green-600/20">
                              Free
                            </span>
                          ) : (
                            <span className="inline-flex items-center rounded-full bg-slate-100 px-2.5 py-0.5 text-xs font-medium text-slate-600 ring-1 ring-inset ring-slate-500/10">
                              Locked
                            </span>
                          )}
                        </div>
                      </div>
                      <p className="mt-1 line-clamp-2 text-sm text-slate-500">
                        {richTextToPlainText(content.description || "") || "Click to view content details and start learning."}
                      </p>
                    </Link>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </AppLayout>
  );
}
