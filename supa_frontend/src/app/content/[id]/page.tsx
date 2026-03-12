import Link from "next/link";
import { notFound } from "next/navigation";

import AppLayout from "@/components/layouts/AppLayout";
import HistoryBackButton from "@/components/ui/HistoryBackButton";
import { sanitizeInternalHref, toPositiveInt } from "@/lib/collectionNavigation";
import { createClient } from "@/lib/supabase/server";

interface PageProps {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ backTo?: string }>;
}

export default async function ContentItemPage({ params, searchParams }: PageProps) {
  const { id } = await params;
  const { backTo } = await searchParams;
  const supabase = await createClient();

  const { data: content, error } = await supabase
    .from("content_items")
    .select("*")
    .eq("id", id)
    .single();

  if (error || !content) {
    return notFound();
  }

  const { data: parentCollectionRows } = await supabase
    .from("collection_items")
    .select("collection_id")
    .eq("content_item_id", id)
    .limit(1);

  const parentCollectionId = Array.isArray(parentCollectionRows)
    ? toPositiveInt(parentCollectionRows[0]?.collection_id)
    : 0;
  const backFallbackHref = sanitizeInternalHref(
    backTo,
    parentCollectionId > 0 ? `/collections/${parentCollectionId}` : "/collections",
  );

  const description = content.data?.description || content.description;
  const url = content.data?.url || content.url;

  return (
    <AppLayout>
      <div className="mx-auto max-w-4xl py-8">
        <div className="mb-8">
          <HistoryBackButton
            fallbackHref={backFallbackHref}
            label="Back to Test"
            className="mb-4 inline-flex items-center text-sm text-slate-500 hover:text-slate-900"
            iconClassName="mr-1 h-4 w-4"
          />
          <div className="mt-4 flex items-center gap-3">
            {content.type === "video" ? (
              <span className="rounded-full bg-red-100 px-3 py-1 text-xs font-bold uppercase tracking-wider text-red-600">Video</span>
            ) : content.type === "pdf" ? (
              <span className="rounded-full bg-blue-100 px-3 py-1 text-xs font-bold uppercase tracking-wider text-blue-600">PDF Document</span>
            ) : (
              <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-bold uppercase tracking-wider text-slate-600">{content.type}</span>
            )}
          </div>
          <h1 className="mt-2 text-4xl font-extrabold tracking-tight text-slate-900">{content.title}</h1>
          <p className="mt-4 text-xl leading-relaxed text-slate-500">{description}</p>
        </div>

        <div className="flex min-h-[600px] items-center justify-center overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-xl">
          {url ? (
            content.type === "video" ? (
              <div className="aspect-video h-full w-full">
                <iframe
                  src={url.replace("watch?v=", "embed/")}
                  className="h-full w-full"
                  allowFullScreen
                />
              </div>
            ) : content.type === "pdf" ? (
              <embed src={url} type="application/pdf" className="h-full min-h-[800px] w-full" />
            ) : (
              <div className="p-12 text-center">
                <p className="mb-6 text-lg text-slate-600">This content is hosted externally.</p>
                <Link
                  href={url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center rounded-xl bg-slate-900 px-8 py-3 font-bold text-white transition-all hover:bg-slate-800"
                >
                  Open Content Link
                </Link>
              </div>
            )
          ) : (
            <div className="p-12 text-center">
              <p className="text-slate-500">No URL or content file provided for this item.</p>
            </div>
          )}
        </div>
      </div>
    </AppLayout>
  );
}
